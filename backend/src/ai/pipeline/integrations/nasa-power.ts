/**
 * NASA POWER hourly point adapter.
 *
 * Verified against the live API (2026-10-21, 30.79 N / 31.00 E):
 *   GET https://power.larc.nasa.gov/api/temporal/hourly/point
 *   ?parameters=T2M,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR,TS
 *   &community=AG&longitude=..&latitude=..&start=YYYYMMDD&end=YYYYMMDD
 *   &format=JSON&time-standard=UTC
 *
 * Two API behaviours are handled explicitly:
 *  - Without `time-standard=UTC`, POWER returns Local Solar Time (LST), which
 *    would silently shift every observation. UTC is always requested and the
 *    response header is checked.
 *  - Missing values are returned as the header's fill value (-999), not null.
 *    Fill values become `null` (missing), never zero.
 *
 * `ALLSKY_SFC_SW_DWN` has been observed with unit `MJ/hr` in hourly responses
 * (despite some documentation showing W/m²). The unit is read from the
 * response and converted downstream instead of assumed.
 */
import { z } from 'zod';
import type { PipelineConfig } from '../config.js';
import { hasCoordinates } from '../config.js';
import { parsePowerHourUtc, toIsoUtc } from '../utils/time.js';
import { ExternalApiError, redactUrl } from '../utils/retry.js';
import type { HttpJsonClient } from './http.js';

export interface NasaPowerVariableSpec {
  name: string;
  normalized: string;
  expectedUnit: string;
  measurementKind: 'reanalysis' | 'remotely_retrieved';
  longName: string;
  notes: string[];
}

export const NASA_POWER_VARIABLES: readonly NasaPowerVariableSpec[] = [
  {
    name: 'T2M',
    normalized: 'outdoor_air_temperature',
    expectedUnit: '°C',
    measurementKind: 'reanalysis',
    longName: 'Temperature at 2 Meters',
    notes: ['MERRA-2/GEOS-IT reanalysis at 2 m; open-air grid cell, not greenhouse air.'],
  },
  {
    name: 'RH2M',
    normalized: 'outdoor_relative_humidity',
    expectedUnit: '%',
    measurementKind: 'reanalysis',
    longName: 'Relative Humidity at 2 Meters',
    notes: ['Reanalysis relative humidity at 2 m.'],
  },
  {
    name: 'WS2M',
    normalized: 'outdoor_wind_speed',
    expectedUnit: 'm/s',
    measurementKind: 'reanalysis',
    longName: 'Wind Speed at 2 Meters',
    notes: ['Reanalysis wind speed at 2 m.'],
  },
  {
    name: 'ALLSKY_SFC_SW_DWN',
    normalized: 'outdoor_shortwave_radiation',
    expectedUnit: 'MJ/hr',
    measurementKind: 'remotely_retrieved',
    longName: 'All Sky Surface Shortwave Downward Irradiance',
    notes: [
      'CERES SYN1deg satellite-derived surface shortwave irradiance (all-sky), not a ground measurement.',
      'Hourly responses have reported unit MJ/hr; unit is read from the response and converted to W/m².',
    ],
  },
  {
    name: 'PRECTOTCORR',
    normalized: 'outdoor_precipitation',
    expectedUnit: 'mm/hour',
    measurementKind: 'reanalysis',
    longName: 'Precipitation Corrected',
    notes: ['Bias-corrected MERRA-2 precipitation.'],
  },
  {
    name: 'TS',
    normalized: 'outdoor_skin_temperature',
    expectedUnit: 'C',
    measurementKind: 'reanalysis',
    longName: 'Earth Skin Temperature',
    notes: [
      'Modeled Earth skin temperature, not soil temperature at a probe depth and not greenhouse media temperature.',
    ],
  },
];

const numberOrNull = z.union([z.number(), z.null()]);

