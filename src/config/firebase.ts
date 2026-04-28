import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken, type AppCheck } from 'firebase/app-check';

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

// ── App Check (bot/abuse protection) ─────────────────────────────────────────
// Ενεργοποιείται αυτόματα όταν υπάρχει VITE_RECAPTCHA_V3_SITE_KEY στο .env.
// Για dev/emulator debug token: localStorage.setItem('pp:appcheck-debug', '1') → reload.
// Τα Firestore/Auth SDK επισυνάπτουν το token αυτόματα.
// Για HTTP Cloud Functions χρησιμοποίησε `getAppCheckHeader()` παρακάτω.
let appCheckInstance: AppCheck | null = null;
if (typeof window !== 'undefined') {
  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY;
  if (recaptchaSiteKey) {
    try {
      if (import.meta.env.DEV && window.localStorage.getItem('pp:appcheck-debug') === '1') {
        (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('[AppCheck] Init failed — continuing χωρίς App Check:', err);
    }
  }
}

/** Επιστρέφει `X-Firebase-AppCheck` header αν υπάρχει active instance, αλλιώς {} */
export async function getAppCheckHeader(): Promise<Record<string, string>> {
  if (!appCheckInstance) return {};
  try {
    const { token } = await getAppCheckToken(appCheckInstance, /* forceRefresh */ false);
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch (err) {
    console.warn('[AppCheck] token fetch failed:', err);
    return {};
  }
}

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

const DEFAULT_CF_BASE = `https://${FUNCTIONS_REGION}-${FUNCTIONS_PROJECT}.cloudfunctions.net`;

/** Ρητό override από .env (staging / άλλο project). */
function resolvedExplicitFunctionsBase(): string | null {
  const raw = (import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_FUNCTIONS_URL || '').trim();
  if (!raw) return null;
  return (raw.startsWith('http') ? raw : `https://${raw}`).replace(/\/$/, '');
}

/**
 * Βάση για `fetch()` προς HTTP Cloud Functions.
 *
 * Σημαντικό: το **Firebase Hosting** κόβει τα requests που κάνει proxy σε function σε **~60s**.
 * Το `connectorSync` (Megaventory κ.λπ.) μπορεί να τρέχει πολλά λεπτά — πρέπει **απευθείας**
 * στο `*.cloudfunctions.net`, όχι μέσω Hosting rewrite (αλλιώς 502/504).
 */
export const FUNCTIONS_BASE_URL = resolvedExplicitFunctionsBase() ?? DEFAULT_CF_BASE;

/**
 * Απόλυτο origin για OAuth `redirect_uri`, curl snippets, κ.λπ.
 * Σε production SPA = `window.location.origin` (custom domain ή web.app).
 */
export function getFunctionsOrigin(): string {
  const ex = resolvedExplicitFunctionsBase();
  if (ex) return ex;
  if (import.meta.env.DEV) return DEFAULT_CF_BASE;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return DEFAULT_CF_BASE;
}

/** Σταθερό public URL function (curl / API keys) — πάντα cloudfunctions.net εκτός αν έχεις ρητό .env. */
export function buildFunctionUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const ex = resolvedExplicitFunctionsBase();
  if (ex) return `${ex.replace(/\/$/, '')}${p}`;
  return `${DEFAULT_CF_BASE}${p}`;
}
