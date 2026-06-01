import { FirestoreService } from './firestore';

const CACHE_PREFIX = 'pp-erp-scenario-v6';
// 7 ημέρες: ο χρήστης μπαινοβγαίνει στη σελίδα όλη την εβδομάδα — τα δεδομένα παραμένουν αποθηκευμένα
// (μνήμη + localStorage + Firestore) και ξαναϋπολογίζονται μόνο σε αλλαγή περιόδου ή «Ανανέωση».
export const SCENARIO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMOTE_COLLECTION = 'commercial_scenario_cache';

interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

function remoteDocId(brandId: string, fromDate: string, toDate: string): string {
  // Firestore doc id: χωρίς '/'· οι ISO ημερομηνίες είναι ασφαλείς.
  return `${brandId}__${fromDate}__${toDate}`;
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
    // Quota exceeded: καθάρισε ΟΛΑ τα παλιά scenario entries (κάθε brand/period) και ξαναδοκίμασε,
    // ώστε να επιβιώνει το cache του τρέχοντος period μεταξύ reloads αντί να χάνεται σιωπηλά.
    try {
      Object.keys(s)
        .filter((k) => k.startsWith(`${CACHE_PREFIX}:`) && k !== key)
        .forEach((k) => s.removeItem(k));
      s.setItem(key, payload);
    } catch {
      // Private-mode ή ακόμη πάνω από quota — αγνόησε.
    }
  }
  return savedAt;
}

/**
 * Firestore-backed cache (durable across reloads/συσκευές, χωρίς localStorage quota).
 * Κρατά το ίδιο μικρό payload με το localStorage. Δεν είναι server compute — απλό cache doc.
 */
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
    // Μη-κρίσιμο: αν αποτύχει (π.χ. >1MB doc), μένει το localStorage.
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
