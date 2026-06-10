/**
 * Stock Movement Tracker
 *
 * Καθολικός μηχανισμός παρακολούθησης κινητικότητας αποθεμάτων ανά SKU.
 * Λειτουργεί για όλα τα brands ανεξάρτητα από connector:
 *   - Brands με ecommerce connector → διαβάζει stock από magento_products / shopify_products κλπ.
 *   - Brands μόνο με imports → διαβάζει stock_level από το `products` collection.
 *
 * Καταγράφει daily snapshot ανά brand (ένα doc/ημέρα) σε:
 *   stock_snapshots/{brandId}/days/{YYYY-MM-DD}
 *     { skuStockJson, skuCount, capturedAt, source }
 *
 * Υπολογίζει deltas (μειώσεις = πωλήσεις net of returns) και τα αποθηκεύει στο
 *   stock_movement/{brandId}.skuMovementJson  →  { sku: { dec7d, dec30d, dec90d } }
 * Το ecommerce_summary κρατά μόνο metadata για να μην ξεπερνά το Firestore 1MB doc limit.
 *
 * Σχεδιαστική σημείωση: τα deltas είναι "net of returns/cancellations" — αν
 * επιστραφεί ένα προϊόν, το stock ανεβαίνει και μειώνει το dec_window. Αυτό
 * είναι feature, όχι bug: εκφράζει πραγματική κινητικότητα.
 */

import * as admin from 'firebase-admin';
import { type Firestore, type QueryDocumentSnapshot, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ECOMMERCE_PROVIDERS, readPlatformStockBySku } from './ecommerceAggregator';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const JSON_CHUNK_TARGET_BYTES = 850_000;
const DELETE_BATCH_SIZE = 400;

/** YYYY-MM-DD σε Europe/Athens (απλοποιημένο: UTC date — αρκεί για daily granularity). */
function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateKeyDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return todayKey(d);
}

function chunkRecord<T>(record: Record<string, T>): Record<string, T>[] {
  const chunks: Record<string, T>[] = [];
  let bucket: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    bucket[key] = value;
    if (JSON.stringify(bucket).length > JSON_CHUNK_TARGET_BYTES) {
      delete bucket[key];
      if (Object.keys(bucket).length > 0) chunks.push(bucket);
      bucket = { [key]: value };
    }
  }
  if (Object.keys(bucket).length > 0) chunks.push(bucket);
  return chunks.length ? chunks : [{}];
}

