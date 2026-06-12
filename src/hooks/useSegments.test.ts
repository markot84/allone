import { describe, expect, it } from 'vitest';
import { __test, type SegmentDataCoverage } from './useSegments';
import type { DataAnalysisRfmScope } from '../services/dataAnalysisRfm';
import type { RFMSegment } from '../types';

const { selectAggregateScope, ordersQueryGate, aggregateQueryGate, catalogQueryGate } = __test;

function makeSegment(overrides: Partial<RFMSegment> = {}): RFMSegment {
  return {
    id: 'champions',
    name: 'Champions',
    rfm_score: '555',
    count: 10,
    percentage: 50,
    revenue_share: 60,
    color: '#6B7280',
    description: '',
    icon: '',
    ...overrides,
  };
}

function makeCoverage(overrides: Partial<SegmentDataCoverage> = {}): SegmentDataCoverage {
  return {
    sourcePreference: 'orders',
    activeSource: 'ecommerce',
    eShopCustomers: 100,
    totalCustomers: 120,
    otherCustomers: 20,
    eShopPenetration: 83.3,
    hasEshopOrders: true,
    hasExternalData: false,
    policyLabel: 'e-shop orders',
    marketingPolicy: '',
    ...overrides,
  };
}

function makeScope(overrides: Partial<DataAnalysisRfmScope> = {}): DataAnalysisRfmScope {
  return {
    sourcePreference: 'orders',
    segments: [makeSegment()],
    totalCustomers: 120,
    ordersAttributed: 300,
    guestOrdersSkipped: 5,
    dataCoverage: makeCoverage(),
    canCompute: true,
    ...overrides,
  };
}

describe('selectAggregateScope', () => {
  it('επιστρέφει null όταν δεν υπάρχει aggregate doc (scopes undefined)', () => {
    expect(selectAggregateScope(undefined, 'identified')).toBeNull();
    expect(selectAggregateScope(undefined, 'all')).toBeNull();
  });

  it('επιστρέφει null σε first-run running/failed χωρίς preserved scopes (scopes κενό)', () => {
    expect(selectAggregateScope({}, 'identified')).toBeNull();
    expect(selectAggregateScope({}, 'all')).toBeNull();
  });

  it('keystone: running/failed ΜΕ preserved scopes ⇒ επιστρέφει το scope (το HEAD το μηδένιζε σε status !== ready)', () => {
    // Το predicate δεν βλέπει καθόλου το status — αρκεί τα scopes να υπάρχουν.
    const identified = makeScope();
    expect(selectAggregateScope({ identified }, 'identified')).toBe(identified);
  });

  it('auto-switch: identified με canCompute:false και all με canCompute:true ⇒ σερβίρει το all', () => {
    const identified = makeScope({ canCompute: false, segments: [] });
    const all = makeScope({ sourcePreference: 'external', canCompute: true });
    expect(selectAggregateScope({ identified, all }, 'identified')).toBe(all);
  });

  it('και τα δύο canCompute:false ⇒ επιστρέφει το preferred ως έχει (ο caller κάνει fallback)', () => {
    const identified = makeScope({ canCompute: false, segments: [] });
    const all = makeScope({ canCompute: false, segments: [] });
    const result = selectAggregateScope({ identified, all }, 'identified');
    expect(result).toBe(identified);
    expect(result?.canCompute).toBe(false);
  });

  it('μονόδρομο switch: preferred "all" με canCompute:false επιστρέφεται ως έχει, ακόμα κι αν το identified υπολογίζεται', () => {
    const identified = makeScope({ canCompute: true });
    const all = makeScope({ sourcePreference: 'external', canCompute: false, segments: [] });
    expect(selectAggregateScope({ identified, all }, 'all')).toBe(all);
  });

  it('absent-key chain: λείπει το preferred ⇒ fallback σε all, μετά identified, μετά null', () => {
    const all = makeScope({ sourcePreference: 'external' });
    const identified = makeScope();
    expect(selectAggregateScope({ all }, 'identified')).toBe(all);
    expect(selectAggregateScope({ identified }, 'all')).toBe(identified);
  });
});

describe('ordersQueryGate', () => {
  const base = { isDataAnalysis: false, skipOrderHydration: false, brandId: 'b1', connectedPlatformsCount: 2 };

  it('true μόνο για default variant με brand και συνδεδεμένες πλατφόρμες', () => {
    expect(ordersQueryGate(base)).toBe(true);
  });

  it('false για data_analysis variant', () => {
    expect(ordersQueryGate({ ...base, isDataAnalysis: true })).toBe(false);
  });

  it('false με skipOrderHydration (dashboard path)', () => {
    expect(ordersQueryGate({ ...base, skipOrderHydration: true })).toBe(false);
  });

  it('false χωρίς brandId', () => {
    expect(ordersQueryGate({ ...base, brandId: null })).toBe(false);
  });

  it('false χωρίς συνδεδεμένες πλατφόρμες', () => {
    expect(ordersQueryGate({ ...base, connectedPlatformsCount: 0 })).toBe(false);
  });
});

describe('aggregateQueryGate', () => {
  it('true για data_analysis variant με brand', () => {
    expect(aggregateQueryGate({ isDataAnalysis: true, useServerAggregate: false, brandId: 'b1' })).toBe(true);
  });

  it('true για useServerAggregate με brand', () => {
    expect(aggregateQueryGate({ isDataAnalysis: false, useServerAggregate: true, brandId: 'b1' })).toBe(true);
  });

  it('false χωρίς κανένα από τα δύο flags', () => {
    expect(aggregateQueryGate({ isDataAnalysis: false, useServerAggregate: false, brandId: 'b1' })).toBe(false);
  });

  it('false χωρίς brandId ακόμα και με flags', () => {
    expect(aggregateQueryGate({ isDataAnalysis: true, useServerAggregate: true, brandId: null })).toBe(false);
  });
});

describe('catalogQueryGate', () => {
  const base = {
    ordersQueryEnabled: true,
    shouldUseAggregate: false,
    hasUsableSnapshot: false,
    ordersPending: false,
    rawOrdersCount: 50,
  };

  it('true όταν τρέχει ο orders δρόμος με κατεβασμένες παραγγελίες', () => {
    expect(catalogQueryGate(base)).toBe(true);
  });

  it('false ΠΑΝΤΑ όταν shouldUseAggregate — κόβει το client-side catalogAlignment bypass', () => {
    expect(catalogQueryGate({ ...base, shouldUseAggregate: true })).toBe(false);
  });

  it('false όταν σερβίρει usable snapshot', () => {
    expect(catalogQueryGate({ ...base, hasUsableSnapshot: true })).toBe(false);
  });

  it('false όσο εκκρεμούν οι παραγγελίες', () => {
    expect(catalogQueryGate({ ...base, ordersPending: true })).toBe(false);
  });

  it('false χωρίς παραγγελίες', () => {
    expect(catalogQueryGate({ ...base, rawOrdersCount: 0 })).toBe(false);
  });

  it('false όταν το orders query είναι κλειστό', () => {
    expect(catalogQueryGate({ ...base, ordersQueryEnabled: false })).toBe(false);
  });
});
