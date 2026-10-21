/**
 * Configuration for the AI data-integration / decision / prediction pipelines.
 *
 * Deliberately separate from `src/config/env.ts` (the legacy HTTP backend):
 * the pipelines run as their own process and need scheduling, source and
 * agronomic settings that the existing server does not use.
 *
 * Every value has an explicit default. Anything that would require inventing
 * data (coordinates, planting date, GDD thresholds, equipment capabilities)
 * is either absent or disabled by default and surfaced as a configuration
 * warning at startup — never silently assumed.
 */
import { z } from 'zod';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_PREDICTIONS_PATH } from './prediction/legacy.js';

/** Absolute path of the backend package root (…/backend). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Resolve a configuration path relative to the backend package root. */
export function resolveBackendPath(value: string): string {
  return isAbsolute(value) ? value : resolve(PACKAGE_ROOT, value);
}

/** Parse booleans the way humans write them in .env files ("false" is false). */
const bool = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return defaultValue;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return v; // let z.boolean() report the invalid value
  }, z.boolean());

const optionalNumber = () =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }, z.number().finite().optional());

const firebasePath = () =>
  z
    .string()
    .min(1)
    .transform((p) => {
      const withSlash = p.startsWith('/') ? p : `/${p}`;
      return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
    });

const isoDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'invalid calendar date');

const timeZone = () =>
  z.string().default('Africa/Cairo').refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'invalid IANA timezone');

