/**
 * Tests for the AI data-integration / decision / prediction pipeline.
 *
 * The pipeline runs against the in-memory store so no Firebase project is
 * needed. The fixtures are LABELLED SYNTHETIC values: they are not measured
 * observations of a real greenhouse.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPipelineConfig,
  configurationWarnings,
  PipelineConfigError,
  type PipelineConfig,
} from '../src/ai/pipeline/config.js';
import { detectTimestamp, compactUtcStamp, localDayKey, addHours } from '../src/ai/pipeline/utils/time.js';
import { roundTo, convert, vpdKpa, haversineKm } from '../src/ai/pipeline/utils/units.js';
import {
  normalizeIndoorSnapshot,
  seriesValues,
  toSeriesPoint,
} from '../src/ai/pipeline/utils/quality.js';
import { JobLock } from '../src/ai/pipeline/storage/job-lock.js';
import { MemoryStore } from '../src/ai/pipeline/storage/store.js';
import { buildPaths } from '../src/ai/pipeline/storage/records.js';
import { runDecisionCycle } from '../src/ai/pipeline/cycle/decision-cycle.js';
import { runPredictionCycle } from '../src/ai/pipeline/cycle/prediction-cycle.js';
import { createRuntime } from '../src/ai/pipeline/runtime.js';
import type { HttpJsonClient, MinimalLogger } from '../src/ai/pipeline/integrations/http.js';
import type { IndoorSeriesPoint } from '../src/ai/pipeline/schema.js';

const NOW_MS = Date.UTC(2026, 9, 21, 12, 0, 0);

const silentLogger: MinimalLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Fails the test if the pipeline tries to reach the network. */
const offlineHttp: HttpJsonClient = {
  getJson: async () => {
    throw new Error('external HTTP must not be called in this test');
  },
  clearCache: () => undefined,
  cacheSize: () => 0,
};

function testConfig(overrides: Record<string, string> = {}): PipelineConfig {
  return loadPipelineConfig({
    GREENHOUSE_ID: 'gh-test',
    EXTERNAL_SOURCES: '',
    PIPELINE_ALLOW_MEMORY_FALLBACK: 'true',
    ...overrides,
  });
}

/** Synthetic, clearly-labelled indoor sensor snapshot. */
function syntheticSensorData(nowMs: number): Record<string, unknown> {
  return {
    temperature: 26.4,
    soilTemperature: 22.1,
    humidity: 68,
    soilMoisture: 41,
    gas: 180,
    light: 640,
    airPressure: 1013.2,
    lastUpdate: nowMs,
  };
}

/** Synthetic indoor series point (LABELLED: not a measured observation). */
function syntheticSeriesPoint(observedAtMs: number, airTemp: number, soilMoisture: number): IndoorSeriesPoint {
  return {
    schemaVersion: 'observation/v1',
    observedAtMs,
    observedAt: new Date(observedAtMs).toISOString(),
    ingestedAt: new Date(observedAtMs).toISOString(),
    greenhouseId: 'gh-test',
    deviceId: 'synthetic-device',
    values: {
      air_temperature: airTemp,
      soil_moisture_index: soilMoisture,
      relative_humidity: 68,
    },
    units: {
      air_temperature: 'degC',
      soil_moisture_index: '%',
      relative_humidity: '%',
    },
    sourceFields: {
      air_temperature: 'temperature',
      soil_moisture_index: 'soilMoisture',
      relative_humidity: 'humidity',
    },
    quality: {
      air_temperature: 'valid',
      soil_moisture_index: 'valid',
      relative_humidity: 'valid',
    },
    overallQuality: 'ok',
  };
}

describe('pipeline configuration', () => {
  it('defaults to the existing database layout', () => {
    const cfg = testConfig();
    expect(cfg.SENSOR_DATA_PATH).toBe('/Sensoura/sensorData');
    expect(cfg.AI_SUGGESTIONS_PATH).toBe('/Sensoura/AI_Suggestions');
    expect(cfg.AI_PREDICTIONS_PATH).toBe('/Sensoura/AI_Predictions');
    expect(cfg.AI_LEGACY_PREDICTIONS_PATH).toBe('/Sensoura/aiPredictions');
    expect(cfg.AI_LEGACY_PREDICTIONS_WRITE).toBe(true);
  });

  it('never points the pipeline at the auto-executing suggestions node', () => {
    const cfg = testConfig();
    expect(cfg.AI_SUGGESTIONS_PATH).not.toBe('/Sensoura/aiSuggestions');
  });

  it('warns about everything that would require invented data', () => {
    const warnings = configurationWarnings(testConfig());
    const text = warnings.join(' | ');
    expect(text).toMatch(/GREENHOUSE_LAT/);
    expect(text).toMatch(/irrigation/i);
    expect(text).toMatch(/appended to the existing/i);
  });

  it('rejects a configuration that only half-configures the coordinates', () => {
    expect(() => loadPipelineConfig({ GREENHOUSE_LAT: '30.0' })).toThrow(PipelineConfigError);
  });

  it('can disable the legacy append', () => {
    const cfg = testConfig({ AI_LEGACY_PREDICTIONS_WRITE: 'false' });
    expect(cfg.AI_LEGACY_PREDICTIONS_WRITE).toBe(false);
  });
});

