/**
 * Compatibility layer for the existing `/Sensoura/aiPredictions` node.
 *
 * VERIFIED live structure (read from the existing database, not invented):
 *   {
 *     "3001": {
 *       "type": "rainfall",
 *       "predictedValue": "after 2 days afternoon",
 *       "confidence": 0.85,
 *       "predictionTime": 1791867600000
 *     },
 *     "3002": {
 *       "type": "air_temp",
 *       "predictedValue": 30.0,
 *       "confidence": 0.9,
 *       "predictionTime": 1791867600000
 *     }
 *   }
 *
 * Rules this module enforces:
 *  - the four legacy field names (`type`, `predictedValue`, `confidence`,
 *    `predictionTime`) are preserved exactly, in every record we read or write
 *  - `predictionTime` stays a numeric Unix timestamp in MILLISECONDS
 *  - existing records are never modified, overwritten or deleted
 *  - new records get deterministic, collision-safe numeric ids
 *  - `confidence` is never invented: the field is present on every record
 *    this pipeline writes, but its value is `null` unless a calibrated
 *    measure exists (this pipeline does not produce one)
 *  - anything new is an ADDITIVE, optional field on top of the legacy four
 *
 * IMPORTANT — the Realtime Database does not store null values: a field
 * written as null is dropped by the server. The in-memory projection
 * therefore carries `confidence: null` (the documented contract of the
 * node after the pipeline appends records), while the record as stored in
 * the database simply has no `confidence` key. Both views parse to the
 * same thing: `confidence` is null, i.e. "not computed", never a number
 * the pipeline made up.
 *
 * Nothing in this module writes an actuator command. `predictedValue` for
 * rainfall is a period description (a string) exactly like the existing
 * record, because that is the legacy contract; the quantity lives in the
 * optional `precipitationMm` field.
 */
import { z } from 'zod';
import type { PredictionV1 } from '../schema.js';
import type { PipelineStore } from '../storage/store.js';
import { isPlausibleTimestampMs, toIsoUtc } from '../utils/time.js';

/** Default path of the pre-existing node. Configurable, never replaced. */
export const LEGACY_PREDICTIONS_PATH = '/Sensoura/aiPredictions';

/** Marker written on records this pipeline appends (optional, additive). */
export const LEGACY_PROJECTION_SCHEMA = 'legacy-prediction-projection/v1';

/**
 * The legacy record contract, expressed the way an existing consumer would
 * parse it. Unknown fields are preserved (`.passthrough()`) so additive
 * extensions do not break old readers.
 */
export const legacyPredictionSchema = z
  .object({
    type: z.string().min(1),
    predictedValue: z.union([z.string(), z.number().finite()]),
    /**
     * Null when no calibrated confidence exists. The Realtime Database drops
     * null values on write, so a stored record without a calibrated
     * confidence has no `confidence` key at all — which parses to null here.
     */
    confidence: z.number().finite().min(0).max(1).nullish(),
    /** Unix milliseconds. */
    predictionTime: z.number().int().nonnegative(),
  })
  .passthrough();

export type LegacyPrediction = z.infer<typeof legacyPredictionSchema>;

/** A legacy record plus everything needed to report on it without losing data. */
export interface LegacyPredictionEntry {
  /** The key the record is stored under (e.g. "3001"). */
  key: string;
  type: string | null;
  predictedValue: string | number | null;
  confidence: number | null;
  /** Unix milliseconds, or null when the stored value was not a usable number. */
  predictionTime: number | null;
  /** UTC ISO rendering of `predictionTime`. */
  predictionTimeIso: string | null;
  /** The record exactly as stored. */
  raw: Record<string, unknown>;
  /** True when the record satisfies the legacy contract. */
  valid: boolean;
  /** Human-readable reasons the record is not fully valid. */
  issues: string[];
}

