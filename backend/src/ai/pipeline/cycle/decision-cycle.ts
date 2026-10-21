/**
 * Decision pipeline cycle (~30 min).
 *
 * Data flow:
 *   1. read  /Sensoura/sensorData + /Sensoura/system  (read-only)
 *   2. validate + normalize the indoor snapshot
 *   3. read stored indoor history for trends and anomaly baselines
 *   4. fetch external context (Open-Meteo current + air quality), best effort
 *   5. evaluate crop constraints, candidate actions and safety checks
 *   6. persist observations, series point and recommendations
 *   7. assess outcomes of previously issued recommendations (observational)
 *
 * The cycle never writes to /Sensoura/commands and never changes the ESP32's
 * own safety logic.
 */
import type { PipelineConfig } from '../config.js';
import { equipmentFromConfig, hasCoordinates, resolveBackendPath } from '../config.js';
import { RULESET_VERSION, type SuggestionV1 } from '../schema.js';
import type { PipelineStore } from '../storage/store.js';
import {
  listRecentSuggestions,
  readSeries,
  saveIndoorObservations,
  saveSeriesPoint,
  saveSuggestion,
  type PipelinePaths,
} from '../storage/records.js';
import {
  applyCalibrationToSnapshot,
  indoorObservations,
  normalizeIndoorSnapshot,
  seriesValues,
  toSeriesPoint,
} from '../utils/quality.js';
import { applyCalibrationsToValues, loadCalibrationRegistry } from '../calibration/apply.js';
import { buildOutdoorContext, type OutdoorContext } from '../processing/external.js';
import { evaluateDecision, outcomeMetricFor } from '../decision/engine.js';
import { toIsoUtc } from '../utils/time.js';
import { roundTo } from '../utils/units.js';
import type { HttpJsonClient } from '../integrations/http.js';
import { fetchOpenMeteoAirQuality, fetchOpenMeteoCurrent } from '../integrations/open-meteo.js';
import { describeError } from '../utils/retry.js';
import type { MinimalLogger } from '../integrations/http.js';

export interface DecisionCycleDeps {
  cfg: PipelineConfig;
  store: PipelineStore;
  paths: PipelinePaths;
  http: HttpJsonClient;
  logger: MinimalLogger;
  now?: () => number;
}

export interface DecisionCycleResult {
  stats: {
    [key: string]: number | string | boolean | null;
  };
  warnings: string[];
  indoorQuality: string;
  recommendations: number;
  diagnostics: number;
}

interface SystemNode {
  deviceId?: string;
  status?: string;
  lastSeen?: number;
  relay?: { mode?: string; state?: string; reason?: string };
}

/** Resolve the greenhouse id: configuration first, then the device id. */
export async function resolveGreenhouseId(
  cfg: PipelineConfig,
  store: PipelineStore,
  fallback = 'sensoura-greenhouse-01'
): Promise<string> {
  if (cfg.GREENHOUSE_ID) return cfg.GREENHOUSE_ID;
  const system = await store.get<SystemNode>(cfg.SYSTEM_PATH);
  if (system?.deviceId && typeof system.deviceId === 'string' && system.deviceId.length > 0) {
    return system.deviceId;
  }
  return fallback;
}

