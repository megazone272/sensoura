/**
 * Tests for calibration artifacts: loading, validation and application.
 *
 * All fixtures are SYNTHETIC. The repository contains no paired reference
 * measurements, so these artifacts exist only to prove that the loading and
 * application rules behave as documented.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDecisionCycle } from '../src/ai/pipeline/cycle/decision-cycle.js';
import { buildPaths } from '../src/ai/pipeline/storage/records.js';
import { MemoryStore } from '../src/ai/pipeline/storage/store.js';
import type { HttpJsonClient, MinimalLogger } from '../src/ai/pipeline/integrations/http.js';
import {
  applyCalibration,
  applyCalibrationsToValues,
  calibrationArtifactSchema,
  loadCalibrationArtifact,
  loadCalibrationRegistry,
} from '../src/ai/pipeline/calibration/apply.js';
import {
  applyCalibrationToSnapshot,
  indoorObservations,
  normalizeIndoorSnapshot,
  toSeriesPoint,
} from '../src/ai/pipeline/utils/quality.js';
import { evaluateDecision } from '../src/ai/pipeline/decision/engine.js';
import { equipmentFromConfig, loadPipelineConfig, type PipelineConfig } from '../src/ai/pipeline/config.js';
import type { CalibrationArtifact } from '../src/ai/pipeline/calibration/apply.js';

const NOW_MS = Date.UTC(2026, 9, 21, 12, 0, 0);

function testConfig(overrides: Record<string, string> = {}): PipelineConfig {
  return loadPipelineConfig({
    GREENHOUSE_ID: 'gh-test',
    EXTERNAL_SOURCES: '',
    PIPELINE_ALLOW_MEMORY_FALLBACK: 'true',
    ...overrides,
  });
}

/** SYNTHETIC artifact used only to exercise the loading rules. */
function syntheticArtifact(overrides: Partial<CalibrationArtifact> = {}): CalibrationArtifact {
  return {
    schemaVersion: 'calibration-artifact/v1',
    artifactId: 'calib_air_temperature_synthetic',
    variable: 'air_temperature',
    unit: 'degC',
    status: 'validated',
    methodId: 'ols_bias_v1',
    description: 'SYNTHETIC artifact: reference = 0.5 + 1.05 * local',
    coefficients: { slope: 1.05, intercept: 0.5, formula: 'reference = intercept + slope * local' },
    applicability: { minLocalValue: 10, maxLocalValue: 40, greenhouseId: null, notes: [] },
    training: {
      dataset: 'synthetic://paired-reference',
      datasetDescription: 'SYNTHETIC paired readings',
      instrument: 'SYNTHETIC reference instrument',
      sampleCount: 120,
      trainSampleCount: 84,
      validationSampleCount: 36,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-09-20T00:00:00.000Z',
      splitMethod: 'chronological 70/30',
      trainedAt: '2026-09-21T00:00:00.000Z',
    },
    validation: {
      metrics: { MAE: 0.12, RMSE: 0.15, bias: 0.01, sampleSize: 36 },
      unit: 'degC',
      notes: ['SYNTHETIC metrics.'],
    },
    ...overrides,
  };
}

async function writeTempArtifact(dir: string, name: string, content: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  return path;
}

const silentLogger: MinimalLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const offlineHttp: HttpJsonClient = {
  getJson: async () => {
    throw new Error('external HTTP must not be called in this test');
  },
  clearCache: () => undefined,
  cacheSize: () => 0,
};

