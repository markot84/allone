import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken, type AppCheck } from 'firebase/app-check';
import { getAppConfigSync } from '../services/appConfig';

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

// ── Project-derived defaults ────────────────────────────────────────────────
// Used until `loadAppConfig()` resolves and Firestore overrides (if any) take
// effect. The default values match the production Firebase project, so the
// app is fully functional even if the `appConfig/publicConfig` doc is missing.

const DEFAULT_APP_URL = `https://${PROJECT_ID}.web.app`;
const DEFAULT_FUNCTIONS_BASE = `https://${DEFAULT_FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;

/**
 * Returns the runtime app URL: the Firestore override from `appConfig/publicConfig`
 * if loaded, otherwise the project-derived default.
 */
export function getAppUrl(): string {
  const cfg = getAppConfigSync();
  return cfg.appUrl || DEFAULT_APP_URL;
}

/**
 * Βάση για `fetch()` προς HTTP Cloud Functions.
 *
 * Σημαντικό: το **Firebase Hosting** κόβει τα requests που κάνει proxy σε function σε **~60s**.
 * Το `connectorSync` (Megaventory κ.λπ.) μπορεί να τρέχει πολλά λεπτά — πρέπει **απευθείας**
 * στο `*.cloudfunctions.net`, όχι μέσω Hosting rewrite (αλλιώς 502/504).
 */
export function getFunctionsBaseUrl(): string {
  const cfg = getAppConfigSync();
  if (cfg.functionsBaseUrl) {
    try {
      const u = new URL(cfg.functionsBaseUrl);
      const host = u.hostname.toLowerCase();
      if (!host.includes('github') && !host.includes('gist.github')) {
        return cfg.functionsBaseUrl.replace(/\/$/, '');
      }
      console.warn('[config] Ignoring suspicious functionsBaseUrl from Firestore');
    } catch {
      console.warn('[config] Ignoring invalid functionsBaseUrl from Firestore');
    }
  }
  if (cfg.functionsRegion && cfg.functionsRegion !== DEFAULT_FUNCTIONS_REGION) {
    return `https://${cfg.functionsRegion}-${PROJECT_ID}.cloudfunctions.net`;
  }
  return DEFAULT_FUNCTIONS_BASE;
}

// Back-compat constants. New code should call the getters above; these read
// the same cache but are kept so module-level expressions like
// `const REFRESH_URL = ${FUNCTIONS_BASE_URL}/refreshAggregates` keep working
// during the transition. They evaluate at first read; for code paths that
// must reflect a live Firestore override mid-session, prefer the functions.
export const APP_URL: string = DEFAULT_APP_URL;
export const FUNCTIONS_BASE_URL: string = DEFAULT_FUNCTIONS_BASE;

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