export const pipelineConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // --- Process -----------------------------------------------------------
    PIPELINE_ENABLED: bool(true),
    PIPELINE_HOST: z.string().default('0.0.0.0'),
    PIPELINE_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    PIPELINE_DRY_RUN: bool(false),
    PIPELINE_ALLOW_MEMORY_FALLBACK: bool(false),
    PIPELINE_ADMIN_TOKEN: z.string().min(8).optional(),
    PIPELINE_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // --- Site / greenhouse --------------------------------------------------
    // Coordinates are intentionally unset: the repository contains no verified
    // location (only the country/region context). External sources stay
    // disabled until both are provided.
    GREENHOUSE_ID: z.string().min(1).optional(),
    GREENHOUSE_LAT: optionalNumber(),
    GREENHOUSE_LON: optionalNumber(),
    GREENHOUSE_TIMEZONE: timeZone(),

    // --- Existing database paths (read-only for the pipelines) --------------
    SENSOR_DATA_PATH: firebasePath().default('/Sensoura/sensorData'),
    SYSTEM_PATH: firebasePath().default('/Sensoura/system'),

    // --- Pipeline-owned paths (never the legacy /Sensoura/aiSuggestions) ----
    AI_DATA_ROOT: firebasePath().default('/Sensoura/AI_Data'),
    AI_SUGGESTIONS_PATH: firebasePath().default('/Sensoura/AI_Suggestions'),
    AI_PREDICTIONS_PATH: firebasePath().default('/Sensoura/AI_Predictions'),

    // --- Pre-existing prediction node (append-only compatibility target) ---
    // The live node already contains records such as
    //   "3001": { type: "rainfall", predictedValue: "after 2 days afternoon",
    //             confidence: 0.85, predictionTime: 1791867600000 }
    // New records are APPENDED under deterministic ids; existing records are
    // never modified, overwritten or deleted.
    AI_LEGACY_PREDICTIONS_PATH: firebasePath().default(LEGACY_PREDICTIONS_PATH),
    AI_LEGACY_PREDICTIONS_WRITE: bool(true),

    // --- Scheduling ---------------------------------------------------------
    DECISION_ENABLED: bool(true),
    DECISION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
    DECISION_RUN_ON_START: bool(true),
    PREDICTION_ENABLED: bool(true),
    PREDICTION_INTERVAL_MS: z.coerce.number().int().min(3_600_000).default(24 * 60 * 60_000),
    PREDICTION_RUN_ON_START: bool(true),
    SCHEDULER_STARTUP_DELAY_MS: z.coerce.number().int().min(0).default(5_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(20_000),
    LOCK_TTL_MS: z.coerce.number().int().min(60_000).default(15 * 60_000),

    // --- Freshness / validation --------------------------------------------
    // Firmware publishes every 5 s. 15 min tolerates network hiccups while
    // still catching a dead node before recommendations are emitted.
    INDOOR_STALE_AFTER_MS: z.coerce.number().int().min(60_000).default(15 * 60_000),
    EXTERNAL_STALE_AFTER_MS: z.coerce.number().int().min(60_000).default(3 * 60 * 60_000),
    EXTERNAL_MATCH_MAX_DELTA_SECONDS: z.coerce.number().int().min(60).default(3_600),
    MAX_PROVIDER_DISTANCE_KM: z.coerce.number().min(1).default(50),
    ANOMALY_Z_THRESHOLD: z.coerce.number().min(1).default(6),
    ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(4).default(8),
    SENSOR_GAS_MAX_RAW: z.coerce.number().min(1).default(4095),
    SENSOR_LIGHT_MAX_RAW: z.coerce.number().min(1).default(4095),

    // --- External HTTP ------------------------------------------------------
    EXTERNAL_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(15_000),
    EXTERNAL_HTTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
    EXTERNAL_HTTP_BASE_DELAY_MS: z.coerce.number().int().min(50).default(1_000),
    EXTERNAL_HTTP_MIN_GAP_MS: z.coerce.number().int().min(0).default(1_000),
    EXTERNAL_HTTP_MAX_RESPONSE_BYTES: z.coerce.number().int().min(10_000).default(5_000_000),
    EXTERNAL_SOURCES: z
      .string()
      .default('open-meteo,nasa-power')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
      .pipe(z.array(z.enum(['open-meteo', 'nasa-power']))),

    OPEN_METEO_FORECAST_URL: z.string().url().default('https://api.open-meteo.com/v1/forecast'),
    OPEN_METEO_ARCHIVE_URL: z.string().url().default('https://archive-api.open-meteo.com/v1/archive'),
    OPEN_METEO_AIR_QUALITY_URL: z.string().url().default('https://air-quality-api.open-meteo.com/v1/air-quality'),
    NASA_POWER_HOURLY_URL: z
      .string()
      .url()
      .default('https://power.larc.nasa.gov/api/temporal/hourly/point'),

    // Provider data does not change every 30 minutes; cache aggressively.
    OPEN_METEO_CURRENT_CACHE_MS: z.coerce.number().int().min(60_000).default(15 * 60_000),
    OPEN_METEO_AIR_QUALITY_CACHE_MS: z.coerce.number().int().min(60_000).default(60 * 60_000),
    OPEN_METEO_HOURLY_CACHE_MS: z.coerce.number().int().min(60_000).default(60 * 60_000),
    OPEN_METEO_ARCHIVE_CACHE_MS: z.coerce.number().int().min(60_000).default(6 * 60 * 60_000),
    NASA_POWER_CACHE_MS: z.coerce.number().int().min(60_000).default(12 * 60 * 60_000),

    // --- Calibration artifacts -------------------------------------------
    // Calibration models are produced by `npm run ai:train` from paired
    // reference measurements. No such data exists yet, so the pipeline keeps
    // using the raw sensor values until an operator supplies it.
    AI_CALIBRATION_ENABLED: bool(true),
    AI_CALIBRATION_ARTIFACT_DIR: z.string().min(1).default('models/calibration'),

    // --- Installed equipment (verified from firmware/src/main.ino) ---------
    // The node has: pump relay (GPIO10), buzzer (GPIO11), LEDs. There is NO
    // ventilation, fan or supplemental lighting hardware in the firmware.
    EQUIPMENT_PUMP: bool(true),
    EQUIPMENT_BUZZER: bool(true),
    EQUIPMENT_VENTILATION: bool(false),
    EQUIPMENT_VENTILATION_FAN: bool(false),
    EQUIPMENT_HUMIDIFIER_FAN: bool(false),
    EQUIPMENT_SUPPLEMENTAL_LIGHT: bool(false),

    // Irrigation must stay independent of AI unless explicitly approved.
    AI_ALLOW_IRRIGATION_RECOMMENDATIONS: bool(false),
    AI_ALLOW_BUZZER_ALERTS: bool(false),

    // --- Recommendation behaviour ------------------------------------------
    SUGGESTION_TTL_MS: z.coerce.number().int().min(60_000).default(2 * 60 * 60_000),
    RECOMMENDATION_COOLDOWN_MS: z.coerce.number().int().min(60_000).default(2 * 60 * 60_000),
    MAX_RECOMMENDATIONS_PER_RUN: z.coerce.number().int().min(1).max(20).default(4),
    OUTCOME_ASSESS_AFTER_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
    OUTCOME_ASSESS_WINDOW_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60_000),
    HISTORY_LOOKBACK_MS: z.coerce.number().int().min(60_000).default(7 * 24 * 60 * 60_000),
    HISTORY_MAX_POINTS: z.coerce.number().int().min(10).default(720),

    // --- Potato agronomy (initial review-required defaults) -----------------
    POTATO_CULTIVAR: z.string().min(1).optional(),
    POTATO_PLANTING_DATE: isoDate().optional(),
    POTATO_BASE_TEMP_C: z.coerce.number().min(0).max(15).default(7),
    POTATO_GDD_EMERGENCE: optionalNumber(),
    POTATO_GDD_FLOWERING: optionalNumber(),
    POTATO_AIR_TEMP_OPTIMAL_MIN_C: z.coerce.number().default(15),
    POTATO_AIR_TEMP_OPTIMAL_MAX_C: z.coerce.number().default(24),
    POTATO_AIR_TEMP_CRITICAL_MAX_C: z.coerce.number().default(30),
    POTATO_AIR_TEMP_CRITICAL_MIN_C: z.coerce.number().default(2),
    POTATO_HUMIDITY_OPTIMAL_MIN_PCT: z.coerce.number().min(0).max(100).default(60),
    POTATO_HUMIDITY_OPTIMAL_MAX_PCT: z.coerce.number().min(0).max(100).default(85),
    POTATO_SOIL_MOISTURE_INDEX_MIN: z.coerce.number().min(0).max(100).default(30),
    POTATO_SOIL_MOISTURE_INDEX_MAX: z.coerce.number().min(0).max(100).default(80),
    GAS_RAW_ALERT_THRESHOLD: optionalNumber(),
    // No absolute meaning is assumed for raw MQ135 counts; a relative rise over
    // a long enough window is the only defensible trend signal.
    GAS_RAW_TREND_ALERT_PERCENT: z.coerce.number().min(5).max(500).default(25),
    GAS_RAW_TREND_MIN_MINUTES: z.coerce.number().int().min(15).default(60),

    // --- Prediction / retention --------------------------------------------
    PREDICTION_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    PREDICTION_HISTORY_MAX_POINTS: z.coerce.number().int().min(24).default(2_000),
    BASELINE_HORIZONS_HOURS: z
      .string()
      .default('6,24')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
      .pipe(z.array(z.number().int().min(1).max(72)).min(1)),
    PREDICTION_HORIZONS_HOURS: z
      .string()
      .default('24,72')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
      .pipe(z.array(z.number().int().min(1).max(168)).min(1)),
    BASELINE_MIN_SAMPLES: z.coerce.number().int().min(5).default(24),
    BASELINE_MATCH_TOLERANCE_MIN: z.coerce.number().int().min(5).default(20),
    BLIGHT_PAST_DAYS: z.coerce.number().int().min(2).max(7).default(3),
    BLIGHT_FORECAST_DAYS: z.coerce.number().int().min(1).max(7).default(3),
    BLIGHT_RH_THRESHOLD_PCT: z.coerce.number().min(50).max(100).default(90),
    BLIGHT_MIN_HUMID_HOURS: z.coerce.number().int().min(1).max(24).default(11),
    BLIGHT_MIN_TEMP_C: z.coerce.number().min(0).max(20).default(10),
    AI_RETENTION_MAX_RECORDS: z.coerce.number().int().min(10).default(500),
  })
  .superRefine((cfg, ctx) => {
    if ((cfg.GREENHOUSE_LAT === undefined) !== (cfg.GREENHOUSE_LON === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GREENHOUSE_LAT and GREENHOUSE_LON must be provided together',
        path: ['GREENHOUSE_LAT'],
      });
    }
    if (cfg.GREENHOUSE_LAT !== undefined && (cfg.GREENHOUSE_LAT < -90 || cfg.GREENHOUSE_LAT > 90)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'latitude must be -90..90', path: ['GREENHOUSE_LAT'] });
    }
    if (cfg.GREENHOUSE_LON !== undefined && (cfg.GREENHOUSE_LON < -180 || cfg.GREENHOUSE_LON > 180)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'longitude must be -180..180', path: ['GREENHOUSE_LON'] });
    }
    if (cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C >= cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'POTATO_AIR_TEMP_OPTIMAL_MIN_C must be below POTATO_AIR_TEMP_OPTIMAL_MAX_C',
        path: ['POTATO_AIR_TEMP_OPTIMAL_MIN_C'],
      });
    }
    if (cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT >= cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'POTATO_HUMIDITY_OPTIMAL_MIN_PCT must be below POTATO_HUMIDITY_OPTIMAL_MAX_PCT',
        path: ['POTATO_HUMIDITY_OPTIMAL_MIN_PCT'],
      });
    }
    const planting = cfg.POTATO_PLANTING_DATE ? Date.parse(`${cfg.POTATO_PLANTING_DATE}T00:00:00Z`) : null;
    if (planting !== null && planting > Date.now() + 24 * 60 * 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'POTATO_PLANTING_DATE is in the future',
        path: ['POTATO_PLANTING_DATE'],
      });
    }
    if (cfg.EQUIPMENT_HUMIDIFIER_FAN && !cfg.EQUIPMENT_VENTILATION_FAN && cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT < 100) {
      // Not an error: a humidifier fan can be installed without a ventilation fan.
      // Recorded only to make the capability matrix visible in validation output.
    }
  });

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

