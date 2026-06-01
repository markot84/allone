const CACHE_PREFIX = 'pp-erp-scenario-v6';
export const SCENARIO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  savedAt: number;
  data: T;
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
  try {
    s.setItem(buildKey(brandId, fromDate, toDate), JSON.stringify({ savedAt, data }));
  } catch {
    // Ignore quota/private-mode failures.
  }
  return savedAt;
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
