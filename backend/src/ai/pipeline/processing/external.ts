/**
 * External observation normalization.
 *
 * Raw provider values are preserved next to the normalized value and the
 * conversion steps. Unsupported mappings keep `normalized = null` and a quality
 * reason; nothing is relabelled.
 */
import type { PipelineConfig } from '../config.js';
import { hasCoordinates } from '../config.js';
import { mappingFor } from '../calibration/registry.js';
import {
  OBSERVATION_SCHEMA,
  RULESET_VERSION,
  sanitizePathKey,
  type ObservationV1,
} from '../schema.js';
import type { MatchingInfo } from '../utils/matching.js';
import { matchSpatial, outdoorMatching } from '../utils/matching.js';
import { toIsoUtc } from '../utils/time.js';
import { convert, haversineKm, roundTo } from '../utils/units.js';
import type { NasaPowerRows } from '../integrations/nasa-power.js';
import { NASA_POWER_VARIABLES } from '../integrations/nasa-power.js';
import type { ProviderSnapshot } from '../integrations/open-meteo.js';
import { OPEN_METEO_AIR_VARIABLES, OPEN_METEO_CURRENT_VARIABLES } from '../integrations/open-meteo.js';

const NORMALIZED_BY_SOURCE: Record<string, Record<string, { normalized: string; unit: string }>> = {
  'open-meteo': Object.fromEntries(
    [...OPEN_METEO_CURRENT_VARIABLES, ...OPEN_METEO_AIR_VARIABLES].map((v) => [
      v.name,
      { normalized: v.normalized, unit: v.unit },
    ])
  ),
  'nasa-power': Object.fromEntries(
    NASA_POWER_VARIABLES.map((v) => [v.name, { normalized: v.normalized, unit: v.expectedUnit }])
  ),
};

/** Physical bounds for provider variables; out-of-range values are invalid. */
const EXTERNAL_RANGES: Record<string, [number, number]> = {
  outdoor_air_temperature: [-60, 60],
  outdoor_relative_humidity: [0, 100],
  outdoor_surface_pressure: [800, 1100],
  outdoor_shortwave_radiation: [0, 1600],
  outdoor_precipitation: [0, 300],
  outdoor_skin_temperature: [-60, 80],
  outdoor_soil_moisture_0_1cm: [0, 1],
  outdoor_wind_speed: [0, 100],
  pm2_5: [0, 1500],
  pm10: [0, 3000],
  carbon_monoxide: [0, 100_000],
  nitrogen_dioxide: [0, 2000],
  sulphur_dioxide: [0, 2000],
  ozone: [0, 2000],
  aerosol_optical_depth: [0, 10],
};

export interface OutdoorContext {
  sourceId: 'open-meteo';
  observedAtMs: number;
  observedAt: string;
  ageMinutes: number;
  timeDeltaSeconds: number | null;
  distanceKm: number | null;
  values: Record<string, number | null>;
  units: Record<string, string>;
  quality: 'ok' | 'degraded' | 'invalid' | 'stale';
  reasons: string[];
  caveats: string[];
  atmospheric: Record<string, number | null>;
  requestUrl: string;
}

export interface ExternalObservationOptions {
  nowMs: number;
  greenhouseId: string;
  referenceMs: number;
  maxDeltaSeconds: number;
  maxDistanceKm: number;
}

