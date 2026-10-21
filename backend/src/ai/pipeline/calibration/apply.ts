/**
 * Calibration model artifacts: loading, validation and application.
 *
 * A calibration model is only ever produced by the training workflow
 * (`npm run ai:train`), which fits it on paired reference measurements and
 * evaluates it on a chronological holdout. This module only CONSUMES such an
 * artifact:
 *
 *   - an artifact that does not validate is ignored (never guessed at)
 *   - an artifact whose target is a VOC name is rejected outright
 *   - an artifact is only applied inside the value range it was trained on
 *     (no silent extrapolation)
 *   - the raw sensor value is always preserved next to the calibrated value
 *
 * The pipeline ships without any artifact: the repository contains no paired
 * reference measurements, so `indoorSensorStatus` stays `none` until an
 * operator supplies real reference data and trains a model.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CALIBRATION_STATUSES } from '../schema.js';
import { assertNotVocTarget } from './registry.js';
import { roundTo } from '../utils/units.js';

export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export const CALIBRATION_ARTIFACT_SCHEMA = 'calibration-artifact/v1';

/**
 * The persisted shape of a trained bias model.
 *
 * `coefficients` describes a same-unit model: the reference and the local
 * reading are expressed in the same unit, so the calibrated output keeps the
 * local unit and no unit conversion is involved.
 */
export const calibrationArtifactSchema = z.object({
  schemaVersion: z.literal(CALIBRATION_ARTIFACT_SCHEMA),
  artifactId: z.string().min(1),
  /** Normalized pipeline variable this artifact calibrates (e.g. `air_temperature`). */
  variable: z.string().min(1),
  /** Unit of the local reading and of the calibrated output. */
  unit: z.string().min(1),
  /** `validated` means the model passed its chronological holdout evaluation. */
  status: z.enum(['validated', 'unvalidated']),
  methodId: z.string().min(1),
  description: z.string().min(1),
  coefficients: z.object({
    slope: z.number().finite(),
    intercept: z.number().finite(),
    formula: z.literal('reference = intercept + slope * local'),
  }),
  applicability: z.object({
    minLocalValue: z.number().finite(),
    maxLocalValue: z.number().finite(),
    greenhouseId: z.string().nullable(),
    notes: z.array(z.string()),
  }),
  training: z.object({
    dataset: z.string().min(1),
    datasetDescription: z.string().min(1),
    /** The calibrated reference instrument (must be a real instrument). */
    instrument: z.string().min(1),
    sampleCount: z.number().int().min(0),
    trainSampleCount: z.number().int().min(0),
    validationSampleCount: z.number().int().min(0),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    splitMethod: z.string().min(1),
    trainedAt: z.string().min(1),
  }),
  validation: z.object({
    metrics: z
      .object({
        MAE: z.number().finite(),
        RMSE: z.number().finite(),
        bias: z.number().finite(),
        sampleSize: z.number().int().min(0),
      })
      .nullable(),
    unit: z.string().min(1),
    notes: z.array(z.string()),
  }),
});

export type CalibrationArtifact = z.infer<typeof calibrationArtifactSchema>;

/** What happened to one variable when a calibration was considered. */
export interface CalibrationApplication {
  variable: string;
  applied: boolean;
  status: CalibrationStatus;
  methodId: string | null;
  description: string | null;
  /** The unmodified sensor reading. */
  rawValue: number | null;
  /** The calibrated value; equals the raw value when nothing was applied. */
  calibratedValue: number | null;
  reason: string;
}

export type CalibrationLoadResult =
  | { ok: true; path: string; artifact: CalibrationArtifact }
  | { ok: false; path: string; reason: string };

/**
 * Load and validate one artifact.
 *
 * Never throws: an unusable artifact is reported with a reason so the caller
 * can ignore it and carry on with the raw sensor values.
 */
