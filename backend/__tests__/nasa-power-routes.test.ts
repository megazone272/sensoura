import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClimateRequestError, type ClimateHistoryResult } from '../src/services/nasaPower.js';
import { registerClimateRoutes } from '../src/routes/climate.js';

const sampleResult: ClimateHistoryResult = {
  observations: [],
  source: 'NASA POWER',
  retrievedAt: '2025-01-01T00:00:00.000Z',
  cache: { stale: false, ageMs: 0 },
};

async function createApp(climate: {
  getLatest: ReturnType<typeof vi.fn>;
  getHistory: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
}) {
  const app = Fastify({ logger: false });
  await registerClimateRoutes(app, climate);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe('NASA POWER read-only HTTP routes', () => {
  it('returns normalized history and status', async () => {
    const climate = {
      getLatest: vi.fn().mockResolvedValue({ observation: null, retrievedAt: null, stale: false }),
      getHistory: vi.fn().mockResolvedValue(sampleResult),
      getStatus: vi.fn().mockReturnValue({ source: 'NASA POWER', sourceAvailable: null, cacheEntries: 0 }),
    };
    const app = await createApp(climate);
    const history = await app.inject({ method: 'GET', url: '/api/climate/history?start=20250101&end=20250102' });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual(sampleResult);
    expect(climate.getHistory).toHaveBeenCalledWith('20250101', '20250102');
    const status = await app.inject({ method: 'GET', url: '/api/climate/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().source).toBe('NASA POWER');
    const current = await app.inject({ method: 'GET', url: '/api/climate/current' });
    expect(current.statusCode).toBe(200);
    expect(current.json().caveat).toContain('not real-time');
    await app.close();
  });

  it('rejects missing, extra, and malformed history query parameters', async () => {
    const climate = {
      getLatest: vi.fn(), getHistory: vi.fn().mockRejectedValue(new ClimateRequestError('INVALID_DATE', 'Dates must use YYYYMMDD format')),
      getStatus: vi.fn(),
    };
    const app = await createApp(climate);
    const missing = await app.inject({ method: 'GET', url: '/api/climate/history?start=20250101' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('INVALID_QUERY');
    const extra = await app.inject({ method: 'GET', url: '/api/climate/history?start=20250101&end=20250102&limit=5000' });
    expect(extra.statusCode).toBe(400);
    const invalid = await app.inject({ method: 'GET', url: '/api/climate/history?start=not-a-date&end=20250102' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('INVALID_DATE');
    await app.close();
  });

  it('returns a sanitized 503 for upstream failures', async () => {
    const climate = {
      getLatest: vi.fn().mockRejectedValue(new ClimateRequestError('UPSTREAM', 'private upstream detail')),
      getHistory: vi.fn().mockRejectedValue(new ClimateRequestError('TIMEOUT', 'private upstream detail')),
      getStatus: vi.fn(),
    };
    const app = await createApp(climate);
    const history = await app.inject({ method: 'GET', url: '/api/climate/history?start=20250101&end=20250102' });
    expect(history.statusCode).toBe(503);
    expect(history.json()).toEqual({ error: 'Climate data unavailable', code: 'TIMEOUT' });
    const current = await app.inject({ method: 'GET', url: '/api/climate/current' });
    expect(current.statusCode).toBe(503);
    expect(current.body).not.toContain('private upstream detail');
    await app.close();
  });
});
