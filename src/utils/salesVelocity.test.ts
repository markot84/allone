import { describe, expect, it } from 'vitest';
import { hasVelocityData, velocityPoints } from './salesVelocity';
import type { Product } from '../types';

const base: Product = {
  id: 'p1',
  name: 'Product',
  sku: 'SKU-1',
  category: 'Cat',
  margin_tier: 'high',
  margin_percentage: 40,
  stock_level: 10,
  stock_capacity: 100,
  price: 20,
};

describe('velocityPoints', () => {
  it('normalises each window to units per day, oldest first', () => {
    const points = velocityPoints({
      ...base,
      qty_sold_last_90d: 90,
      qty_sold_last_30d: 60,
      qty_sold_last_7d: 21,
    });
    expect(points.map((p) => p.rate)).toEqual([1, 2, 3]);
    expect(points[0].label).toBe('90 ημέρες');
  });

  it('drops windows the catalogue does not carry', () => {
    const points = velocityPoints({ ...base, qty_sold_last_30d: 30 });
    expect(points).toHaveLength(1);
  });

  it('keeps a genuine zero — a SKU that sold nothing is data, not a gap', () => {
    const points = velocityPoints({ ...base, qty_sold_last_90d: 0, qty_sold_last_7d: 0 });
    expect(points.map((p) => p.rate)).toEqual([0, 0]);
  });
});

describe('hasVelocityData', () => {
  it('needs two windows before a trend can be drawn', () => {
    expect(hasVelocityData([{ ...base, qty_sold_last_30d: 30 }])).toBe(false);
    expect(hasVelocityData([{ ...base, qty_sold_last_30d: 30, qty_sold_last_7d: 7 }])).toBe(true);
  });

  it('is false for a catalogue with no sales windows at all', () => {
    expect(hasVelocityData([base, { ...base, id: 'p2' }])).toBe(false);
  });
});
