/**
 * Versioned data contracts for the pipeline.
 *
 * Firebase key rules: keys must match [A-Za-z0-9_-]; RTDB forbids `. # $ [ ] /`.
 * `sanitizePathKey` is applied to provider variable names before they are used
 * as database keys.
 */
import { z } from 'zod';

export const PIPELINE_SCHEMA_VERSION = '1.0.0';
export const OBSERVATION_SCHEMA = 'observation/v1';
export const SUGGESTION_SCHEMA = 'ai-suggestion/v1';
export const PREDICTION_SCHEMA = 'ai-prediction/v1';
export const EXECUTION_SCHEMA = 'pipeline-execution/v1';
export const LOCK_SCHEMA = 'pipeline-lock/v1';
export const RULESET_VERSION = 'potato-rules/v1';

export const SOURCE_IDS = ['greenhouse-esp32', 'open-meteo', 'nasa-power'] as const;
export const QUALITY_STATUSES = ['valid', 'suspect', 'stale', 'invalid', 'missing'] as const;
export const CALIBRATION_STATUSES = [
  'none',
  'unit_conversion',
  'derived',
  'bias_corrected',
  'model_prediction',
  'not_applicable',
] as const;

export const RESERVED_PATH_CHARS = /[.#$/[\]]/g;

/** Make any string safe to use as a Realtime Database path segment. */
export function sanitizePathKey(key: string): string {
  const cleaned = key.replace(RESERVED_PATH_CHARS, '_').replace(/\s+/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

const iso = z.string().datetime({ offset: true });
const finiteNumber = z.number().finite();

export const timestampFormatSchema = z.enum([
  'unix_seconds',
  'unix_ms',
  'iso8601_utc',
  'iso8601_with_offset',
  'power_hourly_utc',
  'unknown',
]);

export const sourceRefSchema = z.object({
  id: z.enum(SOURCE_IDS),
  provider: z.string().min(1),
  product: z.string().nullable(),
  dataset: z.string().nullable(),
  transport: z.enum(['firebase-rtdb', 'https-rest', 'in-memory', 'none']),
});

export const variableRefSchema = z.object({
  /** Name exactly as sent by the source (e.g. `temperature`, `T2M`). */
  originalName: z.string().min(1),
  /** Pipeline-normalized name (snake_case, e.g. `air_temperature`). */
  normalizedName: z.string().min(1),
  originalUnit: z.string(),
  normalizedUnit: z.string().nullable(),
  /** How the value came to exist at the source. */
  measurementKind: z.enum([
    'direct_measurement',
    'remotely_retrieved',
    'modeled',
    'reanalysis',
    'derived',
    'index',
  ]),
});

export const valueSchema = z.object({
  raw: finiteNumber.nullable(),
  normalized: finiteNumber.nullable(),
  missing: z.boolean(),
});

export const timestampsSchema = z.object({
  observedAt: iso,
  observedAtMs: finiteNumber,
  ingestedAt: iso,
  sourceTimestamp: z
    .object({
      raw: z.union([z.number(), z.string()]),
      format: timestampFormatSchema,
    })
    .nullable(),
  utcOffsetSeconds: z.number().int().nullable(),
});

export const locationSchema = z.object({
  configured: z.object({ lat: finiteNumber, lon: finiteNumber }).nullable(),
  observed: z.object({ lat: finiteNumber, lon: finiteNumber }).nullable(),
  /** Great-circle distance between configured site and provider grid cell. */
  distanceKm: finiteNumber.nullable(),
});

export const qualitySchema = z.object({
  status: z.enum(QUALITY_STATUSES),
  reasons: z.array(z.string()),
  anomaly: z
    .object({
      method: z.literal('mad_zscore'),
      score: finiteNumber,
      baseline: finiteNumber,
      mad: finiteNumber,
      samples: z.number().int(),
    })
    .nullable(),
});

export const calibrationSchema = z.object({
  status: z.enum(CALIBRATION_STATUSES),
  methodId: z.string().nullable(),
  description: z.string().nullable(),
  /** True only when a documented model/coefficient was actually applied. */
  applied: z.boolean(),
});

export const matchingSchema = z.object({
  role: z.enum(['indoor', 'outdoor_reference', 'atmospheric_indicator', 'unmatched']),
  method: z.enum(['none', 'timestamp', 'spatial_temporal']),
  timeDeltaSeconds: z.number().nullable(),
  distanceKm: finiteNumber.nullable(),
  notes: z.array(z.string()),
});

export const transformationSchema = z.object({
  steps: z.array(z.string()),
  rulesetVersion: z.string(),
});

export const observationV1Schema = z.object({
  schemaVersion: z.literal(OBSERVATION_SCHEMA),
  observationId: z.string().min(1),
  greenhouseId: z.string().min(1),
  deviceId: z.string().nullable(),
  source: sourceRefSchema,
  variable: variableRefSchema,
  value: valueSchema,
  timestamps: timestampsSchema,
  location: locationSchema,
  quality: qualitySchema,
  calibration: calibrationSchema,
  matching: matchingSchema,
  transformation: transformationSchema,
});

export type ObservationV1 = z.infer<typeof observationV1Schema>;

/** Compact, query-friendly indoor series point (one per sensor snapshot). */
export const indoorSeriesPointSchema = z.object({
  schemaVersion: z.literal(OBSERVATION_SCHEMA),
  observedAtMs: finiteNumber,
  observedAt: iso,
  ingestedAt: iso,
  greenhouseId: z.string().min(1),
  deviceId: z.string().nullable(),
  values: z.record(z.number().nullable()),
  units: z.record(z.string()),
  /** Firebase field name actually read for each normalized variable. */
  sourceFields: z.record(z.string()).optional(),
  quality: z.record(z.enum(QUALITY_STATUSES)),
  overallQuality: z.enum(['ok', 'degraded', 'invalid', 'stale']),
});

export type IndoorSeriesPoint = z.infer<typeof indoorSeriesPointSchema>;

export const constraintSchema = z.object({
  id: z.string(),
  variable: z.string(),
  status: z.enum(['ok', 'below', 'above', 'critical', 'unknown']),
  value: finiteNumber.nullable(),
  unit: z.string(),
  bounds: z.object({ min: finiteNumber.nullable(), max: finiteNumber.nullable() }).nullable(),
  reasons: z.array(z.string()),
});

export const indoorSummarySchema = z.object({
  observedAt: iso,
  ageMinutes: finiteNumber,
  quality: z.enum(['ok', 'degraded', 'invalid', 'stale']),
  values: z.record(finiteNumber.nullable()),
  /** Raw sensor values, kept next to the (possibly calibrated) values. */
  rawValues: z.record(finiteNumber.nullable()).optional(),
  units: z.record(z.string()),
  variableQuality: z.record(z.enum(QUALITY_STATUSES)),
  reasons: z.array(z.string()),
});

export const outdoorSummarySchema = z.object({
  sourceId: z.enum(SOURCE_IDS),
  observedAt: iso,
  ageMinutes: finiteNumber,
  timeDeltaSeconds: z.number().nullable(),
  distanceKm: finiteNumber.nullable(),
  values: z.record(finiteNumber.nullable()),
  units: z.record(z.string()),
  quality: z.enum(['ok', 'degraded', 'invalid', 'stale']),
  reasons: z.array(z.string()),
  comparisonCaveats: z.array(z.string()),
});

export const safetySchema = z.object({
  passed: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    })
  ),
  blockedReasons: z.array(z.string()),
  executesActuator: z.literal(false),
  requiresHumanApproval: z.literal(true),
});

