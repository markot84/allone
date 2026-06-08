import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken, type AppCheck } from 'firebase/app-check';

const DEFAULT_FUNCTIONS_REGION = 'europe-west1';

function requireEnv(name: string): string {
  const v = import.meta.env[name] as string | undefined;
  if (!v) throw new Error(`[firebase] Missing required env var ${name} (see .env.example)`);
  return v;
}

// Bootstrap: the six SDK keys and the App Check site key are the only env
// values the SPA still reads. Everything else now lives in Firestore at
// `appConfig/publicConfig` (loaded by services/appConfig.ts at app startup).
const firebaseConfig = {
  apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv('VITE_FIREBASE_APP_ID'),
};

export const PROJECT_ID = firebaseConfig.projectId;

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

// ── Project-derived defaults ────────────────────────────────────────────────
// Values come from .env (VITE_*) with project-derived fallbacks. publicConfig
// used to live in Firestore (`appConfig/publicConfig`) but moved back to env
// vars to keep deploys deterministic.

const ENV_REGION = (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined)?.trim();
const FUNCTIONS_REGION = ENV_REGION || DEFAULT_FUNCTIONS_REGION;

const DEFAULT_APP_URL = `https://${PROJECT_ID}.web.app`;
const DEFAULT_FUNCTIONS_BASE = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;

export function getAppUrl(): string {
  const envUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.trim();
  return envUrl || DEFAULT_APP_URL;
}

/**
 * Βάση για `fetch()` προς HTTP Cloud Functions.
 *
 * Σημαντικό: το **Firebase Hosting** κόβει τα requests που κάνει proxy σε function σε **~60s**.
 * Το `connectorSync` (Megaventory κ.λπ.) μπορεί να τρέχει πολλά λεπτά — πρέπει **απευθείας**
 * στο `*.cloudfunctions.net`, όχι μέσω Hosting rewrite (αλλιώς 502/504).
 */
export function getFunctionsBaseUrl(): string {
  const override = ((import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)
    ?? (import.meta.env.VITE_FUNCTIONS_URL as string | undefined)
    ?? '').trim();
  if (override) {
    try {
      const u = new URL(override);
      const host = u.hostname.toLowerCase();
      if (!host.includes('github') && !host.includes('gist.github')) {
        return override.replace(/\/$/, '');
      }
      console.warn('[config] Ignoring suspicious VITE_FUNCTIONS_BASE_URL');
    } catch {
      console.warn('[config] Ignoring invalid VITE_FUNCTIONS_BASE_URL');
    }
  }
  return DEFAULT_FUNCTIONS_BASE;
}

// Back-compat constants. Evaluated once at module load; for runtime-mutable
// behavior call the getters above.
export const APP_URL: string = getAppUrl();
export const FUNCTIONS_BASE_URL: string = getFunctionsBaseUrl();

/**
 * Legacy / misc origin helper. Για OAuth `redirect_uri` χρησιμοποίησε `getFunctionsBaseUrl()` + `/connectorCallback`
 * (ίδιο host με `connectorAuth`), όχι `window.location.origin` — αλλιώς `redirect_uri_mismatch` στο Google Console.
 */
export function getFunctionsOrigin(): string {
  if (import.meta.env.DEV) return getFunctionsBaseUrl();
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return getFunctionsBaseUrl();
}

/** Σταθερό public URL function — διαβάζει live από Firestore override αν υπάρχει. */
export function buildFunctionUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getFunctionsBaseUrl()}${p}`;
}
