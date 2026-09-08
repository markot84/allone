/** The export was rebuilt to run in chunks because assembling a whole customer list in one
 * synchronous pass froze the tab. Only the *how* changed — these lock the output byte-for-byte
 * against the original, including across a chunk boundary. */
import { describe, expect, it } from 'vitest';
import { pickSegmentCustomers, rowsToCsv, rowsToCsvChunked } from './segmentActionPack';

describe('pickSegmentCustomers — the export carries the customers the strategy was built on', () => {
  const card = [{ customerId: 'a' }, { customerId: 'b' }];
  const megaventory = [{ customerId: 'a' }, { customerId: 'b' }, { customerId: 'c' }, { customerId: 'd' }];

  it("takes the page's own customers even when Firestore holds a larger universe", () => {
    // This was the 34K-rows-for-a-12,8K-strategy case: "larger wins" is the wrong rule.
    expect(pickSegmentCustomers(card, megaventory)).toBe(card);
  });

  it('falls back to Firestore only when the segment carries no customers itself', () => {
    expect(pickSegmentCustomers([], megaventory)).toBe(megaventory);
    expect(pickSegmentCustomers(undefined, megaventory)).toBe(megaventory);
  });

  it('is empty when neither side has anyone, so the caller can refuse honestly', () => {
    expect(pickSegmentCustomers([], [])).toEqual([]);
  });
});

/** Rows carrying every case csvEscape has to handle: separators, quotes, newlines, and the
 * leading characters a spreadsheet would execute as a formula. */
const AWKWARD: (string | number)[][] = [
  ['Customer ID', 'Email', 'Όνομα', 'Segment', 'Recency', 'Frequency', 'Monetary', 'RFM Score'],
  ['c-1', 'a@b.gr', 'Παπαδόπουλος, Γιάννης', 'Champions', 3, 12, 1450.5, '555'],
  ['c-2', 'q"uote@b.gr', 'Line\nbreak', 'At Risk', 90, 2, 30, '211'],
  ['c-3', '=cmd|calc', '+1234', '-formula', 0, 0, 0, '@tab'],
  ['c-4', '', '', 'Lost', '', '', '', ''],
];

function manyRows(n: number): (string | number)[][] {
  const out: (string | number)[][] = [AWKWARD[0]];
  for (let i = 0; i < n; i += 1) {
    const base = AWKWARD[1 + (i % 4)];
    out.push([`c-${i}`, ...base.slice(1)]);
  }
  return out;
}

describe('rowsToCsvChunked matches the synchronous builder', () => {
  it('handles separators, quotes, newlines and formula payloads identically', async () => {
    expect(await rowsToCsvChunked(AWKWARD)).toBe(rowsToCsv(AWKWARD));
  });

  it('matches across a chunk boundary', async () => {
    const rows = manyRows(4501); // spans three chunks at 2000 rows each
    expect(await rowsToCsvChunked(rows)).toBe(rowsToCsv(rows));
  });

  it('matches exactly on a chunk boundary', async () => {
    const rows = manyRows(1999); // 2000 rows with the header
    expect(await rowsToCsvChunked(rows)).toBe(rowsToCsv(rows));
  });

  it('handles an empty list and a single row', async () => {
    expect(await rowsToCsvChunked([])).toBe(rowsToCsv([]));
    expect(await rowsToCsvChunked([AWKWARD[0]])).toBe(rowsToCsv([AWKWARD[0]]));
  });
});
