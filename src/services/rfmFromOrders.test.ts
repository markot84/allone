/**
 * Tests for the pure RFM scoring/segmentation engine over raw e-commerce orders
 * (`computeRfmSegmentsFromEcommerceOrders` & co. in rfmFromOrders.ts).
 *
 * Focus — the deterministic, catalog-free path:
 *   - quintile R/F/M bucket assignment (assignQuintileScores via the public API),
 *   - segment labelling for representative customers (champions vs at-risk vs lost),
 *   - guest/anonymous handling (email-less orders excluded from RFM unless opted in),
 *   - the 365-day rolling window, demo/cancelled exclusions, and degenerate inputs.
 *
 * These assertions reconstruct INTENDED behaviour from the code and its Greek
 * comments; they never reach Firestore (no `fetch*` exports are exercised here).
 */
import { describe, expect, it } from 'vitest';
import type { EcommerceRawLineItem, EcommerceRawOrder } from './ecommerceRawOrders';
import { makeOrderLine } from '../test/helpers';
import {
  computeRfmSegmentsFromEcommerceOrders,
  computeRfmOrderScopeStats,
} from './rfmFromOrders';
import type { RFMSegment } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a raw e-commerce order with sensible, RFM-relevant defaults.
 * `total` drives the monetary axis (non-demo revenue == order.total).
 */
function makeOrder(overrides: Partial<EcommerceRawOrder> = {}): EcommerceRawOrder {
  const lineItems: EcommerceRawLineItem[] = overrides.lineItems ?? [makeOrderLine()];
  return {
    orderId: 'o-1',
    orderName: 'O-1',
    platform: 'shopify',
    status: 'paid',
    total: 100,
    currency: 'EUR',
    createdAt: '2026-01-15T10:00:00.000Z',
    paymentMethod: 'card',
    ...overrides,
    lineItems,
  };
}

/** ISO timestamp `days` before the anchor date. */
function isoDaysBefore(anchorIso: string, days: number): string {
  const anchor = new Date(anchorIso).getTime();
  return new Date(anchor - days * MS_PER_DAY).toISOString();
}

/** Flatten every customerId across all segments → its containing segment id. */
function segmentOfCustomer(segments: RFMSegment[], customerId: string): string | undefined {
  for (const seg of segments) {
    if ((seg.customers ?? []).some((c) => c.customerId === customerId)) return seg.id;
  }
  return undefined;
}

