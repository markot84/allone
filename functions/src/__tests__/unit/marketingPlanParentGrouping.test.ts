/** SKU opportunities collapse by declared parent: variants take one slot with summed quantities. */
import { describe, it, expect } from 'vitest';
import { buildMarketingPlanInsight } from '../../marketingPlan/marketingPlanInsights';

const period = { presetId: 'next_month', periodLabel: 'x', fromDate: '2026-08-01', toDate: '2026-08-31' };
const sig = (repl: number, stock = 2) => ({
  category: 'Shoes', available_stock: stock, replenishment_qty: repl, replenishment_value: repl * 10, avg_sale_price: 50,
});

describe('marketing plan parent grouping', () => {
  const signals = { 'P1-41': sig(3), 'P1-42': sig(5), 'LONE-1': sig(2) } as never;

  it('collapses variants into one suggestion with summed qty and variantCount', () => {
    const insight = buildMarketingPlanInsight({
      period, lastYearOrders: [], procurementSignals: signals,
      parentSkuBySku: { 'P1-41': 'P1', 'P1-42': 'P1' },
    });
    const skus = insight.skuSuggestions.map((s) => s.sku).sort();
    expect(skus).toEqual(['LONE-1', 'P1']);
    const parent = insight.skuSuggestions.find((s) => s.sku === 'P1')!;
    expect(parent.estimatedReorderQty).toBe(8);
    expect(parent.currentStock).toBe(4);
    expect(parent.variantCount).toBe(2);
  });

  it('without a parent map, variants stay separate rows', () => {
    const insight = buildMarketingPlanInsight({ period, lastYearOrders: [], procurementSignals: signals });
    expect(insight.skuSuggestions).toHaveLength(3);
  });
});