export class PipelineConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid pipeline configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'PipelineConfigError';
  }
}

export function loadPipelineConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const parsed = pipelineConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new PipelineConfigError(issues);
  }
  return parsed.data;
}

export interface EquipmentCapabilities {
  pump: boolean;
  buzzer: boolean;
  ventilation: boolean;
  ventilationFan: boolean;
  humidifierFan: boolean;
  supplementalLight: boolean;
}

export function equipmentFromConfig(cfg: PipelineConfig): EquipmentCapabilities {
  return {
    pump: cfg.EQUIPMENT_PUMP,
    buzzer: cfg.EQUIPMENT_BUZZER,
    ventilation: cfg.EQUIPMENT_VENTILATION,
    ventilationFan: cfg.EQUIPMENT_VENTILATION_FAN,
    humidifierFan: cfg.EQUIPMENT_HUMIDIFIER_FAN,
    supplementalLight: cfg.EQUIPMENT_SUPPLEMENTAL_LIGHT,
  };
}

export function hasCoordinates(cfg: PipelineConfig): cfg is PipelineConfig & {
  GREENHOUSE_LAT: number;
  GREENHOUSE_LON: number;
} {
  return cfg.GREENHOUSE_LAT !== undefined && cfg.GREENHOUSE_LON !== undefined;
}