describe('calibration artifact validation', () => {
  it('accepts a well-formed artifact', () => {
    const parsed = calibrationArtifactSchema.safeParse(syntheticArtifact());
    expect(parsed.success).toBe(true);
  });

  it('rejects an artifact that is not valid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    const path = await writeTempArtifact(dir, 'broken.json', '{ not json');
    const result = await loadCalibrationArtifact(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not valid JSON/i);
  });

  it('rejects an artifact that does not match the schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    const path = await writeTempArtifact(dir, 'partial.json', { variable: 'air_temperature' });
    const result = await loadCalibrationArtifact(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/schema validation/i);
  });

  it('rejects an artifact that claims to be validated but has no metrics', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    const path = await writeTempArtifact(
      dir,
      'nometrics.json',
      syntheticArtifact({ validation: { metrics: null, unit: 'degC', notes: [] } })
    );
    const result = await loadCalibrationArtifact(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/validation metrics/i);
  });

  it('rejects an artifact with an inverted applicability range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    const path = await writeTempArtifact(
      dir,
      'inverted.json',
      syntheticArtifact({ applicability: { minLocalValue: 40, maxLocalValue: 10, greenhouseId: null, notes: [] } })
    );
    const result = await loadCalibrationArtifact(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/inverted/i);
  });

  it('refuses a calibration that targets a VOC name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    const path = await writeTempArtifact(dir, 'voc.json', syntheticArtifact({ variable: 'voc_index' }));
    const result = await loadCalibrationArtifact(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/VOC/i);
  });

  it('reports a missing file instead of throwing', async () => {
    const result = await loadCalibrationArtifact(join(tmpdir(), 'sensoura-does-not-exist', 'x.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not be read/i);
  });
});

describe('calibration registry', () => {
  it('loads valid artifacts and records the rejected ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sensoura-cal-'));
    await writeTempArtifact(dir, 'air_temperature.json', syntheticArtifact());
    await writeTempArtifact(dir, 'broken.json', 'not json at all');

    const registry = await loadCalibrationRegistry(dir);
    expect(registry.directoryExists).toBe(true);
    expect(registry.artifacts.size).toBe(1);
    expect(registry.artifacts.has('air_temperature')).toBe(true);
    expect(registry.rejected).toHaveLength(1);
    expect(registry.rejected[0].reason).toMatch(/not valid JSON/i);
  });

  it('is empty (not an error) when the artifact directory does not exist', async () => {
    const registry = await loadCalibrationRegistry(join(tmpdir(), 'sensoura-no-such-dir'));
    expect(registry.artifacts.size).toBe(0);
    expect(registry.directoryExists).toBe(false);
    expect(registry.rejected[0].reason).toMatch(/does not exist/i);
  });
});

describe('calibration application', () => {
  const artifact = syntheticArtifact();

  it('applies the model inside the trained range', () => {
    const result = applyCalibration(artifact, 20);
    expect(result.applied).toBe(true);
    expect(result.status).toBe('bias_corrected');
    // 0.5 + 1.05 * 20 = 21.5
    expect(result.calibratedValue).toBeCloseTo(21.5, 6);
    expect(result.rawValue).toBe(20);
  });

  it('refuses to extrapolate outside the trained range', () => {
    const result = applyCalibration(artifact, 55);
    expect(result.applied).toBe(false);
    expect(result.status).toBe('none');
    expect(result.calibratedValue).toBe(55);
    expect(result.reason).toMatch(/outside the calibrated range/i);
  });

  it('does not apply an artifact that was never validated', () => {
    const unvalidated = syntheticArtifact({ status: 'unvalidated' });
    const result = applyCalibration(unvalidated, 20);
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/not evaluated on an independent holdout/i);
  });

  it('does not apply to a missing value', () => {
    const result = applyCalibration(artifact, null);
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no value/i);
  });

  it('calibrates only the variables that have an artifact', () => {
    const registry = {
      artifacts: new Map([['air_temperature', artifact]]),
      rejected: [],
      directory: '/tmp',
      directoryExists: true,
    };
    const { values, applications } = applyCalibrationsToValues(registry, {
      air_temperature: 20,
      relative_humidity: 65,
    });
    expect(values.air_temperature).toBeCloseTo(21.5, 6);
    expect(values.relative_humidity).toBe(65);
    expect(applications.air_temperature.applied).toBe(true);
  });
});

