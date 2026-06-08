import { describe, expect, it } from 'vitest';
import { analyzePriceChangeImpact } from './priceChangeImpact';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

function order(day: string, sku: string, price: number, qty: number): EcommerceRawOrder {
  return {
    orderId: `${day}-${sku}`,
    orderName: '',
    platform: 'megaventory_invoices',
    status: '',
    total: price * qty,
    currency: 'EUR',
    createdAt: `${day}T12:00:00.000Z`,
    lineItems: [{ sku, price, quantity: qty }],
    paymentMethod: '',
    shippingMethod: '',
    customerEmail: '',
  };
}

describe('analyzePriceChangeImpact', () => {
  it('detects price increase with separate revenue and margin', () => {
    const costBySku = new Map([['SKU-A', 6]]);
    const orders = [
      ...Array.from({ length: 5 }, (_, i) => order(`2026-02-${String(10 + i).padStart(2, '0')}`, 'SKU-A', 10, 2)),
      ...Array.from({ length: 5 }, (_, i) => order(`2026-03-${String(1 + i).padStart(2, '0')}`, 'SKU-A', 12, 3)),
    ];
    const { rows, summary } = analyzePriceChangeImpact({
      orders,
      periodFrom: '2026-03-01',
      periodTo: '2026-03-31',
      costBySku,
    });
    expect(summary.detected).toBe(1);
    expect(rows[0]?.before.margin).toBeGreaterThan(0);
    expect(rows[0]?.after.margin).toBeGreaterThan(rows[0]?.before.margin);
    expect(summary.totalMarginAfter).toBeGreaterThan(summary.totalMarginBefore);
  });
});