export const expectedEffectSchema = z.object({
  description: z.string(),
  direction: z.enum(['increase', 'decrease', 'maintain', 'unknown']),
  metric: z.string().nullable(),
  magnitude: z.string().nullable(),
});

export const actionSchema = z.object({
  id: z.string(),
  category: z.enum(['ventilation', 'humidity', 'lighting', 'irrigation', 'monitoring', 'notify']),
  targetDevice: z.enum([
    'ventilation',
    'ventilation_fan',
    'humidifier_fan',
    'supplemental_light',
    'pump',
    'buzzer',
    'none',
  ]),
  /** Always null: the pipeline never writes actuator commands. */
  requestedCommand: z.null(),
  executionMode: z.literal('advisory_only'),
  executableByBackend: z.literal(false),
  requiresHumanApproval: z.literal(true),
});

export const outcomeSchema = z.object({
  assessedAt: iso,
  status: z.enum(['improved', 'unchanged', 'worsened', 'unknown']),
  metric: z.string(),
  baselineValue: finiteNumber.nullable(),
  observedValue: finiteNumber.nullable(),
  delta: finiteNumber.nullable(),
  caveat: z.string(),
});

export const suggestionV1Schema = z.object({
  schemaVersion: z.literal(SUGGESTION_SCHEMA),
  recommendationId: z.string().min(1),
  recordType: z.enum(['recommendation', 'diagnostic']),
  greenhouseId: z.string().min(1),
  createdAt: iso,
  createdAtMs: finiteNumber,
  expiresAt: iso,
  expiresAtMs: finiteNumber,
  status: z.enum(['open', 'diagnostic', 'deduplicated', 'expired', 'suppressed']),
  action: actionSchema,
  reason: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: finiteNumber.nullable(),
  confidenceNote: z.string(),
  expectedEffect: expectedEffectSchema,
  inputSummary: z.object({
    indoor: indoorSummarySchema.nullable(),
    outdoor: outdoorSummarySchema.nullable(),
    constraints: z.array(constraintSchema),
    history: z
      .object({
        samples: z.number().int(),
        windowMinutes: finiteNumber,
        trends: z.record(z.number().nullable()),
      })
      .nullable(),
    equipment: z.record(z.boolean()),
    dataQuality: z.object({
      status: z.enum(['ok', 'degraded', 'invalid', 'stale']),
      reasons: z.array(z.string()),
    }),
  }),
  calibration: z.object({
    indoorSensorStatus: z.enum(CALIBRATION_STATUSES),
    outdoorComparisonStatus: z.enum(CALIBRATION_STATUSES),
    notes: z.array(z.string()),
  }),
  safety: safetySchema,
  ruleVersion: z.string(),
  modelVersion: z.null(),
  outcome: outcomeSchema.nullable(),
});

