import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { initializeFirebase, isFirebaseEnabled, getRestClient, mockDb } from '../src/services/firebase.js';
import { getLogger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = getLogger('push-schema');

const initialData = JSON.parse(
  readFileSync(join(__dirname, '..', 'src', 'config', 'sensoura-initial-data.json'), 'utf-8')
);

/**
 * Nodes the schema push must never write to.
 *
 * `/Sensoura/aiPredictions` holds pre-existing prediction history; the
 * `AI_*` nodes belong to the AI pipeline. Seeding the schema must not
 * destroy them, so they are refused explicitly even if the seed file ever
 * grows a key with one of these names.
 */
const PROTECTED_KEYS = ['aiPredictions', 'AI_Predictions', 'AI_Suggestions', 'AI_Data'];

export interface SchemaPushPlan {
  /** Keys to write. */
  write: string[];
  /** Keys that already exist and are therefore left untouched. */
  keep: string[];
  /** Keys that are never written, whatever the database contains. */
  refuse: string[];
}

/**
 * Decide what a schema push is allowed to write.
 *
 * Pure, so the rule can be tested without a database: a key that already
 * exists is kept unless `force` is set, and a protected key is never
 * written at all.
 */
export function planSchemaPush(
  seed: Record<string, unknown>,
  existing: Record<string, unknown>,
  force = false
): SchemaPushPlan {
  const plan: SchemaPushPlan = { write: [], keep: [], refuse: [] };
  for (const key of Object.keys(seed)) {
    if (PROTECTED_KEYS.includes(key)) {
      plan.refuse.push(key);
      continue;
    }
    if (key in existing && !force) {
      plan.keep.push(key);
      continue;
    }
    plan.write.push(key);
  }
  return plan;
}

/**
 * Seeds the Firebase Realtime Database with the SENSOURA schema.
 *
 * Non-destructive by default: a top-level node that already exists in the
 * database is left exactly as it is, so a deployment or a migration never
 * overwrites live data (sensor readings, command history, existing
 * predictions). Pass `--force` to overwrite the seeded keys on purpose.
 *
 * Uses the REST transport (service-account OAuth token) so it works even on
 * networks where the admin SDK's persistent websocket channel is rejected.
 */
export async function pushSensouraSchema(): Promise<void> {
  initializeFirebase();
  const rest = getRestClient();

  if (!isFirebaseEnabled() || !rest) {
    logger.info('Firebase not configured — seeding mock database');
    seedMockDatabase();
    return;
  }

  const force = process.argv.includes('--force');

  try {
    logger.info('Pushing Sensoura schema to Firebase Realtime Database...');

    const existing = (await rest.get<Record<string, unknown>>('/Sensoura')) ?? {};
    if (rest.isUsingTestData()) {
      logger.warn(
        'The service account is not authorised for /Sensoura: the schema was NOT seeded there. ' +
          'Grant it the "Firebase Realtime Database Admin" role and run this again.'
      );
    }
    const plan = planSchemaPush(initialData as Record<string, unknown>, existing, force);
    for (const key of plan.refuse) {
      logger.warn({ key }, 'Refusing to write a protected node — it is never seeded');
    }

    for (const key of plan.write) {
      await rest.put(`/Sensoura/${key}`, (initialData as Record<string, unknown>)[key]);
    }

    if (plan.write.length > 0) logger.info({ created: plan.write }, 'Sensoura nodes written to /Sensoura');
    if (plan.keep.length > 0) {
      logger.info(
        { kept: plan.keep },
        'Existing nodes were left untouched (pass --force to overwrite them)'
      );
    }

    // /testData is the only path open for anonymous read/write (rules allow it).
    // It is scratch space by definition, so it is always refreshed.
    await rest.put('/testData', {
      sensorData: initialData.sensorData,
      system: initialData.system,
      timestamp: Date.now(),
      note: 'Test data for anonymous auth verification',
    });
    logger.info('✅ Test data pushed to /testData');

    logger.info('🎉 Schema push complete!');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to push schema');
    throw error;
  }
}

function seedMockDatabase(): void {
  mockDb.set('/Sensoura', initialData);
  mockDb.set('/testData', {
    sensorData: initialData.sensorData,
    system: initialData.system,
    timestamp: Date.now(),
    note: 'Test data for anonymous auth verification',
  });
  logger.info('Mock database seeded with Sensoura data');
}

// Run if executed directly (path comparison is Windows-safe)
const isMain = (() => {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  pushSensouraSchema()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
