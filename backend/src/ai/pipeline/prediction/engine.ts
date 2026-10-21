/**
 * AI Prediction Engine (daily).
 *
 * Emits one record per target so unsupported targets are visible rather than
 * silently missing:
 *  - outdoor weather forecast      -> provider model output (NOT our model)
 *  - indoor persistence baseline  -> measurable baseline with backtest metrics
 *  - growth stage (GDD)           -> derived index; thresholds must be configured
 *  - late-blight weather risk     -> documented rule, not a diagnosis
 *  - VOC estimate                 -> explicitly unsupported
 *  - source comparison            -> provider inter-check, not a prediction
 */
import type { PipelineConfig } from '../config.js';
import {
  PREDICTION_SCHEMA,
  sanitizePathKey,
  type IndoorSeriesPoint,
  type PredictionV1,
} from '../schema.js';
import type { ValidatedIndoorSnapshot } from '../utils/quality.js';
import { seriesValues } from '../utils/quality.js';
import type { DailyRows, HourlyRows, ProviderSnapshot } from '../integrations/open-meteo.js';
import type { NasaPowerRows } from '../integrations/nasa-power.js';
import {
  addHours,
  compactUtcStamp,
  localDayKey,
  toIsoUtc,
  utcDayKey,
} from '../utils/time.js';
import { roundTo } from '../utils/units.js';
import { assessLateBlight } from './late-blight.js';
import { backtestPersistence } from './persistence.js';
import { computeGddSeries, projectThreshold, type DailyTemperature } from './gdd.js';
import { evaluateVocEstimationSupport, VOC_POLICY } from '../calibration/registry.js';

export interface PredictionInput {
  cfg: PipelineConfig;
  greenhouseId: string;
  nowMs: number;
  indoor: ValidatedIndoorSnapshot | null;
  series: readonly IndoorSeriesPoint[];
  currentWeather: ProviderSnapshot | null;
  hourly: HourlyRows | null;
  archiveDaily: DailyRows | null;
  airQuality: ProviderSnapshot | null;
  powerRows: NasaPowerRows | null;
  providerErrors: Array<{ source: string; message: string }>;
}

export interface PredictionOutput {
  predictions: PredictionV1[];
  notes: string[];
}