async function deleteChunkCollection(db: Firestore, collectionPath: string): Promise<void> {
  for (;;) {
    const snap = await db.collection(collectionPath).limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
}

async function writeJsonChunks<T>(
  db: Firestore,
  collectionPath: string,
  fieldName: string,
  record: Record<string, T>
): Promise<number> {
  await deleteChunkCollection(db, collectionPath);
  const chunks = chunkRecord(record);
  for (let i = 0; i < chunks.length; i += 500) {
    const batch = db.batch();
    chunks.slice(i, i + 500).forEach((chunk, offset) => {
      batch.set(db.collection(collectionPath).doc(String(i + offset)), {
        [fieldName]: JSON.stringify(chunk),
        keyCount: Object.keys(chunk).length,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  return chunks.length;
}

async function readJsonChunks<T>(
  db: Firestore,
  collectionPath: string,
  fieldName: string
): Promise<Record<string, T> | null> {
  const snap = await db.collection(collectionPath).get();
  if (snap.empty) return null;
  const merged: Record<string, T> = {};
  for (const doc of snap.docs.sort((a, b) => Number(a.id) - Number(b.id))) {
    const raw = doc.data()[fieldName];
    if (typeof raw !== 'string' || !raw) continue;
    try {
      Object.assign(merged, JSON.parse(raw) as Record<string, T>);
    } catch {
      logger.warn(`[StockMovement] Corrupt JSON chunk ${collectionPath}/${doc.id}`);
    }
  }
  return Object.keys(merged).length ? merged : null;
}

/**
 * Διαβάζει stock από το `products` collection (import-based brands).
 *
 * PER-60 perf: `.select('sku','stock_level')` + stream — ΧΩΡΙΣ projection η query κατέβαζε ΟΛΟΚΛΗΡΑ
 * τα (παχιά) product-intelligence docs μόνο για 2 πεδία: σε 88k SKUs (e-tennis) αυτό ήταν ~20+ λεπτά
 * I/O και κόντευε το 30min hard cap του worker. Με projection: ίδια σημασιολογία, ~sec αντί λεπτά,
 * και το stream αποφεύγει να υλοποιήσει όλο το QuerySnapshot στη μνήμη καθώς ο κατάλογος μεγαλώνει.
 */
async function readImportedStockBySku(db: Firestore, brandId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const query = db
    .collection('products')
    .where('brandId', '==', brandId)
    .select('sku', 'stock_level');
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    const sku = String(d.sku || '').trim();
    if (!sku) continue;
    const qty = typeof d.stock_level === 'number' ? d.stock_level : 0;
    // Επιτρέπει πολλαπλά docs με ίδιο SKU (variants) — άθροιση.
    out.set(sku, (out.get(sku) || 0) + qty);
  }
  return out;
}

/**
 * Καταγράφει το τρέχον stock snapshot για ένα brand. Idempotent ανά ημέρα
 * (overwrite του ίδιου doc). Επιστρέφει πληροφορίες για logging/UI.
 */
export async function captureStockSnapshot(brandId: string): Promise<{
  skuCount: number;
  source: 'connector' | 'import' | 'mixed' | 'none';
  dateKey: string;
  bytesJson: number;
}> {
  const db = getDb();
  const dateKey = todayKey();

  // 1) Connector platforms (αν υπάρχουν)
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const connData = connDoc.data() || {};
  const connectedPlatforms = ECOMMERCE_PROVIDERS.filter((p) => connData[p]?.connected);

  let connectorMap = new Map<string, number>();
  if (connectedPlatforms.length > 0) {
    const arrays = await Promise.all(
      connectedPlatforms.map((p) => readPlatformStockBySku(db, brandId, p))
    );
    for (const m of arrays) {
      for (const [sku, qty] of m.entries()) {
        connectorMap.set(sku, (connectorMap.get(sku) || 0) + qty);
      }
    }
  }

  // 2) Import-based stock (πάντα διαβάζεται — covers brands χωρίς connector
  // και SKUs που υπάρχουν μόνο στο catalog).
  const importMap = await readImportedStockBySku(db, brandId);

  // Συνδυασμός: connector value προτεραιότητα αν υπάρχει.
  const merged = new Map<string, number>(importMap);
  for (const [sku, qty] of connectorMap.entries()) merged.set(sku, qty);

  if (merged.size === 0) {
    logger.info(`[StockMovement] No stock data found for brand ${brandId} — skipping snapshot`);
    return { skuCount: 0, source: 'none', dateKey, bytesJson: 0 };
  }

  const skuStock: Record<string, number> = {};
  for (const [sku, qty] of merged.entries()) {
    skuStock[sku] = Math.round(qty);
  }
  const skuStockJson = JSON.stringify(skuStock);
  const stockSnapshotChunkCount = await writeJsonChunks(
    db,
    `stock_snapshots/${brandId}/days/${dateKey}/chunks`,
    'skuStockJson',
    skuStock
  );

  const source: 'connector' | 'import' | 'mixed' =
    connectorMap.size > 0 && importMap.size > 0
      ? 'mixed'
      : connectorMap.size > 0
      ? 'connector'
      : 'import';

  await db
    .doc(`stock_snapshots/${brandId}/days/${dateKey}`)
    .set(
      {
        skuStockJson: FieldValue.delete(),
        stockSnapshotChunkCount,
        skuCount: merged.size,
        source,
        capturedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  logger.info(
    `[StockMovement] Snapshot captured for ${brandId} (${dateKey}): ${merged.size} SKUs, source=${source}, ${(skuStockJson.length / 1024).toFixed(1)}KB`
  );

  return { skuCount: merged.size, source, dateKey, bytesJson: skuStockJson.length };
}

interface SnapshotDoc {
  skuStockJson?: string;
  stockSnapshotChunkCount?: number;
  skuCount?: number;
  source?: string;
}

async function readSnapshot(db: Firestore, brandId: string, dateKey: string): Promise<Record<string, number> | null> {
  const snap = await db.doc(`stock_snapshots/${brandId}/days/${dateKey}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as SnapshotDoc;
  if (data.skuStockJson) {
    try {
      return JSON.parse(data.skuStockJson) as Record<string, number>;
    } catch {
      return null;
    }
  }
  if (!data.stockSnapshotChunkCount) return null;
  return readJsonChunks<number>(db, `stock_snapshots/${brandId}/days/${dateKey}/chunks`, 'skuStockJson');
}

/**
 * Βρίσκει το πιο κοντινό snapshot σε μια ημερομηνία στόχο.
 * Επιστρέφει το πλησιέστερο snapshot με ημερομηνία <= targetDateKey
 * (αν δεν υπάρχει ακριβές match, παίρνει το παλαιότερο που είναι >= targetDateKey - tolerance).
 */
async function findClosestSnapshot(
  db: Firestore,
  brandId: string,
  targetDateKey: string,
  toleranceDays = 3
): Promise<{ dateKey: string; data: Record<string, number> } | null> {
  // Try exact match first
  const exact = await readSnapshot(db, brandId, targetDateKey);
  if (exact) return { dateKey: targetDateKey, data: exact };

  // Search ± tolerance days γύρω από target (preferred: παλαιότερο = πιο "καθαρή" baseline)
  for (let offset = 1; offset <= toleranceDays; offset++) {
    // Πρώτα κοιτάζουμε προς τα πίσω (πιο παλιό snapshot = πιο "ασφαλές" baseline)
    const target = new Date(targetDateKey + 'T00:00:00Z');
    const earlier = new Date(target);
    earlier.setUTCDate(earlier.getUTCDate() - offset);
    const earlierKey = todayKey(earlier);
    const earlierData = await readSnapshot(db, brandId, earlierKey);
    if (earlierData) return { dateKey: earlierKey, data: earlierData };

    const later = new Date(target);
    later.setUTCDate(later.getUTCDate() + offset);
    const laterKey = todayKey(later);
    const laterData = await readSnapshot(db, brandId, laterKey);
    if (laterData) return { dateKey: laterKey, data: laterData };
  }
  return null;
}

interface MovementEntry {
  dec7d?: number;
  dec30d?: number;
  dec90d?: number;
}

/**
 * Υπολογίζει stock movement deltas από snapshots και τα αποθηκεύει στο
 * ecommerce_summary/{brandId}.
 */
export async function computeStockMovement(brandId: string): Promise<{
  skuCount: number;
  baselineDate: string | null;
  windowsAvailable: { d7: boolean; d30: boolean; d90: boolean };
}> {
  const db = getDb();
  const todayKeyStr = todayKey();

  const todayData = await readSnapshot(db, brandId, todayKeyStr);
  if (!todayData) {
    // Δεν υπάρχει σημερινό snapshot — προσπάθησε να κάνεις capture πρώτα.
    logger.warn(`[StockMovement] No today snapshot for ${brandId} — skipping movement computation`);
    return { skuCount: 0, baselineDate: null, windowsAvailable: { d7: false, d30: false, d90: false } };
  }

  const snap7 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(7), 3);
  const snap30 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(30), 5);
  const snap90 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(90), 10);

  // Find earliest snapshot for "lifetime tracking" baseline
  const allSnapshots = await db
    .collection(`stock_snapshots/${brandId}/days`)
    .orderBy(admin.firestore.FieldPath.documentId(), 'asc')
    .limit(1)
    .get();
  const baselineDate = allSnapshots.empty ? null : allSnapshots.docs[0].id;

  const movement: Record<string, MovementEntry> = {};
  // Συμπεριλαμβάνουμε όλα τα SKUs που εμφανίζονται σε ΟΠΟΙΟΔΗΠΟΤΕ snapshot —
  // αυτό επιτρέπει filter "never sold" όταν το stock έχει μείνει ίδιο.
  const allSkus = new Set<string>([
    ...Object.keys(todayData),
    ...(snap7 ? Object.keys(snap7.data) : []),
    ...(snap30 ? Object.keys(snap30.data) : []),
    ...(snap90 ? Object.keys(snap90.data) : []),
  ]);

  for (const sku of allSkus) {
    const now = todayData[sku] ?? 0;
    const entry: MovementEntry = {};
    if (snap7) {
      const old = snap7.data[sku] ?? 0;
      entry.dec7d = Math.max(0, old - now);
    }
    if (snap30) {
      const old = snap30.data[sku] ?? 0;
      entry.dec30d = Math.max(0, old - now);
    }
    if (snap90) {
      const old = snap90.data[sku] ?? 0;
      entry.dec90d = Math.max(0, old - now);
    }
    movement[sku] = entry;
  }

  const skuMovementJson = JSON.stringify(movement);
  const stockMovementChunkCount = await writeJsonChunks(
    db,
    `stock_movement/${brandId}/chunks`,
    'skuMovementJson',
    movement
  );

  const stockMovementUpdatedAt = FieldValue.serverTimestamp();
  await db.doc(`stock_movement/${brandId}`).set(
    {
      skuMovementJson: FieldValue.delete(),
      stockMovementChunkCount,
      skuMovementCount: allSkus.size,
      stockMovementBaselineDate: baselineDate,
      stockMovementUpdatedAt,
    },
    { merge: true }
  );

  await db.doc(`ecommerce_summary/${brandId}`).set(
    {
      skuMovementJson: FieldValue.delete(),
      skuMovementCount: allSkus.size,
      stockMovementBaselineDate: baselineDate,
      stockMovementUpdatedAt,
    },
    { merge: true }
  );

  logger.info(
    `[StockMovement] Movement computed for ${brandId}: ${allSkus.size} SKUs, baseline=${baselineDate}, windows={7d:${!!snap7},30d:${!!snap30},90d:${!!snap90}}`
  );

  return {
    skuCount: allSkus.size,
    baselineDate,
    windowsAvailable: { d7: !!snap7, d30: !!snap30, d90: !!snap90 },
  };
}

/** Convenience: capture + compute σε ένα call. */
export async function refreshStockMovement(brandId: string): Promise<void> {
  await captureStockSnapshot(brandId);
  await computeStockMovement(brandId);
}
