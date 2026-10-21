/**
 * Calibration training workflow.
 *
 * Training is deliberately SEPARATE from inference. The pipeline never trains
 * at run time; this workflow is invoked explicitly (`npm run ai:train`) when
 * new reference measurements are available.
 *
 * Steps:
 *   1. load the paired reference datasets
 *   2. validate every sample and record the rejected ones
 *   3. fit a same-unit bias model on the earlier 70 % of the samples
 *   4. evaluate it on the most recent 30 % (chronological holdout)
 *   5. write a versioned artifact with provenance and metrics
 *
 * When the data is not sufficient the workflow reports
 * `insufficient_data` and writes NOTHING: an unvalidated artifact must never
 * reach the inference path.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CALIBRATION_ARTIFACT_SCHEMA,
  type CalibrationArtifact,
} from '../pipeline/calibration/apply.js';
import { assertNotVocTarget, fitBiasCalibration } from '../pipeline/calibration/registry.js';
import { toIsoUtc } from '../pipeline/utils/time.js';
import { loadPairedDatasets, type PairedDataset } from './dataset.js';

export interface TrainingOptions {
  /** Directory holding the paired reference datasets. */
  datasetDir: string;
  /** Directory the artifacts are written to. */
  artifactDir: string;
  now?: () => number;
  minTrainSamples?: number;
  minValidationSamples?: number;
  /** When false the artifact is built but not written to disk. */
  write?: boolean;
}

export interface TrainingOutcome {
  variable: string;
  status: 'trained' | 'insufficient_data' | 'error';
  datasetPath: string | null;
  artifactPath: string | null;
  artifact: CalibrationArtifact | null;
  sampleCount: number;
  rejectedRows: number;
  metrics: { MAE: number; RMSE: number; bias: number; sampleSize: number } | null;
  reasons: string[];
}

export interface TrainingReport {
  outcomes: TrainingOutcome[];
  failures: Array<{ path: string; reason: string }>;
  written: number;
  trainedAt: string;
}

function artifactPathFor(artifactDir: string, variable: string): string {
  return join(artifactDir, `${variable}.json`);
}

function buildArtifact(
  dataset: PairedDataset,
  fit: ReturnType<typeof fitBiasCalibration>,
  trainedAtMs: number
): CalibrationArtifact {
  const metrics = fit.validationMetrics;
  const range = fit.trainLocalRange ?? { min: 0, max: 0 };
  const periodStart = dataset.rows.length > 0 ? toIsoUtc(dataset.rows[0].atMs) : toIsoUtc(trainedAtMs);
  const periodEnd = dataset.rows.length > 0 ? toIsoUtc(dataset.rows[dataset.rows.length - 1].atMs) : toIsoUtc(trainedAtMs);

  return {
    schemaVersion: CALIBRATION_ARTIFACT_SCHEMA,
    artifactId: `calib_${dataset.variable}_${toIsoUtc(trainedAtMs).replace(/[:.]/g, '-')}`,
    variable: dataset.variable,
    unit: dataset.unit,
    status: 'validated',
    methodId: fit.methodId,
    description:
      `Same-unit bias model for ${dataset.variable}: reference = intercept + slope * local. ` +
      `Reference instrument: ${dataset.instrument}.`,
    coefficients: {
      slope: fit.slope as number,
      intercept: fit.intercept as number,
      formula: 'reference = intercept + slope * local',
    },
    applicability: {
      minLocalValue: range.min,
      maxLocalValue: range.max,
      greenhouseId: null,
      notes: [
        `The model is only valid for local values between ${range.min} and ${range.max} ${dataset.unit}, ` +
          'the range covered by the training split.',
        'Outside that range the calibration is not applied (no extrapolation).',
      ],
    },
    training: {
      dataset: dataset.sourcePath,
      datasetDescription: dataset.description,
      instrument: dataset.instrument,
      sampleCount: dataset.rows.length,
      trainSampleCount: fit.trainSamples,
      validationSampleCount: fit.validationSamples,
      periodStart,
      periodEnd,
      splitMethod:
        'chronological: the earliest 70 % of the samples are used for fitting, the most recent 30 % for validation',
      trainedAt: toIsoUtc(trainedAtMs),
    },
    validation: {
      metrics: metrics
        ? {
            MAE: metrics.MAE,
            RMSE: metrics.RMSE,
            bias: metrics.bias,
            sampleSize: metrics.sampleSize,
          }
        : null,
      unit: dataset.unit,
      notes: [
        ...fit.reasons,
        'Training and validation samples are disjoint and split chronologically.',
        'The reference instrument and its uncertainty are not re-estimated; the reported error therefore ' +
          'includes the reference instrument’s own uncertainty.',
      ],
    },
  };
}

