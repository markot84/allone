/** Reorder point = lead time × multiplier, with the supplier's own lead time winning over the brand default. */
import { describe, it, expect } from 'vitest';
import { getReorderPointDays, DEFAULT_LEAD_TIME_DAYS, DEFAULT_REORDER_MULTIPLIER } from './productUtils';

describe('getReorderPointDays', () => {
  it("uses the supplier's own lead time", () => {
    expect(getReorderPointDays(20, 30, 1.5)).toBe(30);
  });

  it('falls back to the brand default when the supplier has none', () => {
    expect(getReorderPointDays(null, 40, 1.5)).toBe(60);
    expect(getReorderPointDays(0, 40, 1.5)).toBe(60);
    expect(getReorderPointDays(undefined, 40, 1.5)).toBe(60);
  });

  it('falls back to platform defaults when nothing is configured', () => {
    expect(getReorderPointDays(null)).toBe(
      Math.round(DEFAULT_LEAD_TIME_DAYS * DEFAULT_REORDER_MULTIPLIER),
    );
  });

  it('honours a brand-specific multiplier and returns whole days', () => {
    expect(getReorderPointDays(30, 30, 1)).toBe(30);
    expect(getReorderPointDays(7, 30, 1.5)).toBe(11); // 10.5 → 11
  });
});
