import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { filterProductsByProfitMaxScope, productMatchesSalesBasePreset } from './salesBaseScore';

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
