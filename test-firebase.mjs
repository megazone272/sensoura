import { existsSync } from 'node:fs';
import path from 'node:path';

// Load environment variables if available
if (typeof process.loadEnvFile === 'function') {
  for (const envPath of ['./backend/.env', './.env']) {
    if (existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
        break;
      } catch {
        // ignore
      }
    }
  }
}

import { initializeFirebase, isFirebaseEnabled, getDatabase, resolveCredentials, describeCredentials } from './backend/dist/services/firebase.js';

console.log('--- SENSOURA FIREBASE INTEGRATION TEST ---');
const creds = resolveCredentials();
console.log('Resolved credentials:', describeCredentials(creds));

initializeFirebase();
const enabled = isFirebaseEnabled();
console.log('Firebase enabled:', enabled);

if (enabled) {
  const db = getDatabase();
  console.log('Database instance available:', !!db);
  if (db) {
    try {
      console.log('Fetching /Sensoura node from Firebase Realtime Database...');
      const snap = await db.ref('/Sensoura').get();
      if (snap.exists()) {
        console.log('SUCCESS: Connected to Firebase! Top-level keys:', Object.keys(snap.val()));
      } else {
        console.log('Connected to Firebase, but /Sensoura node is empty.');
      }
    } catch (err) {
      console.error('Error fetching from Firebase:', err.message);
    }
  }
} else {
  console.log('Firebase is running in LOCAL MOCK mode.');
}
process.exit(0);