export interface LegacyPredictionRead {
  /** Path the records were read from. */
  path: string;
  /** True when the node exists in the database. */
  present: boolean;
  /** Valid and partially valid records, keyed as stored. */
  records: LegacyPredictionEntry[];
  /** Records that could not be interpreted at all. */
  invalid: LegacyPredictionEntry[];
}

/**
 * Parse one stored record without throwing and without discarding anything.
 * The raw value is always preserved so historical representations (such as
 * the "after 2 days afternoon" rainfall string) survive a round trip.
 */
export function parseLegacyPredictionEntry(key: string, raw: unknown): LegacyPredictionEntry {
  const issues: string[] = [];
  const record: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push('record is not an object');
  }

  const type = typeof record.type === 'string' && record.type.trim() !== '' ? record.type : null;
  if (type === null) issues.push('missing or empty "type"');

  let predictedValue: string | number | null = null;
  const rawValue = record.predictedValue;
  if (typeof rawValue === 'string') {
    predictedValue = rawValue;
  } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    predictedValue = rawValue;
  } else {
    issues.push('"predictedValue" is neither a string nor a finite number');
  }

  let confidence: number | null = null;
  const rawConfidence = record.confidence;
  if (rawConfidence === null || rawConfidence === undefined) {
    // Absent or explicitly null: not computed. Not an error.
  } else if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    if (rawConfidence < 0 || rawConfidence > 1) {
      issues.push(`"confidence" ${rawConfidence} is outside 0..1`);
    } else {
      confidence = rawConfidence;
    }
  } else {
    issues.push(`"confidence" is not a finite number (${JSON.stringify(rawConfidence)})`);
  }

  let predictionTime: number | null = null;
  const rawTime = record.predictionTime;
  if (typeof rawTime === 'number' && Number.isFinite(rawTime)) {
    if (!Number.isInteger(rawTime)) {
      issues.push(`"predictionTime" ${rawTime} is not an integer millisecond timestamp`);
    } else if (!isPlausibleTimestampMs(rawTime)) {
      issues.push(`"predictionTime" ${rawTime} is outside the plausible 2000-2100 millisecond range`);
    } else {
      predictionTime = rawTime;
    }
  } else {
    issues.push(`"predictionTime" is not a numeric millisecond timestamp (${JSON.stringify(rawTime)})`);
  }

  return {
    key,
    type,
    predictedValue,
    confidence,
    predictionTime,
    predictionTimeIso: predictionTime === null ? null : toIsoUtc(predictionTime),
    raw: record,
    valid: issues.length === 0,
    issues,
  };
}

/** Read every record from the legacy node. Never writes. */
export async function readLegacyPredictions(
  store: PipelineStore,
  path: string
): Promise<LegacyPredictionRead> {
  const raw = await store.get<Record<string, unknown>>(path);
  if (!raw || typeof raw !== 'object') {
    return { path, present: false, records: [], invalid: [] };
  }

  const records: LegacyPredictionEntry[] = [];
  const invalid: LegacyPredictionEntry[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const entry = parseLegacyPredictionEntry(key, value);
    records.push(entry);
    if (!entry.valid) invalid.push(entry);
  }
  records.sort((a, b) => (a.predictionTime ?? 0) - (b.predictionTime ?? 0) || a.key.localeCompare(b.key));
  return { path, present: true, records, invalid };
}

/**
 * The optional, additive fields this pipeline may add to a legacy record.
 * Every one of them is optional: an old reader that only knows the four
 * legacy fields keeps working unchanged.
 */
