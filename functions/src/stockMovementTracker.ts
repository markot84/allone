/** Per-SKU stock velocity tracker: daily snapshot per brand → deltas at stock_movement/{brandId}.
 *  Deltas are net of returns/cancellations (returns raise stock, reducing the dec window) by design. */

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

/** YYYY-MM-DD (simplified: UTC date — sufficient for daily granularity). */
function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateKeyDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return todayKey(d);
}

/** Tracks size INCREMENTALLY (stringify only each added entry); re-stringifying the whole bucket per
 *  insert was quadratic. Exported for the unit test that pins this from regressing. */
export function chunkRecord<T>(record: Record<string, T>): Record<string, T>[] {
  const chunks: Record<string, T>[] = [];
  let bucket: Record<string, T> = {};
  let bucketCount = 0;
  let bucketBytes = 2; // '{}'
  for (const [key, value] of Object.entries(record)) {
    // ~bytes this entry adds when serialized: "key":<value>, (separator counted via +1)
    const entryBytes =
      Buffer.byteLength(JSON.stringify(key)) + 1 + Buffer.byteLength(JSON.stringify(value)) + 1;
    if (bucketCount > 0 && bucketBytes + entryBytes > JSON_CHUNK_TARGET_BYTES) {
      chunks.push(bucket);
      bucket = {};
      bucketCount = 0;
      bucketBytes = 2;
    }
    bucket[key] = value;
    bucketCount++;
    bucketBytes += entryBytes;
  }
  if (bucketCount > 0) chunks.push(bucket);
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

/** Per-(sku, location) stock for a day: sku → locationId → {a: available, p: physical}. */
export type PerLocationSnapshot = Record<string, Record<string, { a: number; p: number }>>;

/** Brand warehouse filter from connectors/{brandId}.megaventory.stockLocations; null = all warehouses.
 *  Mirrors the connector's includedStockLocationIds so snapshot folding matches the live roll-up. */
export function parseStockLocationsFilter(megaventory: unknown): Set<string> | null {
  const raw = (megaventory as { stockLocations?: unknown } | undefined)?.stockLocations;
  if (!Array.isArray(raw)) return null;
  const ids = raw.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
  return ids.length ? new Set(ids) : null;
}

/** Fold a per-location snapshot down to sku → effective stock, honoring a warehouse filter (null =
 *  all). Sums available + physical over the selected locations, then effective = available>0 ?
 *  available : physical — IDENTICAL to the connector's rollUpStockTotalsByProduct/stockOnHand, so a
 *  folded snapshot matches products.stock_level for the same selection. */
export function foldPerLocationSnapshot(rec: PerLocationSnapshot, filter: Set<string> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sku of Object.keys(rec)) {
    let a = 0;
    let p = 0;
    const locs = rec[sku];
    for (const loc of Object.keys(locs)) {
      if (filter && !filter.has(loc)) continue;
      a += locs[loc]?.a || 0;
      p += locs[loc]?.p || 0;
    }
    out[sku] = Math.round(a > 0 ? a : p);
  }
  return out;
}

/** Reads stock from the `products` collection (import-based brands). Uses `.select()` projection +
 *  stream to avoid downloading whole product-intelligence docs for 2 fields and materializing in memory. */
async function readImportedStockBySku(
  db: Firestore,
  brandId: string
): Promise<{ stock: Map<string, number>; discontinued: Set<string> }> {
  const stock = new Map<string, number>();
  const discontinued = new Set<string>();
  const query = db
    .collection('products')
    .where('brandId', '==', brandId)
    .select('sku', 'stock_level', 'discontinued_at');
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    const sku = String(d.sku || '').trim();
    if (!sku) continue;
    // Discontinued products (ERP-deleted, kept with stock 0) are EXCLUDED: otherwise zeroing their
    // stock registers as an N-unit "sale" and pollutes velocity/procurement signals.
    if (d.discontinued_at) {
      discontinued.add(sku);
      continue;
    }
    const qty = typeof d.stock_level === 'number' ? d.stock_level : 0;
    // Allow multiple docs with the same SKU (variants) — sum them.
    stock.set(sku, (stock.get(sku) || 0) + qty);
  }
  return { stock, discontinued };
}

/** SKUs marked discontinued — excluded from the snapshot union (old snapshots keep them ~90 days). */
async function readDiscontinuedSkus(db: Firestore, brandId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const query = db
    .collection('products')
    .where('brandId', '==', brandId)
    .select('sku', 'discontinued_at');
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    const sku = String(d.sku || '').trim();
    if (sku && d.discontinued_at) out.add(sku);
  }
  return out;
}

/** Reads raw per-(sku, location) stock from megaventory_stock (unfiltered — every warehouse), so the
 *  snapshot stays faithful to the connector and any stockLocations selection folds at read time. */
