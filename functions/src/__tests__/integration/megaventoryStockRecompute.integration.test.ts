/** recomputeMegaventoryProductTotals vs the Firestore emulator: re-derives megaventory_products
 *  totals from the already-synced per-location megaventory_stock under the brand's stockLocations —
 *  filter + {0,0} zero-emit, NO Megaventory API call. Run via `npm run test:integration`. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { recomputeMegaventoryProductTotals, setDb } from '../../megaventoryConnector';

const PROJECT_ID = 'demo-test';
const BRAND = 'mv-recompute-brand';

let db: admin.firestore.Firestore;

async function seedStock(productId: string, locationId: string, availableStock: number, physicalStock: number) {
  await db.doc(`megaventory_stock/mv_stk_${productId}_${locationId}`).set({
    brandId: BRAND,
    productId,
    sku: `SKU-${productId}`,
    locationId,
    availableStock,
    physicalStock,
    source: 'megaventory_api',
  });
}

async function setFilter(stockLocations: string[] | undefined) {
  await db.doc(`connectors/${BRAND}`).set(
    { megaventory: { connected: true, ...(stockLocations ? { stockLocations } : {}) } },
    { merge: true }
  );
}

async function totals(productId: string) {
  const d = (await db.doc(`megaventory_products/mv_p_${productId}`).get()).data() || {};
  return { a: d.availableStockTotal, p: d.physicalStockTotal, s: d.stockOnHand };
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
  for (const coll of ['megaventory_stock', 'megaventory_products']) {
    const snap = await db.collection(coll).where('brandId', '==', BRAND).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }
  await db.doc(`connectors/${BRAND}`).delete().catch(() => {});
  // ΚΑΠ=18, GLYFA=26
  await seedStock('100', '18', 4, 4); // central
  await seedStock('100', '26', 1, 1); // outlet
  await seedStock('200', '26', 3, 3); // outlet only — no ΚΑΠ
  await seedStock('300', '18', 0, 7); // central, reserved: available 0 → physical fallback
});

describe('recomputeMegaventoryProductTotals (emulator)', () => {
  it('filters totals to ΚΑΠ and zero-emits products with no ΚΑΠ stock', async () => {
    await setFilter(['18']);
    const res = await recomputeMegaventoryProductTotals(BRAND);
    expect(res.products).toBe(3);
    expect(await totals('100')).toEqual({ a: 4, p: 4, s: 4 }); // outlet unit dropped
    expect(await totals('200')).toEqual({ a: 0, p: 0, s: 0 }); // no ΚΑΠ → zeroed
    expect(await totals('300')).toEqual({ a: 0, p: 7, s: 7 }); // available 0 → physical fallback
  });

  it('no filter sums every warehouse', async () => {
    await setFilter(undefined);
    await recomputeMegaventoryProductTotals(BRAND);
    expect(await totals('100')).toEqual({ a: 5, p: 5, s: 5 }); // 4 central + 1 outlet
    expect(await totals('200')).toEqual({ a: 3, p: 3, s: 3 });
  });
});
