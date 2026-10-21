/**
 * Calibration training CLI.
 *
 *   npm run ai:train                       # train every dataset in datasets/calibration
 *   npm run ai:train -- --dataset-dir X    # explicit dataset directory
 *   npm run ai:train -- --artifact-dir Y    # explicit artifact output directory
 *   npm run ai:train -- --dry-run          # build the artifacts without writing them
 *
 * This is a separate workflow from inference on purpose: the pipeline never
 * trains at run time. When no paired reference data is available the command
 * reports that and exits non-zero — it never invents a model.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeTrainingReport, runTraining } from './training/run-training.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(PACKAGE_ROOT, value);
}

async function main(): Promise<void> {
  const datasetDir = resolvePath(
    argValue('--dataset-dir') ?? process.env.AI_TRAINING_DATASET_DIR ?? 'datasets/calibration'
  );
  const artifactDir = resolvePath(
    argValue('--artifact-dir') ?? process.env.AI_CALIBRATION_ARTIFACT_DIR ?? 'models/calibration'
  );
  const write = !process.argv.includes('--dry-run');

  console.log(`sensoura calibration training`);
  console.log(`  dataset directory : ${datasetDir}${existsSync(datasetDir) ? '' : ' (missing)'}`);
  console.log(`  artifact directory: ${artifactDir}`);
  console.log(`  mode             : ${write ? 'write artifacts' : 'dry run (no artifacts written)'}`);
  console.log('');

  const report = await runTraining({ datasetDir, artifactDir, write });

  for (const line of describeTrainingReport(report)) console.log(line);

  const trained = report.outcomes.filter((o) => o.status === 'trained').length;
  const insufficient = report.outcomes.filter((o) => o.status === 'insufficient_data').length;
  const errored = report.outcomes.filter((o) => o.status === 'error').length;

  console.log('');
  console.log(
    `trained ${trained}, insufficient_data ${insufficient}, error ${errored}, ` +
      `artifacts written ${report.written}, datasets rejected ${report.failures.length}`
  );

  if (trained === 0) {
    console.log('');
    console.log(
      'No calibration model was trained. This is expected until paired reference measurements exist:\n' +
        '  - the MQ135 has no R0/load-resistor calibration and no temperature/humidity compensation,\n' +
        '  - there is no co-located reference instrument for temperature, humidity or pressure,\n' +
        '  - the light reading is an uncalibrated photoresistor count.\n' +
        'Until then the pipeline uses the raw sensor values and reports indoorSensorStatus=none.'
    );
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`Training failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
