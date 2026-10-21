/**
 * Data validation for the greenhouse node.
 *
 * Field names, ranges and units come from the firmware and the existing
 * `sensorDataSchema` (backend/src/models/sensoura.ts):
 *   temperature       DHT11 air temperature, °C
 *   soilTemperature   DS18B20 probe, °C (depth not documented by the firmware)
 *   humidity          DHT11 relative humidity, %
 *   soilMoisture      mapped ADC value 0..100, NOT volumetric water content
 *   gas               MQ135 raw ADC counts (12-bit), NOT ppm and NOT a VOC index
 *   light             photoresistor raw ADC counts (12-bit), NOT lux / PAR
 *   airPressure       BMP180 absolute pressure, hPa
 *   lastUpdate        Unix SECONDS in firmware (`time(nullptr)`), ms in seeds
 *
 * A second, alternative spelling set is accepted as an ALIAS of the same
 * physical variable (it is the schema documented in the project brief):
 *   AirTemp, SoilTemp, AirHumidity, SoilMoisture, VOC, Light, Barometricpressure
 *
 * The repository's own names stay canonical: nothing is renamed in Firebase
 * and no value is rewritten. The alias is only used to FIND the value; the
 * field that was actually read is preserved in `rawNames` and in every
 * observation's `variable.originalName`, so a reader can always tell which
 * spelling produced the number.
 *
 * Suspect readings are never silently dropped; they are labelled and passed on
 * with an explicit quality status.
 */
import type { PipelineConfig } from '../config.js';
import type { IndoorSeriesPoint, ObservationV1 } from '../schema.js';
import { OBSERVATION_SCHEMA, RULESET_VERSION, sanitizePathKey } from '../schema.js';
import { detectTimestamp, parseIsoUtc, toIsoUtc, type TimestampFormat } from './time.js';
import { roundTo } from './units.js';
import type { CalibrationApplication } from '../calibration/apply.js';

export type QualityStatus = 'valid' | 'suspect' | 'stale' | 'invalid' | 'missing';

export interface IndoorVariableSpec {
  rawName: string;
  /**
   * Alternative spellings accepted for the same physical variable. Each may
   * declare its own unit when the alternate source expresses a different
   * measurement basis (e.g. `Light` as % vs the firmware's ADC counts).
   */
  aliases: readonly { name: string; unit?: string; note?: string }[];
  normalizedName: string;
  unit: string;
  measurementKind: 'direct_measurement' | 'index';
  physicalMin: number;
  physicalMax: number;
  /** Plausible greenhouse range; outside => suspect (not invalid). */
  plausibleMin: number;
  plausibleMax: number;
  critical: boolean;
  caveat: string | null;
}

