/** Receipt-date aggregation keeps the EARLIEST date per SKU across inbound documents (the real
 * first-available / stock-age anchor), regardless of document order. */
import { describe, it, expect } from 'vitest';
import { mergeEarliestReceiptDates, mergeLatestReceiptSuppliers } from '../../megaventoryConnector';

describe('mergeEarliestReceiptDates', () => {
  it('keeps the earliest date per SKU across documents', () => {
    const m = new Map<string, string>();
    mergeEarliestReceiptDates(m, [
      { date: '2025-06-01', lineItems: [{ sku: 'A' }, { sku: 'B' }] },
      { date: '2024-03-10', lineItems: [{ sku: 'A' }] }, // earlier for A
      { date: '2025-12-31', lineItems: [{ sku: 'B' }] }, // later for B, ignored
    ]);
    expect(m.get('A')).toBe('2024-03-10');
    expect(m.get('B')).toBe('2025-06-01');
  });

  it('merges into an existing map (resume across backfill passes), taking the min', () => {
    const m = new Map<string, string>([['A', '2025-01-01']]);
    mergeEarliestReceiptDates(m, [{ date: '2023-09-09', lineItems: [{ sku: 'A' }] }]);
    expect(m.get('A')).toBe('2023-09-09');
  });

  it('normalizes timestamps to YYYY-MM-DD and skips blank skus/dates', () => {
    const m = new Map<string, string>();
    mergeEarliestReceiptDates(m, [
      { date: '2025-06-01T12:34:56', lineItems: [{ sku: ' C ' }, { sku: '' }, {}] },
      { date: '', lineItems: [{ sku: 'D' }] },
    ]);
    expect(m.get('C')).toBe('2025-06-01');
    expect(m.has('D')).toBe(false);
  });
});

describe('mergeLatestReceiptSuppliers', () => {
  it('keeps the supplier of the NEWEST document per SKU, regardless of order', () => {
    const m = new Map<string, { d: string; s: string }>();
    mergeLatestReceiptSuppliers(m, [
      { date: '2025-06-01', supplier: 'WILSON', lineItems: [{ sku: 'A' }, { sku: 'B' }] },
      { date: '2024-03-10', supplier: 'HEAD', lineItems: [{ sku: 'A' }] }, // older, ignored
      { date: '2025-12-31', supplier: 'BABOLAT', lineItems: [{ sku: 'B' }] },
    ]);
    expect(m.get('A')).toEqual({ d: '2025-06-01', s: 'WILSON' });
    expect(m.get('B')).toEqual({ d: '2025-12-31', s: 'BABOLAT' });
  });

  it('merges into an existing map and skips docs without supplier or date', () => {
    const m = new Map<string, { d: string; s: string }>([['A', { d: '2025-01-01', s: 'OLD' }]]);
    mergeLatestReceiptSuppliers(m, [
      { date: '2025-02-02', supplier: 'NEW', lineItems: [{ sku: 'A' }] },
      { date: '2025-03-03', supplier: '', lineItems: [{ sku: 'A' }] },
      { date: '', supplier: 'X', lineItems: [{ sku: 'A' }] },
    ]);
    expect(m.get('A')).toEqual({ d: '2025-02-02', s: 'NEW' });
  });
});