export async function runDecisionCycle(deps: DecisionCycleDeps): Promise<DecisionCycleResult> {
  const { cfg, store, paths, http, logger } = deps;
  const nowMs = (deps.now ?? Date.now)();
  const warnings: string[] = [];

  const greenhouseId = await resolveGreenhouseId(cfg, store);
  const stats: DecisionCycleResult['stats'] = { greenhouseId };

  // ---------------------------------------------------------------- 1. read
  const rawSensorData = await store.get<Record<string, unknown>>(cfg.SENSOR_DATA_PATH);
  const rawSystem = await store.get<SystemNode>(cfg.SYSTEM_PATH);
  const deviceId = typeof rawSystem?.deviceId === 'string' ? rawSystem.deviceId : null;
  stats.sensorNodePresent = rawSensorData !== null;
  stats.deviceId = deviceId ?? '(none)';

  // ---------------------------------------------------------------- 3. history
  const historySince = nowMs - cfg.HISTORY_LOOKBACK_MS;
  const series = await readSeries(store, paths.series, {
    sinceMs: historySince,
    maxPoints: cfg.HISTORY_MAX_POINTS,
  });
  const history = seriesValues(series);

  // ---------------------------------------------------------------- 2. validate
  let indoor = normalizeIndoorSnapshot(rawSensorData, {
    greenhouseId,
    deviceId,
    nowMs,
    staleAfterMs: cfg.INDOOR_STALE_AFTER_MS,
    gasMaxRaw: cfg.SENSOR_GAS_MAX_RAW,
    lightMaxRaw: cfg.SENSOR_LIGHT_MAX_RAW,
    anomaly: { minSamples: cfg.ANOMALY_MIN_SAMPLES, zThreshold: cfg.ANOMALY_Z_THRESHOLD },
    history,
  });
  stats.indoorQuality = indoor.overallQuality;
  stats.indoorAgeMinutes = indoor.ageMinutes;
  stats.historyPoints = series.length;
  if (indoor.overallQuality !== 'ok') {
    warnings.push(`indoor data quality is ${indoor.overallQuality}: ${indoor.reasons.join('; ')}`);
  }

  // ------------------------------------------------- 2b. calibration artifacts
  // A calibration model only exists when `npm run ai:train` produced one from
  // paired reference measurements. Without such an artifact the raw sensor
  // values are used unchanged.
  if (cfg.AI_CALIBRATION_ENABLED) {
    const registry = await loadCalibrationRegistry(
      resolveBackendPath(cfg.AI_CALIBRATION_ARTIFACT_DIR)
    );
    const { applications } = applyCalibrationsToValues(registry, indoor.values);
    const applied = Object.values(applications).filter((a) => a.applied);
    indoor = applyCalibrationToSnapshot(indoor, applications);
    stats.calibrationArtifacts = registry.artifacts.size;
    stats.calibrationApplied = applied.length;
    for (const rejection of registry.rejected) {
      warnings.push(`calibration artifact rejected (${rejection.path}): ${rejection.reason}`);
    }
    for (const application of applied) {
      logger.info(
        { variable: application.variable, methodId: application.methodId },
        'Calibration applied to indoor reading'
      );
    }
  }

  // ---------------------------------------------------------------- 4. external
  let outdoor: OutdoorContext | null = null;
  const providerErrors: Array<{ source: string; message: string }> = [];
  if (hasCoordinates(cfg) && cfg.EXTERNAL_SOURCES.includes('open-meteo')) {
    try {
      const current = await fetchOpenMeteoCurrent(cfg, http, nowMs);
      let airQuality = null;
      try {
        airQuality = await fetchOpenMeteoAirQuality(cfg, http, nowMs);
      } catch (error) {
        const described = describeError(error);
        providerErrors.push({ source: 'open-meteo:air-quality', message: described.message });
        logger.warn({ err: described.message }, 'Air-quality fetch failed; continuing without it');
      }
      if (current) {
        outdoor = buildOutdoorContext(cfg, current, {
          nowMs,
          timeDeltaSeconds: roundTo((nowMs - current.observedAtMs) / 1000, 1),
          airQuality,
        });
      }
    } catch (error) {
      const described = describeError(error);
      providerErrors.push({ source: 'open-meteo:current', message: described.message });
      logger.warn({ err: described.message }, 'External weather fetch failed; continuing with indoor data only');
    }
  } else {
    warnings.push(
      hasCoordinates(cfg)
        ? 'open-meteo is not in EXTERNAL_SOURCES'
        : 'GREENHOUSE_LAT/GREENHOUSE_LON are not configured: external sources are disabled'
    );
  }
  stats.outdoorAvailable = outdoor !== null;
  stats.outdoorQuality = outdoor?.quality ?? 'unavailable';
  stats.providerErrors = providerErrors.length;

  // ---------------------------------------------------------------- 5. decide
  const previous = await listRecentSuggestions(store, paths.suggestions, 50);
  const evaluation = evaluateDecision({
    cfg,
    greenhouseId,
    nowMs,
    indoor,
    outdoor,
    series,
    previous: previous.map((p) => p.value),
    equipment: equipmentFromConfig(cfg),
  });

  stats.constraintsEvaluated = evaluation.constraints.length;
  stats.candidatesSkipped = evaluation.skipped.length;
  stats.suppressedByCooldown = evaluation.suppressedByCooldown;

  // ---------------------------------------------------------------- 6. persist
  if (cfg.PIPELINE_DRY_RUN) {
    warnings.push('PIPELINE_DRY_RUN=true: nothing was written to Firebase');
    return {
      stats: { ...stats, recommendations: evaluation.recommendations.length, diagnostics: evaluation.diagnostics.length },
      warnings,
      indoorQuality: indoor.overallQuality,
      recommendations: evaluation.recommendations.length,
      diagnostics: evaluation.diagnostics.length,
    };
  }

  const observations = indoorObservations(indoor, cfg);
  const written = await saveIndoorObservations(store, paths.indoorObservations, observations);
  stats.indoorObservations = written;

  await saveSeriesPoint(store, paths.series, toSeriesPoint(indoor));

  for (const record of [...evaluation.recommendations, ...evaluation.diagnostics]) {
    await saveSuggestion(store, paths.suggestions, record);
  }
  stats.recommendations = evaluation.recommendations.length;
  stats.diagnostics = evaluation.diagnostics.length;

  // ---------------------------------------------------------------- 7. outcomes
  const assessed = await assessOutcomes(deps, previous.map((p) => p.value), nowMs);
  stats.outcomesAssessed = assessed;
  if (assessed > 0) warnings.push(`${assessed} previously issued recommendation(s) were re-assessed`);

  return {
    stats,
    warnings,
    indoorQuality: indoor.overallQuality,
    recommendations: evaluation.recommendations.length,
    diagnostics: evaluation.diagnostics.length,
  };
}

