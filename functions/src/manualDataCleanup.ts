import { type Firestore, type Query } from 'firebase-admin/firestore';
import { logger } from './utils/logger';

const BATCH_SIZE = 400;
const PRESERVED_MEGAVENTORY_SOURCE = 'megaventory_custom_report';
const PRESERVED_MEGAVENTORY_RFM_SOURCE = 'megaventory_rfm';
/** SKUs from full ProductGet when the custom report covers only a subset (e.g. SQL filter). */
export const PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE = 'megaventory_api_catalog';

const BRAND_SCOPED_MANUAL_COLLECTIONS = [
  'products',
  'segments',
  'segment_customers',
  'suppliers',
  'procurement_inventory',
  'procurement_costing',
  'procurement_item_evaluation',
  'procurement_customer_evaluation',
  'procurement_pricing_policy',
  'procurement_fiscal_year',
  'procurement_statistics',
] as const;

export type ManualImportCleanupCounts = Record<string, number>;

async function deleteQueryBatch(
  db: Firestore,
  collectionPath: string,
  query: Query,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await query.limit(BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;

    if (snap.size < BATCH_SIZE) break;
  }
  logger.info(`[ManualCleanup] ${collectionPath}: deleted ${deleted}`);
  return deleted;
}

async function deleteBrandCollection(db: Firestore, collectionName: string, brandId: string): Promise<number> {
  let deleted = 0;
  const snap = await db.collection(collectionName).where('brandId', '==', brandId).get();
  const matching = snap.docs.filter((doc) => {
    const source = doc.data().source;
    return (
      source !== PRESERVED_MEGAVENTORY_SOURCE &&
      source !== PRESERVED_MEGAVENTORY_RFM_SOURCE &&
      source !== PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE
    );
  });
  for (let i = 0; i < matching.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of matching.slice(i, i + BATCH_SIZE)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, matching.length - i);
  }
  logger.info(`[ManualCleanup] ${collectionName}: deleted ${deleted} manual/non-Megaventory rows`);
  return deleted;
}

async function deleteDocumentIfExists(db: Firestore, path: string): Promise<number> {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  await ref.delete();
  logger.info(`[ManualCleanup] ${path}: deleted 1`);
  return 1;
}

async function deleteProcurementSnapshots(db: Firestore, brandId: string): Promise<ManualImportCleanupCounts> {
  const counts: ManualImportCleanupCounts = {};
  let snapshotsDeleted = 0;
  let chunksDeleted = 0;

  for (;;) {
    const snap = await db
      .collection('procurement_snapshots')
      .where('brandId', '==', brandId)
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) break;

    for (const snapshot of snap.docs) {
      chunksDeleted += await deleteQueryBatch(
        db,
        `procurement_snapshots/${snapshot.id}/chunks`,
        snapshot.ref.collection('chunks'),
      );
    }

    const batch = db.batch();
    for (const snapshot of snap.docs) {
      batch.delete(snapshot.ref);
    }
    await batch.commit();
    snapshotsDeleted += snap.size;

    if (snap.size < BATCH_SIZE) break;
  }

  counts.procurement_snapshots = snapshotsDeleted;
  counts.procurement_snapshot_chunks = chunksDeleted;
  return counts;
}

async function deleteStockSnapshots(db: Firestore, brandId: string): Promise<ManualImportCleanupCounts> {
  const daysDeleted = await deleteQueryBatch(
    db,
    `stock_snapshots/${brandId}/days`,
    db.collection(`stock_snapshots/${brandId}/days`),
  );

  await db.doc(`stock_snapshots/${brandId}`).delete().catch(() => undefined);
  return { stock_snapshot_days: daysDeleted };
}

async function deleteImportJobs(db: Firestore, brandId: string): Promise<number> {
  let deleted = 0;
  const typesToDelete = new Set(['products', 'procurement', 'segments']);
  const snap = await db.collection('import_jobs').where('brandId', '==', brandId).get();
  const matching = snap.docs.filter((doc) => typesToDelete.has(String(doc.data().type || '')));
  for (let i = 0; i < matching.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of matching.slice(i, i + BATCH_SIZE)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, matching.length - i);
  }
  logger.info(`[ManualCleanup] import_jobs: deleted ${deleted}`);
  return deleted;
}

async function deleteFeedSources(db: Firestore, brandId: string): Promise<number> {
  return deleteQueryBatch(
    db,
    'feed_sources',
    db.collection('feed_sources').where('brandId', '==', brandId),
  );
}

export async function cleanupManualImportsForMegaventoryMaster(
  db: Firestore,
  brandId: string,
): Promise<ManualImportCleanupCounts> {
  const counts: ManualImportCleanupCounts = {};

  for (const collectionName of BRAND_SCOPED_MANUAL_COLLECTIONS) {
    counts[collectionName] = await deleteBrandCollection(db, collectionName, brandId);
  }

  Object.assign(counts, await deleteProcurementSnapshots(db, brandId));

  counts.procurement_signals = await deleteDocumentIfExists(db, `procurement_signals/${brandId}`);

  counts.stock_movement = await deleteDocumentIfExists(db, `stock_movement/${brandId}`);
  Object.assign(counts, await deleteStockSnapshots(db, brandId));

  counts.import_jobs = await deleteImportJobs(db, brandId);
  counts.feed_sources = await deleteFeedSources(db, brandId);

  logger.info(`[ManualCleanup] Completed for ${brandId}: ${JSON.stringify(counts)}`);
  return counts;
}
