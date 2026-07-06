/** PER-177: for a Megaventory brand that scoped its warehouses, the custom-report overlay must not
 * overwrite the warehouse-filtered mirror stock with the report's all-warehouse figure. keepStock=true
 * preserves the filtered stock and re-buckets on it; keepStock=false keeps the legacy report-wins path. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { applyStockOverlay } = __test;

const baseProduct = () =>
  ({ id: 'mv_p_1', productId: '1', sku: 'A', name: 'A', category: 'x', margin_tier: 'low',
     margin_percentage: 0, stock_level: 4, stock_capacity: 8, priority_tag: 'healthy',
     price: 10, qty_sold_period: 1, source: 'erp' }) as Record<string, unknown>;

const reportOverlay = () =>
  ({ stock_level: 200, stock_capacity: 400, available_stock: 200, stock_on_hand: 200,
     priority_tag: 'excess', source: 'erp' }) as Record<string, unknown>;

describe('applyStockOverlay warehouse-filtered stock (PER-177)', () => {
  it('keepStock=true keeps the filtered stock and re-buckets on it (excess -> healthy)', () => {
    const p = baseProduct();
    applyStockOverlay(p as never, reportOverlay() as never, true);
    expect(p.stock_level).toBe(4); // filtered mirror value, not the report's 200
    expect(p.available_stock).toBeUndefined(); // report's all-WH available not written over
    expect(p.priority_tag).toBe('healthy'); // 4 units / 1-per-30d = 120d cover -> healthy, not excess
  });

  it('keepStock=false uses the report stock (legacy path for unmirrored SKUs)', () => {
    const p = baseProduct();
    applyStockOverlay(p as never, reportOverlay() as never, false);
    expect(p.stock_level).toBe(200);
    expect(p.available_stock).toBe(200);
    expect(p.priority_tag).toBe('excess'); // 200 units / 1-per-30d = 6000d cover -> excess
  });
});
