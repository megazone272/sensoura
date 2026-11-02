import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClimateRequestError,
  NasaPowerDailyService,
  validateClimateDateRange,
} from '../src/services/nasaPower.js';

const NOW = Date.UTC(2025, 0, 10, 12);

function powerResponse(t2m: Record<string, number>, rh2m: Record<string, number>) {
  return new Response(JSON.stringify({
    properties: {
      parameter: { T2M: t2m, RH2M: rh2m },
      header: { fill_value: -999 },
    },
    parameters: { T2M: { units: 'C' }, RH2M: { units: '%' } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function service(fetchImpl: typeof fetch, options: { now?: () => number; cacheTtlMs?: number; staleIfErrorMs?: number } = {}) {
  return new NasaPowerDailyService({
    now: options.now ?? (() => NOW),
    fetchImpl,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    staleIfErrorMs: options.staleIfErrorMs ?? 60_000,
    timeoutMs: 100,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('NASA POWER daily point service', () => {
  it('builds the documented request and normalizes temperature and humidity', async () => {
    const fetchMock = vi.fn(async () => powerResponse({ '20250101': 18.2, '20250102': 19 }, { '20250101': 52, '20250102': 49 }));
    const client = service(fetchMock as unknown as typeof fetch);

    const result = await client.getHistory('20250101', '20250102');
    const requested = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requested.origin + requested.pathname).toBe('https://power.larc.nasa.gov/api/temporal/daily/point');
    expect(requested.searchParams.get('parameters')).toBe('T2M,RH2M');
    expect(requested.searchParams.get('community')).toBe('AG');
    expect(requested.searchParams.get('longitude')).toBe('31.2357');
    expect(requested.searchParams.get('latitude')).toBe('30.0444');
    expect(requested.searchParams.get('start')).toBe('20250101');
    expect(requested.searchParams.get('end')).toBe('20250102');
    expect(requested.searchParams.get('format')).toBe('JSON');
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({
      date: '2025-01-01', location: 'Cairo, Egypt', airTemperatureC: 18.2,
      relativeHumidityPercent: 52, source: 'NASA POWER', dataStatus: 'available',
    });
    expect(result.observations[0].metadata.parameters).toEqual({ T2M: '°C', RH2M: '%' });
  });

  it('maps NASA fill values to missing values without replacing them with zero', async () => {
    const client = service(async () => powerResponse({ '20250101': -999 }, { '20250101': 45 }));
    const [row] = (await client.getHistory('20250101', '20250101')).observations;
    expect(row.airTemperatureC).toBeNull();
    expect(row.relativeHumidityPercent).toBe(45);
    expect(row.dataStatus).toBe('partially_available');
  });

  it('represents fill values and dates omitted by NASA as missing null observations', async () => {
    const client = service(async () => powerResponse(
      { '20250101': 18, '20250103': 20 },
      { '20250101': 40, '20250103': 50 },
    ));
    const rows = (await client.getHistory('20250101', '20250103')).observations;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      date: '2025-01-02', airTemperatureC: null, relativeHumidityPercent: null, dataStatus: 'missing',
    });
    expect(rows[0].airTemperatureC).toBe(18);
    expect(rows[2].relativeHumidityPercent).toBe(50);
  });

  it('rejects malformed JSON and unexpected response structures', async () => {
    const malformed = service(async () => new Response('{', { status: 200 }));
    await expect(malformed.getHistory('20250101', '20250101')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const unexpected = service(async () => new Response(JSON.stringify({ properties: {} }), { status: 200 }));
    await expect(unexpected.getHistory('20250101', '20250101')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports upstream HTTP and network errors without exposing response bodies', async () => {
    const httpError = service(async () => new Response('sensitive upstream detail', { status: 429 }));
    await expect(httpError.getHistory('20250101', '20250101')).rejects.toMatchObject({ code: 'UPSTREAM' });
    const networkError = service(async () => { throw new Error('network down'); });
    await expect(networkError.getHistory('20250101', '20250101')).rejects.toMatchObject({ code: 'UPSTREAM' });
  });

  it('classifies an aborted upstream request as a timeout', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = service(async () => { throw timeout; });
    await expect(client.getHistory('20250101', '20250101')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('serves a bounded stale successful response after upstream failure', async () => {
    let now = NOW;
    let fail = false;
    const fetchMock = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return powerResponse({ '20250101': 18 }, { '20250101': 40 });
    });
    const client = service(fetchMock as unknown as typeof fetch, { now: () => now, cacheTtlMs: 10, staleIfErrorMs: 1_000 });
    await client.getHistory('20250101', '20250101');
    now += 20;
    fail = true;
    const stale = await client.getHistory('20250101', '20250101');
    expect(stale.cache.stale).toBe(true);
    expect(stale.observations[0].dataStatus).toBe('stale');
    expect(stale.observations[0].retrievedAt).toBe(new Date(NOW).toISOString());
    expect(client.getStatus().sourceAvailable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses fresh cached ranges and rejects invalid, future, reversed, and excessive ranges', async () => {
    const fetchMock = vi.fn(async () => powerResponse({ '20250101': 18 }, { '20250101': 40 }));
    const client = service(fetchMock as unknown as typeof fetch);
    await client.getHistory('20250101', '20250101');
    await client.getHistory('20250101', '20250101');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => validateClimateDateRange('2025-01-01', '20250101', new Date(NOW))).toThrow(ClimateRequestError);
    expect(() => validateClimateDateRange('20250102', '20250101', new Date(NOW))).toThrow(ClimateRequestError);
    expect(() => validateClimateDateRange('20250101', '20250111', new Date(NOW))).toThrow(ClimateRequestError);
    expect(() => validateClimateDateRange('20240101', '20250101', new Date(NOW))).toThrow(ClimateRequestError);
    expect(() => validateClimateDateRange('19801231', '19801231', new Date(NOW))).toThrow(ClimateRequestError);
    expect(() => validateClimateDateRange('20240111', '20250110', new Date(NOW))).not.toThrow();
    expect(() => validateClimateDateRange('20240110', '20250110', new Date(NOW))).toThrow(ClimateRequestError);
  });
});
