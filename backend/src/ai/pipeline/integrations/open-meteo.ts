/**
 * Open-Meteo adapters.
 *
 * Endpoints and parameter names were verified against the live API
 * (2026-10-21, coordinates 30.79 N / 31.00 E):
 *   GET https://api.open-meteo.com/v1/forecast
 *   GET https://archive-api.open-meteo.com/v1/archive
 *   GET https://air-quality-api.open-meteo.com/v1/air-quality
 *
 * All requests use `timezone=UTC`, so returned ISO strings have no offset and
 * are interpreted as UTC (recorded as a warning by the timestamp detector).
 */
import { z } from 'zod';
import type { PipelineConfig } from '../config.js';
import { hasCoordinates } from '../config.js';
import { detectTimestamp, toIsoUtc, utcDateKeyCompact } from '../utils/time.js';
import { ExternalApiError } from '../utils/retry.js';
import { redactUrl } from '../utils/retry.js';
import type { HttpJsonClient } from './http.js';

export interface ProviderVariableValue {
  originalName: string;
  value: number | null;
  unit: string;
  measurementKind: 'modeled' | 'reanalysis' | 'remotely_retrieved' | 'derived';
  notes: string[];
}

export interface ProviderSnapshot {
  sourceId: 'open-meteo';
  provider: string;
  product: string;
  dataset: string | null;
  requestUrl: string;
  fetchedAtMs: number;
  observedAtMs: number;
  grid: { lat: number; lon: number; elevationM: number | null };
  variables: ProviderVariableValue[];
  caveats: string[];
}

export interface HourlyRows {
  requestUrl: string;
  grid: { lat: number; lon: number; elevationM: number | null };
  units: Record<string, string>;
  rows: Array<{ atMs: number; values: Record<string, number | null> }>;
  caveats: string[];
}

export interface DailyRows {
  requestUrl: string;
  grid: { lat: number; lon: number; elevationM: number | null };
  units: Record<string, string>;
  rows: Array<{ dateKey: string; values: Record<string, number | null> }>;
  caveats: string[];
}

export const OPEN_METEO_CURRENT_VARIABLES = [
  { name: 'temperature_2m', normalized: 'outdoor_air_temperature', unit: 'degC', kind: 'modeled' as const },
  { name: 'relative_humidity_2m', normalized: 'outdoor_relative_humidity', unit: '%', kind: 'modeled' as const },
  { name: 'surface_pressure', normalized: 'outdoor_surface_pressure', unit: 'hPa', kind: 'modeled' as const },
  { name: 'shortwave_radiation', normalized: 'outdoor_shortwave_radiation', unit: 'W/m2', kind: 'modeled' as const },
  { name: 'precipitation', normalized: 'outdoor_precipitation', unit: 'mm', kind: 'modeled' as const },
  { name: 'soil_temperature_0cm', normalized: 'outdoor_skin_temperature', unit: 'degC', kind: 'modeled' as const },
  { name: 'soil_moisture_0_to_1cm', normalized: 'outdoor_soil_moisture_0_1cm', unit: 'm3/m3', kind: 'modeled' as const },
] as const;

export const OPEN_METEO_AIR_VARIABLES = [
  { name: 'pm2_5', normalized: 'pm2_5', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'pm10', normalized: 'pm10', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'carbon_monoxide', normalized: 'carbon_monoxide', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'nitrogen_dioxide', normalized: 'nitrogen_dioxide', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'sulphur_dioxide', normalized: 'sulphur_dioxide', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'ozone', normalized: 'ozone', unit: 'μg/m³', kind: 'modeled' as const },
  { name: 'aerosol_optical_depth', normalized: 'aerosol_optical_depth', unit: '1', kind: 'modeled' as const },
] as const;

const nullableNumber = z.union([z.number(), z.null()]);

const responseBaseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number().nullable().optional(),
    timezone: z.string().optional(),
    utc_offset_seconds: z.number().optional(),
    current: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
    current_units: z.record(z.string()).optional(),
    hourly: z.object({ time: z.array(z.string()) }).passthrough().optional(),
    hourly_units: z.record(z.string()).optional(),
    daily: z.record(z.array(z.union([z.string(), nullableNumber]))).optional(),
    daily_units: z.record(z.string()).optional(),
    error: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

type ResponseBase = z.infer<typeof responseBaseSchema>;

function requireCoordinates(cfg: PipelineConfig): { lat: number; lon: number } {
  if (!hasCoordinates(cfg)) {
    throw new ExternalApiError(
      'Open-Meteo requires GREENHOUSE_LAT/GREENHOUSE_LON; external sources are disabled until configured',
      'validation',
      'open-meteo',
      null,
      false
    );
  }
  return { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON };
}