describe('timestamp handling', () => {
  it('detects unix seconds from the firmware and unix milliseconds from the app', () => {
    const seconds = detectTimestamp(1791867600);
    expect(seconds.format).toBe('unix_seconds');
    expect(seconds.ms).toBe(1791867600000);

    const millis = detectTimestamp(1791867600000);
    expect(millis.format).toBe('unix_ms');
    expect(millis.ms).toBe(1791867600000);
  });

  it('parses ISO timestamps and POWER hourly keys', () => {
    expect(detectTimestamp('2026-10-13T05:00:00Z').ms).toBe(Date.UTC(2026, 9, 13, 5, 0, 0));
    expect(detectTimestamp('2026101305').format).toBe('power_hourly_utc');
  });

  it('reports unusable timestamps instead of guessing', () => {
    const bad = detectTimestamp('not-a-timestamp');
    expect(bad.ms).toBeNull();
    expect(bad.warnings.length).toBeGreaterThan(0);
  });

  it('formats ids and local days', () => {
    expect(compactUtcStamp(NOW_MS)).toBe('20261021T120000Z');
    expect(localDayKey(NOW_MS, 'Africa/Cairo')).toBe('2026-10-21');
    expect(addHours(NOW_MS, 6)).toBe(NOW_MS + 6 * 3_600_000);
  });
});

describe('unit handling', () => {
  it('rounds and converts', () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    const fahrenheit = convert(20, 'degC', 'degF');
    expect(fahrenheit?.value).toBeCloseTo(68, 5);
  });

  it('computes a positive vapour pressure deficit', () => {
    expect(vpdKpa(25, 50)).toBeGreaterThan(0);
  });

  it('measures distance between two points', () => {
    expect(haversineKm({ lat: 30, lon: 30 }, { lat: 30, lon: 30 })).toBeCloseTo(0, 6);
    expect(haversineKm({ lat: 30, lon: 30 }, { lat: 31, lon: 30 })).toBeGreaterThan(100);
  });
});

describe('indoor data quality', () => {
  const opts = {
    greenhouseId: 'gh-test',
    deviceId: 'synthetic-device',
    nowMs: NOW_MS,
    staleAfterMs: 15 * 60_000,
    gasMaxRaw: 4095,
    lightMaxRaw: 4095,
    anomaly: { minSamples: 8, zThreshold: 6 },
  };

  it('accepts a fresh snapshot and records the field it read', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData(NOW_MS), opts);
    expect(snapshot.overallQuality).toBe('ok');
    expect(snapshot.values.air_temperature).toBe(26.4);
    expect(snapshot.sourceFields.air_temperature).toBe('temperature');
    expect(snapshot.sourceFields.soil_moisture_index).toBe('soilMoisture');
  });

  it('marks a stale snapshot as stale instead of using it silently', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData(NOW_MS - 60 * 60_000), opts);
    expect(snapshot.overallQuality).toBe('stale');
  });

  it('reports a missing sensor node', () => {
    const snapshot = normalizeIndoorSnapshot(null, opts);
    expect(snapshot.overallQuality).toBe('invalid');
    expect(snapshot.reasons.length).toBeGreaterThan(0);
  });

  it('converts a snapshot into a series point and back into series values', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData(NOW_MS), opts);
    const point = toSeriesPoint(snapshot);
    expect(point.observedAtMs).toBe(NOW_MS);
    const values = seriesValues([point]);
    expect(values.air_temperature[0].value).toBe(26.4);
  });
});

