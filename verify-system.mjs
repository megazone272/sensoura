import { initializeFirebase, isFirebaseEnabled, getDatabase, getRestClient } from './backend/src/services/firebase.js';

async function verifySystem() {
  console.log('=== SENSOURA System Verification ===\n');
  
  // 1. Firebase status
  console.log('1. Firebase Status:');
  const enabled = isFirebaseEnabled();
  console.log('   Firebase enabled:', enabled);
  
  const result = initializeFirebase();
  if (result) {
    console.log('   ✅ Firebase initialized');
    console.log('   Project ID:', result.app.options.projectId);
    console.log('   DB available:', !!result.db);
    console.log('   REST client:', !!(result.restClient));
  } else {
    console.log('   ⚠️ Firebase running in mock mode');
  }
  
  // 2. Test database read
  console.log('\n2. Database Connection:');
  const db = getDatabase();
  if (db) {
    try {
      const sensorSnap = await db.ref('/Sensoura/sensorData').get();
      console.log('   Sensor data:', sensorSnap.exists() ? '✅ Found' : '❌ Empty');
      if (sensorSnap.exists()) {
        const data = sensorSnap.val();
        console.log('   - temperature:', data.AirTemp);
        console.log('   - soilMoisture:', data.SoilMoisture);
        console.log('   - humidity:', data.AirHumidity);
      }
      
      const systemSnap = await db.ref('/Sensoura/system').get();
      console.log('   System status:', systemSnap.exists() ? '✅ Found' : '❌ Empty');
      if (systemSnap.exists()) {
        const sys = systemSnap.val();
        console.log('   - relay state:', sys.relay?.state);
        console.log('   - buzzer muted:', sys.buzzer?.muted);
      }
    } catch (err) {
      console.error('   ❌ Database read error:', err.message);
    }
  }
  
  // 3. REST client test
  console.log('\n3. REST Client:');
  const restClient = getRestClient();
  if (restClient) {
    try {
      const data = await restClient.get('/Sensoura/sensorData');
      console.log('   ✅ REST read successful');
      console.log('   - gas:', data.VOC);
      console.log(' - light:', data.Light);
    } catch (err) {
      console.error('   ❌ REST read error:', err.message);
    }
  }
  
  // 4. Summary
  console.log('\n=== Summary ===');
  console.log('Firebase:', enabled ? '✅ Connected' : '⚠️ Mock mode');
  console.log('Database access:', db && db.ref ? '✅ Available' : '❌ Not available');
  console.log('REST fallback:', restClient ? '✅ Active' : '❌ Not available');
}

verifySystem().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});