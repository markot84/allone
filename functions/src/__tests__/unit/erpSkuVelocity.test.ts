/** All-channel ERP velocity: sales add quantity, credit notes subtract it, windows (7/30/90d) are
 * anchored to an explicit "now", and cancelled/void documents are ignored. */
import { describe, it, expect } from 'vitest';
import { accumulateErpInvoiceVelocity, accumulateSoftOneDocVelocity, emptyErpVelocityAccum } from '../../ecommerceAggregator';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2025-06-30T12:00:00.000Z').getTime();
const dayAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

describe('accumulateErpInvoiceVelocity', () => {
  it('sums sales quantities across channels into the right windows', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(3), lineItems: [{ sku: 'A', quantity: 2 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(20), lineItems: [{ sku: 'A', quantity: 5 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(60), lineItems: [{ sku: 'A', quantity: 8 }] }, NOW);
    expect(a.sold.get('A')).toBe(15);
    expect(a.sold7.get('A')).toBe(2);
    expect(a.sold30.get('A')).toBe(7);
    expect(a.sold90.get('A')).toBe(15);
  });

  it('credit notes subtract returned quantity (line items are positive magnitudes)', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(5), lineItems: [{ sku: 'B', quantity: 10 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'credit_note', date: dayAgo(4), lineItems: [{ sku: 'B', quantity: 3 }] }, NOW);
    expect(a.sold.get('B')).toBe(7);
    expect(a.sold30.get('B')).toBe(7);
  });

  it('tracks lastSale from sales only, not credit notes', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(10), lineItems: [{ sku: 'C', quantity: 1 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'credit_note', date: dayAgo(1), lineItems: [{ sku: 'C', quantity: 1 }] }, NOW);
    expect(a.lastSale.get('C')).toBe(new Date(`${dayAgo(10)}T12:00:00.000Z`).getTime());
  });

  it('ignores cancelled/void documents and blank skus/dates', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', status: 'Cancelled', date: dayAgo(2), lineItems: [{ sku: 'D', quantity: 9 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', status: 'Ακυρωμένο', date: dayAgo(2), lineItems: [{ sku: 'D', quantity: 9 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: '', lineItems: [{ sku: 'D', quantity: 9 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(2), lineItems: [{ sku: '', quantity: 9 }] }, NOW);
    expect(a.sold.has('D')).toBe(false);
  });

  it('tracks the positive-only split so returns derive as pos − net', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { kind: 'sales_invoice', date: dayAgo(5), lineItems: [{ sku: 'F', quantity: 10 }] }, NOW);
    accumulateErpInvoiceVelocity(a, { kind: 'credit_note', date: dayAgo(4), lineItems: [{ sku: 'F', quantity: 3 }] }, NOW);
    expect(a.pos.get('F')).toBe(10);
    expect(a.pos30.get('F')).toBe(10);
    expect(a.sold.get('F')).toBe(7); // returns = 10 − 7 = 3
  });

  it('treats a document with no kind as a sale (back-compat)', () => {
    const a = emptyErpVelocityAccum();
    accumulateErpInvoiceVelocity(a, { date: dayAgo(2), lineItems: [{ sku: 'E', quantity: 4 }] }, NOW);
    expect(a.sold.get('E')).toBe(4);
    expect(a.sold7.get('E')).toBe(4);
  });
});

describe('accumulateSoftOneDocVelocity', () => {
  it('sums SALDOC line quantities into the right windows (documentDate)', () => {
    const a = emptyErpVelocityAccum();
    accumulateSoftOneDocVelocity(a, { documentDate: dayAgo(3), lineItems: [{ sku: 'A', quantity: 2 }] }, NOW);
    accumulateSoftOneDocVelocity(a, { documentDate: dayAgo(20), lineItems: [{ sku: 'A', quantity: 5 }] }, NOW);
    accumulateSoftOneDocVelocity(a, { documentDate: dayAgo(60), lineItems: [{ sku: 'A', quantity: 8 }] }, NOW);
    expect(a.sold.get('A')).toBe(15);
    expect(a.sold7.get('A')).toBe(2);
    expect(a.sold30.get('A')).toBe(7);
    expect(a.sold90.get('A')).toBe(15);
    expect(a.lastSale.get('A')).toBe(new Date(`${dayAgo(3)}T12:00:00.000Z`).getTime());
  });

  it('falls back to SALDOC.TRNDATE (YYYY-MM-DD 00:00:00) when documentDate is absent', () => {
    const a = emptyErpVelocityAccum();
    accumulateSoftOneDocVelocity(a, { 'SALDOC.TRNDATE': `${dayAgo(2)} 00:00:00`, lineItems: [{ sku: 'B', quantity: 3 }] }, NOW);
    expect(a.sold7.get('B')).toBe(3);
  });

  it('ignores cancelled/void docs and blank skus/dates', () => {
    const a = emptyErpVelocityAccum();
    accumulateSoftOneDocVelocity(a, { 'SALDOC.STATUS': 'Ακυρωμένο', documentDate: dayAgo(2), lineItems: [{ sku: 'C', quantity: 9 }] }, NOW);
    accumulateSoftOneDocVelocity(a, { documentDate: '', lineItems: [{ sku: 'C', quantity: 9 }] }, NOW);
    accumulateSoftOneDocVelocity(a, { documentDate: dayAgo(2), lineItems: [{ sku: '', quantity: 9 }] }, NOW);
    expect(a.sold.has('C')).toBe(false);
  });
});
