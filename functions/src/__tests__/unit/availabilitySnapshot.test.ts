import { describe, it, expect } from 'vitest';
import { availabilitySnapshotSkus } from '../../productIntelligenceAggregator';

const p = (sku: string, stock_on_hand: number) => ({ sku, stock_on_hand, stock_level: stock_on_hand }) as never;

describe('availabilitySnapshotSkus (PER-320)', () => {
  it('keeps only in-stock skus, deduped and sorted', () => {
    expect(availabilitySnapshotSkus([p('B', 2), p('A', 1), p('B', 3), p('C', 0), p('', 5)])).toEqual(['A', 'B']);
  });
});
