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