async function writeArtifact(artifactDir: string, artifact: CalibrationArtifact): Promise<string> {
  await mkdir(artifactDir, { recursive: true });
  const target = artifactPathFor(artifactDir, artifact.variable);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await rename(tmp, target);
  return target;
}

/** Train every dataset found in `datasetDir` and write the validated artifacts. */
export async function runTraining(opts: TrainingOptions): Promise<TrainingReport> {
  const nowMs = (opts.now ?? Date.now)();
  const trainedAt = toIsoUtc(nowMs);
  const outcomes: TrainingOutcome[] = [];
  const failures: Array<{ path: string; reason: string }> = [];
  let written = 0;

  const { datasets, failures: loadFailures } = await loadPairedDatasets(opts.datasetDir);
  failures.push(...loadFailures);

  for (const dataset of datasets) {
    const base = {
      variable: dataset.variable,
      datasetPath: dataset.sourcePath,
      artifactPath: null,
      artifact: null,
      sampleCount: dataset.rows.length,
      rejectedRows: dataset.rejected.length,
      metrics: null,
    };

    // A calibration target may never be a VOC name.
    try {
      assertNotVocTarget(dataset.variable, dataset.variable);
    } catch (error) {
      outcomes.push({
        ...base,
        status: 'error',
        reasons: [(error as Error).message],
      });
      continue;
    }

    const fit = fitBiasCalibration(
      dataset.rows.map((r) => ({ atMs: r.atMs, local: r.local, reference: r.reference })),
      {
        minTrainSamples: opts.minTrainSamples,
        minValidationSamples: opts.minValidationSamples,
        unitNote: dataset.unit,
      }
    );

    if (fit.status !== 'validated' || fit.slope === null || fit.intercept === null) {
      outcomes.push({
        ...base,
        status: 'insufficient_data',
        reasons: [
          ...fit.reasons,
          'No artifact was written: an unvalidated calibration must not reach the inference path.',
        ],
      });
      continue;
    }

    const artifact = buildArtifact(dataset, fit, nowMs);
    const metrics = fit.validationMetrics;

    if (opts.write === false) {
      outcomes.push({
        ...base,
        status: 'trained',
        artifact,
        metrics: metrics ?? null,
        reasons: ['artifact built but not written (dry run)'],
      });
      continue;
    }

    try {
      const path = await writeArtifact(opts.artifactDir, artifact);
      written++;
      outcomes.push({
        ...base,
        status: 'trained',
        artifactPath: path,
        artifact,
        metrics: metrics ?? null,
        reasons: [
          ...fit.reasons,
          `artifact written to ${path}`,
          'The artifact is applied by the pipeline only inside the trained value range.',
        ],
      });
    } catch (error) {
      outcomes.push({
        ...base,
        status: 'error',
        reasons: [`artifact could not be written: ${(error as Error).message}`],
      });
    }
  }

  return { outcomes, failures, written, trainedAt };
}

/** One-line summary per outcome, safe to print (no secrets involved). */
export function describeTrainingReport(report: TrainingReport): string[] {
  const lines: string[] = [];
  for (const failure of report.failures) {
    lines.push(`dataset rejected: ${failure.path}: ${failure.reason}`);
  }
  for (const outcome of report.outcomes) {
    const metrics = outcome.metrics
      ? `MAE ${outcome.metrics.MAE} ${outcome.artifact?.unit ?? ''} / RMSE ${outcome.metrics.RMSE} / bias ${outcome.metrics.bias} (n=${outcome.metrics.sampleSize})`
      : 'no metrics';
    lines.push(
      `${outcome.status.toUpperCase()} ${outcome.variable}: ${outcome.sampleCount} sample(s), ` +
        `${outcome.rejectedRows} rejected, ${metrics}` +
        (outcome.artifactPath ? ` -> ${outcome.artifactPath}` : '')
    );
    for (const reason of outcome.reasons) lines.push(`    - ${reason}`);
  }
  if (report.outcomes.length === 0 && report.failures.length === 0) {
    lines.push('no datasets found: nothing was trained');
  }
  return lines;
}