export const INDOOR_VARIABLES: readonly IndoorVariableSpec[] = [
  {
    rawName: 'temperature',
    aliases: [{ name: 'AirTemp' }, { name: 'airTemp' }],
    normalizedName: 'air_temperature',
    unit: 'degC',
    measurementKind: 'direct_measurement',
    physicalMin: -40,
    physicalMax: 85,
    plausibleMin: -5,
    plausibleMax: 55,
    critical: true,
    caveat: 'DHT11 accuracy is roughly ±2 °C / ±5 % RH; indoor reading, not an outdoor reference.',
  },
  {
    rawName: 'soilTemperature',
    aliases: [{ name: 'SoilTemp' }, { name: 'soilTemp' }],
    normalizedName: 'soil_temperature',
    unit: 'degC',
    measurementKind: 'direct_measurement',
    physicalMin: -40,
    physicalMax: 85,
    plausibleMin: -5,
    plausibleMax: 55,
    critical: false,
    caveat: 'DS18B20 probe; insertion depth is not documented in the firmware.',
  },
  {
    rawName: 'humidity',
    aliases: [{ name: 'AirHumidity' }, { name: 'airHumidity' }],
    normalizedName: 'relative_humidity',
    unit: '%',
    measurementKind: 'direct_measurement',
    physicalMin: 0,
    physicalMax: 100,
    plausibleMin: 5,
    plausibleMax: 100,
    critical: true,
    caveat: 'DHT11 relative humidity, ±5 % typical.',
  },
  {
    rawName: 'soilMoisture',
    aliases: [{ name: 'SoilMoisture' }, { name: 'soilMoistureIndex' }],
    normalizedName: 'soil_moisture_index',
    unit: '%',
    measurementKind: 'index',
    physicalMin: 0,
    physicalMax: 100,
    plausibleMin: 0,
    plausibleMax: 100,
    critical: false,
    caveat:
      'ADC counts mapped 3200..1200 -> 0..100. This is a relative index, not volumetric water content; ' +
      'no substrate-specific calibration exists in the repository.',
  },
  {
    rawName: 'gas',
    aliases: [
      {
        name: 'VOC',
        unit: 'VOC Index',
        note:
          'The `VOC` field is documented as a VOC Index (unitless sensor index), not ppm or µg/m³. ' +
          'It is stored under its own unit and is never converted to a concentration.',
      },
      { name: 'voc' },
      { name: 'vocIndex' },
    ],
    normalizedName: 'mq135_gas_raw',
    unit: 'counts',
    measurementKind: 'index',
    physicalMin: 0,
    physicalMax: 4095,
    plausibleMin: 0,
    plausibleMax: 4095,
    critical: false,
    caveat:
      'Raw MQ135 ADC counts (12-bit), sensitive to many gases and to temperature/humidity. ' +
      'Converting to ppm or a VOC index requires R0 calibration and compensation that are not available.',
  },
  {
    rawName: 'light',
    aliases: [
      {
        name: 'Light',
        unit: '%',
        note:
          'The `Light` field is documented as a percentage of the sensor scale, not lux or PAR. ' +
          'It is not converted to irradiance because no calibration exists.',
      },
      { name: 'lightPct', unit: '%' },
    ],
    normalizedName: 'light_raw',
    unit: 'counts',
    measurementKind: 'index',
    physicalMin: 0,
    physicalMax: 4095,
    plausibleMin: 0,
    plausibleMax: 4095,
    critical: false,
    caveat: 'Photoresistor ADC counts; spectral response and circuit gain are uncalibrated (not lux, not PAR).',
  },
  {
    rawName: 'airPressure',
    aliases: [{ name: 'Barometricpressure' }, { name: 'barometricPressure' }, { name: 'pressure' }],
    normalizedName: 'air_pressure',
    unit: 'hPa',
    measurementKind: 'direct_measurement',
    physicalMin: 800,
    physicalMax: 1200,
    plausibleMin: 950,
    plausibleMax: 1060,
    critical: false,
    caveat: 'BMP180 absolute station pressure; not reduced to sea level.',
  },
];

export const INDOOR_VARIABLE_BY_RAW = new Map(INDOOR_VARIABLES.map((v) => [v.rawName, v]));
export const INDOOR_VARIABLE_BY_NORMALIZED = new Map(INDOOR_VARIABLES.map((v) => [v.normalizedName, v]));

/** Hint used in transformation steps; the actual path is configuration-driven. */
const SENSOR_DATA_PATH_HINT = 'sensorData';

export interface AnomalyResult {
  method: 'mad_zscore';
  score: number;
  baseline: number;
  mad: number;
  samples: number;
}

/** Robust anomaly score using median absolute deviation; never drops the value. */
export function detectAnomaly(
  baselineValues: readonly number[],
  current: number,
  opts: { minSamples: number; zThreshold: number }
): AnomalyResult | null {
  const clean = baselineValues.filter((v) => Number.isFinite(v));
  if (clean.length < opts.minSamples || !Number.isFinite(current)) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const absDeviations = clean.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = quantile(absDeviations, 0.5);
  const robustSigma = mad * 1.4826;
  if (robustSigma === 0) return null;

  const score = Math.abs(current - median) / robustSigma;
  if (score < opts.zThreshold) {
    return { method: 'mad_zscore', score: roundTo(score, 2), baseline: median, mad, samples: clean.length };
  }
  return { method: 'mad_zscore', score: roundTo(score, 2), baseline: median, mad, samples: clean.length };
}

function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedAsc[base + 1];
  return next === undefined ? sortedAsc[base] : sortedAsc[base] + rest * (next - sortedAsc[base]);
}

export interface ValidatedIndoorSnapshot {
  greenhouseId: string;
  deviceId: string | null;
  observedAt: string;
  observedAtMs: number;
  ingestedAt: string;
  ingestedAtMs: number;
  timestampFormat: TimestampFormat;
  timestampWarnings: string[];
  rawTimestamp: number | string | null;
  values: Record<string, number | null>;
  /**
   * The unmodified sensor values. `values` may hold a calibrated value; this
   * map always keeps what the sensor actually reported.
   */
  rawValues: Record<string, number | null>;
  /** Per-variable calibration outcome. Empty when no artifact was applied. */
  calibration: Record<string, CalibrationApplication>;
  units: Record<string, string>;
  /** The Firebase field name actually read for each normalized variable. */
  sourceFields: Record<string, string>;
  variableQuality: Record<string, QualityStatus>;
  anomalies: Record<string, AnomalyResult>;
  reasons: string[];
  overallQuality: 'ok' | 'degraded' | 'invalid' | 'stale';
  ageMinutes: number;
}

