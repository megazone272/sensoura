/**
 * READ-ONLY inspection of the pre-existing prediction node.
 *
 *   npm run inspect:legacy
 *
 * It reads /Sensoura/aiPredictions from the live database, parses it with the
 * verified legacy contract and prints what it found. It never writes.
 *
 * It also reports the top-level shape of the database, so the location of the
 * node can be verified instead of assumed.
 */
import { initializeFirebase, getDatabase } from '../src/services/firebase.js';
import { parseLegacyPredictionEntry } from '../src/ai/pipeline/prediction/legacy.js';

/** Paths the legacy node may live at, in priority order. */
const CANDIDATE_PATHS = ['/Sensoura/aiPredictions', '/aiPredictions'];

async function main(): Promise<void> {
  const initialized = initializeFirebase();
  const db = getDatabase();
  if (!initialized || !db) {
    console.error('Firebase is not configured: cannot inspect the live database.');
    process.exitCode = 1;
    return;
  }

  const root = (await db.ref('/').get()).val() as Record<string, unknown> | null;
  console.log('database root keys:', root ? Object.keys(root).join(', ') : '(empty)');
  if (root && typeof root === 'object' && root['Sensoura'] && typeof root['Sensoura'] === 'object') {
    const sensoura = root['Sensoura'] as Record<string, unknown>;
    console.log('/Sensoura keys:', Object.keys(sensoura).join(', '));
  }

  let found = false;
  for (const path of CANDIDATE_PATHS) {
    const snapshot = await db.ref(path).get();
    const value = snapshot.val() as Record<string, unknown> | null;

    if (!value) {
      console.log(`${path}: the node does not exist.`);
      continue;
    }
    found = true;

    const entries = Object.entries(value).map(([key, raw]) => parseLegacyPredictionEntry(key, raw));
    const invalid = entries.filter((e) => !e.valid);

    console.log(`${path}: ${entries.length} record(s), ${invalid.length} not matching the legacy contract.`);
    for (const entry of entries) {
      console.log(
        `  ${entry.key}: type=${entry.type} predictedValue=${JSON.stringify(entry.predictedValue)} ` +
          `confidence=${entry.confidence} predictionTime=${entry.predictionTime} ` +
          `(${entry.predictionTimeIso ?? 'n/a'})${entry.issues.length ? ` ISSUES: ${entry.issues.join('; ')}` : ''}`
      );
    }
  }

  if (!found) {
    console.log('No aiPredictions node found at any known path: nothing to preserve.');
  }
}

void main().catch((error) => {
  console.error('Inspection failed:', (error as Error).message);
  process.exitCode = 1;
});