export async function loadCalibrationArtifact(path: string): Promise<CalibrationLoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    return { ok: false, path, reason: `artifact could not be read: ${(error as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, path, reason: `artifact is not valid JSON: ${(error as Error).message}` };
  }

  const result = calibrationArtifactSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, path, reason: `artifact failed schema validation: ${issues.join('; ')}` };
  }

  const artifact = result.data;

  if (artifact.applicability.minLocalValue > artifact.applicability.maxLocalValue) {
    return {
      ok: false,
      path,
      reason:
        'artifact applicability range is inverted ' +
        `(${artifact.applicability.minLocalValue} > ${artifact.applicability.maxLocalValue})`,
    };
  }

  // A calibration target may never be a VOC name: no external variable in this
  // integration measures an equivalent VOC quantity.
  try {
    assertNotVocTarget(artifact.variable, artifact.variable);
  } catch (error) {
    return { ok: false, path, reason: (error as Error).message };
  }

  if (artifact.status === 'validated' && artifact.validation.metrics === null) {
    return { ok: false, path, reason: 'artifact claims to be validated but carries no validation metrics' };
  }

  return { ok: true, path, artifact };
}

export interface CalibrationRegistry {
  /** Artifacts that loaded and validated, indexed by normalized variable. */
  artifacts: Map<string, CalibrationArtifact>;
  /** Files that were present but unusable, with the reason why. */
  rejected: Array<{ path: string; reason: string }>;
  directory: string;
  directoryExists: boolean;
}

/**
 * Load every `*.json` artifact in a directory.
 *
 * A missing directory is not an error: the pipeline simply has no calibration
 * and keeps using raw sensor values.
 */
export async function loadCalibrationRegistry(directory: string): Promise<CalibrationRegistry> {
  const registry: CalibrationRegistry = {
    artifacts: new Map(),
    rejected: [],
    directory,
    directoryExists: false,
  };

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      registry.rejected.push({ path: directory, reason: 'calibration artifact directory does not exist' });
      return registry;
    }
    registry.rejected.push({ path: directory, reason: `calibration directory could not be read: ${(error as Error).message}` });
    return registry;
  }

  registry.directoryExists = true;

  for (const entry of entries.sort()) {
    if (!entry.toLowerCase().endsWith('.json')) continue;
    const path = join(directory, entry);
    const result = await loadCalibrationArtifact(path);
    if (!result.ok) {
      registry.rejected.push({ path, reason: result.reason });
      continue;
    }
    const existing = registry.artifacts.get(result.artifact.variable);
    if (existing) {
      registry.rejected.push({
        path,
        reason: `duplicate calibration artifact for variable "${result.artifact.variable}" (keeping ${existing.artifactId})`,
      });
      continue;
    }
    registry.artifacts.set(result.artifact.variable, result.artifact);
  }

  return registry;
}

/**
 * Apply one artifact to one raw value.
 *
 * The artifact is NOT applied when it is unvalidated, when the value is
 * missing, or when the value lies outside the range the model was trained on.
 */
export function applyCalibration(
  artifact: CalibrationArtifact,
  rawValue: number | null
): CalibrationApplication {
  const base = {
    variable: artifact.variable,
    methodId: artifact.methodId,
    description: artifact.description,
    rawValue,
    calibratedValue: rawValue,
  };

  if (rawValue === null || !Number.isFinite(rawValue)) {
    return { ...base, applied: false, status: 'none', reason: 'no value to calibrate' };
  }

  if (artifact.status !== 'validated') {
    return {
      ...base,
      applied: false,
      status: 'none',
      reason: `artifact status is "${artifact.status}": it was not evaluated on an independent holdout`,
    };
  }

  if (rawValue < artifact.applicability.minLocalValue || rawValue > artifact.applicability.maxLocalValue) {
    return {
      ...base,
      applied: false,
      status: 'none',
      reason:
        `raw value ${rawValue} is outside the calibrated range ` +
        `${artifact.applicability.minLocalValue}..${artifact.applicability.maxLocalValue} ${artifact.unit}; ` +
        'extrapolation is refused',
    };
  }

  const calibrated = artifact.coefficients.intercept + artifact.coefficients.slope * rawValue;
  if (!Number.isFinite(calibrated)) {
    return { ...base, applied: false, status: 'none', reason: 'calibrated value is not finite' };
  }

  return {
    ...base,
    applied: true,
    status: 'bias_corrected',
    calibratedValue: roundTo(calibrated, 3),
    reason:
      `applied ${artifact.methodId}: ${artifact.coefficients.formula} ` +
      `(slope ${artifact.coefficients.slope}, intercept ${artifact.coefficients.intercept}, unit ${artifact.unit})`,
  };
}

/** Apply the registry entry for a variable, if any. */
export function applyRegistryCalibration(
  registry: CalibrationRegistry,
  variable: string,
  rawValue: number | null
): CalibrationApplication {
  const artifact = registry.artifacts.get(variable);
  if (!artifact) {
    return {
      variable,
      applied: false,
      status: 'none',
      methodId: null,
      description: null,
      rawValue,
      calibratedValue: rawValue,
      reason: 'no calibration artifact for this variable',
    };
  }
  return applyCalibration(artifact, rawValue);
}

/**
 * Apply every registered calibration to a set of values.
 *
 * Returns the calibrated values (unchanged where nothing was applied) and the
 * per-variable outcome, so the caller can record raw and calibrated values
 * separately.
 */
export function applyCalibrationsToValues(
  registry: CalibrationRegistry,
  values: Record<string, number | null>
): { values: Record<string, number | null>; applications: Record<string, CalibrationApplication> } {
  const out: Record<string, number | null> = { ...values };
  const applications: Record<string, CalibrationApplication> = {};

  for (const [variable, artifact] of registry.artifacts) {
    const application = applyCalibration(artifact, values[variable] ?? null);
    applications[variable] = application;
    if (application.applied && application.calibratedValue !== null) {
      out[variable] = application.calibratedValue;
    }
  }

  return { values: out, applications };
}

/** Human-readable summary of a registry, safe to log. */
export function describeRegistry(registry: CalibrationRegistry): {
  directory: string;
  directoryExists: boolean;
  loaded: string[];
  rejected: Array<{ path: string; reason: string }>;
} {
  return {
    directory: registry.directory,
    directoryExists: registry.directoryExists,
    loaded: [...registry.artifacts.values()].map(
      (a) => `${a.variable} (${a.methodId}, ${a.status}, ${a.validation.metrics ? `MAE ${a.validation.metrics.MAE} ${a.unit}` : 'no metrics'})`
    ),
    rejected: registry.rejected,
  };
}