export interface NormalizeOptions {
  greenhouseId: string;
  deviceId: string | null;
  nowMs: number;
  staleAfterMs: number;
  gasMaxRaw: number;
  lightMaxRaw: number;
  anomaly: { minSamples: number; zThreshold: number };
  /** Historical values keyed by normalized variable name. */
  history?: Record<string, ReadonlyArray<{ ms: number; value: number }>>;
}

/** Locate a value for a variable, accepting the canonical name and aliases. */
export function readIndoorField(
  source: Record<string, unknown>,
  spec: IndoorVariableSpec
): { value: number | null; field: string | null; unit: string; note: string | null; aliasNote: string | null } {
  const candidates: Array<{ name: string; unit: string; note: string | null }> = [
    { name: spec.rawName, unit: spec.unit, note: null },
    ...spec.aliases.map((a) => ({ name: a.name, unit: a.unit ?? spec.unit, note: a.note ?? null })),
  ];

  for (const candidate of candidates) {
    if (!(candidate.name in source)) continue;
    const raw = source[candidate.name];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      // Present but unusable (NaN, Infinity, string). Keep looking at aliases,
      // but remember that the field was present and invalid.
      return {
        value: null,
        field: candidate.name,
        unit: candidate.unit,
        note: `${candidate.name} is present but is not a finite number`,
        aliasNote: candidate.note,
      };
    }
    return {
      value: raw,
      field: candidate.name,
      unit: candidate.unit,
      note: null,
      aliasNote: candidate.note,
    };
  }

  return { value: null, field: null, unit: spec.unit, note: null, aliasNote: null };
}

export function normalizeIndoorSnapshot(raw: unknown, opts: NormalizeOptions): ValidatedIndoorSnapshot {
  const reasons: string[] = [];
  const nowIso = toIsoUtc(opts.nowMs);
  const source = isRecord(raw) ? raw : {};

  if (!isRecord(raw)) reasons.push('sensorData node is missing or not an object');

  const detected = detectTimestamp(source.lastUpdate);
  const observedAtMs = detected.ms ?? opts.nowMs;
  if (detected.ms === null) {
    reasons.push('lastUpdate is missing or invalid; using ingestion time for the record');
  }
  reasons.push(...detected.warnings);

  const values: Record<string, number | null> = {};
  const units: Record<string, string> = {};
  const sourceFields: Record<string, string> = {};
  const variableQuality: Record<string, QualityStatus> = {};
  const anomalies: Record<string, AnomalyResult> = {};

  for (const spec of INDOOR_VARIABLES) {
    const read = readIndoorField(source, spec);
    units[spec.normalizedName] = read.unit;
    const maxRaw = spec.rawName === 'gas' ? opts.gasMaxRaw : spec.rawName === 'light' ? opts.lightMaxRaw : spec.physicalMax;

    if (read.field !== null) sourceFields[spec.normalizedName] = read.field;
    if (read.aliasNote) reasons.push(read.aliasNote);

    if (read.value === null) {
      values[spec.normalizedName] = null;
      variableQuality[spec.normalizedName] = read.note ? 'invalid' : 'missing';
      if (read.note) reasons.push(read.note);
      else if (spec.critical) reasons.push(`${spec.rawName} is missing`);
      continue;
    }

    const v = read.value;
    values[spec.normalizedName] = roundTo(v, 3);
    let status: QualityStatus = 'valid';

    if (v < spec.physicalMin || v > maxRaw) {
      status = 'invalid';
      reasons.push(
        `${read.field}=${v} is outside the hardware range ${spec.physicalMin}..${maxRaw} (${read.unit})`
      );
    } else if (v < spec.plausibleMin || v > spec.plausibleMax) {
      status = 'suspect';
      reasons.push(
        `${read.field}=${v} is outside the plausible greenhouse range ${spec.plausibleMin}..${spec.plausibleMax}`
      );
    }

    const baseline = opts.history?.[spec.normalizedName]?.map((p) => p.value);
    if (baseline && baseline.length > 0 && status !== 'invalid') {
      const anomaly = detectAnomaly(baseline, v, opts.anomaly);
      if (anomaly && anomaly.score >= opts.anomaly.zThreshold) {
        anomalies[spec.normalizedName] = anomaly;
        status = 'suspect';
        reasons.push(
          `${read.field} anomaly score ${anomaly.score} vs median ${roundTo(anomaly.baseline, 2)} ` +
            `(MAD ${roundTo(anomaly.mad, 3)}, n=${anomaly.samples})`
        );
      }
    }

    variableQuality[spec.normalizedName] = status;
  }

  const ageMs = opts.nowMs - observedAtMs;
  const ageMinutes = ageMs / 60_000;
  let stale = false;
  if (detected.ms !== null && ageMs > opts.staleAfterMs) {
    stale = true;
    reasons.push(`sensor snapshot is ${roundTo(ageMinutes, 1)} min old (limit ${roundTo(opts.staleAfterMs / 60_000, 1)} min)`);
  }
  if (detected.ms !== null && ageMs < -5 * 60_000) {
    stale = true;
    reasons.push(`sensor timestamp is ${roundTo(-ageMinutes, 1)} min in the future (clock skew?)`);
  }

  const criticalInvalid = INDOOR_VARIABLES.filter((s) => s.critical).some((s) => {
    const q = variableQuality[s.normalizedName];
    return q === 'invalid' || q === 'missing';
  });

  const anySuspect = Object.values(variableQuality).some((q) => q === 'suspect');

  let overallQuality: ValidatedIndoorSnapshot['overallQuality'];
  if (criticalInvalid) overallQuality = 'invalid';
  else if (stale) overallQuality = 'stale';
  else if (anySuspect || reasons.length > 0) overallQuality = 'degraded';
  else overallQuality = 'ok';

  return {
    greenhouseId: opts.greenhouseId,
    deviceId: opts.deviceId,
    observedAt: toIsoUtc(observedAtMs),
    observedAtMs,
    ingestedAt: nowIso,
    ingestedAtMs: opts.nowMs,
    timestampFormat: detected.format,
    timestampWarnings: detected.warnings,
    rawTimestamp: typeof source.lastUpdate === 'number' || typeof source.lastUpdate === 'string' ? source.lastUpdate : null,
    values,
    rawValues: { ...values },
    calibration: {},
    units,
    sourceFields,
    variableQuality,
    anomalies,
    reasons: dedupe(reasons),
    overallQuality,
    ageMinutes: roundTo(ageMinutes, 2),
  };
}

