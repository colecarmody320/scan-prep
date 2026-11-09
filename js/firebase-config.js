// Firebase web configuration for the "scan-prep" project. These values identify the project; they are not secrets.
// Access is controlled by Firebase Authentication (authorized domains) and the Realtime Database security rules
// in firebase/database.rules.json (each signed-in user can read and write only users/<their uid>).
export const firebaseConfig = {
  apiKey: 'AIzaSyDIRwSAnQae77s7he6XN3xZCCerRChzANM',
  authDomain: 'scan-prep.firebaseapp.com',
  databaseURL: 'https://scan-prep-default-rtdb.firebaseio.com',
  projectId: 'scan-prep',
  storageBucket: 'scan-prep.firebasestorage.app',
  messagingSenderId: '369242734149',
  appId: '1:369242734149:web:e3255fd33bd1990c852d2c',
};
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