async function readMegaventoryStockByLocation(db: Firestore, brandId: string): Promise<PerLocationSnapshot> {
  const out: PerLocationSnapshot = {};
  const query = db
    .collection('megaventory_stock')
    .where('brandId', '==', brandId)
    .select('sku', 'locationId', 'availableStock', 'physicalStock');
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    const sku = String(d.sku || '').trim();
    const loc = String(d.locationId || '').trim();
    if (!sku || !loc) continue;
    const a = typeof d.availableStock === 'number' ? d.availableStock : 0;
    const p = typeof d.physicalStock === 'number' ? d.physicalStock : 0;
    if (a === 0 && p === 0) continue; // skip empty cells — keeps the snapshot bounded
    const bySku = (out[sku] ??= {});
    const cur = (bySku[loc] ??= { a: 0, p: 0 });
    cur.a += a;
    cur.p += p;
  }
  return out;
}

/** ERP per-location snapshot (Megaventory): stores sku → {loc: {a,p}} so history is correct under any
 *  warehouse selection, now and after future flips. */
async function captureMegaventoryPerLocationSnapshot(
  db: Firestore,
  brandId: string,
  dateKey: string
): Promise<{ skuCount: number; source: 'connector' | 'import' | 'mixed' | 'none'; dateKey: string; bytesJson: number }> {
  const perLoc = await readMegaventoryStockByLocation(db, brandId);
  // Discontinued SKUs never enter the snapshot (else their later zeroing looks like a sale).
  for (const sku of await readDiscontinuedSkus(db, brandId)) delete perLoc[sku];

  const rounded: PerLocationSnapshot = {};
  for (const sku of Object.keys(perLoc)) {
    const locs = perLoc[sku];
    const rec: Record<string, { a: number; p: number }> = {};
    for (const loc of Object.keys(locs)) rec[loc] = { a: Math.round(locs[loc].a), p: Math.round(locs[loc].p) };
    rounded[sku] = rec;
  }
  const skuCount = Object.keys(rounded).length;
  if (skuCount === 0) {
    logger.info(`[StockMovement] No megaventory_stock for ${brandId} — skipping per-location snapshot`);
    return { skuCount: 0, source: 'none', dateKey, bytesJson: 0 };
  }
  const json = JSON.stringify(rounded);
  const chunkCount = await writeJsonChunks(
    db,
    `stock_snapshots/${brandId}/days/${dateKey}/chunks`,
    'skuLocationStockJson',
    rounded
  );
  await db.doc(`stock_snapshots/${brandId}/days/${dateKey}`).set(
    {
      perLocation: true,
      skuStockJson: FieldValue.delete(), // clear any legacy flat payload from an earlier capture today
      stockSnapshotChunkCount: chunkCount,
      skuCount,
      source: 'connector',
      capturedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info(
    `[StockMovement] Per-location snapshot for ${brandId} (${dateKey}): ${skuCount} SKUs, ${(json.length / 1024).toFixed(1)}KB`
  );
  return { skuCount, source: 'connector', dateKey, bytesJson: json.length };
}

/** Captures the current stock snapshot for a brand; idempotent per day (overwrites the same doc). */
export async function captureStockSnapshot(brandId: string): Promise<{
  skuCount: number;
  source: 'connector' | 'import' | 'mixed' | 'none';
  dateKey: string;
  bytesJson: number;
}> {
  const db = getDb();
  const dateKey = todayKey();

  // 1) Connector platforms (if any)
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const connData = connDoc.data() || {};
  // Megaventory brands: capture per-location so any warehouse (stockLocations) selection folds
  // correctly — both now and after future flips. Other brands keep the flat sku→total snapshot.
  if ((connData.megaventory as { connected?: boolean } | undefined)?.connected) {
    return captureMegaventoryPerLocationSnapshot(db, brandId, dateKey);
  }
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

  // 2) Import-based stock (always read — covers connector-less brands and catalog-only SKUs).
  const { stock: importMap, discontinued } = await readImportedStockBySku(db, brandId);

  // Combine: connector value takes priority when present.
  const merged = new Map<string, number>(importMap);
  for (const [sku, qty] of connectorMap.entries()) merged.set(sku, qty);
  // Discontinued SKUs NEVER enter the snapshot (not even from connector platforms).
  for (const sku of discontinued) merged.delete(sku);

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
  perLocation?: boolean;
}

/** Reads a day's snapshot folded to sku → effective stock. Per-location snapshots fold with `filter`
 *  (so a warehouse flip re-folds all of history); legacy flat snapshots return as stored (their
 *  location dimension was already collapsed — they self-heal as they age out of the windows). */
async function readSnapshot(
  db: Firestore,
  brandId: string,
  dateKey: string,
  filter: Set<string> | null
): Promise<Record<string, number> | null> {
  const snap = await db.doc(`stock_snapshots/${brandId}/days/${dateKey}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as SnapshotDoc;
  if (data.perLocation) {
    if (!data.stockSnapshotChunkCount) return null;
    const rec = await readJsonChunks<Record<string, { a: number; p: number }>>(
      db,
      `stock_snapshots/${brandId}/days/${dateKey}/chunks`,
      'skuLocationStockJson'
    );
    return rec ? foldPerLocationSnapshot(rec, filter) : null;
  }
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

/** Finds the closest snapshot to a target date, preferring the nearest older one within tolerance. */
async function findClosestSnapshot(
  db: Firestore,
  brandId: string,
  targetDateKey: string,
  toleranceDays = 3,
  filter: Set<string> | null = null
): Promise<{ dateKey: string; data: Record<string, number> } | null> {
  // Try exact match first
  const exact = await readSnapshot(db, brandId, targetDateKey, filter);
  if (exact) return { dateKey: targetDateKey, data: exact };

  // Search ± tolerance days around target (preferred: older = "cleaner" baseline)
  for (let offset = 1; offset <= toleranceDays; offset++) {
    // Look backwards first (older snapshot = "safer" baseline)
    const target = new Date(targetDateKey + 'T00:00:00Z');
    const earlier = new Date(target);
    earlier.setUTCDate(earlier.getUTCDate() - offset);
    const earlierKey = todayKey(earlier);
    const earlierData = await readSnapshot(db, brandId, earlierKey, filter);
    if (earlierData) return { dateKey: earlierKey, data: earlierData };

    const later = new Date(target);
    later.setUTCDate(later.getUTCDate() + offset);
    const laterKey = todayKey(later);
    const laterData = await readSnapshot(db, brandId, laterKey, filter);
    if (laterData) return { dateKey: laterKey, data: laterData };
  }
  return null;
}

interface MovementEntry {
  dec7d?: number;
  dec30d?: number;
  dec90d?: number;
}

/** Computes stock movement deltas from snapshots and stores them at ecommerce_summary/{brandId}. */
export async function computeStockMovement(brandId: string): Promise<{
  skuCount: number;
  baselineDate: string | null;
  windowsAvailable: { d7: boolean; d30: boolean; d90: boolean };
}> {
  const db = getDb();
  const todayKeyStr = todayKey();

  // Current warehouse selection — folds every per-location snapshot to the same basis, so today vs
  // baseline deltas (and thus velocity) are warehouse-consistent and re-fold on any future flip.
  const connData = (await db.doc(`connectors/${brandId}`).get()).data() || {};
  const locFilter = parseStockLocationsFilter(connData.megaventory);

  const todayData = await readSnapshot(db, brandId, todayKeyStr, locFilter);
  if (!todayData) {
    // No snapshot for today — try capturing first.
    logger.warn(`[StockMovement] No today snapshot for ${brandId} — skipping movement computation`);
    return { skuCount: 0, baselineDate: null, windowsAvailable: { d7: false, d30: false, d90: false } };
  }

  const snap7 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(7), 3, locFilter);
  const snap30 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(30), 5, locFilter);
  const snap90 = await findClosestSnapshot(db, brandId, dateKeyDaysAgo(90), 10, locFilter);

  // Find earliest snapshot for "lifetime tracking" baseline
  const allSnapshots = await db
    .collection(`stock_snapshots/${brandId}/days`)
    .orderBy(admin.firestore.FieldPath.documentId(), 'asc')
    .limit(1)
    .get();
  const baselineDate = allSnapshots.empty ? null : allSnapshots.docs[0].id;

  const movement: Record<string, MovementEntry> = {};
  // Include all SKUs that appear in ANY snapshot — this enables the
  // "never sold" filter when stock has stayed the same.
  const allSkus = new Set<string>([
    ...Object.keys(todayData),
    ...(snap7 ? Object.keys(snap7.data) : []),
    ...(snap30 ? Object.keys(snap30.data) : []),
    ...(snap90 ? Object.keys(snap90.data) : []),
  ]);
  // Discontinued SKUs dropped from the union — they persist in baseline snapshots (~90 days), so
  // their absence from today's snapshot would otherwise count as a fake N-unit "sale".
  const discontinuedNow = await readDiscontinuedSkus(db, brandId);
  for (const sku of discontinuedNow) allSkus.delete(sku);

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

/** Convenience: capture + compute in one call. */
export async function refreshStockMovement(brandId: string): Promise<void> {
  await captureStockSnapshot(brandId);
  await computeStockMovement(brandId);
}
