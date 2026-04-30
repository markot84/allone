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
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { ECOMMERCE_PROVIDERS, readPlatformStockBySku } from './ecommerceAggregator';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

/** YYYY-MM-DD σε Europe/Athens (απλοποιημένο: UTC date — αρκεί για daily granularity). */
function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateKeyDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return todayKey(d);
}

/** Διαβάζει stock από το `products` collection (import-based brands). */
async function readImportedStockBySku(db: Firestore, brandId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const snap = await db.collection('products').where('brandId', '==', brandId).get();
  for (const doc of snap.docs) {
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

  const source: 'connector' | 'import' | 'mixed' =
    connectorMap.size > 0 && importMap.size > 0
      ? 'mixed'
      : connectorMap.size > 0
      ? 'connector'
      : 'import';

  await db
    .doc(`stock_snapshots/${brandId}/days/${dateKey}`)
    .set({
      skuStockJson,
      skuCount: merged.size,
      source,
      capturedAt: FieldValue.serverTimestamp(),
    });

  logger.info(
    `[StockMovement] Snapshot captured for ${brandId} (${dateKey}): ${merged.size} SKUs, source=${source}, ${(skuStockJson.length / 1024).toFixed(1)}KB`
  );

  return { skuCount: merged.size, source, dateKey, bytesJson: skuStockJson.length };
}

interface SnapshotDoc {
  skuStockJson?: string;
  skuCount?: number;
  source?: string;
}

async function readSnapshot(db: Firestore, brandId: string, dateKey: string): Promise<Record<string, number> | null> {
  const snap = await db.doc(`stock_snapshots/${brandId}/days/${dateKey}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as SnapshotDoc;
  if (!data.skuStockJson) return null;
  try {
    return JSON.parse(data.skuStockJson) as Record<string, number>;
  } catch {
    return null;
  }
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

  const stockMovementUpdatedAt = FieldValue.serverTimestamp();
  await db.doc(`stock_movement/${brandId}`).set({
    skuMovementJson,
    skuMovementCount: allSkus.size,
    stockMovementBaselineDate: baselineDate,
    stockMovementUpdatedAt,
  });

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
