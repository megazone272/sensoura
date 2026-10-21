/**
 * Prediction pipeline cycle (~daily).
 *
 * Data flow:
 *   1. read the current indoor snapshot + stored indoor history
 *   2. fetch external sources: Open-Meteo hourly forecast, ERA5-Land archive
 *      daily, air quality, NASA POWER hourly (each independently fault-tolerant)
 *   3. build predictions (external forecast, persistence baseline, GDD growth
 *      stage, late-blight weather risk, VOC policy, provider cross-check)
 *   4. persist external observations and predictions
 *
 * Provider failures never abort the cycle: the affected prediction is emitted
 * with an explicit `error` / `insufficient_data` status and no invented value.
 */
import type { PipelineConfig } from '../config.js';
import { hasCoordinates, resolveBackendPath } from '../config.js';
import type { PipelineStore } from '../storage/store.js';
import {
  readSeries,
  saveExternalObservations,
  saveIndoorObservations,
  savePrediction,
  saveSeriesPoint,
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
import {
  buildNasaPowerObservations,
  buildOpenMeteoObservations,
} from '../processing/external.js';
import { buildPredictions } from '../prediction/engine.js';
import {
  buildLegacyProjections,
  readLegacyPredictions,
  saveLegacyPredictionIfAbsent,
} from '../prediction/legacy.js';
import { resolveGreenhouseId } from './decision-cycle.js';
import { addDaysUtc, utcDayKey } from '../utils/time.js';
import { describeError } from '../utils/retry.js';
import type { HttpJsonClient, MinimalLogger } from '../integrations/http.js';
import {
  fetchOpenMeteoAirQuality,
  fetchOpenMeteoArchiveDaily,
  fetchOpenMeteoCurrent,
  fetchOpenMeteoHourlyRange,
  type DailyRows,
  type HourlyRows,
  type ProviderSnapshot,
} from '../integrations/open-meteo.js';
import { fetchNasaPowerHourly, type NasaPowerRows } from '../integrations/nasa-power.js';

export interface PredictionCycleDeps {
  cfg: PipelineConfig;
  store: PipelineStore;
  paths: PipelinePaths;
  http: HttpJsonClient;
  logger: MinimalLogger;
  now?: () => number;
}

export interface PredictionCycleResult {
  stats: {
    [key: string]: number | string | boolean | null;
  };
  warnings: string[];
  predictions: number;
}

export async function runPredictionCycle(deps: PredictionCycleDeps): Promise<PredictionCycleResult> {
  const { cfg, store, paths, http, logger } = deps;
  const nowMs = (deps.now ?? Date.now)();
  const warnings: string[] = [];
  const stats: PredictionCycleResult['stats'] = {};

  const greenhouseId = await resolveGreenhouseId(cfg, store);
  stats.greenhouseId = greenhouseId;

  // ---------------------------------------------------------------- 1. indoor
  const rawSensorData = await store.get<Record<string, unknown>>(cfg.SENSOR_DATA_PATH);
  const rawSystem = await store.get<{ deviceId?: string }>(cfg.SYSTEM_PATH);
  const deviceId = typeof rawSystem?.deviceId === 'string' ? rawSystem.deviceId : null;

  const series = await readSeries(store, paths.series, {
    sinceMs: nowMs - cfg.PREDICTION_LOOKBACK_DAYS * 86_400_000,
    maxPoints: cfg.PREDICTION_HISTORY_MAX_POINTS,
  });
  const history = seriesValues(series);

  const indoor = normalizeIndoorSnapshot(rawSensorData, {
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
  stats.historyPoints = series.length;

  // Calibration artifacts (if any) apply to the current snapshot only: the
  // stored history keeps the raw sensor values.
  let calibratedIndoor = indoor;
  if (cfg.AI_CALIBRATION_ENABLED) {
    const registry = await loadCalibrationRegistry(
      resolveBackendPath(cfg.AI_CALIBRATION_ARTIFACT_DIR)
    );
    const { applications } = applyCalibrationsToValues(registry, indoor.values);
    calibratedIndoor = applyCalibrationToSnapshot(indoor, applications);
    stats.calibrationArtifacts = registry.artifacts.size;
    stats.calibrationApplied = Object.values(applications).filter((a) => a.applied).length;
    for (const rejection of registry.rejected) {
      warnings.push(`calibration artifact rejected (${rejection.path}): ${rejection.reason}`);
    }
  }

  // ---------------------------------------------------------------- 2. external
  const providerErrors: Array<{ source: string; message: string }> = [];
  let currentWeather: ProviderSnapshot | null = null;
  let airQuality: ProviderSnapshot | null = null;
  let hourly: HourlyRows | null = null;
  let archiveDaily: DailyRows | null = null;
  let powerRows: NasaPowerRows | null = null;

  if (!hasCoordinates(cfg)) {
    warnings.push(
      'GREENHOUSE_LAT/GREENHOUSE_LON are not configured: every external-backed prediction is reported as unavailable'
    );
    stats.externalSources = 'disabled (no coordinates)';
  } else {
    if (cfg.EXTERNAL_SOURCES.includes('open-meteo')) {
      currentWeather = await safe('open-meteo:current', () => fetchOpenMeteoCurrent(cfg, http, nowMs), providerErrors, warnings, logger);
      airQuality = await safe('open-meteo:air-quality', () => fetchOpenMeteoAirQuality(cfg, http, nowMs), providerErrors, warnings, logger);
      hourly = await safe(
        'open-meteo:hourly',
        () =>
          fetchOpenMeteoHourlyRange(cfg, http, {
            pastDays: cfg.PREDICTION_LOOKBACK_DAYS,
            forecastDays: Math.max(1, Math.ceil((cfg.PREDICTION_HORIZONS_HOURS.at(-1) ?? 24) / 24)),
            nowMs,
          }),
        providerErrors,
        warnings,
        logger
      );
      archiveDaily = await safe(
        'open-meteo:archive',
        () =>
          fetchOpenMeteoArchiveDaily(cfg, http, {
            startDate: utcDayKey(addDaysUtc(nowMs, -(cfg.PREDICTION_LOOKBACK_DAYS + 10) * 86_400_000)),
            endDate: utcDayKey(addDaysUtc(nowMs, -5 * 86_400_000)),
          }),
        providerErrors,
        warnings,
        logger
      );
    }
    if (cfg.EXTERNAL_SOURCES.includes('nasa-power')) {
      powerRows = await safe(
        'nasa-power:hourly',
        () =>
          fetchNasaPowerHourly(cfg, http, {
            startDate: utcDayKey(addDaysUtc(nowMs, -3 * 86_400_000)),
            endDate: utcDayKey(nowMs),
          }),
        providerErrors,
        warnings,
        logger
      );
    }
  }

  stats.providerErrors = providerErrors.length;

  // ---------------------------------------------------------------- 3. predict
  const { predictions, notes } = buildPredictions({
    cfg,
    greenhouseId,
    nowMs,
    indoor: calibratedIndoor,
    series,
    currentWeather,
    hourly,
    archiveDaily,
    airQuality,
    powerRows,
    providerErrors,
  });
  stats.predictions = predictions.length;
  warnings.push(...notes);

  // ------------------------------------------------- 3b. legacy compatibility
  // Read the pre-existing `/Sensoura/aiPredictions` node with its verified
  // structure. It is the source of the "previous prediction" context and the
  // target the new records are appended to.
  const legacyBefore = await readLegacyPredictions(store, paths.legacyPredictions);
  stats.legacyRecordsRead = legacyBefore.records.length;
  stats.legacyRecordsInvalid = legacyBefore.invalid.length;
  if (legacyBefore.invalid.length > 0) {
    warnings.push(
      `${legacyBefore.invalid.length} existing record(s) in ${paths.legacyPredictions} do not match the legacy contract: ` +
        legacyBefore.invalid
          .slice(0, 3)
          .map((r) => `${r.key} (${r.issues.join('; ')})`)
          .join(', ')
    );
  }

  const projections = buildLegacyProjections(predictions, legacyBefore.records, nowMs);
  stats.legacyProjections = projections.length;

  if (cfg.PIPELINE_DRY_RUN) {
    warnings.push('PIPELINE_DRY_RUN=true: nothing was written to Firebase');
    return { stats, warnings, predictions: predictions.length };
  }

  // ---------------------------------------------------------------- 4. persist
  if (indoor) {
    const observations = indoorObservations(calibratedIndoor, cfg);
    await saveIndoorObservations(store, paths.indoorObservations, observations);
    await saveSeriesPoint(store, paths.series, toSeriesPoint(calibratedIndoor));
  }

  if (currentWeather) {
    const records = buildOpenMeteoObservations(cfg, currentWeather, {
      nowMs,
      greenhouseId,
      referenceMs: nowMs,
      maxDeltaSeconds: cfg.EXTERNAL_MATCH_MAX_DELTA_SECONDS,
      maxDistanceKm: cfg.MAX_PROVIDER_DISTANCE_KM,
    });
    await saveExternalObservations(store, paths.externalObservations, 'open-meteo', records);
    stats.externalObservations = records.length;
  }
  if (airQuality) {
    const records = buildOpenMeteoObservations(cfg, airQuality, {
      nowMs,
      greenhouseId,
      referenceMs: nowMs,
      maxDeltaSeconds: cfg.EXTERNAL_MATCH_MAX_DELTA_SECONDS,
      maxDistanceKm: cfg.MAX_PROVIDER_DISTANCE_KM,
    });
    await saveExternalObservations(store, paths.externalObservations, 'open-meteo', records);
  }
  if (powerRows) {
    const records = buildNasaPowerObservations(cfg, powerRows, {
      nowMs,
      greenhouseId,
      referenceMs: nowMs,
      maxDeltaSeconds: cfg.EXTERNAL_MATCH_MAX_DELTA_SECONDS,
      maxDistanceKm: cfg.MAX_PROVIDER_DISTANCE_KM,
    });
    await saveExternalObservations(store, paths.externalObservations, 'nasa-power', records);
  }

  for (const prediction of predictions) {
    await savePrediction(store, paths.predictions, prediction);
  }

  // Append the legacy-shaped projections. Existing records keep their keys and
  // their content: a projection is only written when its id is free.
  if (cfg.AI_LEGACY_PREDICTIONS_WRITE && projections.length > 0) {
    let written = 0;
    let skipped = 0;
    for (const projection of projections) {
      const outcome = await saveLegacyPredictionIfAbsent(
        store,
        paths.legacyPredictions,
        projection.id,
        projection.record
      );
      if (outcome === 'written') written++;
      else skipped++;
    }
    stats.legacyProjectionsWritten = written;
    stats.legacyProjectionsSkipped = skipped;
    if (skipped > 0) {
      warnings.push(
        `${skipped} legacy projection(s) were skipped because a record already exists under that id`
      );
    }
  }

  return { stats, warnings, predictions: predictions.length };
}

/** Run a provider call; a failure degrades one target instead of the cycle. */
async function safe<T>(
  source: string,
  fn: () => Promise<T>,
  errors: Array<{ source: string; message: string }>,
  warnings: string[],
  logger: MinimalLogger
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const described = describeError(error);
    errors.push({ source, message: described.message });
    warnings.push(`${source} failed: ${described.message}`);
    logger.warn({ source, code: described.kind, retryable: described.retryable }, 'Provider call failed');
    return null;
  }
}