export function buildPredictions(input: PredictionInput): PredictionOutput {
  const { cfg, greenhouseId, nowMs } = input;
  const generatedAt = toIsoUtc(nowMs);
  const minuteBucket = compactUtcStamp(Math.floor(nowMs / 60_000) * 60_000);
  const predictions: PredictionV1[] = [];
  const notes: string[] = [];

  const dataQuality = {
    status:
      input.indoor === null
        ? ('degraded' as const)
        : input.indoor.overallQuality === 'ok'
          ? ('ok' as const)
          : input.indoor.overallQuality === 'invalid'
            ? ('invalid' as const)
            : input.indoor.overallQuality === 'stale'
              ? ('stale' as const)
              : ('degraded' as const),
    reasons: input.indoor?.reasons ?? ['no current indoor snapshot available'],
  };

  const make = (
    type: PredictionV1['predictionType'],
    target: string,
    fields: Partial<PredictionV1> & Pick<PredictionV1, 'status' | 'modelVersion' | 'methodClass'>
  ): PredictionV1 => {
    const id = `pred_${sanitizePathKey(type)}_${sanitizePathKey(target)}_${minuteBucket}`;
    return {
      schemaVersion: PREDICTION_SCHEMA,
      predictionId: id,
      greenhouseId,
      generatedAt,
      generatedAtMs: nowMs,
      predictionType: type,
      target,
      predictedValue: null,
      unit: null,
      forecastHorizon: null,
      probability: null,
      riskLevel: null,
      uncertainty: null,
      inputSummary: {},
      dataQuality,
      validationMetrics: null,
      notes: [],
      ...fields,
    };
  };

  // ------------------------------------------------------------------
  // A. Outdoor environmental forecast (external provider, not our model)
  // ------------------------------------------------------------------
  if (input.hourly && input.hourly.rows.length > 0) {
    for (const horizon of cfg.PREDICTION_HORIZONS_HOURS) {
      const windowEnd = nowMs + horizon * 3_600_000;
      const rows = input.hourly.rows.filter((r) => r.atMs >= nowMs - 1_800_000 && r.atMs <= windowEnd);
      const samples = rows.length;
      if (samples === 0) {
        notes.push(`no provider forecast rows in the ${horizon} h window`);
        continue;
      }

      const series = (name: string) => rows.map((r) => r.values[name]).filter((v): v is number => typeof v === 'number');
      const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

      const targets: Array<{ target: string; value: number | null; unit: string; aggregate: 'mean' | 'sum' }> = [
        { target: 'outdoor_air_temperature', value: mean(series('temperature_2m')), unit: 'degC', aggregate: 'mean' },
        { target: 'outdoor_relative_humidity', value: mean(series('relative_humidity_2m')), unit: '%', aggregate: 'mean' },
        { target: 'outdoor_shortwave_radiation', value: mean(series('shortwave_radiation')), unit: 'W/m2', aggregate: 'mean' },
        {
          target: 'outdoor_precipitation',
          value: series('precipitation').length ? roundTo(series('precipitation').reduce((a, b) => a + b, 0), 2) : null,
          unit: 'mm',
          aggregate: 'sum',
        },
      ];

      for (const t of targets) {
        if (t.value === null) {
          notes.push(`provider ${t.target} has no values in the ${horizon} h window`);
          continue;
        }
        predictions.push(
          make('environmental_forecast', `${t.target}_${horizon}h`, {
            predictedValue: roundTo(t.value, 2),
            unit: t.unit,
            forecastHorizon: { hours: horizon, validFrom: generatedAt, validTo: toIsoUtc(windowEnd) },
            status: 'external_forecast',
            methodClass: 'external_provider',
            modelVersion: 'open-meteo:best_match',
            dataQuality: {
              status: samples >= horizon * 0.75 ? 'ok' : 'degraded',
              reasons:
                samples >= horizon * 0.75
                  ? []
                  : [`only ${samples} of ~${horizon} hourly provider values in the window`],
            },
            inputSummary: {
              sourceId: 'open-meteo',
              provider: 'Open-Meteo',
              product: 'forecast (best_match)',
              grid: input.hourly.grid,
              requestUrl: input.hourly.requestUrl,
              sampleCount: samples,
              aggregation: `${t.aggregate} over ${horizon} h`,
              providerDeterministic: true,
            },
            notes: [
              'Provider model output, not a model trained by this pipeline.',
              'The deterministic endpoint does not return ensemble spread, so uncertainty is not reported.',
              'Outdoor grid-cell forecast; it does not predict greenhouse interior conditions.',
            ],
          })
        );
      }
    }
  } else {
    predictions.push(
      make('environmental_forecast', 'outdoor_weather', {
        status: 'error',
        methodClass: 'external_provider',
        modelVersion: 'open-meteo:best_match',
        dataQuality: { status: 'invalid', reasons: input.providerErrors.map((e) => `${e.source}: ${e.message}`) },
        notes: [
          'Outdoor forecast unavailable; no values were invented.',
          ...input.providerErrors.map((e) => `${e.source}: ${e.message}`),
        ],
        inputSummary: { providerErrors: input.providerErrors },
      })
    );
  }

  // ------------------------------------------------------------------
  // B. Indoor persistence baseline (measurable, no ML claim)
  // ------------------------------------------------------------------
  const valuesByVar = seriesValues([...input.series]);
  const baselineTargets: Array<{ varName: string; unit: string }> = [
    { varName: 'air_temperature', unit: 'degC' },
    { varName: 'soil_moisture_index', unit: '%' },
  ];
  if (input.series.length === 0) {
    notes.push('no stored indoor history yet: persistence baselines require the decision pipeline to have run');
  }

  for (const target of baselineTargets) {
    const points = valuesByVar[target.varName] ?? [];
    for (const horizon of cfg.BASELINE_HORIZONS_HOURS) {
      const backtest = backtestPersistence(points, {
        horizonHours: horizon,
        toleranceMinutes: cfg.BASELINE_MATCH_TOLERANCE_MIN,
        minSamples: cfg.BASELINE_MIN_SAMPLES,
      });
      const idTarget = `${target.varName}_${horizon}h`;
      if (!backtest.supported || backtest.forecast === null) {
        predictions.push(
          make('indoor_baseline_forecast', idTarget, {
            status: 'insufficient_data',
            methodClass: 'baseline',
            modelVersion: 'baseline-persistence-v1',
            unit: target.unit,
            inputSummary: {
              variable: target.varName,
              historyPoints: points.length,
              horizonHours: horizon,
              toleranceMinutes: cfg.BASELINE_MATCH_TOLERANCE_MIN,
            },
            notes: ['Persistence baseline not reported because its backtest requirements are not met.', ...backtest.reasons],
            dataQuality: { status: 'degraded', reasons: backtest.reasons },
          })
        );
        continue;
      }

      const metrics = backtest.metrics;
      predictions.push(
        make('indoor_baseline_forecast', idTarget, {
          predictedValue: backtest.forecast,
          unit: target.unit,
          forecastHorizon: { hours: horizon, validFrom: generatedAt, validTo: toIsoUtc(addHours(nowMs, horizon)) },
          status: 'ok',
          methodClass: 'baseline',
          modelVersion: 'baseline-persistence-v1',
          uncertainty:
            backtest.residualStd === null
              ? null
              : {
                  method: 'residual_std',
                  value: backtest.residualStd,
                  unit: target.unit,
                  sampleSize: metrics?.sampleSize ?? 0,
                },
          validationMetrics: metrics
            ? [
                { metric: 'MAE', value: metrics.MAE, unit: target.unit, sampleSize: metrics.sampleSize, method: 'walk-forward persistence backtest' },
                { metric: 'RMSE', value: metrics.RMSE, unit: target.unit, sampleSize: metrics.sampleSize, method: 'walk-forward persistence backtest' },
                { metric: 'bias', value: metrics.bias, unit: target.unit, sampleSize: metrics.sampleSize, method: 'walk-forward persistence backtest' },
              ]
            : null,
          inputSummary: {
            variable: target.varName,
            historyPoints: points.length,
            horizonHours: horizon,
            lastObservedAt: toIsoUtc(points[points.length - 1].ms),
          },
          dataQuality,
          notes: [
            'Baseline persistence forecast (last value carried forward), NOT a trained ML model.',
            'Metrics come from a walk-forward backtest on this greenhouse’s stored history; overlapping samples are not independent.',
            ...backtest.reasons,
          ],
        })
      );
    }
  }

  // ------------------------------------------------------------------
  // C. Growth stage (GDD) — only with planting date + configured thresholds
  // ------------------------------------------------------------------
  predictions.push(buildGrowthStagePrediction(input, make));

  // ------------------------------------------------------------------
  // D. Late blight weather risk
  // ------------------------------------------------------------------
  if (input.hourly && input.hourly.rows.length > 0) {
    const blightDays = input.hourly.rows
      .map((r) => ({
        atMs: r.atMs,
        tempC: typeof r.values.temperature_2m === 'number' ? r.values.temperature_2m : null,
        rhPct: typeof r.values.relative_humidity_2m === 'number' ? r.values.relative_humidity_2m : null,
      }))
      .filter((r) => r.tempC !== null && r.rhPct !== null);

    const assessment = assessLateBlight(blightDays, {
      timeZone: cfg.GREENHOUSE_TIMEZONE,
      rhThresholdPct: cfg.BLIGHT_RH_THRESHOLD_PCT,
      minHumidHours: cfg.BLIGHT_MIN_HUMID_HOURS,
      minTempC: cfg.BLIGHT_MIN_TEMP_C,
      nowMs,
    });

    predictions.push(
      make('disease_risk', 'late_blight_smith_period', {
        predictedValue: assessment.days.map((d) => ({
          date: d.dateKey,
          riskLevel: d.riskLevel,
          humidHours: d.humidHours,
          minTempC: d.minTempC,
          complete: d.complete,
          conditionsMet: d.conditionsMet,
          reasons: d.reasons,
        })),
        riskLevel: assessment.overallRisk,
        status: 'ok',
        methodClass: 'rule_based',
        modelVersion: 'smith-period-v1',
        forecastHorizon: {
          hours: cfg.BLIGHT_FORECAST_DAYS * 24,
          validFrom: generatedAt,
          validTo: toIsoUtc(addHours(nowMs, cfg.BLIGHT_FORECAST_DAYS * 24)),
        },
        inputSummary: {
          sourceId: 'open-meteo',
          grid: input.hourly.grid,
          hourlySamples: blightDays.length,
          timezone: cfg.GREENHOUSE_TIMEZONE,
          criteria: {
            rhThresholdPct: cfg.BLIGHT_RH_THRESHOLD_PCT,
            minHumidHours: cfg.BLIGHT_MIN_HUMID_HOURS,
            minTempC: cfg.BLIGHT_MIN_TEMP_C,
            consecutiveDays: 2,
          },
        },
        dataQuality: {
          status: assessment.days.some((d) => !d.complete) ? 'degraded' : 'ok',
          reasons: assessment.days.some((d) => !d.complete) ? ['one or more assessment days are incomplete'] : [],
        },
        notes: assessment.caveats,
      })
    );
  } else {
    predictions.push(
      make('disease_risk', 'late_blight_smith_period', {
        status: 'insufficient_data',
        methodClass: 'rule_based',
        modelVersion: 'smith-period-v1',
        dataQuality: { status: 'invalid', reasons: ['hourly temperature/RH data unavailable'] },
        notes: ['Late-blight risk was not computed because hourly temperature/RH input is missing.'],
      })
    );
  }

  // ------------------------------------------------------------------
  // E. VOC estimate — explicitly unsupported
  // ------------------------------------------------------------------
  if (input.currentWeather) {
    void input.currentWeather;
  }
  const vocSupport = evaluateVocEstimationSupport({
    referenceVocSamples: 0,
    referenceInstrument: null,
    pairedLocalSamples: 0,
    hasR0Calibration: false,
    hasTemperatureHumidityCompensation: false,
  });
  predictions.push(
    make('voc_estimate', 'voc_index_from_mq135', {
      status: 'unsupported',
      methodClass: 'unavailable',
      modelVersion: 'not_available',
      dataQuality: { status: 'ok', reasons: [] },
      inputSummary: {
        localVariable: VOC_POLICY.localVariable,
        localUnit: VOC_POLICY.localUnit,
        equivalentExternalVariable: null,
        referenceSamples: 0,
      },
      notes: [
        VOC_POLICY.statement,
        'No VOC estimate is produced. The raw MQ135 index is stored unchanged.',
        ...vocSupport.reasons,
        ...vocSupport.requiredBeforeEstimating,
      ],
    })
  );

  // ------------------------------------------------------------------
  // F. Provider cross-check (diagnostic, not a forecast)
  // ------------------------------------------------------------------
  const crossCheck = buildSourceComparison(input);
  if (crossCheck) {
    predictions.push(
      make('source_comparison', 'outdoor_reference_cross_check', {
        predictedValue: crossCheck.values,
        status: 'ok',
        methodClass: 'measured_derived',
        modelVersion: 'provider-cross-check-v1',
        inputSummary: crossCheck.inputSummary,
        notes: [
          'This is an inter-source agreement diagnostic, not a forecast and not a calibration.',
          'NASA POWER T2M/RH2M are reanalysis; Open-Meteo archive is ERA5-Land reanalysis. Both are modeled outdoor values.',
          'Differences reflect grid resolution, model/assimilation differences and time aggregation — they are not sensor bias.',
        ],
      })
    );
  }

  notes.push(
    'No trained machine-learning model is used: no labelled growth-stage or disease dataset exists in this repository, ' +
      'and the legacy tfjs models were trained on synthetic data.'
  );

  return { predictions, notes };
}

