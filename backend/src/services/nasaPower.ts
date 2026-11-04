import { z } from 'zod';

function logClimate(level: 'debug' | 'info' | 'warn', message: string, details?: Record<string, number | string>): void {
  const write = level === 'debug' ? console.debug : level === 'info' ? console.info : console.warn;
  write(`[nasa-power] ${message}`, details ?? {});
}

export type ClimateDataStatus = 'available' | 'partially_available' | 'missing' | 'stale';

export interface ExternalClimateObservation {
  date: string;
  location: 'Cairo, Egypt';
  latitude: number;
  longitude: number;
  airTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  source: 'NASA POWER';
  retrievedAt: string;
  dataStatus: ClimateDataStatus;
  metadata: {
    community: 'AG';
    temporal: 'daily';
    timeStandard: 'LST';
    fillValue: number;
    parameters: { T2M: '°C'; RH2M: '%' };
    caveat: string;
  };
}

export interface ClimateHistoryResult {
  observations: ExternalClimateObservation[];
  source: 'NASA POWER';
  retrievedAt: string;
  cache: { stale: boolean; ageMs: number };
}

export interface NasaPowerOptions {
  latitude?: number;
  longitude?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  staleIfErrorMs?: number;
  maxCacheEntries?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

const ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const MIN_DATE = '19810101';
const SOURCE_CAVEAT = 'Daily gridded outdoor climate data, not a live weather feed or a greenhouse sensor measurement.';
const payloadSchema = z.object({
  properties: z.object({
    parameter: z.object({
      T2M: z.record(z.string(), z.unknown()).optional(),
      RH2M: z.record(z.string(), z.unknown()).optional(),
    }),
  }).passthrough(),
  header: z.object({ fill_value: z.number().finite().optional() }).passthrough().optional(),
  parameters: z.object({
    T2M: z.object({ units: z.string().optional() }).passthrough().optional(),
    RH2M: z.object({ units: z.string().optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export class ClimateRequestError extends Error {
  constructor(readonly code: 'INVALID_DATE' | 'DATE_RANGE' | 'UPSTREAM' | 'TIMEOUT' | 'INVALID_RESPONSE', message: string) {
    super(message);
    this.name = 'ClimateRequestError';
  }
}

interface CacheEntry {
  rows: ExternalClimateObservation[];
  retrievedAtMs: number;
  expiresAtMs: number;
}

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseDate(value: string): number {
  if (!/^\d{8}$/.test(value)) {
    throw new ClimateRequestError('INVALID_DATE', 'Dates must use YYYYMMDD format');
  }

  const year = Number(value.slice(0, 4));

  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 1981 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ClimateRequestError('INVALID_DATE', 'Date is outside supported NASA POWER daily date boundaries');
  }
  const ms = Date.UTC(year, month - 1, day);

  if (new Date(ms).toISOString().slice(0, 10).replace(/-/g, '') !== value) {
    throw new ClimateRequestError('INVALID_DATE', 'Date is not a valid calendar day');
  }
  if (value < MIN_DATE) throw new ClimateRequestError('INVALID_DATE', 'NASA POWER daily data starts on 19810101');
  return ms;
}

export function validateClimateDateRange(start: string, end: string, today = new Date()): void {
  const startMs = parseDate(start);
  const endMs = parseDate(end);
  if (endMs < startMs) throw new ClimateRequestError('DATE_RANGE', 'end must be on or after start');
  if (endMs > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
    throw new ClimateRequestError('DATE_RANGE', 'end must not be in the future');
  }
  const days = Math.floor((endMs - startMs) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new ClimateRequestError('DATE_RANGE', `Date range cannot exceed ${MAX_RANGE_DAYS} days`);
}

function numericValue(raw: unknown, fillValue: number, name: 'T2M' | 'RH2M'): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) throw new ClimateRequestError('INVALID_RESPONSE', `NASA POWER returned a non-numeric ${name} value`);
  if (value === fillValue) return null;
  if (name === 'RH2M' && (value < 0 || value > 100)) {
    throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER returned relative humidity outside 0–100%');
  }
  if (name === 'T2M' && (value < -100 || value > 70)) {
    throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER returned air temperature outside the valid range');
  }
  return value;
}

export class NasaPowerDailyService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private sourceAvailable: boolean | null = null;

  private readonly options: Required<Pick<NasaPowerOptions, 'latitude' | 'longitude' | 'timeoutMs' | 'cacheTtlMs' | 'staleIfErrorMs' | 'maxCacheEntries' | 'endpoint'>>;

  constructor(options: NasaPowerOptions = {}) {
    this.options = {
      latitude: options.latitude ?? Number(process.env.NASA_POWER_LATITUDE ?? 30.0444),
      longitude: options.longitude ?? Number(process.env.NASA_POWER_LONGITUDE ?? 31.2357),
      timeoutMs: options.timeoutMs ?? Number(process.env.NASA_POWER_TIMEOUT_MS ?? 8000),
      cacheTtlMs: options.cacheTtlMs ?? Number(process.env.NASA_POWER_CACHE_TTL_MS ?? 12 * 60 * 60_000),
      staleIfErrorMs: options.staleIfErrorMs ?? Number(process.env.NASA_POWER_STALE_IF_ERROR_MS ?? 7 * 24 * 60 * 60_000),
      maxCacheEntries: options.maxCacheEntries ?? Number(process.env.NASA_POWER_MAX_CACHE_ENTRIES ?? 24),
      endpoint: options.endpoint ?? process.env.NASA_POWER_DAILY_URL ?? ENDPOINT,
    };
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!Number.isFinite(this.options.latitude) || this.options.latitude < -90 || this.options.latitude > 90 ||
        !Number.isFinite(this.options.longitude) || this.options.longitude < -180 || this.options.longitude > 180 ||
        !Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs < 1 ||
        !Number.isFinite(this.options.cacheTtlMs) || this.options.cacheTtlMs < 0 ||
        !Number.isInteger(this.options.maxCacheEntries) || this.options.maxCacheEntries < 1) {
      throw new Error('Invalid NASA POWER configuration');
    }
  }

  async getHistory(start: string, end: string): Promise<ClimateHistoryResult> {
    validateClimateDateRange(start, end, new Date(this.now()));
    const key = `${this.options.latitude},${this.options.longitude}:${start}:${end}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAtMs > this.now()) {
      logClimate('debug', 'daily range cache hit');
      return this.result(cached, false);
    }
    logClimate('debug', 'daily range cache miss');

    try {
      const entry = await this.fetchRange(key, start, end);
      return this.result(entry, false);
    } catch (error) {
      const previous = this.cache.get(key);
      if (previous && this.now() - previous.retrievedAtMs <= this.options.cacheTtlMs + this.options.staleIfErrorMs) {
        this.lastFailureAt = this.now();
        this.sourceAvailable = false;
        return this.result(previous, true);
      }
      throw error;
    }
  }

  async getLatest(): Promise<{ observation: ExternalClimateObservation | null; retrievedAt: string | null; stale: boolean }> {
    const end = compactDate(new Date(this.now()));
    const startDate = new Date(this.now() - 120 * DAY_MS);
    try {
      const history = await this.getHistory(compactDate(startDate), end);
      const observation = [...history.observations].reverse().find((row) => row.dataStatus !== 'missing') ?? null;
      return { observation, retrievedAt: history.retrievedAt, stale: history.cache.stale };
    } catch (error) {
      const cached = [...this.cache.values()]
        .filter((entry) => this.now() - entry.retrievedAtMs <= this.options.cacheTtlMs + this.options.staleIfErrorMs)
        .sort((a, b) => b.retrievedAtMs - a.retrievedAtMs)[0];
      if (!cached) throw error;
      this.lastFailureAt = this.now();
      this.sourceAvailable = false;
      const observation = [...cached.rows].reverse().find((row) => row.dataStatus !== 'missing') ?? null;
      return {
        observation: observation ? { ...observation, dataStatus: 'stale' } : null,
        retrievedAt: new Date(cached.retrievedAtMs).toISOString(),
        stale: true,
      };
    }
  }

  getStatus(): { source: 'NASA POWER'; configured: true; sourceAvailable: boolean | null; lastSuccessfulRetrieval: string | null; lastFailureAt: string | null; cacheEntries: number; freshCacheEntries: number } {
    const now = this.now();
    return {
      source: 'NASA POWER',
      configured: true,
      sourceAvailable: this.sourceAvailable,
      lastSuccessfulRetrieval: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      lastFailureAt: this.lastFailureAt === null ? null : new Date(this.lastFailureAt).toISOString(),
      cacheEntries: this.cache.size,
      freshCacheEntries: [...this.cache.values()].filter((entry) => entry.expiresAtMs > now).length,
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private async fetchRange(key: string, start: string, end: string): Promise<CacheEntry> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const task = this.requestAndNormalize(start, end).then((rows) => {
      const retrievedAtMs = this.now();
      const entry = { rows, retrievedAtMs, expiresAtMs: retrievedAtMs + this.options.cacheTtlMs };
      this.cache.delete(key);
      this.cache.set(key, entry);
      while (this.cache.size > this.options.maxCacheEntries) this.cache.delete(this.cache.keys().next().value!);
      this.lastSuccessAt = retrievedAtMs;
      this.sourceAvailable = true;
      return entry;
    }).catch((error: unknown) => {
      this.lastFailureAt = this.now();
      this.sourceAvailable = false;
      throw error;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async requestAndNormalize(start: string, end: string): Promise<ExternalClimateObservation[]> {
    const url = new URL(this.options.endpoint);
    url.search = new URLSearchParams({
      parameters: 'T2M,RH2M', community: 'AG',
      longitude: String(this.options.longitude), latitude: String(this.options.latitude),
      start, end, format: 'JSON', 'time-standard': 'LST',
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const startedAt = this.now();
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new ClimateRequestError('UPSTREAM', `NASA POWER returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) {
        throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER response exceeded the size limit');
      }
      let json: unknown;
      try {
        const text = await response.text();
        if (text.length > 1_000_000) throw new Error('response too large');
        json = JSON.parse(text);
      } catch {
        throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER returned malformed or oversized JSON');
      }
      const parsed = payloadSchema.safeParse(json);
      if (!parsed.success) throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER response did not match the expected Daily Point structure');
      const payload = parsed.data.properties;
      const parameters = payload.parameter;
      if (!parameters.T2M || !parameters.RH2M) throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER response is missing T2M or RH2M');
      const temperatureUnit = parsed.data.parameters?.T2M?.units;
      const humidityUnit = parsed.data.parameters?.RH2M?.units;
      if (temperatureUnit && !['C', '°C'].includes(temperatureUnit)) throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER reported an unexpected T2M unit');
      if (humidityUnit && !['%', 'percent'].includes(humidityUnit)) throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER reported an unexpected RH2M unit');
      const fillValue = parsed.data.header?.fill_value ?? -999;
      const retrievedAt = new Date(this.now()).toISOString();
      const fromMs = parseDate(start);
      const toMs = parseDate(end);
      const dateKeys = [...new Set([...Object.keys(parameters.T2M), ...Object.keys(parameters.RH2M)])].sort();
      for (const date of dateKeys) {
        const dateMs = parseDate(date);
        if (dateMs < fromMs || dateMs > toMs) throw new ClimateRequestError('INVALID_RESPONSE', 'NASA POWER response included a date outside the requested range');
      }
      const sourceValues = new Set(dateKeys);
      const rows: ExternalClimateObservation[] = [];
      for (let dateMs = fromMs; dateMs <= toMs; dateMs += DAY_MS) {
        const date = compactDate(new Date(dateMs));
        const airTemperatureC = sourceValues.has(date) ? numericValue(parameters.T2M?.[date], fillValue, 'T2M') : null;
        const relativeHumidityPercent = sourceValues.has(date) ? numericValue(parameters.RH2M?.[date], fillValue, 'RH2M') : null;
        const dataStatus: ClimateDataStatus = airTemperatureC === null && relativeHumidityPercent === null
          ? 'missing' : airTemperatureC === null || relativeHumidityPercent === null ? 'partially_available' : 'available';
        rows.push({
          date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          location: 'Cairo, Egypt',
          latitude: this.options.latitude,
          longitude: this.options.longitude,
          airTemperatureC,
          relativeHumidityPercent,
          source: 'NASA POWER',
          retrievedAt,
          dataStatus,
          metadata: {
            community: 'AG', temporal: 'daily', timeStandard: 'LST', fillValue,
            parameters: { T2M: '°C', RH2M: '%' }, caveat: SOURCE_CAVEAT,
          },
        });
      }
      logClimate('info', 'daily request succeeded', { latencyMs: Math.max(0, this.now() - startedAt), observations: rows.length });
      return rows;
    } catch (error) {
      if (error instanceof ClimateRequestError) {
        logClimate('warn', 'daily request failed', { code: error.code });
        throw error;
      }
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        logClimate('warn', 'daily request timed out', { timeoutMs: this.options.timeoutMs });
        throw new ClimateRequestError('TIMEOUT', `NASA POWER request timed out after ${this.options.timeoutMs} ms`);
      }
      logClimate('warn', 'daily request failed due to a network error');
      throw new ClimateRequestError('UPSTREAM', 'NASA POWER request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private result(entry: CacheEntry, stale: boolean): ClimateHistoryResult {
    const ageMs = Math.max(0, this.now() - entry.retrievedAtMs);
    return {
      observations: stale ? entry.rows.map((row) => ({ ...row, dataStatus: row.dataStatus === 'missing' ? 'missing' : 'stale' })) : entry.rows,
      source: 'NASA POWER',
      retrievedAt: new Date(entry.retrievedAtMs).toISOString(),
      cache: { stale, ageMs },
    };
  }
}

export const nasaPowerDailyService = new NasaPowerDailyService();
export const NASA_POWER_MAX_RANGE_DAYS = MAX_RANGE_DAYS;
