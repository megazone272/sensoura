import { initializeFirebase, getDatabase, isFirebaseEnabled, getRestClient } from './backend/src/services/firebase.js';

console.log('Firebase enabled:', isFirebaseEnabled());
const result = initializeFirebase();
if (result) {
  console.log('Firebase initialized, project:', result.app.options.projectId);
  console.log('DB available:', !!result.db);
  
  // Test reading from Firebase
  const db = getDatabase();
  if (db) {
    db.ref('/Sensoura/sensorData').get().then((snapshot) => {
      if (snapshot.exists()) {
        console.log('Sensor data from Firebase:', snapshot.val());
      } else {
        console.log('No sensor data in Firebase yet');
      }
    }).catch((error) => {
      console.error('Error reading sensor data:', error);
    });
    
    db.ref('/Sensoura/system').get().then((snapshot) => {
      if (snapshot.exists()) {
        console.log('System status from Firebase:', snapshot.val());
      } else {
        console.log('No system data in Firebase yet');
      }
    }).catch((error) => {
      console.error('Error reading system data:', error);
    });
  }
  
  const restClient = getRestClient();
  if (restClient) {
    console.log('REST client available');
    restClient.get('/Sensoura/sensorData').then(data => {
      console.log('Sensor data via REST:', data);
    }).catch(err => {
      console.error('REST error:', err.message);
    });
  }
} else {
  console.log('Firebase not initialized - running in mock mode');
}