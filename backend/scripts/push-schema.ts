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
 * Seeds the Firebase Realtime Database with the SENSOURA schema.
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

  try {
    logger.info('Pushing Sensoura schema to Firebase Realtime Database...');

    // Main state tree consumed by firmware + backend + dashboard
    await rest.put('/Sensoura', initialData);
    logger.info('✅ Sensoura data pushed to /Sensoura');

    // /testData is the only path open for anonymous read/write (rules allow it)
    await rest.put('/testData', {
      sensorData: initialData.sensorData,
      system: initialData.system,
      timestamp: Date.now(),
      note: 'Test data for anonymous auth verification',
    });
    logger.info('✅ Test data pushed to /testData');

    logger.info('🎉 Schema push complete!');
  } catch (error) {
    logger.error({ err: error }, 'Failed to push schema');
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
