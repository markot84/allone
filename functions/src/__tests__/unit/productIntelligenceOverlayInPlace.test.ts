/** The PI rebuild was OOM-crashing on large brands. Two hot-path allocations were cut: the velocity
 * merge no longer copies the whole e-shop map, and the sku-stats overlay mutates catalog entries in
 * place instead of spreading a fresh object per SKU. These tests pin the behaviour so the
 * memory-saving rewrite stays equivalent to the old spread/copy version. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { mergeVelocityPreferErp, applySkuStatsOverlay } = __test;

describe('mergeVelocityPreferErp (no-copy)', () => {
  it('prefers the ERP row per SKU and keeps e-shop-only rows', () => {
    const eshop = new Map([
      ['a', { sold: 1, sold30d: 1 }],
      ['b', { sold: 2, sold30d: 2 }],
    ]);
    const erp = new Map([
      ['a', { sold: 100, sold30d: 100 }],
      ['c', { sold: 3, sold30d: 3 }],
    ]);
    const merged = mergeVelocityPreferErp(eshop, erp);
    expect(merged.get('a')).toEqual({ sold: 100, sold30d: 100 }); // ERP wins
    expect(merged.get('b')).toEqual({ sold: 2, sold30d: 2 }); // e-shop kept
    expect(merged.get('c')).toEqual({ sold: 3, sold30d: 3 }); // ERP-only added
    expect(merged.size).toBe(3);
  });

  it('returns the e-shop map unchanged when there is no ERP velocity', () => {
    const eshop = new Map([['a', { sold: 1 }]]);
    expect(mergeVelocityPreferErp(eshop, new Map()).get('a')).toEqual({ sold: 1 });
  });
});

describe('applySkuStatsOverlay (in-place)', () => {
  it('mutates the same product object and sets velocity + priority_tag', () => {
    const product = { sku: 'A', name: 'A', stock_level: 0, source: 'erp' } as Record<string, unknown>;
    const products = new Map<string, typeof product>([['a', product as never]]);
    const stats = new Map([['a', { sold: 50, sold30d: 12, lastSaleAt: '2026-06-01' }]]);
    const applied = applySkuStatsOverlay(products as never, stats as never);
    expect(applied).toBe(1);
    expect(products.get('a')).toBe(product); // same reference — mutated, not replaced
    expect(product.qty_sold_period).toBe(12);
    expect(product.qty_sold_lifetime).toBe(50);
    expect(product.last_sale_at).toBe('2026-06-01');
    expect(product.priority_tag).toBeTypeOf('string'); // a stock bucket was assigned
  });

  it('uses sold90d/3 when there are no 30-day sales, and skips SKUs with no stats', () => {
    const withStats = { sku: 'A', stock_level: 5 } as Record<string, unknown>;
    const noStats = { sku: 'B', stock_level: 5 } as Record<string, unknown>;
    const products = new Map([['a', withStats as never], ['b', noStats as never]]);
    const applied = applySkuStatsOverlay(products as never, new Map([['a', { sold90d: 9 }]]) as never);
    expect(applied).toBe(1);
    expect(withStats.qty_sold_period).toBe(3); // 9 / 3
    expect(noStats.qty_sold_period).toBeUndefined();
  });
});