describe('job lock', () => {
  it('allows only one owner at a time and can be reclaimed after expiry', async () => {
    const store = new MemoryStore();
    const first = new JobLock(store, '/locks/decision', 'decision', 'owner-a', 60_000, () => NOW_MS);
    const second = new JobLock(store, '/locks/decision', 'decision', 'owner-b', 60_000, () => NOW_MS);

    expect((await first.acquire()).acquired).toBe(true);
    expect((await second.acquire()).acquired).toBe(false);

    // The lock is still held.
    expect((await second.acquire()).holder).toBe('owner-a');

    // Once it expires, another owner may take it.
    const later = new JobLock(store, '/locks/decision', 'decision', 'owner-b', 60_000, () => NOW_MS + 120_000);
    expect((await later.acquire()).acquired).toBe(true);
  });

  it('only releases a lock it still owns', async () => {
    const store = new MemoryStore();
    const lock = new JobLock(store, '/locks/prediction', 'prediction', 'owner-a', 60_000, () => NOW_MS);
    await lock.acquire();
    expect(await lock.release()).toBe(true);

    const other = new JobLock(store, '/locks/prediction', 'prediction', 'owner-b', 60_000, () => NOW_MS);
    await other.acquire();
    expect(await lock.release()).toBe(false);
  });
});

describe('decision cycle', () => {
  it('writes recommendations to its own node and never to the legacy nodes', async () => {
    const cfg = testConfig();
    const store = new MemoryStore({
      '/Sensoura/sensorData': syntheticSensorData(NOW_MS),
      '/Sensoura/system': { deviceId: 'synthetic-device', status: 'online' },
    });
    const paths = buildPaths(cfg, 'gh-test');

    const result = await runDecisionCycle({
      cfg,
      store,
      paths,
      http: offlineHttp,
      logger: silentLogger,
      now: () => NOW_MS,
    });

    expect(result.indoorQuality).toBe('ok');

    // The legacy node that actuates the pump must stay untouched.
    expect(await store.get('/Sensoura/aiSuggestions')).toBeNull();
    expect(await store.get('/Sensoura/commands')).toBeNull();

    const suggestions = await store.get<Record<string, Record<string, unknown>>>(paths.suggestions);
    for (const record of Object.values(suggestions ?? {})) {
      const safety = record.safety as Record<string, unknown>;
      expect(safety.executesActuator).toBe(false);
      expect(record.action).toBeDefined();
      expect((record.action as Record<string, unknown>).executionMode).toBe('advisory_only');
      expect((record.action as Record<string, unknown>).requestedCommand).toBeNull();
    }
  });
});