/** Configuration warnings shown at startup. Never includes secrets. */
export function configurationWarnings(cfg: PipelineConfig): string[] {
  const warnings: string[] = [];
  if (!hasCoordinates(cfg)) {
    warnings.push(
      'GREENHOUSE_LAT/GREENHOUSE_LON are not set: external weather, satellite and air-quality sources are DISABLED. ' +
        'No location is inferred from the repository.'
    );
  }
  if (!cfg.EQUIPMENT_VENTILATION && !cfg.EQUIPMENT_VENTILATION_FAN && !cfg.EQUIPMENT_HUMIDIFIER_FAN) {
    warnings.push(
      'No ventilation or fan hardware is declared (firmware has none): ventilation recommendations will be emitted only as ' +
        'operator advisories, never as actuator actions.'
    );
  }
  if (!cfg.AI_ALLOW_IRRIGATION_RECOMMENDATIONS) {
    warnings.push(
      'Irrigation/pump recommendations are disabled (AI_ALLOW_IRRIGATION_RECOMMENDATIONS=false) so the existing pump ' +
        'threshold logic stays independent, as required.'
    );
  }
  if (!cfg.POTATO_PLANTING_DATE) {
    warnings.push('POTATO_PLANTING_DATE is unset: growth-stage (GDD) predictions will report insufficient_configuration.');
  }
  if (cfg.POTATO_GDD_EMERGENCE === undefined && cfg.POTATO_GDD_FLOWERING === undefined) {
    warnings.push(
      'POTATO_GDD_EMERGENCE/POTATO_GDD_FLOWERING are unset: stage dates are not estimated. Supply cultivar-specific ' +
        'thresholds from a cited dataset instead of relying on invented constants.'
    );
  }
  if (!cfg.POTATO_CULTIVAR) warnings.push('POTATO_CULTIVAR is unset: predictions cannot be cultivar-specific.');
  if (cfg.AI_CALIBRATION_ENABLED) {
    warnings.push(
      `Calibration artifacts are read from ${cfg.AI_CALIBRATION_ARTIFACT_DIR}. ` +
        'The repository ships none: without a trained artifact the raw sensor values are used unchanged.'
    );
  }
  if (!cfg.PIPELINE_ADMIN_TOKEN) {
    warnings.push('PIPELINE_ADMIN_TOKEN is unset: the status server exposes manual-run endpoints without authentication.');
  }
  if (cfg.PIPELINE_DRY_RUN) warnings.push('PIPELINE_DRY_RUN=true: no pipeline records will be written to Firebase.');
  if (cfg.AI_LEGACY_PREDICTIONS_WRITE) {
    warnings.push(
      `AI_LEGACY_PREDICTIONS_WRITE=true: new predictions are appended to the existing ${cfg.AI_LEGACY_PREDICTIONS_PATH} ` +
        'node using the legacy field names. Existing records are never modified or deleted.'
    );
  }
  return warnings;
}

