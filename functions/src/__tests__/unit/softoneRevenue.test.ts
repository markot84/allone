/** SoftOne sales-doc net amount: prefer the ingested line items (NETLINEVAL stored as rowTotal),
 * else the SALDOC.SUMAMNT header. Previously it read only NETAMOUNT/NETVALUE/… — none of which the
 * SALDOC browser returns — so revenue came out €0. */
import { describe, it, expect } from 'vitest';
import { softOneSalesDocNetAmount } from '../../ecommerceAggregator';

describe('softOneSalesDocNetAmount', () => {
  it('sums the ingested line items (rowTotal = NETLINEVAL)', () => {
    const d = { 'SALDOC.SUMAMNT': '999', lineItems: [{ rowTotal: 102.14 }, { rowTotal: 50 }] };
    expect(softOneSalesDocNetAmount(d)).toBeCloseTo(152.14, 2);
  });

  it('falls back to SALDOC.SUMAMNT when there are no line items (the bug: was €0)', () => {
    expect(softOneSalesDocNetAmount({ 'SALDOC.SUMAMNT': '220.50' })).toBeCloseTo(220.5, 2);
  });

  it('still honors an explicit net field when present (no line items)', () => {
    expect(softOneSalesDocNetAmount({ 'SALDOC.NETVALUE': '80', 'SALDOC.SUMAMNT': '99' })).toBeCloseTo(80, 2);
  });

  it('returns 0 when neither lines nor any amount field exist', () => {
    expect(softOneSalesDocNetAmount({ 'SALDOC.FINCODE': 'X' })).toBe(0);
  });
});