describe('prediction cycle', () => {
  it('writes predictions, appends legacy projections and preserves existing records', async () => {
    const cfg = testConfig();
    const paths = buildPaths(cfg, 'gh-test');

    const existingLegacy = {
      '3001': {
        type: 'rainfall',
        predictedValue: 'after 2 days afternoon',
        confidence: 0.85,
        predictionTime: 1791867600000,
      },
      '3002': {
        type: 'air_temp',
        predictedValue: 30.0,
        confidence: 0.9,
        predictionTime: 1791867600000,
      },
    };

    const store = new MemoryStore({
      '/Sensoura/sensorData': syntheticSensorData(NOW_MS),
      '/Sensoura/system': { deviceId: 'synthetic-device' },
      [paths.legacyPredictions]: existingLegacy,
    });

    // Synthetic history so the persistence baseline has enough samples to
    // produce a forecast (LABELLED: not measured data).
    for (let i = 29; i >= 0; i--) {
      const at = NOW_MS - i * 6 * 3_600_000;
      await store.set(`${paths.series}/${at}`, syntheticSeriesPoint(at, 25.5, 40));
    }

    const result = await runPredictionCycle({
      cfg,
      store,
      paths,
      http: offlineHttp,
      logger: silentLogger,
      now: () => NOW_MS,
    });

    expect(result.predictions).toBeGreaterThan(0);

    // 1. The pipeline's own records.
    const predictions = await store.get<Record<string, Record<string, unknown>>>(paths.predictions);
    expect(Object.keys(predictions ?? {}).length).toBeGreaterThan(0);
    for (const record of Object.values(predictions ?? {})) {
      expect(record.schemaVersion).toBe('ai-prediction/v1');
      expect(record.generatedAtMs).toBe(NOW_MS);
    }

    // 2. The existing legacy records are untouched.
    const legacy = await store.get<Record<string, Record<string, unknown>>>(paths.legacyPredictions);
    expect(legacy['3001']).toEqual(existingLegacy['3001']);
    expect(legacy['3002']).toEqual(existingLegacy['3002']);

    // 3. New records were appended with the legacy field names.
    const appended = Object.entries(legacy ?? {}).filter(([key]) => key !== '3001' && key !== '3002');
    expect(appended.length).toBeGreaterThan(0);
    for (const [key, record] of appended) {
      expect(key).toMatch(/^\d+$/);
      expect(typeof record.type).toBe('string');
      expect(['string', 'number']).toContain(typeof record.predictedValue);
      expect(record.confidence).toBeNull();
      expect(record.predictionTime).toBe(NOW_MS);
      expect(record.schemaVersion).toBe('legacy-prediction-projection/v1');
    }

    // 4. No actuator command was ever written.
    expect(await store.get('/Sensoura/commands')).toBeNull();
    expect(await store.get('/Sensoura/aiSuggestions')).toBeNull();
  });

  it('does not write legacy projections when the append is disabled', async () => {
    const cfg = testConfig({ AI_LEGACY_PREDICTIONS_WRITE: 'false' });
    const paths = buildPaths(cfg, 'gh-test');
    const store = new MemoryStore({
      '/Sensoura/sensorData': syntheticSensorData(NOW_MS),
      [paths.legacyPredictions]: { '3001': { type: 'rainfall', predictedValue: 'after 2 days afternoon', confidence: 0.85, predictionTime: 1791867600000 } },
    });

    for (let i = 29; i >= 0; i--) {
      const at = NOW_MS - i * 6 * 3_600_000;
      await store.set(`${paths.series}/${at}`, syntheticSeriesPoint(at, 25.5, 40));
    }

    await runPredictionCycle({
      cfg,
      store,
      paths,
      http: offlineHttp,
      logger: silentLogger,
      now: () => NOW_MS,
    });

    const legacy = await store.get<Record<string, unknown>>(paths.legacyPredictions);
    expect(Object.keys(legacy ?? {})).toEqual(['3001']);
  });

  it('reports external failures instead of inventing values', async () => {
    const cfg = testConfig({ EXTERNAL_SOURCES: 'open-meteo', GREENHOUSE_LAT: '30.0', GREENHOUSE_LON: '31.0' });
    const paths = buildPaths(cfg, 'gh-test');
    const store = new MemoryStore({ '/Sensoura/sensorData': syntheticSensorData(NOW_MS) });

    const result = await runPredictionCycle({
      cfg,
      store,
      paths,
      http: offlineHttp,
      logger: silentLogger,
      now: () => NOW_MS,
    });

    expect(result.warnings.join(' ')).toMatch(/failed|unavailable/i);
    const predictions = await store.get<Record<string, Record<string, unknown>>>(paths.predictions);
    const outdoor = Object.values(predictions ?? {}).find(
      (p) => p.predictionType === 'environmental_forecast' && p.status === 'error'
    );
    expect(outdoor).toBeDefined();
    expect(outdoor?.predictedValue).toBeNull();
  });
});

describe('runtime status server', () => {
  const servers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const stop = servers.pop();
      await stop?.();
    }
  });

  it('exposes the parsed legacy predictions and the configured paths', async () => {
    const cfg = testConfig();
    const store = new MemoryStore({
      '/Sensoura/aiPredictions': {
        '3001': {
          type: 'rainfall',
          predictedValue: 'after 2 days afternoon',
          confidence: 0.85,
          predictionTime: 1791867600000,
        },
      },
    });

    const port = 3400 + Math.floor(Math.random() * 400);
    const runtime = createRuntime({
      cfg,
      logger: silentLogger,
      store,
      statusPort: port,
      statusHost: '127.0.0.1',
      now: () => NOW_MS,
    });

    // The schedulers use a startup delay, so no cycle runs during the test.
    await runtime.start();
    servers.push(() => runtime.stop());

    const response = await fetch(`http://127.0.0.1:${port}/predictions/legacy`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string;
      count: number;
      records: Array<{ key: string; predictedValue: string; confidence: number; predictionTime: number }>;
    };
    expect(body.path).toBe('/Sensoura/aiPredictions');
    expect(body.count).toBe(1);
    expect(body.records[0].key).toBe('3001');
    expect(body.records[0].predictedValue).toBe('after 2 days afternoon');
    expect(body.records[0].confidence).toBe(0.85);
    expect(body.records[0].predictionTime).toBe(1791867600000);

    const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as {
      paths: { legacyPredictions: string };
    };
    expect(status.paths.legacyPredictions).toBe('/Sensoura/aiPredictions');
  });
});
