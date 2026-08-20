/** PER-300: stock is shelf units — the ERP's on-hand (which adds unreceived orders) must not count. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';
const { effectiveStock } = __test;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = (o: Record<string, number>) => o as any;

describe('effectiveStock', () => {
  it('ignores available_stock — 200 expected from a work order is not stock', () => {
    expect(effectiveStock(p({ stock_on_hand: 0, available_stock: 200, stock_level: 200 }))).toBe(0);
  });

  it('uses the shelf count when the ERP reports part of it as committed', () => {
    expect(effectiveStock(p({ stock_on_hand: 4, available_stock: 2, stock_level: 2 }))).toBe(4);
  });

  it('falls back to stock_level for sources without a shelf count', () => {
    expect(effectiveStock(p({ stock_level: 7 }))).toBe(7);
    expect(effectiveStock(p({}))).toBe(0);
  });
});
