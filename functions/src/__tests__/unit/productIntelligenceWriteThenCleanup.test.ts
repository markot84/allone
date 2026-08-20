/** PER-166/167 — the PI rebuild now writes new page docs in place and only deletes the leftovers
 * afterwards (write-then-cleanup), so readers serving the aggregate while status='running' never see
 * a missing-page gap (which would yield partial data or, for the strategy/channel pages, a fall back
 * to loading the full ~222k catalog). The cleanup must NEVER delete a page that's in the new set. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { stalePageIds } = __test;

describe('stalePageIds (write-then-cleanup)', () => {
  it('deletes only pages absent from the new set; never the shared (overwritten) ones', () => {
    const existing = ['b_all_1', 'b_all_2', 'b_dead_1', 'b_dead_2', 'b_healthy_1'];
    const kept = new Set(['b_all_1', 'b_dead_1', 'b_healthy_1']); // new build is smaller
    expect(stalePageIds(existing, kept).sort()).toEqual(['b_all_2', 'b_dead_2']);
  });

  it('returns nothing to delete when the new build covers every existing page', () => {
    const existing = ['b_all_1', 'b_dead_1'];
    expect(stalePageIds(existing, new Set(['b_all_1', 'b_dead_1', 'b_all_2']))).toEqual([]);
  });

  it('returns nothing on a first build (no existing pages)', () => {
    expect(stalePageIds([], new Set(['b_all_1']))).toEqual([]);
  });
});
