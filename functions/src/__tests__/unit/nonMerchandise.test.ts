import { describe, expect, it } from 'vitest';
import { buildIsNonStocked, readNonMerchandise } from '../../nonMerchandise';

const none = buildIsNonStocked(readNonMerchandise(undefined));
const etennis = buildIsNonStocked(
  readNonMerchandise({
    nonMerchandise: {
      categories: ['plejimo', 'Δωροεπιταγές'],
      nameContains: ['Court Cards', 'Discount', 'false', 'Unstrung'],
    },
  })
);

describe('nonMerchandise', () => {
  it('empty rules preserve platform behavior exactly', () => {
    expect(none({ sku: 'discount', name: 'x' })).toBe(true);
    expect(none({ sku: 'shipping-1', name: 'x' })).toBe(true);
    expect(none({ sku: 'a', name: 'Shipping πωλήσεων' })).toBe(true);
    expect(none({ sku: 'demo-1', name: 'x' })).toBe(true);
    expect(none({ sku: 'a', name: 'Babolat Pure Drive', category: 'plejimo' })).toBe(false);
  });

  it('category match is exact-equals, accent/case-insensitive', () => {
    expect(etennis({ sku: 'a', name: 'x', category: 'ΔΩΡΟΕΠΙΤΑΓΕΣ' })).toBe(true);
    expect(etennis({ sku: 'a', name: 'x', category: 'Plejimo' })).toBe(true);
    expect(etennis({ sku: 'a', name: 'x', category: 'plejimo accessories' })).toBe(false);
  });

  it('name arm matches substrings regardless of category', () => {
    expect(etennis({ sku: 'a', name: 'Court Cards Numbering', category: 'Uncategorized' })).toBe(true);
    expect(etennis({ sku: 'a', name: 'Head Speed Unstrung' })).toBe(true);
    expect(etennis({ sku: 'a', name: 'Babolat Pure Drive' })).toBe(false);
  });

  it('missing fields do not throw', () => {
    expect(etennis({})).toBe(false);
    expect(none({})).toBe(false);
  });

  it('readNonMerchandise tolerates malformed shapes', () => {
    expect(readNonMerchandise({ nonMerchandise: { categories: 'x', nameContains: [1, '', null] } as never }))
      .toEqual({ categories: [], nameContains: ['1'] });
  });
});
