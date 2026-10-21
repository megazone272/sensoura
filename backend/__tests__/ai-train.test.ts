/**
 * Tests for the calibration training workflow.
 *
 * All datasets are SYNTHETIC. The repository contains no real paired
 * reference measurements; these fixtures only prove that the workflow fits,
 * evaluates, writes and refuses to write an artifact correctly.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTraining } from '../src/ai/training/run-training.js';
import { loadPairedDataset } from '../src/ai/training/dataset.js';
import { loadCalibrationArtifact, loadCalibrationRegistry, applyCalibration } from '../src/ai/pipeline/calibration/apply.js';

const TRAINED_AT = Date.UTC(2026, 9, 21, 12, 0, 0);

/**
 * SYNTHETIC paired readings with a known relationship:
 *   reference = 1.0 + 1.10 * local (+ a small deterministic offset)
 */
function syntheticSamples(count: number, startMs = Date.UTC(2026, 8, 1)): Array<{
  timestamp: string;
  local: number;
  reference: number;
}> {
  const samples: Array<{ timestamp: string; local: number; reference: number }> = [];
  for (let i = 0; i < count; i++) {
    const local = 15 + (i % 40) * 0.5;
    const reference = 1 + 1.1 * local + ((i % 5) - 2) * 0.05;
    samples.push({ timestamp: new Date(startMs + i * 3_600_000).toISOString(), local, reference });
  }
  return samples;
}

