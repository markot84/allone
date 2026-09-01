/** PER-320 Phase C: per-category/supplier threshold overrides — sanitizer, first-match precedence, bucket/chip effect, group rep rule, rebuild-vs-CF parity. */
import { describe, it, expect, beforeEach } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow, collapseByParentSku, resolveStockThresholds, resolveThresholdRules, thresholdsFor, setActiveThresholdRules, setActiveStockThresholds, setActiveAvailability, applyAvailabilityDeadGate } = __test;

const BASE = resolveStockThresholds(undefined);
const rules = (raw: unknown) => resolveThresholdRules(raw, BASE);

beforeEach(() => {
  setActiveStockThresholds(BASE);
  setActiveThresholdRules([]);
  setActiveAvailability(null);
});

describe('resolveThresholdRules (sanitizer)', () => {
  it('drops garbage, scope-less and empty-threshold rules; keeps valid ones', () => {
    const r = rules([
      null, 'x', 42,
      { categories: ['Μπαλάκια'], thresholds: { slowMovingMaxDailySales: 0.5 } },
      { thresholds: { deadStockDays: 10 } }, // no scope
      { categories: ['Ρακέτες'], thresholds: {} }, // no thresholds
      { categories: ['Ρακέτες'], thresholds: { velocityWindowDays: 10 } }, // only excluded key
      { categories: ['Παπούτσια'], thresholds: { deadStockDays: -5, excessDaysOfCover: 200 } },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].t.slowMovingMaxDailySales).toBe(0.5);
    expect(r[1].t.excessDaysOfCover).toBe(200);
    expect(r[1].t.deadStockDays).toBe(BASE.deadStockDays); // negative dropped → inherit
  });

  it('truncates at 50 rules and normalizes supplier names', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ categories: [`c${i}`], thresholds: { deadStockDays: 1 + i } }));
    expect(rules(many)).toHaveLength(50);
    const r = rules([{ suppliers: ['  WILSON '], thresholds: { deadStockDays: 9 } }]);
    expect(r[0].sups.has('wilson')).toBe(true);
  });
});

describe('thresholdsFor (first match wins; AND across lists, OR within)', () => {
  it('matches category OR subcategory; supplier normalized; no match → brand thresholds', () => {
    setActiveThresholdRules(rules([
      { categories: ['Μπαλάκια'], suppliers: ['Wilson'], thresholds: { deadStockDays: 10 } },
      { categories: ['Μπαλάκια'], thresholds: { deadStockDays: 20 } },
    ]));
    expect(thresholdsFor('Μπαλάκια', null, 'WILSON ').deadStockDays).toBe(10); // rule 1: both matched
    expect(thresholdsFor('Μπαλάκια', null, 'Head').deadStockDays).toBe(20); // rule 1 supplier mismatch → rule 2
    expect(thresholdsFor('Άλλο', 'Μπαλάκια', 'Head').deadStockDays).toBe(20); // subcategory union
    expect(thresholdsFor('Άλλο', null, 'Head').deadStockDays).toBe(BASE.deadStockDays);
  });
});

const row = (extra: Record<string, unknown>) => ({ sku: 'S1', stock_level: 100, price: 10, ...extra });

