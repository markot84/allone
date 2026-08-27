import { describe, it, expect } from 'vitest';
import { normalizeStockAge } from '../../megaventoryNormalizer';

describe('normalizeStockAge (Excel-serial Stock_Age_Days)', () => {
  it('converts date serials to an age in days', () => {
    const todaySerial = Date.now() / 86400000 + 25569;
    expect(normalizeStockAge(44240)).toBe(Math.round(todaySerial - 44240)); // ≈ Feb 2021 → ~2000d
    expect(normalizeStockAge(Math.round(todaySerial))).toBeLessThanOrEqual(1); // "today" serial → ~0
  });

  it('passes plausible day-counts and empties through', () => {
    expect(normalizeStockAge(365)).toBe(365);
    expect(normalizeStockAge(0)).toBe(0);
    expect(normalizeStockAge(undefined)).toBeUndefined();
  });
});
