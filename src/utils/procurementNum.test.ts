import { describe, it, expect } from 'vitest';
import { parseNum } from './procurementNum';

describe('parseNum', () => {
  it('reads Greek format (dots thousands, comma decimal)', () => {
    expect(parseNum('1.234,56')).toBe(1234.56);
    expect(parseNum('1.451.382,00')).toBe(1451382);
    expect(parseNum('0,5')).toBe(0.5);
  });

  it('reads multiple dots as thousands (unambiguous)', () => {
    expect(parseNum('1.234.567')).toBe(1234567);
  });

  it('reads plain decimals', () => {
    expect(parseNum('15.24')).toBe(15.24);
    expect(parseNum('7.8500000000000005')).toBeCloseTo(7.85);
    expect(parseNum('5.34232558139535')).toBeCloseTo(5.3423);
  });

  /** PER-186: these four values are the real safeblock ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ cells that a
   *  "3 decimals means Greek thousands" rule multiplied by 1000 — 4 rows out of 929 turned
   *  Αξία Αποθέματος into €1,451,382 instead of €289,341. */
  it('reads a single dot with exactly 3 decimals as a decimal, not thousands', () => {
    expect(parseNum('9.004')).toBe(9.004);
    expect(parseNum('18.436')).toBe(18.436);
    expect(parseNum('11.735')).toBe(11.735);
    expect(parseNum('0.838')).toBe(0.838);
  });

  it('does not inflate the stock-value KPI (the PER-186 regression)', () => {
    // stock × cost for the four offending rows: with the old rule this summed to ~1000× too much.
    const rows = [
      { stock: '1', cost: '9.004' },
      { stock: '1', cost: '18.436' },
      { stock: '1', cost: '11.735' },
      { stock: '1', cost: '0.838' },
    ];
    const total = rows.reduce((s, r) => s + parseNum(r.stock) * parseNum(r.cost), 0);
    expect(total).toBeCloseTo(40.013);
    expect(total).toBeLessThan(100); // old behaviour: 40013
  });

  it('handles blanks, numbers and junk', () => {
    expect(parseNum(null)).toBe(0);
    expect(parseNum('')).toBe(0);
    expect(parseNum('  ')).toBe(0);
    expect(parseNum(42)).toBe(42);
    expect(parseNum(NaN)).toBe(0);
    expect(parseNum('abc')).toBe(0);
  });
});
