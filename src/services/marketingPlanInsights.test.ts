import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import type { EcommerceRawOrder } from './ecommerceRawOrders';
import { buildMarketingPlanInsight } from './marketingPlanInsights';

function product(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? overrides.sku ?? 'p',
    name: overrides.name ?? 'Product',
    sku: overrides.sku ?? 'SKU',
    category: overrides.category ?? 'Shoes',
    margin_tier: 'medium',
    margin_percentage: 20,
    stock_level: overrides.stock_level ?? 0,
    stock_capacity: 10,
    price: overrides.price ?? 10,
    ...overrides,
  };
}

function order(overrides: Partial<EcommerceRawOrder>): EcommerceRawOrder {
  return {
    orderId: overrides.orderId ?? 'o',
    platform: 'magento',
    status: 'complete',
    total: overrides.total ?? 100,
    currency: 'EUR',
    createdAt: overrides.createdAt ?? '2025-06-10T12:00:00.000Z',
    lineItems: overrides.lineItems ?? [],
    ...overrides,
  };
}

describe('buildMarketingPlanInsight', () => {
  it('builds category-first reorder guidance from last-year sales and current stock', () => {
    const insight = buildMarketingPlanInsight({
      period: {
        presetId: 'next_month',
        periodLabel: 'Επόμενος μήνας',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      },
      inventoryProducts: [
        product({ sku: 'S1', name: 'Runner 1', category: 'Shoes', subcategory: 'Running', brand: 'Brand A', stock_level: 2, price: 20 }),
      ],
      lastYearOrders: [
        order({
          lineItems: [{ sku: 'S1', name: 'Runner 1', quantity: 10, price: 20, rowTotal: 200 }],
        }),
      ],
    });

    expect(insight.evidence.units).toBe(10);
    expect(insight.reorderPlan[0]).toMatchObject({
      category: 'Shoes',
      subcategory: 'Running',
      brand: 'Brand A',
      action: 'increase',
      estimatedReorderQty: 9,
      confidence: 'high',
    });
    expect(insight.skuSuggestions[0]).toMatchObject({ sku: 'S1', estimatedReorderQty: 9 });
    expect(insight.dataQuality.level).toBe('strong');
  });

  it('derives category/brand/margin and ERP reorder qty from procurement signals (no product catalog)', () => {
    const insight = buildMarketingPlanInsight({
      period: {
        presetId: 'next_month',
        periodLabel: 'Επόμενος μήνας',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      },
      inventoryProducts: [],
      procurementSignals: {
        S1: {
          available_stock: 2,
          category: 'Παπούτσια Running',
          supplier: 'Babolat',
          flow_group: 'Running',
          margin_pct: 42,
          days_of_cover: 7,
          replenishment_qty: 25,
          avg_sale_price: 80,
        },
      },
      lastYearOrders: [
        order({ lineItems: [{ sku: 'S1', name: 'Runner', quantity: 10, price: 80, rowTotal: 800 }] }),
      ],
    });

    const group = insight.reorderPlan[0];
    expect(group).toMatchObject({
      category: 'Παπούτσια Running',
      subcategory: 'Running',
      brand: 'Babolat',
      action: 'increase',
      estimatedReorderQty: 25, // ERP replenishment_qty preferred over estimate
      reorderQtySource: 'erp',
      marginPct: 42,
      daysOfCover: 7,
      confidence: 'high',
    });
    expect(insight.dataQuality.lineItemCoveragePct).toBe(100);
    expect(insight.skuSuggestions[0]).toMatchObject({ sku: 'S1', estimatedReorderQty: 25, reorderQtySource: 'erp', marginPct: 42 });
  });

  it('bridges last-year sales to ERP categories via product name when SKU codes differ (Magento ↔ Megaventory)', () => {
    const insight = buildMarketingPlanInsight({
      period: {
        presetId: 'next_month',
        periodLabel: 'Επόμενος μήνας',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      },
      // Megaventory catalog: ERP sku + name (different coding scheme from Magento).
      inventoryProducts: [
        product({ sku: '0000278-320', name: 'Babolat Pro Hurricane Tour String 200m', category: 'Strings' }),
      ],
      procurementSignals: {
        '0000278-320': {
          available_stock: 1,
          category: 'Cordage tennis',
          supplier: 'Babolat',
          margin_pct: 40,
          avg_sale_price: 90,
        },
      },
      lastYearOrders: [
        order({
          lineItems: [
            // Magento configurable: parent (counts) + child (ignored). SKU «243102» != ERP «0000278».
            { sku: '243102-1.30mm', name: 'Babolat Pro Hurricane Τοur String 200m', quantity: 3, price: 90, rowTotal: 270, itemId: 1, parentItemId: null, productType: 'configurable' },
            { sku: '243102-1.30mm', name: 'Babolat Pro Hurricane Τοur String 200m-1.30mm', quantity: 3, price: 0, rowTotal: 0, itemId: 2, parentItemId: 1, productType: 'simple' },
          ],
        }),
      ],
    });

    const group = insight.reorderPlan[0];
    expect(group.category).toBe('Cordage tennis');
    // Demand bridged via name (3 units, not 6 — the child line was ignored).
    expect(group.lastYearUnits).toBe(3);
    expect(group.action).toBe('increase');
    expect(insight.evidence.matchedLines).toBe(1);
  });

  it('does not double-count stock when a SKU appears across multiple orders', () => {
    const insight = buildMarketingPlanInsight({
      period: {
        presetId: 'next_month',
        periodLabel: 'Επόμενος μήνας',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      },
      inventoryProducts: [
        product({ sku: 'S1', name: 'Runner', category: 'Shoes', stock_level: 5, price: 20 }),
      ],
      lastYearOrders: [
        order({ orderId: 'o1', lineItems: [{ sku: 'S1', name: 'Runner', quantity: 3, price: 20, rowTotal: 60 }] }),
        order({ orderId: 'o2', lineItems: [{ sku: 'S1', name: 'Runner', quantity: 4, price: 20, rowTotal: 80 }] }),
      ],
    });

    // stock counted once (5), not per-line (would be 10)
    expect(insight.reorderPlan[0].currentStock).toBe(5);
    expect(insight.reorderPlan[0].lastYearUnits).toBe(7);
  });

  it('marks weak data when line items cannot be matched to inventory', () => {
    const insight = buildMarketingPlanInsight({
      period: {
        presetId: 'next_month',
        periodLabel: 'Επόμενος μήνας',
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      },
      inventoryProducts: [],
      lastYearOrders: [
        order({
          lineItems: [{ sku: 'UNKNOWN', name: 'Unknown', quantity: 3, price: 10 }],
        }),
      ],
    });

    expect(insight.dataQuality.level).toBe('weak');
    expect(insight.skuSuggestions).toHaveLength(0);
    expect(insight.dataQuality.notes.length).toBeGreaterThan(0);
  });
});
