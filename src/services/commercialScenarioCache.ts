import { FirestoreService } from './firestore';

const CACHE_PREFIX = 'pp-erp-scenario-v9';
// 7 days: cached across the week (memory + localStorage + Firestore); recomputed only on period change/"Refresh".
export const SCENARIO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMOTE_COLLECTION = 'commercial_scenario_cache';

interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

// Bump when cached-row schema/filtering changes so old Firestore docs don't serve stale payload.
const REMOTE_CACHE_VERSION = 'v9';

function remoteDocId(brandId: string, fromDate: string, toDate: string): string {
  // Firestore doc id: no '/'; ISO dates are safe.
  return `${brandId}__${fromDate}__${toDate}__${REMOTE_CACHE_VERSION}`;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function buildKey(brandId: string, fromDate: string, toDate: string): string {
  return `${CACHE_PREFIX}:${brandId}:${fromDate}:${toDate}`;
}

export function readScenarioCache<T>(
  brandId: string,
  fromDate: string,
  toDate: string
): { data: T; savedAt: number } | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(buildKey(brandId, fromDate, toDate));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry?.savedAt || !entry?.data) return null;
    if (Date.now() - entry.savedAt > SCENARIO_CACHE_TTL_MS) return null;
    return { data: entry.data, savedAt: entry.savedAt };
  } catch {
    return null;
  }
}

export function writeScenarioCache<T>(
  brandId: string,
  fromDate: string,
  toDate: string,
  data: T
): number {
  const s = storage();
  const savedAt = Date.now();
  if (!s) return savedAt;
  const key = buildKey(brandId, fromDate, toDate);
  const payload = JSON.stringify({ savedAt, data });
  try {
    s.setItem(key, payload);
  } catch {
    // Quota exceeded: clear ALL old scenario entries (every brand/period) and retry.
    try {
      Object.keys(s)
        .filter((k) => k.startsWith(`${CACHE_PREFIX}:`) && k !== key)
        .forEach((k) => s.removeItem(k));
      s.setItem(key, payload);
    } catch {
      // Private-mode or still over quota - ignore.
    }
  }
  return savedAt;
}

/** Firestore-backed cache (durable, no localStorage quota); same small payload, just a cache doc. */
export async function readScenarioCacheRemote<T>(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<{ data: T; savedAt: number } | null> {
  try {
    const doc = await FirestoreService.getDocument<{ savedAt: number; data: T }>(
      REMOTE_COLLECTION,
      remoteDocId(brandId, fromDate, toDate)
    );
    if (!doc?.savedAt || !doc?.data) return null;
    if (Date.now() - doc.savedAt > SCENARIO_CACHE_TTL_MS) return null;
    return { data: doc.data, savedAt: doc.savedAt };
  } catch {
    return null;
  }
}

export async function writeScenarioCacheRemote<T>(
  brandId: string,
  fromDate: string,
  toDate: string,
  data: T
): Promise<void> {
  try {
    await FirestoreService.setDocument(REMOTE_COLLECTION, remoteDocId(brandId, fromDate, toDate), {
      brandId,
      fromDate,
      toDate,
      savedAt: Date.now(),
      data,
    });
  } catch {
    // Non-critical: if it fails (e.g. >1MB doc), localStorage remains.
  }
}

export async function clearScenarioCacheRemote(brandId: string, fromDate: string, toDate: string): Promise<void> {
  try {
    await FirestoreService.deleteDocument(REMOTE_COLLECTION, remoteDocId(brandId, fromDate, toDate));
  } catch {
    // ignore
  }
}

export function clearScenarioCache(brandId: string, fromDate?: string, toDate?: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (fromDate && toDate) {
      s.removeItem(buildKey(brandId, fromDate, toDate));
    } else {
      const prefix = `${CACHE_PREFIX}:${brandId}:`;
      Object.keys(s)
        .filter((k) => k.startsWith(prefix))
        .forEach((k) => s.removeItem(k));
    }
  } catch {
    // Storage iteration can fail in restricted modes.
  }
}
