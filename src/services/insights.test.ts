import { describe, expect, it } from 'vitest';
import { generateInsightsFromData, type InsightInventoryAggregate } from './insights';
import type { InventorySummary, Product, RFMSegment } from '../types';

function makeSummary(overrides: Partial<InventorySummary> = {}): InventorySummary {
  return {
    // total_skus deliberately inflated (tombstones) - the cards must NOT rely on it
    // or on summary.*.percentage (same denominator).
    total_skus: 600,
    total_value: 100_000,
    healthy_stock: { count: 88, percentage: 14.7 },
    excess_stock: { count: 2, percentage: 0.3, value: 5_000 },
    dead_stock: { count: 3, percentage: 0.5, value: 2_000 },
    low_stock: { count: 7, percentage: 1.2 },
    ...overrides,
  };
}

function makeInventory(overrides: Partial<InsightInventoryAggregate> = {}): InsightInventoryAggregate {
  return { summary: makeSummary(), categoriesCount: 3, totalCount: 6, ...overrides };
}

function makeSegment(overrides: Partial<RFMSegment> = {}): RFMSegment {
  return {
    id: 'loyal',
    name: 'Loyal',
    rfm_score: '444',
    count: 50,
    percentage: 10,
    revenue_share: 20,
    color: '#6B7280',
    description: '',
    icon: '',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Racket Pro',
    sku: 'SKU1',
    category: 'Tennis',
    margin_tier: 'low',
    margin_percentage: 10,
    stock_level: 10,
    stock_capacity: 100,
    price: 50,
    ...overrides,
  };
}

const twoSegments = [makeSegment(), makeSegment({ id: 'promising', name: 'Promising' })];
const PRODUCT_CARD_KEYS = ['dead_stock', 'excess_stock', 'high_margin_low_stock', 'low_stock'];

function keysOf(insights: ReturnType<typeof generateInsightsFromData>): Array<string | undefined> {
  return insights.map((i) => i.insightKey);
}

describe('generateInsightsFromData — aggregate-fed product cards', () => {
  it('inventory {dead 3, excess 2, low 7, healthy 88} ⇒ 3 cards, low % = 7 (from counts, not percentages)', () => {
    const insights = generateInsightsFromData([], [], undefined, undefined, null, makeInventory());
    const keys = keysOf(insights);
    expect(keys).toContain('dead_stock');
    expect(keys).toContain('excess_stock');
    expect(keys).toContain('low_stock');
    // No field in the aggregate - data-driven absence until that feature lands.
    expect(keys).not.toContain('high_margin_low_stock');

    // stockedCount = 88+7+3+2 = 100 ⇒ 7% - if total_skus (600) were used it would be 1%.
    const low = insights.find((i) => i.insightKey === 'low_stock');
    expect(low?.insight).toContain('7 ενεργά προϊόντα');
    expect(low?.insight).toContain('(7%)');
  });

  it('low_stock.count: 5 ⇒ no low card (requires > 5, same threshold as legacy)', () => {
    const inventory = makeInventory({ summary: makeSummary({ low_stock: { count: 5, percentage: 1 } }) });
    const insights = generateInsightsFromData([], [], undefined, undefined, null, inventory);
    expect(keysOf(insights)).not.toContain('low_stock');
  });

  it('inventory: null + products: [] ⇒ no product card (import-only brand, honest absence)', () => {
    const insights = generateInsightsFromData([], twoSegments, undefined, undefined, null, null);
    for (const key of PRODUCT_CARD_KEYS) {
      expect(keysOf(insights)).not.toContain(key);
    }
  });

  it('cross_sell: categoriesCount 3 / totalCount 6 + 2 segments ⇒ card with the category count', () => {
    const insights = generateInsightsFromData([], twoSegments, undefined, undefined, null, makeInventory());
    const crossSell = insights.find((i) => i.insightKey === 'cross_sell');
    expect(crossSell).toBeDefined();
    expect(crossSell?.insight).toContain('3 κατηγορίες');
  });

  it('cross_sell: categoriesCount 1 ⇒ no card (needs >=2 categories)', () => {
    const insights = generateInsightsFromData([], twoSegments, undefined, undefined, null, makeInventory({ categoriesCount: 1 }));
    expect(keysOf(insights)).not.toContain('cross_sell');
  });

  it('cross_sell: totalCount 4 < 5 ⇒ no card (same threshold as legacy products.length)', () => {
    const insights = generateInsightsFromData([], twoSegments, undefined, undefined, null, makeInventory({ totalCount: 4 }));
    expect(keysOf(insights)).not.toContain('cross_sell');
  });
});

describe('generateInsightsFromData — legacy branch regression (without inventory)', () => {
  // Fixture: 3 dead (distinct model groups), 2 excess, 6 low (1 high-margin), 1 healthy = 12 actionable.
  const legacyProducts: Product[] = [
    makeProduct({ id: 'd1', sku: 'DEADA', priority_tag: 'dead' }),
    makeProduct({ id: 'd2', sku: 'DEADB', priority_tag: 'dead' }),
    makeProduct({ id: 'd3', sku: 'DEADC', priority_tag: 'dead' }),
    makeProduct({ id: 'e1', sku: 'EXCA', priority_tag: 'excess', category: 'Padel' }),
    makeProduct({ id: 'e2', sku: 'EXCB', priority_tag: 'excess', category: 'Padel' }),
    makeProduct({ id: 'l1', sku: 'LOWA', priority_tag: 'low' }),
    makeProduct({ id: 'l2', sku: 'LOWB', priority_tag: 'low' }),
    makeProduct({ id: 'l3', sku: 'LOWC', priority_tag: 'low' }),
    makeProduct({ id: 'l4', sku: 'LOWD', priority_tag: 'low' }),
    makeProduct({ id: 'l5', sku: 'LOWE', priority_tag: 'low' }),
    makeProduct({ id: 'l6', sku: 'LOWF', priority_tag: 'low', margin_tier: 'high', margin_percentage: 30 }),
    makeProduct({ id: 'h1', sku: 'OKA', priority_tag: 'healthy' }),
  ];

  it('produces the 4 product cards with the same numbers as HEAD', () => {
    const insights = generateInsightsFromData(legacyProducts, twoSegments);
    const byKey = new Map(insights.map((i) => [i.insightKey, i]));

    expect(byKey.get('dead_stock')?.insight).toContain('3 ενεργά προϊόντα/model groups');
    expect(byKey.get('excess_stock')?.insight).toContain('2 κωδικοί');
    expect(byKey.get('high_margin_low_stock')?.insight).toContain('1 προϊόντα υψηλού περιθωρίου');
    // 6 low out of 12 actionable = 50%
    expect(byKey.get('low_stock')?.insight).toContain('6 ενεργά προϊόντα (50%)');
  });

  it('legacy cross_sell: >=5 products with 2 categories + 2 segments ⇒ card', () => {
    const insights = generateInsightsFromData(legacyProducts, twoSegments);
    const crossSell = insights.find((i) => i.insightKey === 'cross_sell');
    expect(crossSell).toBeDefined();
    expect(crossSell?.insight).toContain('2 κατηγορίες');
  });

  it('products without stock are not actionable ⇒ no card', () => {
    const stockless = [makeProduct({ id: 's1', sku: 'ZEROA', priority_tag: 'dead', stock_level: 0 })];
    const insights = generateInsightsFromData(stockless, []);
    for (const key of PRODUCT_CARD_KEYS) {
      expect(keysOf(insights)).not.toContain(key);
    }
  });
});