export interface LegacyProjectionExtras {
  /** Unit of `predictedValue` ("degC", "%", "mm", ...). */
  unit?: string;
  /** The pipeline record this projection was derived from. */
  predictionId?: string;
  /** Marker so pipeline-written records are identifiable. */
  schemaVersion?: string;
  /** ISO start of the forecast window. */
  forecastStart?: string;
  /** ISO end of the forecast window. */
  forecastEnd?: string;
  /** Rainfall quantity in millimetres for `type: "rainfall"`. */
  precipitationMm?: number;
  /** Forecast probability 0..1, only when the source actually provides one. */
  probability?: number;
  /** Risk level for `type: "disease_risk"`. */
  riskLevel?: string;
  /** Per-stage growth projections for `type: "growth_stage"`. */
  stages?: Array<Record<string, unknown>>;
  /** Per-day risk detail for `type: "disease_risk"`. */
  riskDays?: Array<Record<string, unknown>>;
  /** Accumulated growing degree days for `type: "growth_stage"`. */
  accumulatedGdd?: number;
  /** Upstream source id, e.g. "open-meteo". */
  source?: string;
  /** Explains a null `confidence`. */
  confidenceNote?: string;
  /** The most recent earlier legacy record of the same type. */
  previousPrediction?: {
    predictionTime: number;
    predictedValue: string | number;
    /** Only present when that record carried a numeric confidence. */
    confidence?: number;
  };
}

export interface LegacyProjectionRecord extends LegacyProjectionExtras {
  type: string;
  predictedValue: string | number;
  /**
   * Null unless a calibrated confidence exists. This pipeline does not
   * produce one, so the value is always null — never a fabricated number.
   * The key is always present so the record satisfies the documented
   * consumer contract (`confidence` is nullable, not optional).
   */
  confidence: number | null;
  predictionTime: number;
}

/** The legacy `type` vocabulary, including the extensions this pipeline adds. */
export const LEGACY_PREDICTION_TYPES = [
  // Pre-existing types.
  'rainfall',
  'air_temp',
  // Documented extensions.
  'humidity',
  'solar_radiation',
  'indoor_air_temp',
  'indoor_soil_moisture',
  'growth_stage',
  'disease_risk',
] as const;

export type LegacyPredictionType = (typeof LEGACY_PREDICTION_TYPES)[number];

const CONFIDENCE_NOTE =
  'no confidence field: this pipeline does not produce calibrated confidence scores and never invents one.';

/** Human-readable forecast period, matching the phrasing of the existing record. */
export function rainfallPeriodPhrase(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return 'forecast period unknown';
  const days = hours / 24;
  if (Number.isInteger(days)) return days === 1 ? 'after 1 day' : `after ${days} days`;
  return `after ${hours} hours`;
}

interface NumericTargetRule {
  re: RegExp;
  type: LegacyPredictionType;
  unit: string;
  /** Field name of the numeric value inside the v1 record. */
  field?: string;
}

const NUMERIC_TARGETS: NumericTargetRule[] = [
  { re: /^outdoor_air_temperature_(\d+)h$/, type: 'air_temp', unit: 'degC' },
  { re: /^outdoor_relative_humidity_(\d+)h$/, type: 'humidity', unit: '%' },
  { re: /^outdoor_shortwave_radiation_(\d+)h$/, type: 'solar_radiation', unit: 'W/m2' },
  { re: /^outdoor_precipitation_(\d+)h$/, type: 'rainfall', unit: 'mm' },
  { re: /^air_temperature_(\d+)h$/, type: 'indoor_air_temp', unit: 'degC' },
  { re: /^soil_moisture_index_(\d+)h$/, type: 'indoor_soil_moisture', unit: '%' },
];

/**
 * Project a pipeline prediction onto the legacy record shape.
 *
 * Returns `null` when the prediction must not be published to the legacy
 * node (unsupported target, diagnostic record, or a status that means "no
 * value was produced").
 */
