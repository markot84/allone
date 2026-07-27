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
  it('returns null when there is no aggregate doc (scopes undefined)', () => {
    expect(selectAggregateScope(undefined, 'identified')).toBeNull();
    expect(selectAggregateScope(undefined, 'all')).toBeNull();
  });

  it('returns null on first-run running/failed without preserved scopes (empty scopes)', () => {
    expect(selectAggregateScope({}, 'identified')).toBeNull();
    expect(selectAggregateScope({}, 'all')).toBeNull();
  });

  it('keystone: running/failed WITH preserved scopes returns the scope', () => {
    // The predicate never looks at status — it only needs the scopes to exist.
    const identified = makeScope();
    expect(selectAggregateScope({ identified }, 'identified')).toBe(identified);
  });

  it('auto-switch: identified canCompute:false and all canCompute:true serves all', () => {
    const identified = makeScope({ canCompute: false, segments: [] });
    const all = makeScope({ sourcePreference: 'external', canCompute: true });
    expect(selectAggregateScope({ identified, all }, 'identified')).toBe(all);
  });

  it('both canCompute:false returns the preferred as-is (caller does the fallback)', () => {
    const identified = makeScope({ canCompute: false, segments: [] });
    const all = makeScope({ canCompute: false, segments: [] });
    const result = selectAggregateScope({ identified, all }, 'identified');
    expect(result).toBe(identified);
    expect(result?.canCompute).toBe(false);
  });

  it('one-way switch: preferred "all" with canCompute:false is returned as-is, even if identified can compute', () => {
    const identified = makeScope({ canCompute: true });
    const all = makeScope({ sourcePreference: 'external', canCompute: false, segments: [] });
    expect(selectAggregateScope({ identified, all }, 'all')).toBe(all);
  });

  it('absent-key chain: preferred missing falls back to all, then identified, then null', () => {
    const all = makeScope({ sourcePreference: 'external' });
    const identified = makeScope();
    expect(selectAggregateScope({ all }, 'identified')).toBe(all);
    expect(selectAggregateScope({ identified }, 'all')).toBe(identified);
  });
});

describe('ordersQueryGate', () => {
  const base = { isDataAnalysis: false, skipOrderHydration: false, brandId: 'b1', connectedPlatformsCount: 2 };

  it('true only for default variant with brand and connected platforms', () => {
    expect(ordersQueryGate(base)).toBe(true);
  });

  it('false for data_analysis variant', () => {
    expect(ordersQueryGate({ ...base, isDataAnalysis: true })).toBe(false);
  });

  it('false with skipOrderHydration (dashboard path)', () => {
    expect(ordersQueryGate({ ...base, skipOrderHydration: true })).toBe(false);
  });

  it('false without brandId', () => {
    expect(ordersQueryGate({ ...base, brandId: null })).toBe(false);
  });

  it('false without connected platforms', () => {
    expect(ordersQueryGate({ ...base, connectedPlatformsCount: 0 })).toBe(false);
  });
});

describe('aggregateQueryGate', () => {
  it('true for data_analysis variant with brand', () => {
    expect(aggregateQueryGate({ isDataAnalysis: true, useServerAggregate: false, brandId: 'b1' })).toBe(true);
  });

  it('true for useServerAggregate with brand', () => {
    expect(aggregateQueryGate({ isDataAnalysis: false, useServerAggregate: true, brandId: 'b1' })).toBe(true);
  });

  it('false without either flag', () => {
    expect(aggregateQueryGate({ isDataAnalysis: false, useServerAggregate: false, brandId: 'b1' })).toBe(false);
  });

  it('false without brandId even with flags', () => {
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

  it('true when the orders path runs with fetched orders', () => {
    expect(catalogQueryGate(base)).toBe(true);
  });

  it('ALWAYS false when shouldUseAggregate — cuts the client-side catalogAlignment bypass', () => {
    expect(catalogQueryGate({ ...base, shouldUseAggregate: true })).toBe(false);
  });

  it('false when serving a usable snapshot', () => {
    expect(catalogQueryGate({ ...base, hasUsableSnapshot: true })).toBe(false);
  });

  it('false while orders are pending', () => {
    expect(catalogQueryGate({ ...base, ordersPending: true })).toBe(false);
  });

  it('false without orders', () => {
    expect(catalogQueryGate({ ...base, rawOrdersCount: 0 })).toBe(false);
  });

  it('false when the orders query is disabled', () => {
    expect(catalogQueryGate({ ...base, ordersQueryEnabled: false })).toBe(false);
  });
});