function normalizeValue(
  sourceId: string,
  originalName: string,
  rawValue: number | null,
  rawUnit: string
): { normalizedName: string | null; normalizedValue: number | null; unit: string; steps: string[]; reason: string | null } {
  const spec = NORMALIZED_BY_SOURCE[sourceId]?.[originalName];
  if (!spec) {
    return {
      normalizedName: null,
      normalizedValue: null,
      unit: rawUnit,
      steps: [],
      reason: `no normalized variable is defined for ${sourceId}:${originalName}`,
    };
  }
  if (rawValue === null) {
    return { normalizedName: spec.normalized, normalizedValue: null, unit: spec.unit, steps: [], reason: 'provider value is null/missing' };
  }

  // Aerosol optical depth is dimensionless and reported with an empty unit.
  if (spec.unit === '1' && (rawUnit === '' || rawUnit === '1')) {
    return { normalizedName: spec.normalized, normalizedValue: rawValue, unit: '1', steps: ['no conversion (dimensionless)'], reason: null };
  }

  const converted = convert(rawValue, rawUnit, spec.unit);
  if (!converted) {
    return {
      normalizedName: spec.normalized,
      normalizedValue: null,
      unit: spec.unit,
      steps: [],
      reason: `unsupported unit conversion ${rawUnit} -> ${spec.unit}; raw value preserved`,
    };
  }
  return {
    normalizedName: spec.normalized,
    normalizedValue: roundTo(converted.value, 4),
    unit: spec.unit,
    steps: converted.steps,
    reason: null,
  };
}

export function buildExternalObservation(params: {
  cfg: PipelineConfig;
  greenhouseId: string;
  sourceId: 'open-meteo' | 'nasa-power';
  provider: string;
  product: string | null;
  dataset: string | null;
  requestUrl: string;
  originalName: string;
  rawValue: number | null;
  rawUnit: string;
  measurementKind: ObservationV1['variable']['measurementKind'];
  observedAtMs: number;
  ingestedAtMs: number;
  grid: { lat: number; lon: number } | null;
  timeDeltaSeconds: number | null;
  caveats: string[];
  atmosphericIndicator: boolean;
}): ObservationV1 {
  const { cfg } = params;
  const normalized = normalizeValue(params.sourceId, params.originalName, params.rawValue, params.rawUnit);
  const mapping = mappingFor(params.sourceId, params.originalName);
  const configured = hasCoordinates(cfg) ? { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON } : null;
  const spatial = matchSpatial(configured, params.grid, cfg.MAX_PROVIDER_DISTANCE_KM);

  const range = normalized.normalizedName ? EXTERNAL_RANGES[normalized.normalizedName] : undefined;
  const reasons: string[] = [];
  let quality: ObservationV1['quality']['status'] = 'valid';

  if (params.rawValue === null) {
    quality = 'missing';
    reasons.push('provider returned a missing/fill value');
  } else if (normalized.normalizedValue === null) {
    quality = 'invalid';
    reasons.push(normalized.reason ?? 'value could not be normalized');
  } else if (range && (normalized.normalizedValue < range[0] || normalized.normalizedValue > range[1])) {
    quality = 'invalid';
    reasons.push(
      `normalized value ${normalized.normalizedValue} is outside the physical range ${range[0]}..${range[1]}`
    );
  }

  if (mapping?.classification === 'unsupported') {
    reasons.push(mapping.reason);
  }
  if (spatial.distanceKm !== null && spatial.distanceKm > cfg.MAX_PROVIDER_DISTANCE_KM) {
    reasons.push(`provider grid cell is ${spatial.distanceKm} km away (> ${cfg.MAX_PROVIDER_DISTANCE_KM} km)`);
    if (quality === 'valid') quality = 'suspect';
  }

  const matching: MatchingInfo = outdoorMatching({
    timeDeltaSeconds: params.timeDeltaSeconds,
    distanceKm: spatial.distanceKm,
    notes: [
      ...spatial.notes,
      'outdoor/provider observation, not a greenhouse measurement',
      ...(mapping ? [`mapping: ${mapping.classification} — ${mapping.reason}`] : []),
    ],
    atmosphericIndicator: params.atmosphericIndicator,
  });

  const conversionApplied = normalized.steps.some((s) => !s.startsWith('no conversion'));
  const calibrationStatus: ObservationV1['calibration']['status'] =
    mapping?.classification === 'unsupported'
      ? 'not_applicable'
      : conversionApplied
        ? 'unit_conversion'
        : 'none';

  return {
    schemaVersion: OBSERVATION_SCHEMA,
    observationId: `obs_${params.sourceId}_${sanitizePathKey(params.originalName)}_${params.observedAtMs}`,
    greenhouseId: params.greenhouseId,
    deviceId: null,
    source: {
      id: params.sourceId,
      provider: params.provider,
      product: params.product,
      dataset: params.dataset,
      transport: 'https-rest',
    },
    variable: {
      originalName: params.originalName,
      normalizedName: normalized.normalizedName ?? sanitizePathKey(params.originalName),
      originalUnit: params.rawUnit,
      normalizedUnit: normalized.normalizedName ? normalized.unit : null,
      measurementKind: params.measurementKind,
    },
    value: {
      raw: params.rawValue,
      normalized: normalized.normalizedValue,
      missing: params.rawValue === null,
    },
    timestamps: {
      observedAt: toIsoUtc(params.observedAtMs),
      observedAtMs: params.observedAtMs,
      ingestedAt: toIsoUtc(params.ingestedAtMs),
      sourceTimestamp: { raw: toIsoUtc(params.observedAtMs), format: 'iso8601_utc' },
      utcOffsetSeconds: 0,
    },
    location: {
      configured,
      observed: params.grid,
      distanceKm: spatial.distanceKm,
    },
    quality: {
      status: quality,
      reasons,
      anomaly: null,
    },
    calibration: {
      status: calibrationStatus,
      methodId: calibrationStatus === 'not_applicable' ? 'unsupported_mapping' : conversionApplied ? 'unit_conversion' : null,
      description: mapping?.reason ?? null,
      applied: calibrationStatus === 'unit_conversion',
    },
    matching,
    transformation: {
      steps: [
        `request ${params.requestUrl}`,
        ...normalized.steps,
        `quality check (${quality})`,
      ],
      rulesetVersion: RULESET_VERSION,
    },
  };
}

