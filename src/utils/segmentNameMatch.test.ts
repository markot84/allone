/** The strategy's audience is named by the model, the segments are named by the RFM writer, and
 * the two do not always agree. A dropped match exports fewer customers than the strategy covers;
 * a wrong match exports the wrong ones. Both are locked here. */
import { describe, expect, it } from 'vitest';
import { matchSegmentByName, matchSegmentsByName, normalizeSegmentName, segmentSetSignature } from './segmentNameMatch';

type Seg = { name: string; id: string };

/** The six segments the brand actually has. */
const POOL: Seg[] = [
  { id: 'champions', name: 'Champions' },
  { id: 'loyal', name: 'Loyal Customers' },
  { id: 'potential', name: 'Potential Loyalists' },
  { id: 'attention', name: 'Need Attention' },
  { id: 'cant_lose', name: "Can't Lose Them" },
  { id: 'lost', name: 'Lost' },
];

/** Verbatim from the strategy's audience card. */
const AI_NAMES = [
  'Champions',
  'Loyal Customers',
  'Potential Loyalists',
  'Customers Needing Attention',
  "Can't Lose Them",
];

describe('matchSegmentsByName', () => {
  it('resolves all five names the strategy actually produced', () => {
    expect(matchSegmentsByName(AI_NAMES, POOL).map((s) => s.id)).toEqual([
      'champions',
      'loyal',
      'potential',
      'attention',
      'cant_lose',
    ]);
  });

  it('leaves the segment the strategy did not pick alone', () => {
    expect(matchSegmentsByName(AI_NAMES, POOL).some((s) => s.id === 'lost')).toBe(false);
  });

  it('does not let a shared prefix steal another segment', () => {
    // "Loyal" is a prefix of "Loyalists"; only an exact shared word makes it a rename.
    expect(matchSegmentByName('Loyal Customers', [{ id: 'potential', name: 'Potential Loyalists' }])).toBeNull();
  });

  it('survives a curly apostrophe and stray punctuation', () => {
    expect(matchSegmentByName('Can’t Lose Them!', POOL)?.id).toBe('cant_lose');
  });

  it('ignores case, accents and the word "customers"', () => {
    expect(matchSegmentByName('CHAMPIONS', POOL)?.id).toBe('champions');
    expect(matchSegmentByName('Champion Customers', POOL)?.id).toBe('champions');
  });

  it('never returns the same segment twice', () => {
    const matched = matchSegmentsByName(['Champions', 'Champion Customers'], POOL);
    expect(matched).toHaveLength(1);
  });

  it('drops a name that describes nothing in the pool', () => {
    expect(matchSegmentsByName(['Wholesale Partners'], POOL)).toEqual([]);
  });

  it('handles an empty pool and empty names', () => {
    expect(matchSegmentsByName(AI_NAMES, [])).toEqual([]);
    expect(matchSegmentsByName([], POOL)).toEqual([]);
    expect(matchSegmentByName('', POOL)).toBeNull();
  });

  it('exact matches win before loose ones, whatever the order', () => {
    const matched = matchSegmentsByName(['Customers Needing Attention', 'Need Attention'], POOL);
    // The literal name claims the segment; the paraphrase then finds nothing left to take.
    expect(matched.map((s) => s.id)).toEqual(['attention']);
  });
});

describe('segmentSetSignature', () => {
  it('is the same set regardless of order, case or punctuation', () => {
    const a = segmentSetSignature([{ name: 'Champions' }, { name: "Can't Lose Them" }, { name: 'Lost' }]);
    const b = segmentSetSignature([{ name: 'LOST' }, { name: 'Can’t Lose Them' }, { name: 'champions' }]);
    expect(a).toBe(b);
  });

  it('changes when a segment is replaced — the case that went unnoticed for months', () => {
    const june = segmentSetSignature([{ name: 'Champions' }, { name: 'Customers Needing Attention' }]);
    const now = segmentSetSignature([{ name: 'Champions' }, { name: 'At Risk' }]);
    expect(june).not.toBe(now);
  });

  it('is empty for no segments, so a mid-load empty list is not a "changed" set', () => {
    expect(segmentSetSignature([])).toBe('');
  });
});

describe('normalizeSegmentName', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeSegmentName("Can't Lose Them")).toBe('can t lose them');
    expect(normalizeSegmentName('Πελάτες σε Κίνδυνο')).toBe('πελατες σε κινδυνο');
  });
});
