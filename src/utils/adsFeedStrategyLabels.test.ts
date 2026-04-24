import { describe, expect, it } from 'vitest';
import type { ActiveStrategy } from '../hooks/useActiveStrategy';
import type { Product } from '../types';
import { getProductStrategyLabels } from './adsFeedStrategyLabels';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Product 1',
    sku: 'SKU-1',
    category: 'Default',
    margin_tier: 'low',
    margin_percentage: 10,
    stock_level: 5,
    stock_capacity: 5,
    stock_age_days: 10,
    price: 10,
    ...overrides,
  };
}

function strategy(overrides: Partial<ActiveStrategy> = {}): ActiveStrategy {
  return {
    id: 'strategy_brand1',
    brandId: 'brand1',
    scenarioId: 'sales_base',
    weights: {},
    approvalStatus: 'approved',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('getProductStrategyLabels', () => {
  it('επιστρέφει κενά labels χωρίς active strategy', () => {
    const r = getProductStrategyLabels(product(), null);
    expect(r.custom_label_0).toBe('');
    expect(r.all).toEqual([]);
  });

  it('label_0 = όνομα active scenario', () => {
    const r = getProductStrategyLabels(product(), strategy({ scenarioId: 'sales_base' }));
    expect(r.custom_label_0).toBe('Sales Optimization');
  });

  it('Mixed scenario: τα 2 sub-scenarios στο 0 και 1', () => {
    const r = getProductStrategyLabels(
      product(),
      strategy({
        scenarioId: 'mixed',
        mixConfig: { scenarioA: 'profit_max', scenarioB: 'stock_clearance', percentA: 50, percentB: 50 },
      })
    );
    expect(r.custom_label_0).toBe('Profit Maximization');
    expect(r.custom_label_1).toBe('Stock Clearance');
  });

  it('Triage origin: προσθέτει label αν το SKU συμμετέχει', () => {
    const r = getProductStrategyLabels(
      product({ sku: 'TUCKER' }),
      strategy({
        scenarioId: 'sales_base',
        triageOrigin: { bucket: 'dead_capital', label: 'Νεκρά κεφάλαια', skus: ['TUCKER'], selectedAt: '' },
      })
    );
    expect(r.all).toContain('Sales Optimization');
    expect(r.all).toContain('Νεκρά κεφάλαια');
  });

  it('Seasonal discount (scope=all) προστίθεται για κάθε προϊόν', () => {
    const r = getProductStrategyLabels(
      product(),
      strategy({
        scenarioId: 'sales_base',
        seasonalDiscount: {
          periodName: 'Black Friday',
          discountPercent: 20,
          scope: 'all',
          selectedCategories: [],
          selectedProductIds: [],
        },
      })
    );
    expect(r.all).toContain('Seasonal: Black Friday');
  });

  it('μέγιστα 5 labels (truncation)', () => {
    const r = getProductStrategyLabels(
      product({ sku: 'X', category: 'Cat' }),
      strategy({
        scenarioId: 'mixed',
        mixConfig: { scenarioA: 'profit_max', scenarioB: 'stock_clearance', percentA: 50, percentB: 50 },
        seasonalDiscount: {
          periodName: 'P1',
          discountPercent: 10,
          scope: 'all',
          selectedCategories: [],
          selectedProductIds: [],
        },
        seasonalProposal: {
          periodId: 'p2',
          periodName: 'P2',
          scenarioA: 'profit_max',
          scenarioB: 'revenue_push',
          percentA: 50,
          percentB: 50,
          activatedAt: '',
        },
        triageOrigin: { bucket: 'b', label: 'Triage', skus: ['X'], selectedAt: '' },
        priceBenchmarkScope: { preset: 'all_benchmarked', brandFilter: '', categoryFilter: '', search: '', selectedProductIds: null },
      })
    );
    // Profit Max, Stock Clearance, Price Benchmarking, Seasonal: P1, Seasonal: P2, Triage → max 5 truncated
    expect(r.all.length).toBeGreaterThan(5);
    expect(r.custom_label_4).not.toBe('');
    // 6ο και πέρα δεν εκπροσωπείται στο ζευγάρι 0..4
  });
});