describe('computeRfmSegmentsFromEcommerceOrders', () => {
  describe('degenerate inputs', () => {
    it('returns canCompute=false with empty segments for no orders at all', () => {
      const result = computeRfmSegmentsFromEcommerceOrders([]);

      expect(result.canCompute).toBe(false);
      expect(result.segments).toEqual([]);
      expect(result.totalCustomers).toBe(0);
      expect(result.ordersAttributed).toBe(0);
      expect(result.guestOrdersSkipped).toBe(0);
    });

    it('returns canCompute=false when the only orders are guests (no customerKey)', () => {
      // Two anonymous orders: no customerKey, no email → excluded from RFM by default.
      const orders = [
        makeOrder({ orderId: 'g1', createdAt: '2026-03-01T10:00:00.000Z' }),
        makeOrder({ orderId: 'g2', createdAt: '2026-03-02T10:00:00.000Z' }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.canCompute).toBe(false);
      expect(result.segments).toEqual([]);
      expect(result.totalCustomers).toBe(0);
      expect(result.guestOrdersSkipped).toBe(2);
      expect(result.ordersAttributed).toBe(0);
    });
  });

  describe('guest / anonymous handling', () => {
    it('excludes email-less guest orders but counts identified ones', () => {
      const orders = [
        makeOrder({ orderId: 'guest', createdAt: '2026-03-01T10:00:00.000Z' }), // no customerKey
        makeOrder({ orderId: 'known', customerKey: 'cust-1', createdAt: '2026-03-02T10:00:00.000Z' }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.guestOrdersSkipped).toBe(1);
      expect(result.ordersAttributed).toBe(1);
      expect(result.totalCustomers).toBe(1);
      expect(result.canCompute).toBe(true);
    });

    it('includes anonymous guests as one-off customers when includeAnonymousGuests=true', () => {
      const orders = [
        makeOrder({ orderId: 'guest-a', createdAt: '2026-03-01T10:00:00.000Z' }),
        makeOrder({ orderId: 'guest-b', createdAt: '2026-03-02T10:00:00.000Z' }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders, undefined, {
        includeAnonymousGuests: true,
      });

      // Each guest order becomes its own synthetic customer key.
      expect(result.guestOrdersSkipped).toBe(0);
      expect(result.ordersAttributed).toBe(2);
      expect(result.totalCustomers).toBe(2);
      expect(result.canCompute).toBe(true);
    });
  });

  describe('exclusions (demo / cancelled / non-positive revenue / window)', () => {
    it('drops 100%-demo orders from RFM revenue', () => {
      const orders = [
        makeOrder({
          orderId: 'demo-only',
          customerKey: 'cust-demo',
          createdAt: '2026-03-01T10:00:00.000Z',
          lineItems: [makeOrderLine({ title: 'DEMO unit', price: 100, quantity: 1 })],
        }),
        makeOrder({
          orderId: 'real',
          customerKey: 'cust-real',
          createdAt: '2026-03-02T10:00:00.000Z',
        }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      // Only the non-demo customer survives.
      expect(result.totalCustomers).toBe(1);
      expect(segmentOfCustomer(result.segments, 'cust-demo')).toBeUndefined();
      expect(segmentOfCustomer(result.segments, 'cust-real')).toBeDefined();
    });

    it('drops cancelled orders (data-analysis excluded status)', () => {
      const orders = [
        makeOrder({
          orderId: 'cancelled',
          customerKey: 'cust-cxl',
          status: 'cancelled',
          createdAt: '2026-03-01T10:00:00.000Z',
        }),
        makeOrder({
          orderId: 'ok',
          customerKey: 'cust-ok',
          status: 'paid',
          createdAt: '2026-03-02T10:00:00.000Z',
        }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.totalCustomers).toBe(1);
      expect(segmentOfCustomer(result.segments, 'cust-cxl')).toBeUndefined();
      expect(segmentOfCustomer(result.segments, 'cust-ok')).toBeDefined();
    });

    it('drops orders with non-positive net revenue', () => {
      const orders = [
        makeOrder({
          orderId: 'zero',
          customerKey: 'cust-zero',
          total: 0,
          createdAt: '2026-03-01T10:00:00.000Z',
        }),
        makeOrder({
          orderId: 'paid',
          customerKey: 'cust-paid',
          total: 50,
          createdAt: '2026-03-02T10:00:00.000Z',
        }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.totalCustomers).toBe(1);
      expect(segmentOfCustomer(result.segments, 'cust-zero')).toBeUndefined();
    });

    it('ignores orders older than the 365-day rolling window relative to the latest order', () => {
      // asOf is anchored on the newest order; an order >365d before it is dropped.
      const latest = '2026-03-15T10:00:00.000Z';
      const orders = [
        makeOrder({
          orderId: 'fresh',
          customerKey: 'cust-fresh',
          createdAt: latest,
        }),
        makeOrder({
          orderId: 'ancient',
          customerKey: 'cust-ancient',
          createdAt: isoDaysBefore(latest, 400),
        }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.totalCustomers).toBe(1);
      expect(segmentOfCustomer(result.segments, 'cust-ancient')).toBeUndefined();
      expect(segmentOfCustomer(result.segments, 'cust-fresh')).toBeDefined();
    });
  });

  describe('per-customer aggregation', () => {
    it('merges multiple orders of one customer into a single customer row (frequency + monetary sum)', () => {
      const orders = [
        makeOrder({ orderId: 'a1', customerKey: 'repeat', total: 40, createdAt: '2026-03-01T10:00:00.000Z' }),
        makeOrder({ orderId: 'a2', customerKey: 'repeat', total: 60, createdAt: '2026-03-10T10:00:00.000Z' }),
        makeOrder({ orderId: 'a3', customerKey: 'repeat', total: 100, createdAt: '2026-03-20T10:00:00.000Z' }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.totalCustomers).toBe(1);
      expect(result.ordersAttributed).toBe(3);

      const row = result.segments.flatMap((s) => s.customers ?? []).find((c) => c.customerId === 'repeat');
      expect(row).toBeDefined();
      expect(row!.frequency).toBe(3);
      expect(row!.monetary).toBe(200); // 40 + 60 + 100
    });

    it('computes recency in whole days from the latest order date (last order = recency 0)', () => {
      const latest = '2026-03-20T10:00:00.000Z';
      const orders = [
        // This customer's last order is the global latest → recency 0 (asOf is its own day end).
        makeOrder({ orderId: 'r0', customerKey: 'recent', createdAt: latest }),
        // 30 days earlier.
        makeOrder({ orderId: 'r30', customerKey: 'older', createdAt: isoDaysBefore(latest, 30) }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);
      const rows = result.segments.flatMap((s) => s.customers ?? []);
      const recent = rows.find((c) => c.customerId === 'recent');
      const older = rows.find((c) => c.customerId === 'older');

      expect(recent!.recency).toBe(0);
      // asOf is end-of-day of the latest order, so a 30-day-earlier order is 30 days back.
      expect(older!.recency).toBe(30);
    });
  });

  describe('segment labelling for representative customers', () => {
    /**
     * Five customers engineered so each R/F/M axis is strictly ordered, giving
     * distinct quintile scores 5..1 (n=5 → one customer per quintile band).
     *
     * Layout (recency days back / order count / total revenue):
     *   champ   : 0d   , 5 orders, very high €  → R5 F5 M5 → Champions
     *   loyal   : ~30d , 3 orders, high €        → R4 F4 M4 → Loyal Customers (mid R/F/M)
     *   atrisk  : ~250d, 4 orders, high-ish €    → low R, high F/M → At Risk / Can't Lose
     *   lowfreq : ~120d, 2 orders, mid €
     *   lost    : ~360d, 1 order , tiny €        → R1 → Lost
     */
    const anchor = '2026-06-01T12:00:00.000Z';

    function buildCohort(): EcommerceRawOrder[] {
      const mk = (
        key: string,
        daysBack: number,
        extraOrders: number,
        eachTotal: number,
      ): EcommerceRawOrder[] => {
        const out: EcommerceRawOrder[] = [];
        for (let i = 0; i <= extraOrders; i++) {
          out.push(
            makeOrder({
              orderId: `${key}-${i}`,
              customerKey: key,
              total: eachTotal,
              // last order at `daysBack`; earlier orders spaced before it.
              createdAt: isoDaysBefore(anchor, daysBack + i * 5),
            }),
          );
        }
        return out;
      };

      return [
        ...mk('champ', 0, 4, 500), // recency 0, 5 orders, €2500
        ...mk('loyal', 30, 2, 200), // recency ~30, 3 orders, €600
        ...mk('atrisk', 250, 3, 150), // recency ~250, 4 orders, €600
        ...mk('lowfreq', 120, 1, 90), // recency ~120, 2 orders, €180
        ...mk('lost', 360, 0, 20), // recency ~360, 1 order, €20
      ];
    }

    it('labels the freshest, most frequent, highest-spend customer as Champions', () => {
      const result = computeRfmSegmentsFromEcommerceOrders(buildCohort());

      expect(result.totalCustomers).toBe(5);
      expect(segmentOfCustomer(result.segments, 'champ')).toBe('champions');
    });

    it('labels the oldest, single-order, lowest-spend customer as Hibernating (low on all axes)', () => {
      const result = computeRfmSegmentsFromEcommerceOrders(buildCohort());

      // R1 F1 M1: the `r<=2 && f<=2 && m<=2` (hibernating) rule fires *before*
      // the `r===1` (lost) rule in segmentFromRfmScores, so this customer is Hibernating.
      expect(segmentOfCustomer(result.segments, 'lost')).toBe('hibernating');
    });

    it('labels a long-dormant-but-frequent low-value customer as Lost (R1, escapes hibernating)', () => {
      // Lost is only reachable when recency is worst (R1) but the customer is NOT
      // also bottom-quintile on frequency — otherwise hibernating swallows it first.
      // Here the oldest buyer has high frequency yet the lowest monetary → 1-4-1 → Lost.
      const anchorIso = '2026-06-01T12:00:00.000Z';
      const mk = (key: string, daysBack: number, extraOrders: number, eachTotal: number): EcommerceRawOrder[] => {
        const out: EcommerceRawOrder[] = [];
        for (let i = 0; i <= extraOrders; i++) {
          out.push(
            makeOrder({
              orderId: `${key}-${i}`,
              customerKey: key,
              total: eachTotal,
              createdAt: isoDaysBefore(anchorIso, daysBack + i * 5),
            }),
          );
        }
        return out;
      };
      const orders = [
        ...mk('champ', 0, 4, 5000), // R5 F5 M5
        ...mk('A', 20, 1, 400),
        ...mk('B', 60, 0, 300),
        ...mk('C', 120, 2, 200),
        ...mk('lostie', 300, 3, 50), // oldest recency, high freq, lowest € → Lost
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(segmentOfCustomer(result.segments, 'lostie')).toBe('lost');
    });

    it('places a high-frequency / high-value but stale customer in a declining-risk segment', () => {
      const result = computeRfmSegmentsFromEcommerceOrders(buildCohort());

      // atrisk: low recency (R<=2) with strong F/M → At Risk or Can't Lose Them.
      const seg = segmentOfCustomer(result.segments, 'atrisk');
      expect(['at_risk', 'cant_lose_them']).toContain(seg);
    });

    it('assigns every identified customer to exactly one segment and tags an rfmScore', () => {
      const result = computeRfmSegmentsFromEcommerceOrders(buildCohort());

      const allRows = result.segments.flatMap((s) => s.customers ?? []);
      expect(allRows).toHaveLength(5);
      for (const row of allRows) {
        expect(row.rfmScore).toMatch(/^[1-5]-[1-5]-[1-5]$/);
      }
      // Segment counts sum to the customer total (no double counting).
      const summed = result.segments.reduce((acc, s) => acc + s.count, 0);
      expect(summed).toBe(5);
    });

    it('reports percentage and revenue_share that sum to ~100 across segments', () => {
      const result = computeRfmSegmentsFromEcommerceOrders(buildCohort());

      const pct = result.segments.reduce((a, s) => a + s.percentage, 0);
      const rev = result.segments.reduce((a, s) => a + s.revenue_share, 0);
      // Allow rounding slack (each share rounded to 0.1).
      expect(pct).toBeGreaterThan(99);
      expect(pct).toBeLessThan(101);
      expect(rev).toBeGreaterThan(99);
      expect(rev).toBeLessThan(101);
    });
  });

  describe('single-customer edge case', () => {
    it('scores a lone customer at the bottom quintile of every axis → Hibernating', () => {
      // With n=1, assignQuintileScores' cascading bands all target index 0 and the
      // last band (score 1) wins → R1 F1 M1 → Hibernating (not Champions). The single
      // customer still owns 100% of the segment count/revenue.
      const orders = [makeOrder({ orderId: 'solo', customerKey: 'solo', total: 100 })];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);

      expect(result.totalCustomers).toBe(1);
      expect(result.canCompute).toBe(true);
      const seg = result.segments[0];
      expect(seg.id).toBe('hibernating');
      expect(seg.count).toBe(1);
      expect(seg.percentage).toBe(100);
      expect(seg.revenue_share).toBe(100);
      // The rfm_score string reflects the rounded average of the lone 1-1-1 customer.
      expect(seg.customers?.[0]?.rfmScore).toBe('1-1-1');
    });
  });

  describe('behavioral / predictive enrichment surface', () => {
    it('emits behavioral + predictive profiles with sane bounded fields', () => {
      const orders = [
        makeOrder({ orderId: 's-1', customerKey: 'enriched', total: 120, paymentMethod: 'viva' }),
      ];

      const result = computeRfmSegmentsFromEcommerceOrders(orders);
      const seg = result.segments[0];

      expect(seg.behavioral).toBeDefined();
      expect(seg.predictive).toBeDefined();
      // payment_method should surface the order's method (single payment method).
      expect(seg.behavioral!.payment_method).toBe('viva');
      // bounded 0..100 scores.
      expect(seg.behavioral!.engagement_score).toBeGreaterThanOrEqual(0);
      expect(seg.behavioral!.engagement_score).toBeLessThanOrEqual(100);
      expect(seg.predictive!.churn_risk).toBeGreaterThanOrEqual(0);
      expect(seg.predictive!.churn_risk).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high', 'critical']).toContain(seg.predictive!.churn_risk_label);
    });
  });
});

describe('computeRfmOrderScopeStats', () => {
  it('separates identified customers from anonymous guest orders', () => {
    const orders = [
      makeOrder({ orderId: 'i1', customerKey: 'cust-1', createdAt: '2026-03-01T10:00:00.000Z' }),
      makeOrder({ orderId: 'i2', customerKey: 'cust-1', createdAt: '2026-03-05T10:00:00.000Z' }), // same customer
      makeOrder({ orderId: 'g1', createdAt: '2026-03-02T10:00:00.000Z' }), // guest
      makeOrder({ orderId: 'g2', createdAt: '2026-03-03T10:00:00.000Z' }), // guest
    ];

    const stats = computeRfmOrderScopeStats(orders);

    // One unique identified customer (deduped), two guest orders.
    expect(stats.identifiedCustomers).toBe(1);
    expect(stats.guestOrders).toBe(2);
    // allBuyers = identified (1) + distinct guest synthetic keys (2).
    expect(stats.allBuyers).toBe(3);
    expect(stats.canComputeIdentified).toBe(true);
    expect(stats.canComputeAll).toBe(true);
  });

  it('reports canComputeIdentified=false when only guests bought', () => {
    const orders = [
      makeOrder({ orderId: 'g1', createdAt: '2026-03-02T10:00:00.000Z' }),
      makeOrder({ orderId: 'g2', createdAt: '2026-03-03T10:00:00.000Z' }),
    ];

    const stats = computeRfmOrderScopeStats(orders);

    expect(stats.identifiedCustomers).toBe(0);
    expect(stats.canComputeIdentified).toBe(false);
    expect(stats.guestOrders).toBe(2);
    expect(stats.canComputeAll).toBe(true);
  });

  it('excludes cancelled/zero-revenue orders from both scopes', () => {
    const orders = [
      makeOrder({ orderId: 'cxl', customerKey: 'a', status: 'cancelled', createdAt: '2026-03-01T10:00:00.000Z' }),
      makeOrder({ orderId: 'zero', customerKey: 'b', total: 0, createdAt: '2026-03-02T10:00:00.000Z' }),
      makeOrder({ orderId: 'ok', customerKey: 'c', total: 30, createdAt: '2026-03-03T10:00:00.000Z' }),
    ];

    const stats = computeRfmOrderScopeStats(orders);

    expect(stats.identifiedCustomers).toBe(1); // only 'c'
    expect(stats.allBuyers).toBe(1);
  });
});
