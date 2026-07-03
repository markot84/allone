/** PER-178: the PI cards follow filters by summarizing the FILTERED set, not the whole catalog.
 * summaryForProducts must be subset-accurate — a filtered slice yields its own bucket counts/values. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { summaryForProducts } = __test;

const row = (tag: string, stock: number, price: number) =>
  ({ id: tag + stock, sku: 's', name: 'n', category: 'c', margin_tier: 'low',
     margin_percentage: 0, stock_level: stock, stock_capacity: stock * 2,
     priority_tag: tag, price }) as never;

describe('summaryForProducts (PER-178 filtered cards)', () => {
  const all = [
    row('healthy', 10, 5), row('healthy', 4, 5),
    row('excess', 20, 3), row('dead', 8, 2), row('low', 1, 9),
  ];

  it('summarizes the full set', () => {
    const s = summaryForProducts(all);
    expect(s.total_skus).toBe(5);
    expect(s.healthy_stock.count).toBe(2);
    expect(s.excess_stock).toMatchObject({ count: 1, value: 60 });
    expect(s.dead_stock).toMatchObject({ count: 1, value: 16 });
  });

  it('reflects a filtered subset, not the whole catalog', () => {
    const filtered = all.filter((p) => (p as { priority_tag: string }).priority_tag === 'healthy');
    const s = summaryForProducts(filtered);
    expect(s.total_skus).toBe(2);
    expect(s.healthy_stock).toMatchObject({ count: 2, percentage: 100 });
    expect(s.excess_stock.count).toBe(0);
    expect(s.dead_stock.count).toBe(0);
  });
});