describe('calibrated snapshots keep the raw reading', () => {
  const opts = {
    greenhouseId: 'gh-test',
    deviceId: 'synthetic-device',
    nowMs: NOW_MS,
    staleAfterMs: 15 * 60_000,
    gasMaxRaw: 4095,
    lightMaxRaw: 4095,
    anomaly: { minSamples: 8, zThreshold: 6 },
  };

  const syntheticSensorData = {
    temperature: 26.4,
    soilTemperature: 22.1,
    humidity: 68,
    soilMoisture: 41,
    gas: 180,
    light: 640,
    airPressure: 1013.2,
    lastUpdate: NOW_MS,
  };

  it('keeps rawValues untouched and records the calibration outcome', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData, opts);
    expect(snapshot.rawValues.air_temperature).toBe(26.4);
    expect(snapshot.calibration).toEqual({});

    const { applications } = applyCalibrationsToValues(
      { artifacts: new Map([['air_temperature', syntheticArtifact()]]), rejected: [], directory: '', directoryExists: true },
      snapshot.values
    );
    const calibrated = applyCalibrationToSnapshot(snapshot, applications);

    expect(calibrated.rawValues.air_temperature).toBe(26.4);
    expect(calibrated.values.air_temperature).toBeCloseTo(0.5 + 1.05 * 26.4, 3);
    expect(calibrated.calibration.air_temperature.applied).toBe(true);
  });

  it('stores the raw and the calibrated value in the observation record', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData, opts);
    const { applications } = applyCalibrationsToValues(
      { artifacts: new Map([['air_temperature', syntheticArtifact()]]), rejected: [], directory: '', directoryExists: true },
      snapshot.values
    );
    const calibrated = applyCalibrationToSnapshot(snapshot, applications);

    const observations = indoorObservations(calibrated, {});
    const temperature = observations.find((o) => o.variable.normalizedName === 'air_temperature');
    expect(temperature?.value.raw).toBe(26.4);
    expect(temperature?.value.normalized).toBeCloseTo(0.5 + 1.05 * 26.4, 3);
    expect(temperature?.calibration.status).toBe('bias_corrected');
    expect(temperature?.calibration.applied).toBe(true);
    expect(temperature?.transformation.steps.join(' ')).toMatch(/apply calibration/);
  });

  it('keeps the stored series in raw values so the history stays homogeneous', () => {
    const snapshot = normalizeIndoorSnapshot(syntheticSensorData, opts);
    const { applications } = applyCalibrationsToValues(
      { artifacts: new Map([['air_temperature', syntheticArtifact()]]), rejected: [], directory: '', directoryExists: true },
      snapshot.values
    );
    const calibrated = applyCalibrationToSnapshot(snapshot, applications);
    const point = toSeriesPoint(calibrated);
    expect(point.values.air_temperature).toBe(26.4);
  });
});

