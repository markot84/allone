import { describe, expect, it } from 'vitest';
import {
  evaluateCommercialDecisionImpact,
  eventOverlapsPeriod,
  intersectEventWithPeriod,
} from './policyImpactAnalysis';
import type { CommercialDecisionEvent } from './commercialDecisionMemory';
import type { ProductSignal } from '../hooks/useProductSignals';

function makeEvent(overrides: Partial<CommercialDecisionEvent> = {}): CommercialDecisionEvent {
  return {
    id: 'decision-1',
    brandId: 'brand-1',
    eventType: 'discount',
    title: 'Black Friday markdown',
    source: 'manual',
    decisionDate: '2026-05-10',
    startDate: '2026-05-10',
    endDate: '2026-05-12',
    status: 'completed',
    scope: { skus: ['SKU-1'] },
    createdAt: '2026-05-01',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

function makeSignal(overrides: Partial<ProductSignal['resolved']> = {}): ProductSignal {
  return {
    resolved: {
      sku: 'SKU-1',
      qty30d: 40,
      days_of_cover: 30,
      margin_pct: 35,
      ...overrides,
    },
    provenance: {} as ProductSignal['provenance'],
    hasProcurement: true,
    hasWindowSource: true,
  };
}

describe('evaluateCommercialDecisionImpact', () => {
  it('marks completed revenue-positive decisions as winning with useful highlights', () => {
    const impact = evaluateCommercialDecisionImpact({
      event: makeEvent(),
      revenueByDay: {
        '2025-05-10': 100,
        '2025-05-11': 100,
        '2025-05-12': 100,
        '2026-05-10': 200,
        '2026-05-11': 220,
        '2026-05-12': 180,
      },
      ordersByDay: [
        { date: '2025-05-10', orders: 2 },
        { date: '2025-05-11', orders: 2 },
        { date: '2025-05-12', orders: 2 },
        { date: '2026-05-10', orders: 4 },
        { date: '2026-05-11', orders: 4 },
        { date: '2026-05-12', orders: 4 },
      ],
      campaignSpendInPeriod: 100,
      signalsBySku: new Map([['SKU-1', makeSignal()]]),
      targets: { revenueUpliftPct: 10, minRoas: 3 },
    });

    expect(impact.verdict).toBe('winning');
    expect(impact.score).toBeGreaterThanOrEqual(70);
    expect(impact.confidence).toBe('high');
    expect(impact.highlights.some((h) => h.includes('Revenue YoY'))).toBe(true);
  });

  it('keeps active decisions in learning even when early signals are positive', () => {
    const impact = evaluateCommercialDecisionImpact({
      event: makeEvent({ status: 'active' }),
      revenueByDay: {
        '2025-05-10': 100,
        '2026-05-10': 200,
      },
      ordersByDay: [
        { date: '2025-05-10', orders: 1 },
        { date: '2026-05-10', orders: 3 },
      ],
      campaignSpendInPeriod: 20,
      signalsBySku: new Map([['SKU-1', makeSignal()]]),
    });

    expect(impact.verdict).toBe('learning');
  });

  it('penalizes discount decisions that target low-margin or stock-risk SKUs', () => {
    const impact = evaluateCommercialDecisionImpact({
      event: makeEvent(),
      revenueByDay: {
        '2026-05-10': 10,
      },
      ordersByDay: [{ date: '2026-05-10', orders: 1 }],
      campaignSpendInPeriod: 0,
      signalsBySku: new Map([['SKU-1', makeSignal({ days_of_cover: 5, margin_pct: 8 })]]),
    });

    expect(impact.stockAtRiskCount).toBe(1);
    expect(impact.lowMarginCount).toBe(1);
    expect(impact.risks.join(' ')).toContain('stockout');
    expect(impact.risks.join(' ')).toContain('low margin');
  });
});

describe('decision period helpers', () => {
  it('detects overlap and intersects with selected period', () => {
    const event = makeEvent({ startDate: '2026-03-01', endDate: '2026-03-31', decisionDate: '2026-03-01' });
    expect(eventOverlapsPeriod(event, '2026-02-01', '2026-02-28')).toBe(false);
    expect(eventOverlapsPeriod(event, '2026-03-15', '2026-04-01')).toBe(true);
    expect(intersectEventWithPeriod(event, '2026-02-01', '2026-03-10')).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-10',
    });
  });
});
