import { describe, expect, it } from 'vitest';
import { buildErpHistoricalDecisionEvents } from './erpHistoricalDecisionEvents';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

function order(day: string, sku: string, price: number, qty: number): EcommerceRawOrder {
  return {
    orderId: `${day}-${sku}-${price}`,
    orderName: '',
    platform: 'megaventory_invoices',
    status: 'completed',
    total: price * qty,
    currency: 'EUR',
    createdAt: `${day}T12:00:00.000Z`,
    lineItems: [{ sku, price, quantity: qty }],
    paymentMethod: '',
    shippingMethod: '',
    customerEmail: '',
  };
}

describe('buildErpHistoricalDecisionEvents', () => {
  it('creates ERP historical price events with period dates and SKU scope', () => {
    const events = buildErpHistoricalDecisionEvents({
      brandId: 'brand-1',
      periodFrom: '2025-01-01',
      periodTo: '2025-01-31',
      orders: [
        order('2024-12-10', 'SKU-A', 10, 3),
        order('2024-12-20', 'SKU-A', 10, 3),
        order('2025-01-10', 'SKU-A', 12, 3),
        order('2025-01-20', 'SKU-A', 12, 3),
      ],
      costBySku: new Map([['SKU-A', 6]]),
      skuNames: new Map([['SKU-A', 'Product A']]),
    });

    const priceEvent = events.find((event) => event.eventType === 'pricing');
    expect(priceEvent).toMatchObject({
      brandId: 'brand-1',
      source: 'erp_history',
      decisionDate: '2025-01-01',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      scope: { skus: ['SKU-A'], description: 'Product A' },
    });
    expect(priceEvent?.changes?.find((change) => change.label === 'Avg price')).toMatchObject({
      before: 10,
      after: 12,
    });
    expect(priceEvent?.performance).toMatchObject({
      periodRevenue: 72,
      baselineRevenue: 60,
      periodOrders: 6,
      baselineOrders: 6,
      avgPriceBefore: 10,
      avgPriceAfter: 12,
      unitLabel: 'μονάδες SKU',
    });
  });

  it('ignores small price noise below the ERP detection threshold', () => {
    const events = buildErpHistoricalDecisionEvents({
      brandId: 'brand-1',
      periodFrom: '2025-01-01',
      periodTo: '2025-01-31',
      orders: [
        order('2024-12-10', 'SKU-A', 10, 4),
        order('2025-01-10', 'SKU-A', 10.2, 4),
      ],
      costBySku: new Map([['SKU-A', 6]]),
    });

    expect(events).toHaveLength(0);
  });

  it('creates ERP stock pressure events from procurement context', () => {
    const events = buildErpHistoricalDecisionEvents({
      brandId: 'brand-1',
      periodFrom: '2025-01-01',
      periodTo: '2025-01-31',
      orders: [
        order('2024-12-10', 'SKU-STOCK', 20, 5),
        order('2025-01-10', 'SKU-STOCK', 20, 5),
      ],
      costBySku: new Map([['SKU-STOCK', 12]]),
      stockBySku: new Map([['SKU-STOCK', { daysOfCover: 3, availableStock: 1 }]]),
    });

    const stockEvent = events.find((event) => event.eventType === 'stock');
    expect(stockEvent).toMatchObject({
      source: 'erp_history',
      eventType: 'stock',
      decisionDate: '2025-01-01',
      scope: { skus: ['SKU-STOCK'] },
    });
  });
});