describe('decision cycle with a calibration artifact on disk', () => {
  it('applies the artifact and records the raw value next to the calibrated one', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'sensoura-artifacts-'));
    await writeTempArtifact(artifactDir, 'air_temperature.json', syntheticArtifact());

    const cfg = testConfig({ AI_CALIBRATION_ARTIFACT_DIR: artifactDir });
    const store = new MemoryStore({
      '/Sensoura/sensorData': {
        temperature: 26.4,
        soilTemperature: 22.1,
        humidity: 68,
        soilMoisture: 41,
        gas: 180,
        light: 640,
        airPressure: 1013.2,
        lastUpdate: NOW_MS,
      },
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

    expect(result.stats.calibrationArtifacts).toBe(1);
    expect(result.stats.calibrationApplied).toBe(1);

    // The stored observation keeps the raw reading and the calibrated value.
    const observations = await store.get<Record<string, any>>(paths.indoorObservations);
    const day = Object.keys(observations ?? {})[0];
    const timestamp = Object.keys(observations?.[day] ?? {})[0];
    const temperature = observations?.[day]?.[timestamp]?.air_temperature;
    expect(temperature.value.raw).toBe(26.4);
    expect(temperature.value.normalized).toBeCloseTo(0.5 + 1.05 * 26.4, 3);
    expect(temperature.calibration.status).toBe('bias_corrected');
    expect(temperature.calibration.applied).toBe(true);

    // The stored series keeps the raw value so the history stays homogeneous.
    const series = await store.get<Record<string, any>>(paths.series);
    const point = Object.values(series ?? {})[0] as any;
    expect(point.values.air_temperature).toBe(26.4);
  });

  it('keeps using the raw values when the artifact directory holds no artifact', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'sensoura-artifacts-'));

    const cfg = testConfig({ AI_CALIBRATION_ARTIFACT_DIR: artifactDir });
    const store = new MemoryStore({
      '/Sensoura/sensorData': {
        temperature: 26.4,
        soilTemperature: 22.1,
        humidity: 68,
        soilMoisture: 41,
        gas: 180,
        light: 640,
        airPressure: 1013.2,
        lastUpdate: NOW_MS,
      },
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

    expect(result.stats.calibrationArtifacts).toBe(0);
    expect(result.stats.calibrationApplied).toBe(0);

    const observations = await store.get<Record<string, any>>(paths.indoorObservations);
    const day = Object.keys(observations ?? {})[0];
    const timestamp = Object.keys(observations?.[day] ?? {})[0];
    const temperature = observations?.[day]?.[timestamp]?.air_temperature;
    expect(temperature.value.raw).toBe(26.4);
    expect(temperature.value.normalized).toBe(26.4);
    expect(temperature.calibration.applied).toBe(false);
  });
});

describe('decision engine calibration status', () => {
  const opts = {
    greenhouseId: 'gh-test',
    deviceId: 'synthetic-device',
    nowMs: NOW_MS,
    staleAfterMs: 15 * 60_000,
    gasMaxRaw: 4095,
    lightMaxRaw: 4095,
    anomaly: { minSamples: 8, zThreshold: 6 },
  };

  const syntheticSensorData = {
    temperature: 26.4,
    soilTemperature: 22.1,
    humidity: 68,
    soilMoisture: 41,
    gas: 180,
    light: 640,
    airPressure: 1013.2,
    lastUpdate: NOW_MS,
  };

  it('reports indoorSensorStatus=none when nothing was calibrated', () => {
    const cfg = testConfig();
    const indoor = normalizeIndoorSnapshot(syntheticSensorData, opts);
    const evaluation = evaluateDecision({
      cfg,
      greenhouseId: 'gh-test',
      nowMs: NOW_MS,
      indoor,
      outdoor: null,
      series: [],
      previous: [],
      equipment: equipmentFromConfig(cfg),
    });
    const records = [...evaluation.recommendations, ...evaluation.diagnostics];
    for (const record of records) {
      expect(record.calibration.indoorSensorStatus).toBe('none');
    }
  });

  it('reports indoorSensorStatus=bias_corrected when a calibration was applied', () => {
    const cfg = testConfig();
    const indoor = normalizeIndoorSnapshot(syntheticSensorData, opts);
    const { applications } = applyCalibrationsToValues(
      { artifacts: new Map([['air_temperature', syntheticArtifact()]]), rejected: [], directory: '', directoryExists: true },
      indoor.values
    );
    const calibrated = applyCalibrationToSnapshot(indoor, applications);

    const evaluation = evaluateDecision({
      cfg,
      greenhouseId: 'gh-test',
      nowMs: NOW_MS,
      indoor: calibrated,
      outdoor: null,
      series: [],
      previous: [],
      equipment: equipmentFromConfig(cfg),
    });
    const records = [...evaluation.recommendations, ...evaluation.diagnostics];
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.calibration.indoorSensorStatus).toBe('bias_corrected');
      expect(record.calibration.notes.join(' ')).toMatch(/calibration applied/i);
    }
  });
});
