/** PER-320: dead only when the SKU was in stock ≥pct% of the observed availability window; no history → today's behavior. */
import { describe, it, expect, afterEach } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';
const { availabilityAllowsDead, applyAvailabilityDeadGate, setActiveAvailability, resolveStockThresholds, setActiveStockThresholds, collapseByParentSku } = __test;

const avail = (entries: Record<string, number>, observedDays: number) =>
  setActiveAvailability({ bySku: new Map(Object.entries(entries)), observedDays });

afterEach(() => {
  setActiveAvailability(null);
  setActiveStockThresholds(resolveStockThresholds(undefined));
});

describe('availabilityAllowsDead', () => {
  it('allows dead with no history (phase-in) and blocks below the pct', () => {
    expect(availabilityAllowsDead('A')).toBe(true);
    avail({ A: 100, B: 10 }, 100);
    expect(availabilityAllowsDead('A')).toBe(true); // 100%
    expect(availabilityAllowsDead('B')).toBe(false); // 10% < 80
    expect(availabilityAllowsDead('UNSEEN')).toBe(false); // 0%
  });

  it('phase-in denominator is min(window, observed): 2/2 observed days passes', () => {
    avail({ NEW: 2 }, 2);
    expect(availabilityAllowsDead('NEW')).toBe(true);
    avail({ NEW: 1 }, 2); // 50% of a 2-day history
    expect(availabilityAllowsDead('NEW')).toBe(false);
  });

  it('groups use the best member (available when any variant was)', () => {
    avail({ V1: 0, V2: 100 }, 100);
    expect(availabilityAllowsDead(['V1', 'V2'])).toBe(true);
    expect(availabilityAllowsDead(['V1'])).toBe(false);
  });

  it('respects brand-configured window/pct knobs', () => {
    setActiveStockThresholds(resolveStockThresholds({ deadStockWindowDays: 90, deadStockAvailabilityPct: 50 }));
    avail({ A: 50 }, 180); // denom = min(90, 180) = 90 → 55.6% ≥ 50
    expect(availabilityAllowsDead('A')).toBe(true);
    setActiveStockThresholds(resolveStockThresholds({ deadStockWindowDays: 90, deadStockAvailabilityPct: 60 }));
    expect(availabilityAllowsDead('A')).toBe(false);
  });
});

describe('applyAvailabilityDeadGate', () => {
  const p = (sku: string, tag: string) => ({ sku, priority_tag: tag, id: sku, name: sku, category: 'c', margin_tier: 'low', margin_percentage: 0, stock_level: 1, stock_capacity: 1, price: 1, source: 'erp' }) as never;

  it('demotes only unbacked dead rows, leaves everything else', () => {
    avail({ A: 100, B: 5 }, 100);
    const rows = [p('A', 'dead'), p('B', 'dead'), p('B', 'excess')];
    expect(applyAvailabilityDeadGate(rows)).toBe(1);
    expect(rows.map((r: { priority_tag: string }) => r.priority_tag)).toEqual(['dead', 'healthy', 'excess']);
  });

  it('stamps the slow_moving chip: 0<velocity<0.1/day, tag untouched (PER-320 B)', () => {
    const rows = [
      { ...p('S1', 'healthy'), qty_sold_period: 2 },  // 0.067/day → chip
      { ...p('S2', 'healthy'), qty_sold_period: 9 },  // 0.3/day → no chip
      { ...p('S3', 'dead') },                          // no sales → dead path, no chip
    ] as never[];
    applyAvailabilityDeadGate(rows);
    expect(rows.map((r: { slow_moving?: boolean; priority_tag: string }) => [r.slow_moving ?? false, r.priority_tag])).toEqual(
      [[true, 'healthy'], [false, 'healthy'], [false, 'dead']]);
  });

  it('collapseByParentSku stamps the group chip from summed velocity', () => {
    const rows = [
      { ...p('G-1', 'healthy'), parent_sku: 'G', qty_sold_period: 1 },
      { ...p('G-2', 'healthy'), parent_sku: 'G', qty_sold_period: 1 },
    ];
    const [group] = collapseByParentSku(rows as never[]);
    expect(group.slow_moving).toBe(true); // 2/30 = 0.067/day
  });

  it('collapseByParentSku gates the group tag by member availability', () => {
    avail({ 'P-1': 2 }, 100); // 2% availability → group must not be dead
    const rows = [
      { ...p('P-1', 'dead'), parent_sku: 'P', qty_sold_period: 0, qty_sold_lifetime: 5, stock_level: 3 },
    ];
    const [group] = collapseByParentSku(rows as never[]);
    expect(group.priority_tag).toBe('healthy');
    avail({ 'P-1': 100 }, 100);
    const [group2] = collapseByParentSku(rows as never[]);
    expect(group2.priority_tag).toBe('dead');
  });
});