/**
 * Apply calibration results to a snapshot.
 *
 * The calibrated value replaces the value used for decisions, while the raw
 * sensor reading is preserved in `rawValues`. Nothing is clamped: a value that
 * the calibration did not apply to keeps its original magnitude.
 */
export function applyCalibrationToSnapshot(
  snapshot: ValidatedIndoorSnapshot,
  applications: Record<string, CalibrationApplication>
): ValidatedIndoorSnapshot {
  const values = { ...snapshot.values };
  for (const [variable, application] of Object.entries(applications)) {
    if (application.applied && application.calibratedValue !== null) {
      values[variable] = application.calibratedValue;
    }
  }
  return {
    ...snapshot,
    values,
    rawValues: { ...snapshot.rawValues },
    calibration: { ...snapshot.calibration, ...applications },
  };
}

/** Build one versioned observation record per normalized variable. */
export function indoorObservations(
  snapshot: ValidatedIndoorSnapshot,
  cfg: Pick<PipelineConfig, 'GREENHOUSE_LAT' | 'GREENHOUSE_LON'>
): ObservationV1[] {
  const configured =
    cfg.GREENHOUSE_LAT !== undefined && cfg.GREENHOUSE_LON !== undefined
      ? { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON }
      : null;

  return INDOOR_VARIABLES.map((spec) => {
    const value = snapshot.values[spec.normalizedName] ?? null;
    const rawValue = snapshot.rawValues[spec.normalizedName] ?? null;
    const quality = snapshot.variableQuality[spec.normalizedName] ?? 'missing';
    const anomaly = snapshot.anomalies[spec.normalizedName] ?? null;
    const observedAt = snapshot.observedAt;
    const calibration = snapshot.calibration[spec.normalizedName] ?? null;
    // The field actually read from Firebase is preserved; the canonical name
    // is only a fallback when nothing was present.
    const originalName = snapshot.sourceFields[spec.normalizedName] ?? spec.rawName;
    const originalUnit = snapshot.units[spec.normalizedName] ?? spec.unit;
    return {
      schemaVersion: OBSERVATION_SCHEMA,
      observationId: `obs_indoor_${sanitizePathKey(snapshot.greenhouseId)}_${snapshot.observedAtMs}_${spec.normalizedName}`,
      greenhouseId: snapshot.greenhouseId,
      deviceId: snapshot.deviceId,
      source: {
        id: 'greenhouse-esp32',
        provider: 'Sensoura ESP32 node (Firebase RTDB)',
        product: snapshot.deviceId,
        dataset: null,
        transport: 'firebase-rtdb',
      },
      variable: {
        originalName,
        normalizedName: spec.normalizedName,
        originalUnit,
        normalizedUnit: originalUnit,
        measurementKind: spec.measurementKind,
      },
      value: {
        raw: rawValue,
        normalized: value,
        missing: value === null,
      },
      timestamps: {
        observedAt,
        observedAtMs: snapshot.observedAtMs,
        ingestedAt: snapshot.ingestedAt,
        sourceTimestamp:
          snapshot.rawTimestamp === null
            ? null
            : { raw: snapshot.rawTimestamp, format: snapshot.timestampFormat },
        utcOffsetSeconds: null,
      },
      location: { configured, observed: null, distanceKm: null },
      quality: {
        status: quality,
        reasons: snapshot.reasons.filter(
          (r) =>
            r.toLowerCase().includes(spec.rawName.toLowerCase()) ||
            r.toLowerCase().includes(originalName.toLowerCase())
        ),
        anomaly,
      },
      calibration: calibration
        ? {
            status: calibration.applied ? calibration.status : 'none',
            methodId: calibration.methodId,
            description: calibration.applied
              ? calibration.description
              : `calibration not applied: ${calibration.reason}`,
            applied: calibration.applied,
          }
        : {
            // No calibration artifact exists for this variable: the reading is
            // used as reported. `applied` stays false because no model or
            // coefficient was used (the schema reserves `true` for that).
            status: spec.measurementKind === 'index' ? 'not_applicable' : 'none',
            methodId: spec.measurementKind === 'index' ? 'uncalibrated_index' : 'unit_passthrough',
            description: spec.caveat,
            applied: false,
          },
      matching: {
        role: 'indoor',
        method: 'none',
        timeDeltaSeconds: null,
        distanceKm: null,
        notes: spec.caveat ? [spec.caveat] : [],
      },
      transformation: {
        steps: [
          `read Firebase ${SENSOR_DATA_PATH_HINT}`,
          `field "${originalName}"`,
          'validate range',
          'round to 3 decimals',
          ...(calibration?.applied ? [`apply calibration ${calibration.methodId}`] : []),
        ],
        rulesetVersion: RULESET_VERSION,
      },
    } as ObservationV1;
  });
}

