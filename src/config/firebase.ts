import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Firebase configuration
// TODO: Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "your-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "your-project.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "performance-plus",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "your-project.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with IndexedDB persistence so cached data survives page refreshes.
// On reload, queries are served from local disk in <100ms without a network round-trip.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Initialize Auth
export const auth = getAuth(app);
auth.languageCode = 'el';

// Initialize Storage
export const storage = getStorage(app);

export default app;

/** App base URL for invite links (production). Set VITE_APP_URL in .env */
export const APP_URL =
  import.meta.env.VITE_APP_URL || 'https://performance-plus-4a5b2.web.app';

const FUNCTIONS_REGION = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1';
/** Ίδιο fallback με coordination — όχι το placeholder projectId του firebaseConfig */
const FUNCTIONS_PROJECT =
  import.meta.env.VITE_FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';

/** Βάση URL για HTTP Cloud Functions (email, connectors, κ.λπ.) */
export const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
  `https://${FUNCTIONS_REGION}-${FUNCTIONS_PROJECT}.cloudfunctions.net`;
