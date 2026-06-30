import { describe, it, expect } from 'vitest';
import { computeOrderExVatRevenue } from '../../ecommerceAggregator';

describe('computeOrderExVatRevenue — magento credit-memo netting', () => {
  it('un-refunded order: subtotal − discount unchanged (backward-compatible, no refund fields)', () => {
    expect(computeOrderExVatRevenue('magento', { baseSubtotal: 100, baseDiscountAmount: -10 })).toBe(90);
  });

  it('partial refund: nets ex-VAT refunded merchandise (subtotal_refunded − |discount_refunded|)', () => {
    // 100 − 10 = 90 net; refund half: 50 refunded − 5 discount refunded = 45 → remaining 45
    const r = computeOrderExVatRevenue('magento', {
      baseSubtotal: 100, baseDiscountAmount: -10,
      baseSubtotalRefunded: 50, baseDiscountRefunded: -5,
    });
    expect(r).toBe(45);
  });

  it('full refund value never drives revenue negative', () => {
    const r = computeOrderExVatRevenue('magento', {
      baseSubtotal: 100, baseDiscountAmount: 0, baseSubtotalRefunded: 200,
    });
    expect(r).toBe(0);
  });

  it('non-base-currency path nets local subtotal_refunded too', () => {
    const r = computeOrderExVatRevenue('magento', {
      baseSubtotal: 0, subtotal: 80, discountAmount: 0, currency: 'EUR',
      subtotalRefunded: 30, discountRefunded: 0,
    });
    expect(r).toBe(50);
  });

  it('refund fields ignored for non-magento platforms', () => {
    // shopify uses totalPrice − tax; refund fields are magento-only and must not interfere
    const r = computeOrderExVatRevenue('shopify', { totalPrice: 100, baseSubtotalRefunded: 50 });
    expect(r).toBe(100);
  });
});
