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

// Only env the SPA reads: six SDK keys + App Check site key; rest loads from
// `appConfig/publicConfig` (services/appConfig.ts at startup).
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

// App Check: enabled when VITE_RECAPTCHA_V3_SITE_KEY set; debug via localStorage 'pp:appcheck-debug'='1' then reload.
// Firestore/Auth SDKs attach the token automatically; HTTP Functions use `getAppCheckHeader()` below.
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

/** Returns `X-Firebase-AppCheck` header if an active instance exists, otherwise {} */
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

// Memory cache (not IndexedDB persistence): a locked/stalled IndexedDB could hang reads; first-paint is covered by React Query localStorage persist.
// Auto long-polling avoids WebChannel streaming being blocked by proxies/extensions.
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

// Project-derived defaults: values from .env (VITE_*) with project-derived
// fallbacks; env vars keep deploys deterministic.

const ENV_REGION = (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined)?.trim();
const FUNCTIONS_REGION = ENV_REGION || DEFAULT_FUNCTIONS_REGION;

const DEFAULT_APP_URL = `https://${PROJECT_ID}.web.app`;
const DEFAULT_FUNCTIONS_BASE = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;

export function getAppUrl(): string {
  const envUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.trim();
  return envUrl || DEFAULT_APP_URL;
}

/** Base for `fetch()` to HTTP Cloud Functions. Hosting proxies cut off at ~60s, so long
 * runs like `connectorSync` (Megaventory etc.) must hit `*.cloudfunctions.net` directly (else 502/504). */
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

/** Legacy/misc origin helper. For OAuth `redirect_uri` use `getFunctionsBaseUrl()` + `/connectorCallback`
 * (same host as `connectorAuth`), not `window.location.origin` — else `redirect_uri_mismatch` in Google Console. */
export function getFunctionsOrigin(): string {
  if (import.meta.env.DEV) return getFunctionsBaseUrl();
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return getFunctionsBaseUrl();
}

/** Stable public function URL — reads a live Firestore override if present. */
export function buildFunctionUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getFunctionsBaseUrl()}${p}`;
}
