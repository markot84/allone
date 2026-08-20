import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { calculateSalesHeatScore, filterProductsByProfitMaxScope, isPositiveSalesPreset, productMatchesSalesBasePreset } from './salesBaseScore';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Product 1',
    sku: 'SKU-1',
    category: 'Category',
    margin_tier: 'low',
    margin_percentage: 10,
    stock_level: 5,
    stock_capacity: 5,
    stock_age_days: 10,
    price: 10,
    ...overrides,
  };
}

describe('productMatchesSalesBasePreset', () => {
  it('zero_last_7d: requires an authoritative 7d field or last_sale_at (not inferred from a 30d period)', () => {
    const product = makeProduct({ qty_sold_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_7d')).toBe(false);
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_7d: 0 }), 'zero_last_7d'),
    ).toBe(true);
  });

  it('zero_last_30d: requires an authoritative 30d field or last_sale_at (not 90d alone)', () => {
    const product = makeProduct({ qty_sold_last_90d: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_30d')).toBe(false);
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_30d: 0 }), 'zero_last_30d'),
    ).toBe(true);
  });

  it('does not treat 30d=0 as zero_last_90d without 90d or an old last_sale_at', () => {
    const product = makeProduct({ qty_sold_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_90d')).toBe(false);
  });

  it('recognizes stalled when 7d=0 with sales history (or explicit 7d=0 + 90d>0)', () => {
    const product = makeProduct({
      qty_sold_last_7d: 0,
      qty_sold_lifetime: 12,
    });
    expect(productMatchesSalesBasePreset(product, 'stalled_7_vs_90')).toBe(true);
  });

  it('keeps the last_sale_at fallback when all window fields are missing', () => {
    const product = makeProduct({ last_sale_at: '2026-03-01' });
    expect(productMatchesSalesBasePreset(product, 'zero_last_7d')).toBe(true);
    expect(productMatchesSalesBasePreset(product, 'zero_last_30d')).toBe(true);
  });

  it('does not treat 30d=0 as never_sold without an explicit lifetime signal', () => {
    const product = makeProduct({ qty_sold_period: 0, revenue_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'never_sold')).toBe(false);
  });

  // ── PER-302 positive presets ─────────────────────────────────────────

  it('sold_last_30d: matches via qty_sold_period even when the raw 30d window is zero-defaulted', () => {
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_30d: 0, qty_sold_period: 4 }), 'sold_last_30d'),
    ).toBe(true);
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_30d: 0, qty_sold_period: 0 }), 'sold_last_30d'),
    ).toBe(false);
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_30d: 2, stock_level: 0 }), 'sold_last_30d'),
    ).toBe(false);
  });

  it('sold_last_90d: falls back to a recent last_sale_at when windows are missing', () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(productMatchesSalesBasePreset(makeProduct({ last_sale_at: recent }), 'sold_last_90d')).toBe(true);
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    expect(productMatchesSalesBasePreset(makeProduct({ last_sale_at: old }), 'sold_last_90d')).toBe(false);
  });

  it('sold_lifetime: any historical sales evidence with stock > 0', () => {
    expect(productMatchesSalesBasePreset(makeProduct({ qty_sold_lifetime: 3 }), 'sold_lifetime')).toBe(true);
    expect(productMatchesSalesBasePreset(makeProduct({ qty_sold_lifetime: 0 }), 'sold_lifetime')).toBe(false);
  });

  it('fast_low_cover: selling with low days-of-cover only', () => {
    // stock 5, qty_sold_period 30 → 5 days of cover (≤ TOD/2 = 30)
    expect(productMatchesSalesBasePreset(makeProduct({ qty_sold_period: 30 }), 'fast_low_cover')).toBe(true);
    // stock 5, qty_sold_period 1 → 150 days of cover
    expect(productMatchesSalesBasePreset(makeProduct({ qty_sold_period: 1 }), 'fast_low_cover')).toBe(false);
    expect(productMatchesSalesBasePreset(makeProduct({ qty_sold_period: 0 }), 'fast_low_cover')).toBe(false);
    // zero stock is out of stock, not "about to run out"
    expect(
      productMatchesSalesBasePreset(makeProduct({ stock_level: 0, qty_sold_period: 10 }), 'fast_low_cover'),
    ).toBe(false);
  });

  it('heat score is monotone in velocity/recency (hot sellers outrank slow ones)', () => {
    const heavySeller = calculateSalesHeatScore(
      makeProduct({ qty_sold_last_30d: 20, last_sale_at: new Date(Date.now() - 10 * 86400000).toISOString() }),
    );
    const oneOff = calculateSalesHeatScore(
      makeProduct({ qty_sold_last_30d: 1, last_sale_at: new Date(Date.now() - 2 * 86400000).toISOString() }),
    );
    expect(heavySeller).toBeGreaterThan(oneOff);
    // in-store seller with zero-defaulted e-shop windows still reads hot via qty_sold_period
    const inStore = calculateSalesHeatScore(makeProduct({ qty_sold_last_30d: 0, qty_sold_period: 30 }));
    expect(inStore).toBeGreaterThan(oneOff);
    expect(calculateSalesHeatScore(makeProduct({ stock_level: 0, qty_sold_period: 30 }))).toBe(12);
  });

  it('retired presets keep matching for saved strategies', () => {
    expect(
      productMatchesSalesBasePreset(makeProduct({ qty_sold_last_7d: 0 }), 'zero_last_7d'),
    ).toBe(true);
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    expect(productMatchesSalesBasePreset(makeProduct({ last_sale_at: old }), 'cold_last_sale_30d')).toBe(true);
  });

  it('isPositiveSalesPreset flags only the positive group', () => {
    expect(isPositiveSalesPreset('sold_last_30d')).toBe(true);
    expect(isPositiveSalesPreset('fast_low_cover')).toBe(true);
    expect(isPositiveSalesPreset('zero_last_30d')).toBe(false);
    expect(isPositiveSalesPreset('all')).toBe(false);
    expect(isPositiveSalesPreset(undefined)).toBe(false);
  });

  it('does not treat 30d=0 as cold_last_sale_30d when last_sale_at is missing', () => {
    const product = makeProduct({ qty_sold_period: 0, revenue_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'cold_last_sale_30d')).toBe(false);
  });
});

describe('filterProductsByProfitMaxScope', () => {
  const p = (over: Record<string, unknown>) => ({ id: 'x', sku: 'x', name: 'x', category: 'c', margin_tier: 'high', margin_percentage: 1, stock_level: 1, stock_capacity: 1, priority_tag: 'healthy', price: 1, ...over }) as never;
  const items = [p({ brand: 'Nike', subcategory: 'Trail', product_type: 'Shoes' }), p({ brand: 'Asics', product_type: 'Balls' })];

  it('empty scope passes everything; each dimension filters exact-match', () => {
    expect(filterProductsByProfitMaxScope(items, { brandFilter: '', subcategoryFilter: '', productTypeFilter: '' })).toHaveLength(2);
    expect(filterProductsByProfitMaxScope(items, { brandFilter: 'Nike', subcategoryFilter: '', productTypeFilter: '' })).toHaveLength(1);
    expect(filterProductsByProfitMaxScope(items, { brandFilter: '', subcategoryFilter: '', productTypeFilter: 'Balls' })).toHaveLength(1);
    expect(filterProductsByProfitMaxScope(items, { brandFilter: 'Nike', subcategoryFilter: '', productTypeFilter: 'Balls' })).toHaveLength(0);
  });
});
