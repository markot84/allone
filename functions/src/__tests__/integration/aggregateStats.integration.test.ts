/** aggregateStats against the REAL module + Firestore emulator: pins the field-projection + stream
 * refactor by seeding FAT docs and asserting aggregates match the old full-read semantics. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { computeAggregatesForBrand } from '../../aggregateStats';

const PROJECT_ID = 'demo-test';
const BRAND = 'agg-test-brand';

let db: admin.firestore.Firestore;

async function seedProduct(id: string, fields: Record<string, unknown>) {
  await db.doc(`products/${id}`).set({
    brandId: BRAND,
    // fat fields the projection must NOT need to download
    name: `Product ${id}`,
    description: 'x'.repeat(2000),
    metrics: { views: 1, sales: 2, longTail: 'y'.repeat(500) },
    ...fields,
  });
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
});

afterAll(async () => {
  await admin.app().delete();
});

beforeEach(async () => {
  const prods = await db.collection('products').where('brandId', '==', BRAND).get();
  for (const d of prods.docs) await d.ref.delete();
  await db.recursiveDelete(db.collection(`brands/${BRAND}/aggregates`));
});

async function readAggregate(type: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`brands/${BRAND}/aggregates/${type}`).get();
  expect(snap.exists).toBe(true);
  return snap.data() as Record<string, unknown>;
}

describe('aggregateStats (real module, projected streaming reads)', () => {
  it('computes product aggregates from fat docs identically to the full-read semantics', async () => {
    // healthy: stock 50, sells 1/day, fresh
    await seedProduct('a1', {
      price: 10, stock_level: 50, margin_percentage: 30, avg_daily_sales: 1, stock_age_days: 5,
    });
    // low: stock 0
    await seedProduct('a2', { price: 20, stock_level: 0, margin_percentage: 10 });
    // dead: stock present but very old (stock_age_days > 60*2)
    await seedProduct('a3', { price: 5, stock_level: 4, stock_age_days: 200 });
    // excess: stock far above 60*2 days of cover (available_stock takes precedence)
    await seedProduct('a4', { price: 2, available_stock: 1000, stock_level: 1, avg_daily_sales: 2, stock_age_days: 5 });

    await computeAggregatesForBrand(BRAND);
    const agg = await readAggregate('products');

    expect(agg.totalSkus).toBe(4);
    // 10*50 + 20*0 + 5*4 + 2*1000 (available_stock wins over stock_level)
    expect(agg.totalInventoryValue).toBe(500 + 0 + 20 + 2000);
    expect((agg.deadStock as { count: number; value: number }).count).toBe(1);
    expect((agg.deadStock as { count: number; value: number }).value).toBe(20);
    expect((agg.lowStock as { count: number }).count).toBe(1);
    expect((agg.excessStock as { count: number; value: number }).count).toBe(1);
    expect((agg.healthyStock as { count: number }).count).toBe(1);
    expect(agg.withStockLevel).toBe(3);
    expect(agg.withMargin).toBe(2);
    expect(agg.avgMargin).toBe(20); // (30+10)/2
  });

  it('excludes ERP-discontinued tombstones: they no longer inflate totalSkus/lowStock', async () => {
    // 1 live healthy product
    await seedProduct('live1', {
      price: 10, stock_level: 50, margin_percentage: 30, avg_daily_sales: 1, stock_age_days: 5,
    });
    // 3 discontinued tombstones: stock 0, no stock_age — at HEAD these would all classify 'low'
    await seedProduct('tomb1', { price: 0, stock_level: 0, discontinued_at: '2026-06-10T00:00:00.000Z' });
    await seedProduct('tomb2', { price: 0, stock_level: 0, discontinued_at: '2026-06-10T00:00:00.000Z' });
    await seedProduct('tomb3', { price: 0, stock_level: 0, discontinued_at: '2026-06-10T00:00:00.000Z' });

    await computeAggregatesForBrand(BRAND);
    const agg = await readAggregate('products');

    expect(agg.totalSkus).toBe(1); // tombstones skipped, not 4
    expect((agg.lowStock as { count: number }).count).toBe(0); // would be 3 without the skip
    expect((agg.healthyStock as { count: number }).count).toBe(1);
  });

  it('handles a brand with no products (no NaN, zero counts)', async () => {
    await computeAggregatesForBrand(BRAND);
    const agg = await readAggregate('products');

    expect(agg.totalSkus).toBe(0);
    expect(agg.totalInventoryValue).toBe(0);
    expect(agg.avgMargin).toBe(0);
    expect((agg.deadStock as { count: number }).count).toBe(0);
  });
});