const powerSchema = z
  .object({
    geometry: z
      .object({
        type: z.string().optional(),
        coordinates: z.array(z.number()).optional(),
      })
      .optional(),
    properties: z
      .object({
        parameter: z.record(z.record(numberOrNull)),
      })
      .optional(),
    parameters: z
      .record(
        z.object({
          units: z.string(),
          longname: z.string().optional(),
        })
      )
      .optional(),
    header: z
      .object({
        title: z.string().optional(),
        fill_value: z.union([z.number(), z.string()]).optional(),
        time_standard: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .passthrough()
      .optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough();

export interface NasaPowerRows {
  requestUrl: string;
  grid: { lat: number; lon: number; elevationM: number | null };
  units: Record<string, string>;
  fillValue: number;
  rows: Array<{ atMs: number; values: Record<string, number | null> }>;
  caveats: string[];
}

function requireCoordinates(cfg: PipelineConfig): { lat: number; lon: number } {
  if (!hasCoordinates(cfg)) {
    throw new ExternalApiError(
      'NASA POWER requires GREENHOUSE_LAT/GREENHOUSE_LON; external sources are disabled until configured',
      'validation',
      'nasa-power',
      null,
      false
    );
  }
  return { lat: cfg.GREENHOUSE_LAT, lon: cfg.GREENHOUSE_LON };
}

function compactDate(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

export async function fetchNasaPowerHourly(
  cfg: PipelineConfig,
  http: HttpJsonClient,
  opts: { startDate: string; endDate: string }
): Promise<NasaPowerRows> {
  const { lat, lon } = requireCoordinates(cfg);
  const start = compactDate(opts.startDate);
  const end = compactDate(opts.endDate);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) {
    throw new ExternalApiError('nasa-power: invalid date range', 'validation', 'nasa-power', null, false);
  }
  const spanDays = (Date.parse(`${opts.endDate}T00:00:00Z`) - Date.parse(`${opts.startDate}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > 31) {
    throw new ExternalApiError(
      'nasa-power: hourly requests are limited to 31 days per call',
      'validation',
      'nasa-power',
      null,
      false
    );
  }

  const params = NASA_POWER_VARIABLES.map((v) => v.name).join(',');
  const url =
    `${cfg.NASA_POWER_HOURLY_URL}?parameters=${params}&community=AG` +
    `&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}` +
    `&format=JSON&time-standard=UTC`;

  const res = await http.getJson(url, powerSchema, 'nasa-power:hourly', cfg.NASA_POWER_CACHE_MS);

  const timeStandard = res.header?.time_standard;
  if (timeStandard && timeStandard.toUpperCase() !== 'UTC') {
    throw new ExternalApiError(
      `nasa-power: response time_standard is ${timeStandard}; refusing to treat timestamps as UTC`,
      'validation',
      'nasa-power',
      null,
      false
    );
  }

  const parameter = res.properties?.parameter;
  if (!parameter || Object.keys(parameter).length === 0) {
    throw new ExternalApiError(
      'nasa-power: response has no properties.parameter values',
      'validation',
      'nasa-power',
      null,
      false
    );
  }

  const fillValue = Number(res.header?.fill_value ?? -999);
  const units: Record<string, string> = {};
  for (const spec of NASA_POWER_VARIABLES) {
    const declared = res.parameters?.[spec.name]?.units;
    units[spec.name] = declared ?? spec.expectedUnit;
  }

  const timeKeys = new Set<string>();
  for (const spec of NASA_POWER_VARIABLES) {
    for (const key of Object.keys(parameter[spec.name] ?? {})) timeKeys.add(key);
  }

  const rows = [...timeKeys]
    .map((key) => {
      const atMs = parsePowerHourUtc(key);
      if (atMs === null) {
        throw new ExternalApiError(`nasa-power: invalid hourly key ${key}`, 'validation', 'nasa-power', null, false);
      }
      const values: Record<string, number | null> = {};
      for (const spec of NASA_POWER_VARIABLES) {
        const raw = parameter[spec.name]?.[key];
        values[spec.name] =
          typeof raw === 'number' && Number.isFinite(raw) && raw !== fillValue ? raw : null;
      }
      return { atMs, values };
    })
    .sort((a, b) => a.atMs - b.atMs);

  if (rows.length === 0) {
    throw new ExternalApiError(
      `nasa-power: no hourly values returned for ${opts.startDate}..${opts.endDate} (data latency)`,
      'validation',
      'nasa-power',
      null,
      false
    );
  }

  const coords = res.geometry?.coordinates;
  const grid = {
    lat: typeof coords?.[1] === 'number' ? coords[1] : lat,
    lon: typeof coords?.[0] === 'number' ? coords[0] : lon,
    elevationM: typeof coords?.[2] === 'number' ? coords[2] : null,
  };

  return {
    requestUrl: redactUrl(url),
    grid,
    units,
    fillValue,
    rows,
    caveats: [
      'NASA POWER hourly data are source-model/reanalysis and satellite-derived products at native grid resolution; none measures in-greenhouse conditions.',
      'Meteorological parameters typically lag 2-3 days; solar parameters can lag 5-7 days, so recent hours may be missing.',
      'Timestamps requested and validated as UTC (POWER defaults to Local Solar Time).',
      `Missing/fill values (${fillValue}) are stored as null, never as zero.`,
    ],
  };
}

export function nasaPowerObservationTime(ms: number): string {
  return toIsoUtc(ms);
}