describe('rule effect on buckets and the slow-moving chip', () => {
  it('excess threshold override flips the bucket only for the targeted category', () => {
    setActiveThresholdRules(rules([{ categories: ['Μπαλάκια'], thresholds: { excessDaysOfCover: 50 } }]));
    // 100 stock / (20 sold / 30d) = 150 days of cover → excess under the 50-day rule, healthy under default 120? 150>120 → excess either way; use 30 sold → 100d cover.
    const covered = { qty_sold_period: 30 };
    expect(productFromRow('p1', row({ category: 'Μπαλάκια', ...covered }), 'erp')?.priority_tag).toBe('excess'); // 100d > 50
    expect(productFromRow('p2', row({ category: 'Ρακέτες', ...covered }), 'erp')?.priority_tag).toBe('healthy'); // 100d ≤ 120
  });

  it('slow-moving ceiling override stamps the chip per rule in the gate pass', () => {
    setActiveThresholdRules(rules([{ categories: ['Μπαλάκια'], thresholds: { slowMovingMaxDailySales: 0.5 } }]));
    const mk = (cat: string) => productFromRow(cat, row({ category: cat, qty_sold_period: 6 }), 'erp')!; // 0.2/day
    const a = mk('Μπαλάκια');
    const b = mk('Ρακέτες');
    applyAvailabilityDeadGate([a, b]);
    expect(a.slow_moving).toBe(true); // 0.2 < 0.5
    expect(b.slow_moving).toBeUndefined(); // 0.2 ≥ default 0.1? 0.2 > 0.1 → not slow
  });
});

describe('group rows — representative rule + rebuild/CF parity', () => {
  const variants = () => [
    productFromRow('v1', { sku: 'P-1', itemGroupId: 'P', category: 'Μπαλάκια', stock_level: 60, qty_sold_period: 12, price: 5 }, 'erp')!,
    productFromRow('v2', { sku: 'P-2', itemGroupId: 'P', category: 'Ρακέτες', stock_level: 40, qty_sold_period: 6, price: 5 }, 'erp')!,
  ];

  it('the rep variant (max stock) decides the rule; both paths share collapseByParentSku (structural parity)', () => {
    setActiveThresholdRules(rules([{ categories: ['Μπαλάκια'], thresholds: { excessDaysOfCover: 50, slowMovingMaxDailySales: 1 } }]));
    // group: stock 100, sold 18 → 166d cover; rep = v1 (Μπαλάκια, stock 60) → excess by the 50-day rule; velocity 0.6 < 1 → slow chip
    const [g] = collapseByParentSku(variants());
    expect(g.priority_tag).toBe('excess');
    expect(g.slow_moving).toBe(true);
    // same inputs, second invocation (CF grouped path uses the same function) → identical
    const [g2] = collapseByParentSku(variants());
    expect(g2.priority_tag).toBe(g.priority_tag);
    expect(g2.slow_moving).toBe(g.slow_moving);
  });

  it('rule scoped to a non-rep member does not apply to the group', () => {
    setActiveThresholdRules(rules([{ categories: ['Ρακέτες'], thresholds: { excessDaysOfCover: 50 } }]));
    const [g] = collapseByParentSku(variants()); // rep is Μπαλάκια → default 120 < 166 → excess anyway; use lower cover
    // make cover 100d: sold 30 total
    setActiveThresholdRules(rules([{ categories: ['Ρακέτες'], thresholds: { excessDaysOfCover: 50 } }]));
    const vs = [
      productFromRow('v1', { sku: 'P-1', itemGroupId: 'P', category: 'Μπαλάκια', stock_level: 60, qty_sold_period: 20, price: 5 }, 'erp')!,
      productFromRow('v2', { sku: 'P-2', itemGroupId: 'P', category: 'Ρακέτες', stock_level: 40, qty_sold_period: 10, price: 5 }, 'erp')!,
    ];
    const [g3] = collapseByParentSku(vs); // 100 stock / 1/day = 100d ≤ 120 default → healthy (rule ignored)
    expect(g3.priority_tag).toBe('healthy');
    expect(g).toBeDefined();
  });
});

describe('Uncategorized sentinel', () => {
  it("a rule on 'Uncategorized' matches an empty-category row end-to-end", () => {
    setActiveThresholdRules(rules([{ categories: ['Uncategorized'], thresholds: { excessDaysOfCover: 50 } }]));
    const p = productFromRow('p1', row({ qty_sold_period: 30 }), 'erp')!; // no category → 'Uncategorized', 100d cover
    expect(p.category).toBe('Uncategorized');
    expect(p.priority_tag).toBe('excess');
  });
});
