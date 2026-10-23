import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase, ref, set } from 'firebase-admin/database';

const serviceAccount = require('./serviceAccountKey.json');

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: 'https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app'
  });
}

const db = getDatabase();
const now = Date.now();

const sensouraData = {
  sensorData: {
    AirTemp: 28.5,
    SoilTemp: 22.3,
    AirHumidity: 65.2,
    SoilMoisture: 25.0,
    VOC: 180,
    Light: 720,
    Barometricpressure: 1013.25,
    lastUpdate: now,
  },
  system: {
    status: 'online',
    lastSeen: now,
    deviceId: 'sensoura-esp32-01',
    relay: { mode: 'AUTO', state: 'OFF', reason: null, lastAction: null },
    buzzer: { muted: false },
    leds: { green: false, red: false },
  },
  commands: {},
  commandResults: {},
  aiSuggestions: {},
  aiPredictions: {
    '3001': {
      type: 'rainfall',
      predictedValue: 'after 2 days afternoon',
      confidence: 0.85,
      predictionTime: now + 2 * 60 * 60 * 1000,
    },
    '3002': {
      type: 'air_temp',
      predictedValue: 30.0,
      confidence: 0.9,
      predictionTime: now + 2 * 60 * 60 * 1000,
    },
  },
};

await set(ref(db, '/Sensoura'), sensouraData);

console.log('✅ /Sensoura node created successfully with sensorData');