function jsonDataset(variable = 'air_temperature', unit = 'degC', count = 120) {
  return {
    variable,
    unit,
    instrument: 'SYNTHETIC reference instrument',
    description: 'SYNTHETIC paired indoor readings used to exercise the training workflow',
    samples: syntheticSamples(count),
  };
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('calibration dataset loading', () => {
  it('loads a JSON dataset and validates every sample', async () => {
    const dir = await tempDir('sensoura-ds-');
    await writeFile(join(dir, 'air_temperature.json'), JSON.stringify(jsonDataset()), 'utf8');

    const result = await loadPairedDataset(join(dir, 'air_temperature.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.rows).toHaveLength(120);
    expect(result.dataset.instrument).toBe('SYNTHETIC reference instrument');
    expect(result.dataset.rejected).toHaveLength(0);
  });

  it('rejects invalid rows but keeps the valid ones', async () => {
    const dir = await tempDir('sensoura-ds-');
    const dataset = jsonDataset('air_temperature', 'degC', 10);
    dataset.samples.push({ timestamp: 'not-a-date', local: 1, reference: 2 } as never);
    dataset.samples.push({ timestamp: '2026-09-02T00:00:00.000Z', local: Number.NaN, reference: 2 } as never);
    await writeFile(join(dir, 'air_temperature.json'), JSON.stringify(dataset), 'utf8');

    const result = await loadPairedDataset(join(dir, 'air_temperature.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.rows).toHaveLength(10);
    expect(result.dataset.rejected).toHaveLength(2);
  });

  it('requires metadata for a CSV dataset', async () => {
    const dir = await tempDir('sensoura-ds-');
    await writeFile(join(dir, 'air_temperature.csv'), 'timestamp,local,reference\n2026-09-01T00:00:00Z,20,23\n', 'utf8');

    const result = await loadPairedDataset(join(dir, 'air_temperature.csv'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/metadata file/i);
  });

  it('loads a CSV dataset together with its metadata file', async () => {
    const dir = await tempDir('sensoura-ds-');
    const rows = syntheticSamples(5)
      .map((s) => `${s.timestamp},${s.local},${s.reference}`)
      .join('\n');
    await writeFile(join(dir, 'air_temperature.csv'), `timestamp,local,reference\n${rows}\n`, 'utf8');
    await writeFile(
      join(dir, 'air_temperature.meta.json'),
      JSON.stringify({
        variable: 'air_temperature',
        unit: 'degC',
        instrument: 'SYNTHETIC reference instrument',
        description: 'SYNTHETIC CSV dataset',
      }),
      'utf8'
    );

    const result = await loadPairedDataset(join(dir, 'air_temperature.csv'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.rows).toHaveLength(5);
    expect(result.dataset.unit).toBe('degC');
  });
});

describe('calibration training workflow', () => {
  it('trains a model, evaluates it on a holdout and writes a valid artifact', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'air_temperature.json'), JSON.stringify(jsonDataset()), 'utf8');

    const report = await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT });

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0];
    expect(outcome.status).toBe('trained');
    expect(outcome.metrics).not.toBeNull();
    expect(outcome.metrics?.MAE).toBeLessThan(0.2);
    expect(outcome.artifactPath).toBe(join(artifactDir, 'air_temperature.json'));

    // The artifact is a valid artifact that the loader accepts.
    const loaded = await loadCalibrationArtifact(outcome.artifactPath as string);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.artifact.status).toBe('validated');
    expect(loaded.artifact.training.trainSampleCount).toBeGreaterThan(0);
    expect(loaded.artifact.training.validationSampleCount).toBeGreaterThan(0);
    expect(loaded.artifact.training.splitMethod).toMatch(/chronological/i);
    expect(loaded.artifact.validation.metrics?.sampleSize).toBe(loaded.artifact.training.validationSampleCount);

    // The recovered coefficients match the synthetic relationship.
    expect(loaded.artifact.coefficients.slope).toBeCloseTo(1.1, 1);
    expect(loaded.artifact.coefficients.intercept).toBeCloseTo(1, 1);

    // Round trip: the registry loads it and the applier uses it.
    const registry = await loadCalibrationRegistry(artifactDir);
    expect(registry.artifacts.has('air_temperature')).toBe(true);
    const application = applyCalibration(registry.artifacts.get('air_temperature')!, 20);
    expect(application.applied).toBe(true);
    expect(application.calibratedValue).toBeCloseTo(1 + 1.1 * 20, 1);
  });

  it('writes nothing when the paired data is insufficient', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'air_temperature.json'), JSON.stringify(jsonDataset('air_temperature', 'degC', 10)), 'utf8');

    const report = await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT });

    expect(report.outcomes[0].status).toBe('insufficient_data');
    expect(report.outcomes[0].artifactPath).toBeNull();
    expect(report.written).toBe(0);
    expect(await readdir(artifactDir)).toHaveLength(0);
    expect(report.outcomes[0].reasons.join(' ')).toMatch(/insufficient|No artifact was written/i);
  });

  it('refuses to train a model that targets a VOC name', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'voc_index.json'), JSON.stringify(jsonDataset('voc_index', 'VOC Index', 120)), 'utf8');

    const report = await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT });

    expect(report.outcomes[0].status).toBe('error');
    expect(report.outcomes[0].reasons.join(' ')).toMatch(/VOC/i);
    expect(await readdir(artifactDir)).toHaveLength(0);
  });

  it('reports a rejected dataset instead of training on it', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'broken.json'), '{ not json', 'utf8');

    const report = await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].reason).toMatch(/not valid JSON/i);
    expect(report.outcomes).toHaveLength(0);
    expect(report.written).toBe(0);
  });

  it('does not write anything when the dataset directory is missing', async () => {
    const artifactDir = await tempDir('sensoura-artifacts-');
    const report = await runTraining({
      datasetDir: join(tmpdir(), 'sensoura-no-datasets-here'),
      artifactDir,
      now: () => TRAINED_AT,
    });

    expect(report.outcomes).toHaveLength(0);
    expect(report.failures[0].reason).toMatch(/does not exist/i);
    expect(await readdir(artifactDir)).toHaveLength(0);
  });

  it('produces a dry run without writing an artifact', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'air_temperature.json'), JSON.stringify(jsonDataset()), 'utf8');

    const report = await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT, write: false });

    expect(report.outcomes[0].status).toBe('trained');
    expect(report.outcomes[0].artifact).not.toBeNull();
    expect(await readdir(artifactDir)).toHaveLength(0);
  });

  it('records the provenance of the training data in the artifact', async () => {
    const datasetDir = await tempDir('sensoura-train-');
    const artifactDir = await tempDir('sensoura-artifacts-');
    await writeFile(join(datasetDir, 'air_temperature.json'), JSON.stringify(jsonDataset()), 'utf8');

    await runTraining({ datasetDir, artifactDir, now: () => TRAINED_AT });

    const raw = JSON.parse(await readFile(join(artifactDir, 'air_temperature.json'), 'utf8')) as Record<string, any>;
    expect(raw.training.instrument).toBe('SYNTHETIC reference instrument');
    expect(raw.training.datasetDescription).toMatch(/SYNTHETIC/);
    expect(raw.training.trainedAt).toBe(new Date(TRAINED_AT).toISOString());
    expect(raw.applicability.minLocalValue).toBeLessThanOrEqual(raw.applicability.maxLocalValue);
  });
});
