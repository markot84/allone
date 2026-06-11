/**
 * CODE-8 — segmentAffinities are on the app-wide 0–1 scale (rfmFromOrders category_affinity,
 * stored in data_analysis_rfm, rendered ×100 in the UI). calculateCompositeScore must scale
 * the affinity average to 0–100 so `fitScore` lines up with the other sub-scores, instead of
 * contributing ~100× too little. Verified by isolating the fit weight.
 */
import { describe, it, expect } from 'vitest';
import { calculateCompositeScore } from './compositeScore';
import type { Product } from '../types';

// Minimal product; the fit-only weights below zero out every other sub-score, so only
// fitScore reaches the total (composite = fitScore * 100/100).
const product = {
  id: 'p1', sku_id: 'p1', sku: 'p1', name: 'Test', category: 'Test',
  price: 100, margin_percentage: 30, margin_tier: 'medium',
  stock_level: 10, stock_capacity: 100,
} as unknown as Product;
const fitOnly = { profit: 0, stock: 0, strategic: 0, revenue: 0, fit: 100 };

const fitScore = (affinities?: Record<string, number>) =>
  calculateCompositeScore(product, fitOnly, affinities);

describe('calculateCompositeScore — fit scale (CODE-8)', () => {
  it('defaults to the 0–100 neutral (50) when no affinities are given', () => {
    expect(fitScore(undefined)).toBe(50);
    expect(fitScore({})).toBe(50); // empty map must not produce NaN
  });

  it('treats a 0–1 affinity on the 0–100 scale (1.0 → 100, not 1)', () => {
    expect(fitScore({ seg: 1.0 })).toBe(100);
    expect(fitScore({ seg: 0.5 })).toBe(50);
    expect(fitScore({ seg: 0.25 })).toBe(25);
  });

  it('averages multiple segments before scaling', () => {
    expect(fitScore({ a: 1.0, b: 0.0 })).toBe(50); // avg 0.5 → 50
    expect(fitScore({ a: 0.78, b: 0.69, c: 0.61 })).toBe(Math.round(((0.78 + 0.69 + 0.61) / 3) * 100));
  });

  it('clamps to [0,100] even if an out-of-range affinity slips in', () => {
    expect(fitScore({ seg: 2.0 })).toBe(100);
    expect(fitScore({ seg: -1 })).toBe(0);
  });
});
