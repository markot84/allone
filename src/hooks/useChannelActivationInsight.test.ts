import { describe, it, expect } from 'vitest';
import { flattenDeadPages } from './useChannelActivationInsight';
import type { Product } from '../types';

const p = (sku: string): Product => ({ sku } as Product);

describe('flattenDeadPages (PER-166)', () => {
  it('concatenates products across pages in order', () => {
    const out = flattenDeadPages([{ products: [p('A'), p('B')] }, { products: [p('C')] }]);
    expect(out.map((x) => x.sku)).toEqual(['A', 'B', 'C']);
  });

  it('tolerates null pages and pages without products', () => {
    const out = flattenDeadPages([null, { products: undefined }, { products: [p('A')] }, {}]);
    expect(out.map((x) => x.sku)).toEqual(['A']);
  });

  it('returns an empty array for no pages', () => {
    expect(flattenDeadPages([])).toEqual([]);
  });
});
