/** Brands with no catalog connector build Product Intelligence from their imported `products` docs.
 *  Pins the regression that left manually imported catalogs invisible. Run via `npm run test:integration`. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { refreshProductIntelligenceAggregate, setDb } from '../../productIntelligenceAggregator';

const PROJECT_ID = 'demo-test';
const BRAND = 'pi-manual-brand';

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
  for (const coll of ['products', 'product_intelligence', 'connectors', 'brands']) {
    const snap = await db.collection(coll).where('brandId', '==', BRAND).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await db.doc(`product_intelligence/${BRAND}`).delete();
  await db.doc(`connectors/${BRAND}`).delete();
});

describe('refreshProductIntelligenceAggregate — manual catalog fallback', () => {
  it('builds from imported products when no catalog connector exists', async () => {
    // Field names as written by the manual import path (batchWrite stamps brandId only, no source).
    await db.doc(`products/${BRAND}__SKU-1`).set({
      brandId: BRAND, sku: 'SKU-1', name: 'Imported One', price: 100, cost_price: 60, stock_level: 12,
    });
    await db.doc(`products/${BRAND}__SKU-2`).set({
      brandId: BRAND, sku: 'SKU-2', name: 'Imported Two', price: 50, cost_price: 20, stock_level: 0,
    });

    await refreshProductIntelligenceAggregate(BRAND);

    const agg = (await db.doc(`product_intelligence/${BRAND}`).get()).data() || {};
    expect(agg.status).toBe('ready');
    expect(agg.totalCount).toBe(2);
    expect(agg.sourceKind).toBe('manual');
    expect(agg.sourceLabel).toBe('Manual upload');
  });

  it('still skips when the brand has no products at all', async () => {
    await refreshProductIntelligenceAggregate(BRAND);

    const agg = (await db.doc(`product_intelligence/${BRAND}`).get()).data() || {};
    expect(agg.status).toBe('skipped');
    expect(agg.reason).toBe('no_connector_catalog');
  });

  it('ignores imported products once a catalog connector is connected', async () => {
    await db.doc(`products/${BRAND}__SKU-1`).set({
      brandId: BRAND, sku: 'SKU-1', name: 'Imported One', price: 100, cost_price: 60, stock_level: 12,
    });
    await db.doc(`connectors/${BRAND}`).set({ brandId: BRAND, magento: { connected: true } });

    await refreshProductIntelligenceAggregate(BRAND);

    const agg = (await db.doc(`product_intelligence/${BRAND}`).get()).data() || {};
    expect(agg.sourceKind).toBe('connector_catalog');
    expect(agg.totalCount).toBe(0); // magento_products is empty — the manual docs must not leak in
  });
});
