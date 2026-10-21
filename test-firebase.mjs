import { initializeFirebase, isFirebaseEnabled, getDatabase, getRestClient } from './backend/src/services/firebase.js';

console.log('Firebase enabled:', isFirebaseEnabled());
const result = initializeFirebase();
if (result) {
  console.log('Firebase initialized, project:', result.app.options.projectId);
  console.log('DB available:', !!result.db);
  console.log('REST client available:', !!(result.restClient));
} else {
  console.log('Firebase not initialized - running in mock mode');
}