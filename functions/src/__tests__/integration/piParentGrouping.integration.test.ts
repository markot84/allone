/** PER-187: a parent's sizes scatter across buckets — grouping must still aggregate every sibling. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { queryProductIntelligenceRows, setDb } from '../../productIntelligenceAggregator';

const PROJECT_ID = 'demo-test';
const BRAND = 'pi-group-brand';

let db: admin.firestore.Firestore;

const variant = (sku: string, stock: number, sold: number | undefined, tag: string) => ({
  id: sku, sku, name: `Racquet ${sku}`, category: 'Racquets', brand: 'Babolat',
  margin_tier: 'high', margin_percentage: 25, price: 161.21,
  stock_level: stock, stock_capacity: stock * 2, stock_on_hand: stock, available_stock: stock,
  ...(sold != null ? { qty_sold_period: sold } : {}),
  priority_tag: tag, parent_sku: '101552-100', variant_count: 4, source: 'erp',
});

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
  const all = [
    variant('101552-100-L1', 0, undefined, 'no_stock'),
    variant('101552-100-L2', 3, 2, 'healthy'),
    variant('101552-100-L3', 2, 4, 'low'),
    variant('101552-100-L4', 9, undefined, 'dead'),
  ];
  await db.doc(`product_intelligence/${BRAND}`).set({
    brandId: BRAND, status: 'ready', sourceKind: 'erp', totalCount: all.length,
    pagesByBucket: { all: 1, no_stock: 1, healthy: 1, low: 1, dead: 1, excess: 1 },
  });
  await db.doc(`product_intelligence_pages/${BRAND}_all_1`).set({ brandId: BRAND, products: all });
  await db.doc(`product_intelligence_pages/${BRAND}_low_1`).set({
    brandId: BRAND, products: all.filter((p) => p.priority_tag === 'low'),
  });
});

describe('grouped Product Intelligence query', () => {
  it('sums every sibling, even those sitting in other buckets', async () => {
    const res = await queryProductIntelligenceRows({ brandId: BRAND, bucket: 'all', groupByParent: true });
    expect(res.products).toHaveLength(1);
    expect(res.products[0].sku).toBe('101552-100');
    expect(res.products[0].stock_level).toBe(14); // not the 2 of the "low" size alone
    expect(res.products[0].variant_count).toBe(3); // L1 out-of-stock, hidden by default
  });

  it('buckets the group by its own totals, not by the representative variant', async () => {
    const low = await queryProductIntelligenceRows({ brandId: BRAND, bucket: 'low', groupByParent: true });
    expect(low.products).toHaveLength(0);
    const healthy = await queryProductIntelligenceRows({ brandId: BRAND, bucket: 'healthy', groupByParent: true });
    expect(healthy.products.map((p) => p.sku)).toEqual(['101552-100']);
  });

  it('leaves the ungrouped view variant-level', async () => {
    const res = await queryProductIntelligenceRows({ brandId: BRAND, bucket: 'low' });
    expect(res.products.map((p) => p.sku)).toEqual(['101552-100-L3']);
  });
});
