/** PER-188: buildQueryFacets omit-one semantics — own dimension stays full, others narrow. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow, buildQueryFacets } = __test;

// In-stock rows (stock>0, recent sales) so the default includeNoStock gate keeps them all.
const rows = [
  productFromRow('p1', { sku: 'S1', brand: 'A', category: 'X', stock_level: 10, qty_sold_period: 30 }, 'erp')!,
  productFromRow('p2', { sku: 'S2', brand: 'A', category: 'Y', stock_level: 10, qty_sold_period: 30 }, 'erp')!,
  productFromRow('p3', { sku: 'S3', brand: 'B', category: 'Z', stock_level: 10, qty_sold_period: 30 }, 'erp')!,
];

const ids = (f: Array<{ id: string; count: number }>) => f.map((r) => r.id).sort();

describe('buildQueryFacets — omit-one dependent options (PER-188)', () => {
  it('no filter → every value appears in each dimension', () => {
    const f = buildQueryFacets(rows, { brandId: 'b' });
    expect(ids(f.categories)).toEqual(['X', 'Y', 'Z']);
    expect(ids(f.brands)).toEqual(['A', 'B']);
  });

  it('picking brand A narrows categories to A only, but brands stays full (own dimension omitted)', () => {
    const f = buildQueryFacets(rows, { brandId: 'b', brands: ['A'] });
    expect(ids(f.categories)).toEqual(['X', 'Y']); // Z (brand B) drops out
    expect(ids(f.brands)).toEqual(['A', 'B']); // brand list keeps all values
  });

  it('picking category Z narrows brands to B, but categories stays full', () => {
    const f = buildQueryFacets(rows, { brandId: 'b', categories: ['Z'] });
    expect(ids(f.brands)).toEqual(['B']);
    expect(ids(f.categories)).toEqual(['X', 'Y', 'Z']);
  });

  it('no-stock rows are excluded from tag facets when includeNoStock is not set (no dead options)', () => {
    const withDead = [
      ...rows,
      productFromRow('p4', { sku: 'S4', brand: 'A', category: 'X', stock_level: 0, qty_sold_period: 0 }, 'erp')!,
    ];
    const f = buildQueryFacets(withDead, { brandId: 'b' });
    expect(f.tags.map((t) => t.id)).not.toContain('no_stock');
    const withNoStock = buildQueryFacets(withDead, { brandId: 'b', includeNoStock: true });
    expect(withNoStock.tags.map((t) => t.id)).toContain('no_stock');
  });
});
