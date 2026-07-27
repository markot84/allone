/** stockMovementTracker vs the real module + Firestore emulator: pins the `.select('sku','stock_level')`+stream projection — FAT product docs must still read stock, sum duplicate SKUs, and yield deltas.
 * Run via `npm run test:integration` (firebase emulators:exec wraps this). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { captureStockSnapshot, computeStockMovement, setDb } from '../../stockMovementTracker';

const PROJECT_ID = 'demo-test';
const BRAND = 'sm-test-brand';

let db: admin.firestore.Firestore;

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function seedProduct(id: string, sku: string, stock: number) {
  await db.doc(`products/${id}`).set({
    brandId: BRAND,
    sku,
    stock_level: stock,
    // fat fields the projection must NOT need to download
    name: `Product ${sku}`,
    description: 'x'.repeat(2000),
    category: 'Tennis Shoes',
    metrics: { views: 1, sales: 2, longTail: 'y'.repeat(500) },
  });
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
  setDb(db);
});

afterAll(async () => {
  await admin.app().delete();
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection(`stock_snapshots/${BRAND}/days`));
  await db.recursiveDelete(db.collection(`stock_movement/${BRAND}/chunks`));
  const prods = await db.collection('products').where('brandId', '==', BRAND).get();
  for (const d of prods.docs) await d.ref.delete();
});

describe('stockMovementTracker (real module, projected reads)', () => {
  it('captures a snapshot from fat product docs and sums duplicate SKUs', async () => {
    await seedProduct('p1', 'SKU-A', 10);
    await seedProduct('p2', 'SKU-B', 4);
    await seedProduct('p3', 'SKU-B', 6); // duplicate SKU (variant) → summed
    await seedProduct('p4', '', 99); // no sku → skipped

    const res = await captureStockSnapshot(BRAND);

    expect(res.skuCount).toBe(2);
    expect(res.source).toBe('import');
    const chunks = await db.collection(`stock_snapshots/${BRAND}/days/${res.dateKey}/chunks`).get();
    const merged = Object.assign(
      {},
      ...chunks.docs.map((d) => JSON.parse(d.data().skuStockJson as string)),
    );
    expect(merged).toEqual({ 'SKU-A': 10, 'SKU-B': 10 });
  });

  it('computes movement deltas vs a 7-day-old snapshot', async () => {
    await seedProduct('p1', 'SKU-A', 7); // was 10 → dec7d = 3
    await seedProduct('p2', 'SKU-B', 12); // was 10 → restock → dec7d = 0

    // seed the 7d-ago baseline snapshot in the chunked format
    const oldKey = ymdDaysAgo(7);
    await db
      .doc(`stock_snapshots/${BRAND}/days/${oldKey}/chunks/0`)
      .set({ skuStockJson: JSON.stringify({ 'SKU-A': 10, 'SKU-B': 10 }), keyCount: 2 });
    await db
      .doc(`stock_snapshots/${BRAND}/days/${oldKey}`)
      .set({ stockSnapshotChunkCount: 1, skuCount: 2, source: 'import' });

    await captureStockSnapshot(BRAND);
    const res = await computeStockMovement(BRAND);

    expect(res.skuCount).toBe(2);
    expect(res.windowsAvailable.d7).toBe(true);
    const chunks = await db.collection(`stock_movement/${BRAND}/chunks`).get();
    const movement = Object.assign(
      {},
      ...chunks.docs.map((d) => JSON.parse(d.data().skuMovementJson as string)),
    );
    expect(movement['SKU-A'].dec7d).toBe(3);
    expect(movement['SKU-B'].dec7d).toBe(0);
  });

  it('excludes discontinued products from snapshots AND the movement union (no fake sale on deletion)', async () => {
    await seedProduct('p1', 'SKU-A', 7); // live: was 10 → dec7d = 3
    await seedProduct('p2', 'SKU-B', 0); // discontinued with stock zeroed — was 10 in the baseline
    await db.doc('products/p2').set({ discontinued_at: new Date().toISOString() }, { merge: true });

    // baseline snapshot from before the deletion — contains BOTH SKUs
    const oldKey = ymdDaysAgo(7);
    await db
      .doc(`stock_snapshots/${BRAND}/days/${oldKey}/chunks/0`)
      .set({ skuStockJson: JSON.stringify({ 'SKU-A': 10, 'SKU-B': 10 }), keyCount: 2 });
    await db
      .doc(`stock_snapshots/${BRAND}/days/${oldKey}`)
      .set({ stockSnapshotChunkCount: 1, skuCount: 2, source: 'import' });

    const cap = await captureStockSnapshot(BRAND);
    expect(cap.skuCount).toBe(1); // SKU-B excluded from today's snapshot entirely

    const res = await computeStockMovement(BRAND);
    expect(res.skuCount).toBe(1);
    const chunks = await db.collection(`stock_movement/${BRAND}/chunks`).get();
    const movement = Object.assign(
      {},
      ...chunks.docs.map((d) => JSON.parse(d.data().skuMovementJson as string)),
    );
    expect(movement['SKU-A'].dec7d).toBe(3);
    // the deleted product produced NO movement entry — without the union exclusion this would
    // read dec7d = 10 (baseline 10 → absent today), i.e. a fabricated 10-unit "sale"
    expect(movement['SKU-B']).toBeUndefined();
  });
});