type MakeFn = (
  type: PredictionV1['predictionType'],
  target: string,
  fields: Partial<PredictionV1> & Pick<PredictionV1, 'status' | 'modelVersion' | 'methodClass'>
) => PredictionV1;

function buildGrowthStagePrediction(input: PredictionInput, make: MakeFn): PredictionV1 {
  const { cfg, nowMs } = input;
  const plantingDate = cfg.POTATO_PLANTING_DATE;

  if (!plantingDate) {
    return make('growth_stage', 'potato_gdd_stages', {
      status: 'insufficient_configuration',
      methodClass: 'measured_derived',
      modelVersion: 'gdd-mean-method-v1',
      dataQuality: { status: 'degraded', reasons: ['POTATO_PLANTING_DATE is not configured'] },
      inputSummary: { plantingDate: null, cultivar: cfg.POTATO_CULTIVAR ?? null, baseTempC: cfg.POTATO_BASE_TEMP_C },
      notes: [
        'Growth-stage prediction was not produced because the planting date is unknown.',
        'Set POTATO_PLANTING_DATE (YYYY-MM-DD) and cultivar-specific GDD thresholds to enable it.',
      ],
    });
  }

  const dailyMeans = new Map<string, number | null>();
  for (const row of input.archiveDaily?.rows ?? []) {
    const v = row.values.temperature_2m_mean;
    if (typeof v === 'number') dailyMeans.set(row.dateKey, v);
  }

  if (input.hourly) {
    const byDay = new Map<string, number[]>();
    for (const row of input.hourly.rows) {
      const t = row.values.temperature_2m;
      if (typeof t !== 'number') continue;
      const key = localDayKey(row.atMs, cfg.GREENHOUSE_TIMEZONE);
      (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(t);
    }
    for (const [key, temps] of byDay) {
      // Prefer the archive mean where both exist; hourly fills the recent gap.
      if (!dailyMeans.has(key) || dailyMeans.get(key) === null) {
        dailyMeans.set(key, temps.reduce((a, b) => a + b, 0) / temps.length);
      }
    }
  }

  const todayKey = localDayKey(nowMs, cfg.GREENHOUSE_TIMEZONE);
  const daily: DailyTemperature[] = [...dailyMeans.entries()]
    .filter(([date]) => date >= plantingDate)
    .map(([dateKey, meanTempC]) => ({ dateKey, meanTempC }));

  if (daily.length === 0) {
    return make('growth_stage', 'potato_gdd_stages', {
      status: 'insufficient_data',
      methodClass: 'measured_derived',
      modelVersion: 'gdd-mean-method-v1',
      dataQuality: { status: 'invalid', reasons: ['no provider daily temperatures overlap the planting period'] },
      inputSummary: { plantingDate, todayKey, baseTempC: cfg.POTATO_BASE_TEMP_C },
      notes: [
        'No daily temperature data covers the period since planting; no GDD was fabricated.',
        'Recent archive data may lag by several days.',
      ],
    });
  }

  const gdd = computeGddSeries(daily, cfg.POTATO_BASE_TEMP_C, { startDate: plantingDate, endDate: todayKey });
  const futureDays = daily.filter((d) => d.dateKey > todayKey);

  const stageTargets: Array<{ stage: string; threshold: number | undefined }> = [
    { stage: 'emergence', threshold: cfg.POTATO_GDD_EMERGENCE },
    { stage: 'flowering', threshold: cfg.POTATO_GDD_FLOWERING },
  ];

  const configuredTargets = stageTargets.filter(
    (t): t is { stage: string; threshold: number } => typeof t.threshold === 'number'
  );

  if (configuredTargets.length === 0) {
    return make('growth_stage', 'potato_gdd_stages', {
      status: 'insufficient_configuration',
      methodClass: 'measured_derived',
      modelVersion: 'gdd-mean-method-v1',
      predictedValue: {
        accumulatedGddToDate: gdd.cumulativeToDate,
        baseTempC: cfg.POTATO_BASE_TEMP_C,
        plantingDate,
        cultivar: cfg.POTATO_CULTIVAR ?? null,
        stageTargets: [],
      },
      unit: 'degC·day',
      dataQuality: {
        status: gdd.missingDays > 0 ? 'degraded' : 'ok',
        reasons: gdd.missingDays > 0 ? [`${gdd.missingDays} days without temperature data`] : [],
      },
      inputSummary: {
        plantingDate,
        todayKey,
        baseTempC: cfg.POTATO_BASE_TEMP_C,
        dailyObservations: gdd.days.length,
        missingDays: gdd.missingDays,
        source: 'Open-Meteo (ERA5-Land archive + forecast)',
      },
      notes: [
        'Accumulated GDD was computed, but no stage thresholds are configured so no stage date is estimated.',
        'POTATO_GDD_EMERGENCE / POTATO_GDD_FLOWERING must come from a cultivar-specific, cited source.',
        'GDD uses open-air provider temperatures, not greenhouse or soil temperatures.',
      ],
    });
  }

  const projections = configuredTargets.map((t) => ({
    stage: t.stage,
    ...projectThreshold({
      cumulativeGdd: gdd.cumulativeToDate,
      thresholdGdd: t.threshold,
      baseTempC: cfg.POTATO_BASE_TEMP_C,
      startDate: plantingDate,
      futureDays,
      lastObservedDate: todayKey,
    }),
  }));

  return make('growth_stage', 'potato_gdd_stages', {
    status: 'ok',
    methodClass: 'measured_derived',
    modelVersion: 'gdd-mean-method-v1',
    predictedValue: {
      accumulatedGddToDate: gdd.cumulativeToDate,
      baseTempC: cfg.POTATO_BASE_TEMP_C,
      plantingDate,
      cultivar: cfg.POTATO_CULTIVAR ?? null,
      stageTargets: projections.map((p) => ({
        stage: p.stage,
        thresholdGdd: p.thresholdGdd,
        projectedDate: p.projectedDate,
        daysFromPlanting: p.daysFromStart,
        reached: p.reached,
        reason: p.reason,
      })),
    },
    unit: 'degC·day',
    dataQuality: {
      status: gdd.missingDays > 0 ? 'degraded' : 'ok',
      reasons: gdd.missingDays > 0 ? [`${gdd.missingDays} days without temperature data`] : [],
    },
    inputSummary: {
      plantingDate,
      todayKey,
      baseTempC: cfg.POTATO_BASE_TEMP_C,
      dailyObservations: gdd.days.length,
      missingDays: gdd.missingDays,
      cultivar: cfg.POTATO_CULTIVAR ?? null,
      source: 'Open-Meteo (ERA5-Land archive + forecast)',
    },
    notes: [
      'GDD is a derived agronomic index, not a measurement.',
      'Stage dates depend on configured, cultivar-specific thresholds and on provider temperatures, not on greenhouse observations.',
      'Projections beyond the provider forecast horizon are reported as null rather than extrapolated.',
      'No growth-stage observations exist in the repository, so thresholds and dates are unvalidated for this site.',
    ],
  });
}

function buildSourceComparison(input: PredictionInput):
  | { values: Record<string, unknown>; inputSummary: Record<string, unknown> }
  | null {
  if (!input.powerRows || !input.archiveDaily) return null;
  const yesterday = utcDayKey(input.nowMs - 86_400_000);
  const powerDay = input.powerRows.rows.filter((r) => utcDayKey(r.atMs) === yesterday);
  if (powerDay.length < 12) return null;

  const powerTemps = powerDay
    .map((r) => r.values.T2M)
    .filter((v): v is number => typeof v === 'number');
  const powerRh = powerDay
    .map((r) => r.values.RH2M)
    .filter((v): v is number => typeof v === 'number');
  if (powerTemps.length === 0) return null;

  const archiveRow = input.archiveDaily.rows.find((r) => r.dateKey === yesterday);
  const archiveTemp = archiveRow?.values.temperature_2m_mean;
  const archiveRh = archiveRow?.values.relative_humidity_2m_mean;
  if (typeof archiveTemp !== 'number') return null;

  const powerMean = powerTemps.reduce((a, b) => a + b, 0) / powerTemps.length;
  const rhMean = powerRh.length ? powerRh.reduce((a, b) => a + b, 0) / powerRh.length : null;

  return {
    values: {
      date: yesterday,
      nasaPower: {
        T2M_mean_C: roundTo(powerMean, 2),
        RH2M_mean_pct: rhMean === null ? null : roundTo(rhMean, 2),
        hourlySamples: powerTemps.length,
      },
      openMeteoArchive: {
        temperature_2m_mean_C: typeof archiveTemp === 'number' ? roundTo(archiveTemp, 2) : null,
        relative_humidity_2m_mean_pct: typeof archiveRh === 'number' ? roundTo(archiveRh, 2) : null,
      },
      difference: {
        temperature_C: roundTo(powerMean - archiveTemp, 2),
        relativeHumidity_pct: rhMean !== null && typeof archiveRh === 'number' ? roundTo(rhMean - archiveRh, 2) : null,
      },
    },
    inputSummary: {
      date: yesterday,
      nasaPower: { requestUrl: input.powerRows.requestUrl, grid: input.powerRows.grid, units: input.powerRows.units },
      openMeteoArchive: { grid: input.archiveDaily.grid, units: input.archiveDaily.units },
    },
  };
}
