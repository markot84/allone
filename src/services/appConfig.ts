/**
 * Runtime config sourced from Firestore at `appConfig/publicConfig` (frontend
 * URLs / region / signup mode) and `appConfig/superAdmins` (auth UID/email
 * allowlist). Seeded by `.tmp/seed-app-config.mjs` and `.tmp/seed-super-admins.mjs`.
 *
 * Bootstrap pattern:
 *   1. `firebase.ts` initialises the SDK from `.env` (the only place env vars
 *      are still read).
 *   2. `loadAppConfig()` runs once at app startup before any UI renders.
 *   3. Synchronous consumers (`getAppConfigSync`, `getPublicSignupMode`, the
 *      `APP_URL` / `FUNCTIONS_BASE_URL` getters in `firebase.ts`) read the
 *      populated cache. If the doc fetch fails the defaults are used so the
 *      app still functions.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export type PublicSignupMode = 'invite_only' | 'open';

export interface PublicAppConfig {
  appUrl: string;
  functionsRegion: string;
  functionsBaseUrl: string | null;
  interestLeadUrl: string | null;
  publicSignupMode: PublicSignupMode;
}

export interface SuperAdminsConfig {
  uids: string[];
  emails: string[];
}

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';
const DEFAULT_REGION = 'europe-west1';

const DEFAULTS: PublicAppConfig = {
  appUrl: `https://${PROJECT_ID}.web.app`,
  functionsRegion: DEFAULT_REGION,
  functionsBaseUrl: null,
  interestLeadUrl: null,
  publicSignupMode: 'invite_only',
};

let publicCache: PublicAppConfig = DEFAULTS;
let publicPromise: Promise<PublicAppConfig> | null = null;

let superAdminsCache: SuperAdminsConfig | null = null;
let superAdminsPromise: Promise<SuperAdminsConfig> | null = null;

function coerceString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function coerceStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function coerceStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

export function getAppConfigSync(): PublicAppConfig {
  return publicCache;
}

export async function loadAppConfig(): Promise<PublicAppConfig> {
  if (publicPromise) return publicPromise;
  publicPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, 'appConfig', 'publicConfig'));
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      publicCache = {
        appUrl: coerceString(data.appUrl, DEFAULTS.appUrl),
        functionsRegion: coerceString(data.functionsRegion, DEFAULTS.functionsRegion),
        functionsBaseUrl: coerceStringOrNull(data.functionsBaseUrl),
        interestLeadUrl: coerceStringOrNull(data.interestLeadUrl),
        publicSignupMode: data.publicSignupMode === 'open' ? 'open' : 'invite_only',
      };
      return publicCache;
    } catch (err) {
      console.warn('[appConfig] publicConfig fetch failed — using defaults', err);
      return publicCache;
    }
  })();
  return publicPromise;
}

export function getSuperAdminsSync(): SuperAdminsConfig {
  return superAdminsCache ?? { uids: [], emails: [] };
}

export async function loadSuperAdmins(): Promise<SuperAdminsConfig> {
  if (superAdminsCache) return superAdminsCache;
  if (superAdminsPromise) return superAdminsPromise;
  superAdminsPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, 'appConfig', 'superAdmins'));
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      superAdminsCache = {
        uids: coerceStringArray(data.uids),
        emails: coerceStringArray(data.emails).map((e) => e.toLowerCase()),
      };
      return superAdminsCache;
    } catch (err) {
      console.warn('[appConfig] superAdmins fetch failed', err);
      superAdminsCache = { uids: [], emails: [] };
      return superAdminsCache;
    }
  })();
  return superAdminsPromise;
}