export function projectPredictionToLegacy(
  prediction: PredictionV1
): LegacyProjectionRecord | null {
  if (prediction.status !== 'ok' && prediction.status !== 'external_forecast') return null;
  if (prediction.predictedValue === null) return null;

  const horizon = prediction.forecastHorizon;
  const times: LegacyProjectionExtras = horizon
    ? { forecastStart: horizon.validFrom, forecastEnd: horizon.validTo }
    : {};

  const base = {
    predictionTime: prediction.generatedAtMs,
    predictionId: prediction.predictionId,
    schemaVersion: LEGACY_PROJECTION_SCHEMA,
    confidenceNote: CONFIDENCE_NOTE,
    // Never invented: null means "no calibrated confidence exists".
    confidence: null as number | null,
    ...times,
  };

  // Outdoor + indoor numeric targets.
  for (const rule of NUMERIC_TARGETS) {
    const match = rule.re.exec(prediction.target);
    if (!match) continue;
    const horizonHours = Number(match[1]);
    if (!Number.isFinite(horizonHours)) return null;

    if (rule.type === 'rainfall') {
      if (typeof prediction.predictedValue !== 'number') return null;
      // Legacy contract: rainfall predictions carry a period description as a
      // string. The quantity is additive (`precipitationMm`).
      return {
        ...base,
        type: 'rainfall',
        predictedValue: rainfallPeriodPhrase(horizonHours),
        unit: rule.unit,
        precipitationMm: prediction.predictedValue,
        source: 'open-meteo',
      };
    }

    if (typeof prediction.predictedValue !== 'number') return null;
    const sourceId = prediction.inputSummary?.sourceId;
    return {
      ...base,
      type: rule.type,
      predictedValue: prediction.predictedValue,
      unit: rule.unit,
      ...(typeof sourceId === 'string' ? { source: sourceId } : {}),
    };
  }

  // Growth stage (GDD).
  if (prediction.target === 'potato_gdd_stages') {
    const value = prediction.predictedValue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const accumulated = record.accumulatedGddToDate;
    if (typeof accumulated !== 'number' || !Number.isFinite(accumulated)) return null;
    const stages = Array.isArray(record.stageTargets)
      ? (record.stageTargets as Array<Record<string, unknown>>)
      : undefined;
    return {
      ...base,
      type: 'growth_stage',
      predictedValue: accumulated,
      unit: 'degC·day',
      accumulatedGdd: accumulated,
      ...(stages ? { stages } : {}),
      source: 'open-meteo',
    };
  }

  // Late blight weather risk.
  if (prediction.target === 'late_blight_smith_period') {
    if (prediction.riskLevel === null) return null;
    const riskDays = Array.isArray(prediction.predictedValue)
      ? (prediction.predictedValue as Array<Record<string, unknown>>)
      : undefined;
    return {
      ...base,
      type: 'disease_risk',
      predictedValue: prediction.riskLevel,
      riskLevel: prediction.riskLevel,
      ...(riskDays ? { riskDays } : {}),
      source: 'open-meteo',
    };
  }

  // `voc_estimate` (unsupported) and `source_comparison` (diagnostic) are
  // deliberately not published to the legacy node.
  return null;
}

export interface LegacyProjection {
  /** Deterministic id used as the Firebase key. */
  id: string;
  record: LegacyProjectionRecord;
  /** The pipeline record this projection came from. */
  sourcePredictionId: string;
}

/** Number of digits reserved for the index part of a generated id. */
export const LEGACY_ID_INDEX_WIDTH = 4;

/**
 * Deterministic, collision-safe id for a projected record.
 *
 * Format: `<13-digit Unix ms><4-digit index>` — a numeric string, like the
 * existing keys, whose magnitude (17 digits) can never collide with the
 * 4-digit legacy seed range ("3001", "3002", ...).
 *
 * The two parts have fixed widths, so the id can be split back into its
 * (timestamp, index) pair without ambiguity, and two different pairs can
 * never produce the same string. The same inputs always produce the same id.
 */
export function legacyProjectionId(generatedAtMs: number, index: number): string {
  if (
    !Number.isFinite(generatedAtMs) ||
    !Number.isInteger(generatedAtMs) ||
    generatedAtMs < 1_000_000_000_000 ||
    generatedAtMs >= 10_000_000_000_000
  ) {
    throw new Error(
      `legacyProjectionId: expected a 13-digit Unix millisecond timestamp, got ${generatedAtMs}`
    );
  }
  if (!Number.isInteger(index) || index < 0 || index >= 10 ** LEGACY_ID_INDEX_WIDTH) {
    throw new Error(`legacyProjectionId: invalid index ${index}`);
  }
  return `${generatedAtMs}${String(index).padStart(LEGACY_ID_INDEX_WIDTH, '0')}`;
}

