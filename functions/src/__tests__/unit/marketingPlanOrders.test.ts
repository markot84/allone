/** PER-157 — the order normalizers feeding the marketing_plan_insight CF. These are faithful ports
 * of the client's ecommerceRawOrders normalizers; lock the fields the compute reads. */
import { describe, it, expect } from 'vitest';
import { normalizeLineItem, normalizeMegaventoryInvoice, computeExVatTotal } from '../../marketingPlan/orders';

describe('normalizeLineItem', () => {
  it('maps the fields the compute reads, with snake/camel fallbacks', () => {
    const li = normalizeLineItem({ sku: 'AB-1', name: 'Shoe', quantity: '3', price: '10.5', row_total: '31.5', parent_item_id: '99' });
    expect(li).toMatchObject({ sku: 'AB-1', name: 'Shoe', quantity: 3, price: 10.5, rowTotal: 31.5, parentItemId: '99' });
  });
  it('defaults quantity/price to 0 and parentItemId to null when absent/false', () => {
    expect(normalizeLineItem({ sku: 'X' })).toMatchObject({ quantity: 0, price: 0, parentItemId: null });
    expect(normalizeLineItem({ sku: 'X', parentItemId: false }).parentItemId).toBeNull();
  });
  it('keeps a numeric parentItemId numeric (Magento configurable child detection)', () => {
    expect(normalizeLineItem({ sku: 'X', parentItemId: 42 }).parentItemId).toBe(42);
  });
});

describe('normalizeMegaventoryInvoice', () => {
  it('maps header + line items and clamps total to >=0', () => {
    const o = normalizeMegaventoryInvoice({
      documentId: 'D1', documentNo: 'INV-1', status: 'completed', netAmount: 123.45, currency: 'EUR',
      date: '2025-07-15', lineItems: [{ sku: 'S1', quantity: 2, price: 5 }, { foo: 'bar' }],
    });
    expect(o).toMatchObject({ orderId: 'D1', orderName: 'INV-1', platform: 'megaventory_invoices', total: 123.45 });
    expect(o.createdAt).toBe('2025-07-15T12:00:00.000Z');
    expect(o.lineItems).toHaveLength(1); // the {foo} line has no sku/title/name → dropped
    expect(o.lineItems[0]).toMatchObject({ sku: 'S1', quantity: 2, price: 5 });
  });
  it('parses a string netAmount and floors a negative to 0', () => {
    expect(normalizeMegaventoryInvoice({ documentId: 'D', netAmount: '88,0' as unknown as number }).total).toBe(88);
    expect(normalizeMegaventoryInvoice({ documentId: 'D', netAmount: -5 }).total).toBe(0);
  });
  it('handles a header-only invoice (no lineItems) → empty array (e-tennis 2025 cohort)', () => {
    const o = normalizeMegaventoryInvoice({ documentId: 'D', netAmount: 40.16, date: '2025-07-30' });
    expect(o.lineItems).toEqual([]);
    expect(o.total).toBe(40.16);
  });
});

describe('computeExVatTotal', () => {
  it('magento: baseSubtotal − |baseDiscount|', () => {
    expect(computeExVatTotal('magento', { baseSubtotal: 100, baseDiscountAmount: -10 })).toBe(90);
  });
  it('magento: non-EUR currency → 0 (revenue guard)', () => {
    expect(computeExVatTotal('magento', { currency: 'USD', baseCurrencyCode: 'EUR', grandTotal: 100, taxAmount: 20 })).toBe(0);
  });
  it('shopify/woo/opencart: total − tax', () => {
    expect(computeExVatTotal('shopify', { totalPrice: 50, totalTax: 8 })).toBe(42);
    expect(computeExVatTotal('woocommerce', { total: 50, totalTax: 8 })).toBe(42);
    expect(computeExVatTotal('opencart', { total: 50, totalTax: 8 })).toBe(42);
  });
});