/** Compact series point used for trends, backtests and outcome assessment. */
export function toSeriesPoint(snapshot: ValidatedIndoorSnapshot): IndoorSeriesPoint {
  return {
    schemaVersion: OBSERVATION_SCHEMA,
    observedAtMs: snapshot.observedAtMs,
    observedAt: snapshot.observedAt,
    ingestedAt: snapshot.ingestedAt,
    greenhouseId: snapshot.greenhouseId,
    deviceId: snapshot.deviceId,
    // The stored series always keeps the RAW sensor values, so the history
    // stays homogeneous even if a calibration artifact is added later.
    values: snapshot.rawValues,
    units: snapshot.units,
    sourceFields: snapshot.sourceFields,
    quality: snapshot.variableQuality,
    overallQuality: snapshot.overallQuality,
  };
}

export interface TrendResult {
  slopePerHour: number | null;
  delta: number | null;
  samples: number;
  windowMinutes: number;
}

/** Ordinary least squares slope over (time, value) pairs. */
export function computeTrend(points: ReadonlyArray<{ ms: number; value: number }>): TrendResult {
  const pts = points.filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value));
  if (pts.length < 3) return { slopePerHour: null, delta: null, samples: pts.length, windowMinutes: 0 };
  const t0 = pts[0].ms;
  const xs = pts.map((p) => (p.ms - t0) / 3_600_000);
  const ys = pts.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return { slopePerHour: null, delta: null, samples: n, windowMinutes: 0 };
  return {
    slopePerHour: roundTo(num / den, 4),
    delta: roundTo(ys[n - 1] - ys[0], 4),
    samples: n,
    windowMinutes: roundTo((pts[pts.length - 1].ms - t0) / 60_000, 1),
  };
}

/** Convert stored series points into per-variable time series. */
export function seriesValues(
  points: ReadonlyArray<IndoorSeriesPoint>
): Record<string, Array<{ ms: number; value: number }>> {
  const out: Record<string, Array<{ ms: number; value: number }>> = {};
  for (const p of points) {
    const ms = typeof p.observedAtMs === 'number' ? p.observedAtMs : parseIsoUtc(p.observedAt);
    for (const [name, value] of Object.entries(p.values ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      (out[name] ??= []).push({ ms, value });
    }
  }
  for (const series of Object.values(out)) series.sort((a, b) => a.ms - b.ms);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
