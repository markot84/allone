/** #8: the PI stock overlay reads pre-summed totals from megaventory_products (availableStockTotal/
 *  physicalStockTotal — already warehouse-filtered) instead of re-scanning per-location megaventory_stock.
 *  Pins that the source swap reads the right fields. Run via `npm run test:integration`. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { loadMegaventoryStockByProductId, setDb } from '../../productIntelligenceAggregator';

const PROJECT_ID = 'demo-test';
const BRAND = 'pi-stock-brand';

let db: admin.firestore.Firestore;

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
  const snap = await db.collection('megaventory_products').where('brandId', '==', BRAND).get();
  for (const d of snap.docs) await d.ref.delete();
});

describe('loadMegaventoryStockByProductId (reads megaventory_products totals)', () => {
  it('returns warehouse-filtered totals and skips products with no roll-up', async () => {
    await db.doc(`megaventory_products/mv_p_100`).set({
      brandId: BRAND, productId: '100', sku: 'SKU-100',
      stockOnHand: 4, availableStockTotal: 4, physicalStockTotal: 4, // ΚΑΠ-only after roll-up
    });
    await db.doc(`megaventory_products/mv_p_200`).set({
      brandId: BRAND, productId: '200', sku: 'SKU-200',
      stockOnHand: 0, availableStockTotal: 0, physicalStockTotal: 0, // zero-emitted (no ΚΑΠ stock)
    });
    await db.doc(`megaventory_products/mv_p_300`).set({
      brandId: BRAND, productId: '300', sku: 'SKU-300', // ProductGet stub, no stock roll-up
    });

    const { byProductId } = await loadMegaventoryStockByProductId(BRAND);
    expect(byProductId.get('100')).toEqual({ available: 4, physical: 4 });
    expect(byProductId.get('200')).toEqual({ available: 0, physical: 0 }); // present-and-zero
    expect(byProductId.has('300')).toBe(false); // no totals → skipped, catalog value left as-is
  });
});
