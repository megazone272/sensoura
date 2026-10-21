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
    temperature: 28.5,
    soilTemperature: 22.3,
    humidity: 65.2,
    soilMoisture: 25.0,
    gas: 180,
    light: 720,
    airPressure: 1013.25,
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
};

await set(ref(db, '/Sensoura'), sensouraData);

console.log('✅ /Sensoura node created successfully with sensorData');