/** Safe startup summary (no paths that could contain secrets, no credentials). */
export function describeConfig(cfg: PipelineConfig) {
  return {
    nodeEnv: cfg.NODE_ENV,
    dryRun: cfg.PIPELINE_DRY_RUN,
    greenhouseId: cfg.GREENHOUSE_ID ?? '(resolved from system/deviceId)',
    coordinates: hasCoordinates(cfg)
      ? { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON }
      : 'not configured (external sources disabled)',
    timezone: cfg.GREENHOUSE_TIMEZONE,
    sources: cfg.EXTERNAL_SOURCES,
    schedules: {
      decisionMs: cfg.DECISION_INTERVAL_MS,
      predictionMs: cfg.PREDICTION_INTERVAL_MS,
      decisionEnabled: cfg.DECISION_ENABLED,
      predictionEnabled: cfg.PREDICTION_ENABLED,
    },
    paths: {
      suggestions: cfg.AI_SUGGESTIONS_PATH,
      predictions: cfg.AI_PREDICTIONS_PATH,
      legacyPredictions: cfg.AI_LEGACY_PREDICTIONS_PATH,
      dataRoot: cfg.AI_DATA_ROOT,
    },
    equipment: equipmentFromConfig(cfg),
    allowIrrigationRecommendations: cfg.AI_ALLOW_IRRIGATION_RECOMMENDATIONS,
    potato: {
      cultivar: cfg.POTATO_CULTIVAR ?? null,
      plantingDate: cfg.POTATO_PLANTING_DATE ?? null,
      baseTempC: cfg.POTATO_BASE_TEMP_C,
      gddEmergence: cfg.POTATO_GDD_EMERGENCE ?? null,
      gddFlowering: cfg.POTATO_GDD_FLOWERING ?? null,
    },
  };
}