function cacheKey(lat: number, lon: number, path: string): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}|${path}`;
}

function gridOf(res: ResponseBase) {
  return {
    lat: res.latitude,
    lon: res.longitude,
    elevationM: typeof res.elevation === 'number' ? res.elevation : null,
  };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function failIfError(res: ResponseBase, label: string): void {
  if (res.error) {
    throw new ExternalApiError(`${label}: provider error — ${res.reason ?? 'unknown reason'}`, 'validation', label, null, false);
  }
}

const CURRENT_CAVEAT =
  'Open-Meteo values are modeled open-air grid-cell estimates, not in-greenhouse measurements.';

/** Current conditions (15-minute provider interval) for the configured site. */
export async function fetchOpenMeteoCurrent(
  cfg: PipelineConfig,
  http: HttpJsonClient,
  nowMs: number
): Promise<ProviderSnapshot | null> {
  const { lat, lon } = requireCoordinates(cfg);
  const names = OPEN_METEO_CURRENT_VARIABLES.map((v) => v.name).join(',');
  const url =
    `${cfg.OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&current=${names}&timezone=UTC&forecast_days=1`;

  const res = await http.getJson(url, responseBaseSchema, 'open-meteo:current', cfg.OPEN_METEO_CURRENT_CACHE_MS);
  failIfError(res, 'open-meteo:current');
  if (!res.current) {
    throw new ExternalApiError('open-meteo:current: response has no `current` block', 'validation', 'open-meteo', null, false);
  }

  const detected = detectTimestamp(res.current.time);
  if (detected.ms === null) {
    throw new ExternalApiError(
      'open-meteo:current: current.time is missing or invalid',
      'validation',
      'open-meteo',
      null,
      false
    );
  }

  const variables: ProviderVariableValue[] = OPEN_METEO_CURRENT_VARIABLES.map((spec) => {
    const raw = res.current?.[spec.name];
    const value = num(raw);
    const unit = res.current_units?.[spec.name] ?? spec.unit;
    const notes = [CURRENT_CAVEAT];
    if (value === null) notes.push('provider returned null/missing for this variable');
    if (unit !== spec.unit) notes.push(`provider reported unit "${unit}" (expected "${spec.unit}")`);
    return {
      originalName: spec.name,
      value,
      unit,
      measurementKind: spec.kind,
      notes,
    };
  });

  return {
    sourceId: 'open-meteo',
    provider: 'Open-Meteo',
    product: 'forecast (default best_match)',
    dataset: 'multi-model blend (see Open-Meteo model documentation)',
    requestUrl: redactUrl(url),
    fetchedAtMs: nowMs,
    observedAtMs: detected.ms,
    grid: gridOf(res),
    variables,
    caveats: [
      CURRENT_CAVEAT,
      'The API returns the grid-cell centre used for the request; native resolution depends on the selected model.',
      `UTC offset reported by provider: ${res.utc_offset_seconds ?? 0} s`,
    ],
  };
}

/** Hourly forecast/nowcast range, including the last `pastDays` days. */
export async function fetchOpenMeteoHourlyRange(
  cfg: PipelineConfig,
  http: HttpJsonClient,
  opts: { pastDays: number; forecastDays: number; nowMs: number }
): Promise<HourlyRows> {
  const { lat, lon } = requireCoordinates(cfg);
  const names = OPEN_METEO_CURRENT_VARIABLES.map((v) => v.name).join(',');
  const url =
    `${cfg.OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${names}&timezone=UTC&past_days=${Math.max(0, Math.round(opts.pastDays))}` +
    `&forecast_days=${Math.max(1, Math.round(opts.forecastDays))}`;

  const res = await http.getJson(url, responseBaseSchema, 'open-meteo:hourly', cfg.OPEN_METEO_HOURLY_CACHE_MS);
  failIfError(res, 'open-meteo:hourly');
  if (!res.hourly?.time?.length) {
    throw new ExternalApiError('open-meteo:hourly: response has no hourly time axis', 'validation', 'open-meteo', null, false);
  }

  const times = res.hourly.time;
  const rows: HourlyRows['rows'] = times.map((time, i) => {
    const detected = detectTimestamp(time);
    const values: Record<string, number | null> = {};
    for (const spec of OPEN_METEO_CURRENT_VARIABLES) {
      const series = (res.hourly as Record<string, unknown>)[spec.name];
      if (!Array.isArray(series)) {
        values[spec.name] = null;
        continue;
      }
      if (series.length !== times.length) {
        throw new ExternalApiError(
          `open-meteo:hourly: variable ${spec.name} has ${series.length} values for ${times.length} timestamps`,
          'validation',
          'open-meteo',
          null,
          false
        );
      }
      values[spec.name] = num(series[i]);
    }
    return { atMs: detected.ms ?? Number.NaN, values };
  });

  if (rows.some((r) => !Number.isFinite(r.atMs))) {
    throw new ExternalApiError('open-meteo:hourly: unparseable timestamps in time axis', 'validation', 'open-meteo', null, false);
  }

  const units: Record<string, string> = {};
  for (const spec of OPEN_METEO_CURRENT_VARIABLES) {
    units[spec.name] = res.hourly_units?.[spec.name] ?? spec.unit;
  }

  return {
    requestUrl: redactUrl(url),
    grid: gridOf(res),
    units,
    rows: rows.sort((a, b) => a.atMs - b.atMs),
    caveats: [CURRENT_CAVEAT, 'Hourly values are provider model output, not measurements at the greenhouse.'],
  };
}

/** Historical daily aggregates from the ERA5-Land archive endpoint. */
export async function fetchOpenMeteoArchiveDaily(
  cfg: PipelineConfig,
  http: HttpJsonClient,
  opts: { startDate: string; endDate: string }
): Promise<DailyRows> {
  const { lat, lon } = requireCoordinates(cfg);
  const start = opts.startDate;
  const end = opts.endDate;
  const spanDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(spanDays) || spanDays < 0) {
    throw new ExternalApiError('open-meteo:archive: invalid date range', 'validation', 'open-meteo', null, false);
  }
  if (spanDays > 400) {
    throw new ExternalApiError(
      'open-meteo:archive: date range exceeds 400 days; request in smaller chunks',
      'validation',
      'open-meteo',
      null,
      false
    );
  }

  const daily =
    'temperature_2m_mean,temperature_2m_min,temperature_2m_max,relative_humidity_2m_mean,precipitation_sum';
  const url =
    `${cfg.OPEN_METEO_ARCHIVE_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${end}&daily=${daily}&timezone=UTC`;

  const res = await http.getJson(url, responseBaseSchema, 'open-meteo:archive', cfg.OPEN_METEO_ARCHIVE_CACHE_MS);
  failIfError(res, 'open-meteo:archive');
  const timeAxis = res.daily?.time;
  if (!Array.isArray(timeAxis) || timeAxis.length === 0) {
    throw new ExternalApiError('open-meteo:archive: no daily time axis', 'validation', 'open-meteo', null, false);
  }

  const rows: DailyRows['rows'] = timeAxis.map((dateRaw, i) => {
    const dateKey = String(dateRaw).slice(0, 10);
    const values: Record<string, number | null> = {};
    for (const name of daily.split(',')) {
      const series = res.daily?.[name];
      if (!Array.isArray(series) || series.length !== timeAxis.length) {
        values[name] = null;
        continue;
      }
      values[name] = num(series[i]);
    }
    return { dateKey, values };
  });

  const units: Record<string, string> = {};
  for (const name of daily.split(',')) units[name] = res.daily_units?.[name] ?? '';

  return {
    requestUrl: redactUrl(url),
    grid: gridOf(res),
    units,
    rows,
    caveats: [
      'ERA5-Land reanalysis (open-air, ~0.1° grid): modeled historical conditions, not measurements at this greenhouse.',
      'Archive data lags real time by several days; recent days may be null.',
    ],
  };
}

/** Current atmospheric composition from the Open-Meteo air-quality API (CAMS). */
export async function fetchOpenMeteoAirQuality(
  cfg: PipelineConfig,
  http: HttpJsonClient,
  nowMs: number
): Promise<ProviderSnapshot | null> {
  const { lat, lon } = requireCoordinates(cfg);
  const names = OPEN_METEO_AIR_VARIABLES.map((v) => v.name).join(',');
  const url = `${cfg.OPEN_METEO_AIR_QUALITY_URL}?latitude=${lat}&longitude=${lon}&current=${names}&timezone=UTC`;

  const res = await http.getJson(url, responseBaseSchema, 'open-meteo:air-quality', cfg.OPEN_METEO_AIR_QUALITY_CACHE_MS);
  failIfError(res, 'open-meteo:air-quality');
  if (!res.current) {
    throw new ExternalApiError('open-meteo:air-quality: response has no current block', 'validation', 'open-meteo', null, false);
  }
  const detected = detectTimestamp(res.current.time);
  if (detected.ms === null) {
    throw new ExternalApiError('open-meteo:air-quality: invalid current.time', 'validation', 'open-meteo', null, false);
  }

  const variables: ProviderVariableValue[] = OPEN_METEO_AIR_VARIABLES.map((spec) => {
    const value = num(res.current?.[spec.name]);
    const unit = res.current_units?.[spec.name] ?? spec.unit;
    return {
      originalName: spec.name,
      value,
      unit: unit === '' ? spec.unit : unit,
      measurementKind: spec.kind,
      notes: [
        'CAMS atmospheric-composition model output for the grid cell, not a local air-quality measurement.',
        'This is NOT a VOC measurement and must not be used as one.',
      ],
    };
  });

  return {
    sourceId: 'open-meteo',
    provider: 'Open-Meteo (CAMS)',
    product: 'air-quality current',
    dataset: 'CAMS global/European atmospheric composition',
    requestUrl: redactUrl(url),
    fetchedAtMs: nowMs,
    observedAtMs: detected.ms,
    grid: gridOf(res),
    variables,
    caveats: [
      'Atmospheric indicators are stored under their own names; none of them is a VOC index.',
      'CAMS resolution and update cadence depend on the domain; the API returns the grid-cell centre.',
    ],
  };
}

/** Format helper used by the prediction engine (UTC calendar day). */
export function dateKeyFromMs(ms: number): string {
  return toIsoUtc(ms).slice(0, 10);
}

export function compactDateKeyFromMs(ms: number): string {
  return utcDateKeyCompact(ms);
}

export { cacheKey as openMeteoCacheKey };
