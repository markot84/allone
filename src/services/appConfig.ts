/**
 * Super-admin allowlist sourced from Firestore at `appConfig/superAdmins`.
 * Seeded by `.tmp/seed-runtime-config.mjs`. The doc is the single source of
 * truth — read by Firestore rules (`isSuperAdmin()`), by Cloud Functions
 * (`loadSuperAdmins()`), and by the SPA to compute `isSuperAdmin`.
 *
 * Note: SPA URLs / functions region / signup mode used to live alongside
 * this list in `appConfig/publicConfig`, but those moved back to `.env`
 * (build-time substitution) to keep deploys deterministic and avoid the
 * "config is editable in the Console" surface.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { withFirestoreRetry } from './firestore';
import { logger } from '../utils/logger';

export interface SuperAdminsConfig {
  uids: string[];
  emails: string[];
}

let superAdminsCache: SuperAdminsConfig | null = null;
let superAdminsPromise: Promise<SuperAdminsConfig> | null = null;

function coerceStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

export function getSuperAdminsSync(): SuperAdminsConfig {
  return superAdminsCache ?? { uids: [], emails: [] };
}

export async function loadSuperAdmins(): Promise<SuperAdminsConfig> {
  if (superAdminsCache) return superAdminsCache;
  if (superAdminsPromise) return superAdminsPromise;
  superAdminsPromise = (async () => {
    try {
      const snap = await withFirestoreRetry(() => getDoc(doc(db, 'appConfig', 'superAdmins')));
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      superAdminsCache = {
        uids: coerceStringArray(data.uids),
        emails: coerceStringArray(data.emails).map((e) => e.toLowerCase()),
      };
      return superAdminsCache;
    } catch (err) {
      // PER-303: never cache a failed read — one transient error must not lock super admins out for the session.
      logger.warn('[appConfig] superAdmins fetch failed', { err });
      superAdminsPromise = null;
      throw err;
    }
  })();
  return superAdminsPromise;
}
