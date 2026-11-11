import { existsSync } from 'node:fs';

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

console.log('--- SENSOURA FIREBASE LIVE DATA INSPECTION ---');
const creds = resolveCredentials();
console.log('Resolved credentials:', describeCredentials(creds));

initializeFirebase();
const enabled = isFirebaseEnabled();
console.log('Firebase enabled:', enabled);

if (enabled) {
  const db = getDatabase();
  if (db) {
    try {
      const [sensorSnap, systemSnap] = await Promise.all([
        db.ref('/Sensoura/sensorData').get(),
        db.ref('/Sensoura/system').get(),
      ]);

      if (sensorSnap.exists()) {
        console.log('Sensor data from Firebase:', sensorSnap.val());
      } else {
        console.log('No sensor data in Firebase yet');
      }

      if (systemSnap.exists()) {
        console.log('System status from Firebase:', systemSnap.val());
      } else {
        console.log('No system data in Firebase yet');
      }
    } catch (error) {
      console.error('Error reading from Firebase:', error.message);
    }
  }
} else {
  console.log('Firebase not initialized - running in mock mode');
}
process.exit(0);
