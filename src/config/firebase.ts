import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken, type AppCheck } from 'firebase/app-check';

/** Ίδιο με `.firebaserc` — ώστε Firestore/SDK και HTTP functions URL να μην αποκλίνουν αν λείπει `VITE_FIREBASE_PROJECT_ID` στο build. */
const DEFAULT_FIREBASE_PROJECT_ID = 'performance-plus-4a5b2';

// Firebase configuration
// TODO: Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "your-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "your-project.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
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

// Firestore cache: MEMORY (όχι IndexedDB persistence).
//
// ΓΙΑΤΙ: το IndexedDB persistence (persistentLocalCache) μπλόκαρε την αρχικοποίηση της Firestore
// layer — όταν το IndexedDB κλείδωνε/στόλαρε (stale tab lease, locked DB), ΟΛΑ τα reads έμπαιναν
// σε ουρά πίσω από την persistence init → οι σελίδες «κρέμονταν» κι έσβηνε ακόμα και η λίστα brands,
// απαιτώντας πολλαπλά hard refresh. Με memory cache τα reads πάνε κατευθείαν στο δίκτυο, χωρίς
// dependency σε IndexedDB. Το fast first-paint καλύπτεται ήδη από το React Query localStorage persist.
// Auto long-polling: αποφεύγει WebChannel streaming που μπλοκάρεται από proxies/extensions.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true,
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
const FUNCTIONS_PROJECT = import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId || DEFAULT_FIREBASE_PROJECT_ID;

const DEFAULT_CF_BASE = `https://${FUNCTIONS_REGION}-${FUNCTIONS_PROJECT}.cloudfunctions.net`;

/** Ρητό override από .env (staging / άλλο project). Άκυρα ή ύποπτα URLs αγνοούνται → default `*.cloudfunctions.net`. */
function resolvedExplicitFunctionsBase(): string | null {
  const raw = (import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_FUNCTIONS_URL || '').trim();
  if (!raw) return null;
  const normalized = (raw.startsWith('http') ? raw : `https://${raw}`).replace(/\/$/, '');
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    console.warn('[config] Ignoring invalid VITE_FUNCTIONS_BASE_URL / VITE_FUNCTIONS_URL');
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host.includes('github') || host.includes('gist.github')) {
    console.warn('[config] Ignoring VITE_FUNCTIONS_* pointing at GitHub — use europe-west1-<project>.cloudfunctions.net');
    return null;
  }
  return normalized;
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
 * Legacy / misc origin helper. Για OAuth `redirect_uri` χρησιμοποίησε `FUNCTIONS_BASE_URL` + `/connectorCallback`
 * (ίδιο host με `connectorAuth`), όχι `window.location.origin` — αλλιώς `redirect_uri_mismatch` στο Google Console.
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