export function buildOpenMeteoObservations(
  cfg: PipelineConfig,
  snapshot: ProviderSnapshot,
  opts: ExternalObservationOptions
): ObservationV1[] {
  const airQuality = snapshot.product.includes('air-quality');
  const configured = hasCoordinates(cfg) ? { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON } : null;
  const distanceKm = configured ? roundTo(haversineKm(configured, snapshot.grid), 2) : null;

  return snapshot.variables.map((v) =>
    buildExternalObservation({
      cfg,
      greenhouseId: opts.greenhouseId,
      sourceId: 'open-meteo',
      provider: snapshot.provider,
      product: snapshot.product,
      dataset: snapshot.dataset,
      requestUrl: snapshot.requestUrl,
      originalName: v.originalName,
      rawValue: v.value,
      rawUnit: v.unit,
      measurementKind: v.measurementKind,
      observedAtMs: snapshot.observedAtMs,
      ingestedAtMs: opts.nowMs,
      grid: { lat: snapshot.grid.lat, lon: snapshot.grid.lon },
      timeDeltaSeconds: roundTo((opts.referenceMs - snapshot.observedAtMs) / 1000, 1),
      caveats: [...snapshot.caveats, ...v.notes],
      atmosphericIndicator: airQuality,
    })
  ).map((record) => ({
    ...record,
    // The distance was already computed; keep the matching notes consistent.
    location: { ...record.location, distanceKm: record.location.distanceKm ?? distanceKm },
  }));
}