export type SuggestionV1 = z.infer<typeof suggestionV1Schema>;

export const validationMetricSchema = z.object({
  metric: z.enum(['MAE', 'RMSE', 'bias', 'accuracy']),
  value: finiteNumber,
  unit: z.string(),
  sampleSize: z.number().int().min(0),
  method: z.string(),
});

export const predictionV1Schema = z.object({
  schemaVersion: z.literal(PREDICTION_SCHEMA),
  predictionId: z.string().min(1),
  greenhouseId: z.string().min(1),
  generatedAt: iso,
  generatedAtMs: finiteNumber,
  predictionType: z.enum([
    'environmental_forecast',
    'indoor_baseline_forecast',
    'growth_stage',
    'disease_risk',
    'voc_estimate',
    'source_comparison',
  ]),
  target: z.string().min(1),
  predictedValue: z.union([finiteNumber, z.string(), z.record(z.any()), z.array(z.any())]).nullable(),
  unit: z.string().nullable(),
  forecastHorizon: z
    .object({
      hours: finiteNumber,
      validFrom: iso,
      validTo: iso,
    })
    .nullable(),
  probability: z.number().min(0).max(1).nullable(),
  riskLevel: z.enum(['low', 'moderate', 'high']).nullable(),
  uncertainty: z
    .object({
      method: z.string(),
      value: finiteNumber,
      unit: z.string(),
      sampleSize: z.number().int().min(0),
    })
    .nullable(),
  inputSummary: z.record(z.any()),
  dataQuality: z.object({
    status: z.enum(['ok', 'degraded', 'invalid', 'stale']),
    reasons: z.array(z.string()),
  }),
  modelVersion: z.string(),
  methodClass: z.enum(['external_provider', 'rule_based', 'baseline', 'measured_derived', 'unavailable']),
  validationMetrics: z.array(validationMetricSchema).nullable(),
  status: z.enum([
    'ok',
    'external_forecast',
    'insufficient_data',
    'insufficient_configuration',
    'unsupported',
    'error',
  ]),
  notes: z.array(z.string()),
});

export type PredictionV1 = z.infer<typeof predictionV1Schema>;

export const executionV1Schema = z.object({
  schemaVersion: z.literal(EXECUTION_SCHEMA),
  executionId: z.string().min(1),
  pipeline: z.enum(['decision', 'prediction']),
  bucketId: z.string().min(1),
  trigger: z.enum(['schedule', 'startup', 'manual']),
  status: z.enum([
    'running',
    'succeeded',
    'failed',
    'skipped_locked',
    'skipped_duplicate',
    'skipped_overlap',
    'skipped_disabled',
  ]),
  startedAt: iso,
  finishedAt: iso.nullable(),
  durationMs: z.number().nullable(),
  stats: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
  errors: z.array(
    z.object({
      step: z.string(),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
  ),
  dryRun: z.boolean(),
  storeKind: z.enum(['firebase', 'memory']),
  hostInfo: z.string(),
});

export type ExecutionV1 = z.infer<typeof executionV1Schema>;

export const lockV1Schema = z.object({
  schemaVersion: z.literal(LOCK_SCHEMA),
  ownerId: z.string().min(1),
  runId: z.string().min(1),
  acquiredAtMs: finiteNumber,
  expiresAtMs: finiteNumber,
});

export type LockV1 = z.infer<typeof lockV1Schema>;

/** Parse helper that returns a readable error instead of a zod dump. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`${label} failed schema validation: ${issues.join('; ')}`);
  }
  return parsed.data;
}