/**
 * Build every legacy projection for one pipeline run.
 *
 * The order is deterministic (sorted by legacy type and pipeline target), so
 * the assigned ids are stable across runs and across processes.
 */
export function buildLegacyProjections(
  predictions: readonly PredictionV1[],
  previous: readonly LegacyPredictionEntry[] = [],
  nowMs?: number
): LegacyProjection[] {
  const projected: Array<{ payload: LegacyProjectionRecord; prediction: PredictionV1 }> = [];

  for (const prediction of predictions) {
    const payload = projectPredictionToLegacy(prediction);
    if (!payload) continue;
    projected.push({ payload, prediction });
  }

  projected.sort((a, b) =>
    `${a.payload.type}|${a.prediction.target}`.localeCompare(`${b.payload.type}|${b.prediction.target}`)
  );

  const generatedAtMs = pickBaseTimestamp(nowMs, projected);

  return projected.map(({ payload, prediction }, index) => {
    const prior = findPreviousLegacy(prediction, payload.type, previous);
    const record: LegacyProjectionRecord = {
      ...payload,
      ...(prior ? { previousPrediction: prior } : {}),
    };
    return {
      id: legacyProjectionId(generatedAtMs, index),
      record,
      sourcePredictionId: prediction.predictionId,
    };
  });
}

/**
 * The timestamp every id of one run is based on.
 *
 * The run clock wins, so all records of a run share one prefix; the
 * prediction's own generation time is the fallback. A value outside the
 * 13-digit millisecond range is never used, because it would break the
 * fixed-width id format.
 */
function pickBaseTimestamp(
  nowMs: number | undefined,
  projected: ReadonlyArray<{ prediction: PredictionV1 }>
): number {
  const candidates = [nowMs, projected[0]?.prediction.generatedAtMs];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= 1_000_000_000_000 &&
      candidate < 10_000_000_000_000
    ) {
      return candidate;
    }
  }
  // Last resort: the wall clock. Only reachable when no usable timestamp was
  // supplied at all, which does not happen in a scheduled run.
  return Math.trunc(Date.now());
}

/** Most recent earlier legacy record with the same type. */
function findPreviousLegacy(
  prediction: PredictionV1,
  type: string,
  previous: readonly LegacyPredictionEntry[]
): LegacyProjectionExtras['previousPrediction'] | null {
  let best: LegacyPredictionEntry | null = null;
  for (const entry of previous) {
    if (entry.type !== type) continue;
    if (entry.predictionTime === null) continue;
    if (entry.predictionTime > prediction.generatedAtMs) continue;
    if (best === null || (entry.predictionTime ?? 0) >= (best.predictionTime ?? 0)) best = entry;
  }
  if (!best || best.predictedValue === null) return null;
  return {
    predictionTime: best.predictionTime as number,
    predictedValue: best.predictedValue,
    // Only carried over when the earlier record actually had one: the
    // database drops null values, so an absent field stays absent.
    ...(best.confidence === null ? {} : { confidence: best.confidence }),
  };
}

/**
 * Append a projected record to the legacy node.
 *
 * The key is never overwritten: if a record already exists under that id it
 * is left exactly as it is. This is what keeps the migration non-destructive.
 */
export async function saveLegacyPredictionIfAbsent(
  store: PipelineStore,
  path: string,
  id: string,
  record: LegacyProjectionRecord
): Promise<'written' | 'skipped_existing'> {
  const parsed = legacyPredictionSchema.parse(record);
  const existing = await store.get(`${path}/${id}`);
  if (existing !== null && existing !== undefined) return 'skipped_existing';
  await store.set(`${path}/${id}`, parsed);
  return 'written';
}