export function buildNasaPowerObservations(
  cfg: PipelineConfig,
  rows: NasaPowerRows,
  opts: ExternalObservationOptions
): ObservationV1[] {
  const recent = rows.rows.slice(-24);
  const records: ObservationV1[] = [];
  for (const row of recent) {
    for (const spec of NASA_POWER_VARIABLES) {
      const raw = row.values[spec.name] ?? null;
      records.push(
        buildExternalObservation({
          cfg,
          greenhouseId: opts.greenhouseId,
          sourceId: 'nasa-power',
          provider: 'NASA POWER',
          product: 'hourly point (native resolution)',
          dataset: 'MERRA-2 / GEOS-IT / CERES SYN1deg',
          requestUrl: rows.requestUrl,
          originalName: spec.name,
          rawValue: raw,
          rawUnit: rows.units[spec.name] ?? spec.expectedUnit,
          measurementKind: spec.measurementKind,
          observedAtMs: row.atMs,
          ingestedAtMs: opts.nowMs,
          grid: { lat: rows.grid.lat, lon: rows.grid.lon },
          timeDeltaSeconds: roundTo((opts.referenceMs - row.atMs) / 1000, 1),
          caveats: [...rows.caveats, ...spec.notes],
          atmosphericIndicator: false,
        })
      );
    }
  }
  return records;
}

/** Outdoor context used by the decision engine (outdoor reference only). */
export function buildOutdoorContext(
  cfg: PipelineConfig,
  snapshot: ProviderSnapshot,
  opts: { nowMs: number; timeDeltaSeconds: number | null; airQuality?: ProviderSnapshot | null }
): OutdoorContext {
  const values: Record<string, number | null> = {};
  const units: Record<string, string> = {};
  const reasons: string[] = [];

  for (const v of snapshot.variables) {
    const normalized = normalizeValue('open-meteo', v.originalName, v.value, v.unit);
    if (!normalized.normalizedName) continue;
    values[normalized.normalizedName] = normalized.normalizedValue;
    units[normalized.normalizedName] = normalized.unit;
    if (normalized.reason) reasons.push(`${v.originalName}: ${normalized.reason}`);
  }

  const atmospheric: Record<string, number | null> = {};
  if (opts.airQuality) {
    for (const v of opts.airQuality.variables) {
      const normalized = normalizeValue('open-meteo', v.originalName, v.value, v.unit);
      if (normalized.normalizedName) atmospheric[normalized.normalizedName] = normalized.normalizedValue;
    }
  }

  const configured = hasCoordinates(cfg) ? { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON } : null;
  const distanceKm = configured ? roundTo(haversineKm(configured, snapshot.grid), 2) : null;
  const ageMinutes = roundTo((opts.nowMs - snapshot.observedAtMs) / 60_000, 1);

  if (ageMinutes * 60_000 > cfg.EXTERNAL_STALE_AFTER_MS) {
    reasons.push(`outdoor observation is ${ageMinutes} min old (limit ${Math.round(cfg.EXTERNAL_STALE_AFTER_MS / 60_000)} min)`);
  }
  if (values.outdoor_air_temperature === null || values.outdoor_air_temperature === undefined) {
    reasons.push('outdoor air temperature is missing');
  }
  if (values.outdoor_relative_humidity === null || values.outdoor_relative_humidity === undefined) {
    reasons.push('outdoor relative humidity is missing');
  }
  if (distanceKm !== null && distanceKm > cfg.MAX_PROVIDER_DISTANCE_KM) {
    reasons.push(`provider grid cell is ${distanceKm} km away (> ${cfg.MAX_PROVIDER_DISTANCE_KM} km)`);
  }

  const criticalMissing =
    (values.outdoor_air_temperature === null || values.outdoor_air_temperature === undefined) &&
    (values.outdoor_relative_humidity === null || values.outdoor_relative_humidity === undefined);
  const stale = ageMinutes * 60_000 > cfg.EXTERNAL_STALE_AFTER_MS;

  return {
    sourceId: 'open-meteo',
    observedAtMs: snapshot.observedAtMs,
    observedAt: toIsoUtc(snapshot.observedAtMs),
    ageMinutes,
    timeDeltaSeconds: opts.timeDeltaSeconds,
    distanceKm,
    values,
    units,
    quality: stale ? 'stale' : criticalMissing ? 'invalid' : reasons.length > 0 ? 'degraded' : 'ok',
    reasons,
    caveats: [...snapshot.caveats, ...(opts.airQuality?.caveats ?? [])],
    atmospheric,
    requestUrl: snapshot.requestUrl,
  };
}
