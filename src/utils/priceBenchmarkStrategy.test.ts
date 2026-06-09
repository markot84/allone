import { describe, it, expect } from 'vitest';
import { calculatePriceBenchmarkAdvantageScore } from './priceBenchmarkStrategy';

const score = (priceDiff: number) =>
  calculatePriceBenchmarkAdvantageScore({
    productId: 'p',
    gtin: 'g',
    benchmarkPrice: 100,
    priceDiff,
    yourPrice: 100 + priceDiff,
  });

describe('calculatePriceBenchmarkAdvantageScore (LOGIC-6)', () => {
  it('is monotonically decreasing — cheaper scores higher than at-market scores higher than overpriced', () => {
    expect(score(-30)).toBeGreaterThan(score(0));
    expect(score(0)).toBeGreaterThan(score(30));
    expect(score(-2)).toBeGreaterThan(score(2));
  });

  it('stays within [0,100]', () => {
    for (const d of [-300, -30, -2, 0, 2, 30, 300]) {
      const s = score(d);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('scores at-market (priceDiff 0) at 50', () => {
    expect(score(0)).toBe(50);
  });

  it('returns the neutral 22 when there is no benchmark', () => {
    expect(calculatePriceBenchmarkAdvantageScore(undefined)).toBe(22);
    expect(score(0) !== 22).toBe(true);
  });
});