/**
 * Re-assess open recommendations against the newest observation.
 * This is observational only: it records whether the tracked metric moved in
 * the expected direction. It is not a causal claim about the recommendation.
 */
async function assessOutcomes(
  deps: DecisionCycleDeps,
  previous: readonly SuggestionV1[],
  nowMs: number
): Promise<number> {
  const { cfg, store, paths, logger } = deps;
  if (previous.length === 0) return 0;

  const series = await readSeries(store, paths.series, {
    sinceMs: nowMs - cfg.OUTCOME_ASSESS_WINDOW_MS,
    maxPoints: cfg.HISTORY_MAX_POINTS,
  });
  if (series.length === 0) return 0;

  let assessed = 0;
  for (const suggestion of previous) {
    if (suggestion.status !== 'open') continue;
    if (suggestion.outcome !== null) continue;
    if (nowMs - suggestion.createdAtMs < cfg.OUTCOME_ASSESS_AFTER_MS) continue;

    const metric = outcomeMetricFor(suggestion.action.id);
    if (!metric) continue;

    const values = seriesValues(series)[metric] ?? [];
    const before = values.filter((p) => p.ms <= suggestion.createdAtMs);
    const after = values.filter((p) => p.ms > suggestion.createdAtMs);
    if (before.length === 0 || after.length === 0) continue;

    const baselineValue = before[before.length - 1].value;
    const observedValue = after[after.length - 1].value;
    const delta = roundTo(observedValue - baselineValue, 3);
    const direction = suggestion.expectedEffect.direction;

    let status: 'improved' | 'unchanged' | 'worsened' | 'unknown';
    if (direction === 'increase') status = delta > 0 ? 'improved' : delta < 0 ? 'worsened' : 'unchanged';
    else if (direction === 'decrease') status = delta < 0 ? 'improved' : delta > 0 ? 'worsened' : 'unchanged';
    else status = 'unknown';

    const updated: SuggestionV1 = {
      ...suggestion,
      outcome: {
        assessedAt: toIsoUtc(nowMs),
        status,
        metric,
        baselineValue,
        observedValue,
        delta,
        caveat:
          'Observational comparison of the tracked metric before and after the recommendation timestamp. ' +
          'This is not a causal attribution: the operator, the weather and the ESP32 logic all also changed.',
      },
    };

    if (cfg.PIPELINE_DRY_RUN) continue;
    await saveSuggestion(store, paths.suggestions, updated);
    assessed++;
  }

  if (assessed > 0) {
    logger.info({ assessed, ruleVersion: RULESET_VERSION }, 'Recommendation outcomes re-assessed');
  }
  return assessed;
}
