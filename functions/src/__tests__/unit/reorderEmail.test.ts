/** Per-supplier reorder-email grouping: buckets, lead-time fallback chain, reorder-point rounding, row cap. */
import { describe, it, expect } from 'vitest';
import { groupReorderRows, type ReorderRow } from '../../reorderEmail';

const row = (sku: string, supplier?: string): ReorderRow => ({ sku, name: sku, supplier });

describe('groupReorderRows', () => {
  it('groups by supplier (normalized) and sorts by product count desc', () => {
    const groups = groupReorderRows(
      [row('a', ' wilson '), row('b', 'WILSON'), row('c', 'Head')],
      [{ name: 'Wilson', lead_time: 10 }, { name: 'Head', lead_time: 5 }],
      {},
    );
    expect(groups.map((g) => g.supplier)).toEqual(['wilson', 'Head']);
    expect(groups[0].total).toBe(2);
  });

  it('buckets rows without a supplier last under the no-supplier label', () => {
    const groups = groupReorderRows(
      [row('a', 'Wilson'), row('b'), row('c')],
      [{ name: 'Wilson', lead_time: 10 }],
      {},
    );
    expect(groups[groups.length - 1].supplier).toBe('Χωρίς προμηθευτή');
    expect(groups[groups.length - 1].total).toBe(2);
  });

  it('resolves lead time via supplier > brand default > 30 and rounds reorder point', () => {
    const groups = groupReorderRows(
      [row('a', 'Wilson'), row('b', 'Head'), row('c')],
      [{ name: 'Wilson', lead_time: 10 }, { name: 'Head' }],
      { defaultLeadTimeDays: 20, reorderWarningMultiplier: 1.5 },
    );
    const by = (s: string) => groups.find((g) => g.supplier === s)!;
    expect(by('Wilson').leadTimeDays).toBe(10); // supplier lead
    expect(by('Head').leadTimeDays).toBe(20); // brand default
    expect(by('Χωρίς προμηθευτή').leadTimeDays).toBe(20); // brand default
    expect(by('Wilson').reorderPointDays).toBe(15); // round(10 * 1.5)
    // brand default 30 when neither set
    expect(groupReorderRows([row('x', 'Nike')], [], {})[0].leadTimeDays).toBe(30);
  });

  it('caps rows at 40 per supplier and reports the overflow', () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(`s${i}`, 'Wilson'));
    const [g] = groupReorderRows(rows, [{ name: 'Wilson', lead_time: 7 }], {});
    expect(g.rows).toHaveLength(40);
    expect(g.overflow).toBe(5);
    expect(g.total).toBe(45);
  });
});
