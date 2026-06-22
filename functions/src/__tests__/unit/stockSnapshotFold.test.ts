/** Plan B+: per-location stock snapshots fold to sku→effective stock under a warehouse filter,
 *  matching the connector's rollUpStockTotalsByProduct (sum available+physical over selected
 *  locations, then effective = available>0 ? available : physical). */
import { describe, it, expect } from 'vitest';
import { foldPerLocationSnapshot, parseStockLocationsFilter, type PerLocationSnapshot } from '../../stockMovementTracker';

const SNAP: PerLocationSnapshot = {
  // ΚΑΠ=18, GLYFA=26
  multi: { '18': { a: 4, p: 4 }, '26': { a: 1, p: 1 } }, // central 4 + outlet 1
  onlyOther: { '26': { a: 3, p: 3 } }, // no ΚΑΠ stock at all
  physicalFallback: { '18': { a: 0, p: 7 } }, // reserved: available 0, physical 7
};

describe('foldPerLocationSnapshot', () => {
  it('null filter = all warehouses (sum every location)', () => {
    expect(foldPerLocationSnapshot(SNAP, null)).toEqual({ multi: 5, onlyOther: 3, physicalFallback: 7 });
  });

  it('filter to ΚΑΠ (18) keeps only central-warehouse stock', () => {
    const out = foldPerLocationSnapshot(SNAP, new Set(['18']));
    expect(out.multi).toBe(4); // 4 in ΚΑΠ, outlet 1 dropped
    expect(out.onlyOther).toBe(0); // no ΚΑΠ stock → zero
    expect(out.physicalFallback).toBe(7); // available 0 → falls back to physical
  });

  it('multi-warehouse selection sums the chosen locations', () => {
    expect(foldPerLocationSnapshot(SNAP, new Set(['18', '26'])).multi).toBe(5);
  });

  it('effective uses summed available before physical (matches the connector)', () => {
    // available sums to 4 (>0) so physical is ignored even though it is also 4
    expect(foldPerLocationSnapshot({ x: { '18': { a: 4, p: 9 } } }, new Set(['18']))).toEqual({ x: 4 });
  });
});

describe('parseStockLocationsFilter', () => {
  it('absent/empty = null (all warehouses)', () => {
    expect(parseStockLocationsFilter(undefined)).toBeNull();
    expect(parseStockLocationsFilter({ stockLocations: [] })).toBeNull();
    expect(parseStockLocationsFilter({})).toBeNull();
  });
  it('builds a trimmed id set', () => {
    expect(parseStockLocationsFilter({ stockLocations: [' 18 ', '26', ''] })).toEqual(new Set(['18', '26']));
  });
});
