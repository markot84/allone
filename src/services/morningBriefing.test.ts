import { describe, expect, it } from 'vitest';
import {
  collectBriefingData,
  computeBriefingDataHash,
  computeBriefingYearOverYear,
  briefingHeadlineRevenue,
} from './morningBriefing';
import type { AutomationAlert, Campaign, RFMSegment } from '../types';

const PERIOD = { fromDate: '2026-09-01', toDate: '2026-09-03' };

/** Same three days, one year back — what every case below compares against. */
const PREVIOUS_DAYS = ['2025-09-01', '2025-09-02', '2025-09-03'];

function campaign(over: Partial<Campaign> = {}): Campaign {
  return { id: 'c1', name: 'Campaign', channel: 'Other', ...over };
}

function emptyGa4() {
  return {
    totals: { sessions: 0, users: 0, newUsers: 0, bounceRate: 0, conversions: 0 },
    weeklyChange: null,
    hasData: false,
  };
}

describe('computeBriefingYearOverYear', () => {
  it('sums the same window one year back for e-shop revenue, orders and sessions', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: {
        '2025-08-31': 999,
        '2025-09-01': 100,
        '2025-09-02': 200,
        '2025-09-03': 300,
        '2025-09-04': 999,
        '2026-09-01': 50,
      },
      ordersByDay: PREVIOUS_DAYS.map((date, i) => ({ date, orders: i + 1 })).concat([
        { date: '2025-08-31', orders: 99 },
      ]),
      ga4DailyEntries: PREVIOUS_DAYS.map((date) => ({ date, sessions: 10 })).concat([
        { date: '2026-09-01', sessions: 777 },
      ]),
    });

    expect(yoy).toBeDefined();
    expect(yoy!.previous.revenue).toBe(600);
    expect(yoy!.previous.orders).toBe(6);
    expect(yoy!.previous.sessions).toBe(30);
    expect(yoy!.hasPreviousData).toBe(true);
    expect(yoy!.previousPeriodLabel).toContain('2025');
  });

  it('takes ad spend from the campaigns Cost and reports True ROAS, not attributed ROAS', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: { '2025-09-01': 400 },
      previousCampaigns: [
        campaign({ amount_spent: 100, conversion_value: 500 }),
        campaign({ id: 'c2', amount_spent: 100, conversion_value: 300 }),
      ],
    });

    expect(yoy!.previous.spend).toBe(200);
    // Attributed ROAS here would be 800/200 = 4x; True ROAS is store turnover 400 / 200 = 2x.
    expect(yoy!.previous.trueRoas).toBeCloseTo(2, 5);
  });

  it('reports zero True ROAS when there was no ad spend to divide by', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: { '2025-09-01': 400 },
    });

    expect(yoy!.previous.trueRoas).toBe(0);
    expect(yoy!.hasPreviousData).toBe(true);
  });

  it('falls back to organic + ads revenue when the e-shop source is not the headline', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: false,
      previousOrganicRevenue: 700,
      previousCampaigns: [campaign({ amount_spent: 50, conversion_value: 300 })],
    });

    expect(yoy!.previous.revenue).toBe(1000);
  });

  it('prefers real store revenue over the blend even when the e-shop source is inactive', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: false,
      revenueByDay: { '2025-09-02': 2500 },
      previousOrganicRevenue: 700,
      previousCampaigns: [campaign({ amount_spent: 50, conversion_value: 300 })],
    });

    expect(yoy!.previous.revenue).toBe(2500);
  });

  it('reports hasPreviousData=false for a readable but empty window', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: { '2026-09-01': 500 },
      ordersByDay: [{ date: '2026-09-01', orders: 5 }],
    });

    expect(yoy).toBeDefined();
    expect(yoy!.hasPreviousData).toBe(false);
    expect(yoy!.previous.revenue).toBe(0);
  });

  it('returns undefined when the whole previous window precedes the brand history cutoff', () => {
    expect(
      computeBriefingYearOverYear({
        period: PERIOD,
        ecommerceSourceActive: true,
        revenueByDay: { '2025-09-02': 100 },
        historyStartDate: '2026-01-01',
      })
    ).toBeUndefined();
  });

  it('keeps the comparison when the cutoff falls inside the previous window', () => {
    const yoy = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: { '2025-09-03': 100 },
      historyStartDate: '2025-09-03',
    });

    expect(yoy).toBeDefined();
    expect(yoy!.previous.revenue).toBe(100);
  });

  it('returns undefined for malformed or inverted periods', () => {
    expect(
      computeBriefingYearOverYear({ period: { fromDate: '', toDate: '2026-09-03' }, ecommerceSourceActive: true })
    ).toBeUndefined();
    expect(
      computeBriefingYearOverYear({
        period: { fromDate: '2026-09-05', toDate: '2026-09-01' },
        ecommerceSourceActive: true,
      })
    ).toBeUndefined();
  });

  it('clamps a 29 February period end to 28 February of the previous year', () => {
    const yoy = computeBriefingYearOverYear({
      period: { fromDate: '2024-02-01', toDate: '2024-02-29' },
      ecommerceSourceActive: true,
      revenueByDay: { '2023-02-28': 42 },
    });

    expect(yoy!.previous.revenue).toBe(42);
  });
});

describe('briefingHeadlineRevenue', () => {
  it('uses store revenue when the e-shop source is active, even at zero', () => {
    expect(
      briefingHeadlineRevenue({ ecommerceSourceActive: true, storeRevenue: 0, organicRevenue: 900, campaignRevenue: 100 })
    ).toBe(0);
  });

  it('blends organic and ads revenue only when there is no store revenue', () => {
    expect(
      briefingHeadlineRevenue({ ecommerceSourceActive: false, storeRevenue: 0, organicRevenue: 900, campaignRevenue: 100 })
    ).toBe(1000);
    expect(
      briefingHeadlineRevenue({ ecommerceSourceActive: false, storeRevenue: 250, organicRevenue: 900, campaignRevenue: 100 })
    ).toBe(250);
  });
});

describe('collectBriefingData with a year-over-year comparison', () => {
  const base = {
    campaigns: [] as Campaign[],
    segments: [] as RFMSegment[],
    totalOrganicRevenue: 0,
    ga4: emptyGa4(),
    alerts: [] as AutomationAlert[],
    brandName: 'Acme',
  };

  it('omits the key entirely when no comparison is passed', () => {
    expect(collectBriefingData(base).yearOverYear).toBeUndefined();
  });

  it('carries the comparison through to the briefing payload', () => {
    const yearOverYear = computeBriefingYearOverYear({
      period: PERIOD,
      ecommerceSourceActive: true,
      revenueByDay: { '2025-09-01': 500 },
    });

    const data = collectBriefingData({ ...base, yearOverYear });
    expect(data.yearOverYear?.previous.revenue).toBe(500);
  });

  it('changes the data hash so a shifted comparison regenerates the briefing', () => {
    const withoutYoy = collectBriefingData(base);
    const withYoy = collectBriefingData({
      ...base,
      yearOverYear: computeBriefingYearOverYear({
        period: PERIOD,
        ecommerceSourceActive: true,
        revenueByDay: { '2025-09-01': 500 },
      }),
    });

    expect(computeBriefingDataHash(withYoy)).not.toBe(computeBriefingDataHash(withoutYoy));
  });
});

describe('collectBriefingData inventory', () => {
  const base = {
    campaigns: [] as Campaign[],
    segments: [] as RFMSegment[],
    totalOrganicRevenue: 0,
    ga4: {
      totals: { sessions: 0, users: 0, newUsers: 0, bounceRate: 0, conversions: 0 },
      weeklyChange: null,
      hasData: false,
    },
    alerts: [] as AutomationAlert[],
    brandName: 'Acme',
  };

  const piInventory = {
    totalProducts: 4241,
    deadStock: 15,
    lowStock: 88,
    excessStock: 120,
    deadStockCapital: 389367,
    deadStockCapitalIsCost: true,
    lowStockTopNames: ['Alpha', 'Beta'],
  };

  it('is null when Product Intelligence has no aggregate, rather than zeroed', () => {
    expect(collectBriefingData(base).inventory).toBeNull();
    expect(collectBriefingData({ ...base, inventory: null }).inventory).toBeNull();
  });

  it('passes the Product Intelligence figures through untouched', () => {
    expect(collectBriefingData({ ...base, inventory: piInventory }).inventory).toEqual(piInventory);
  });

  it('feeds the data hash, so a PI rebuild regenerates the briefing', () => {
    const without = computeBriefingDataHash(collectBriefingData(base));
    const with15 = computeBriefingDataHash(collectBriefingData({ ...base, inventory: piInventory }));
    const with16 = computeBriefingDataHash(
      collectBriefingData({ ...base, inventory: { ...piInventory, deadStock: 16 } })
    );
    expect(with15).not.toBe(without);
    expect(with16).not.toBe(with15);
  });
});

describe('campaignsLoaded', () => {
  const base = {
    campaigns: [] as Campaign[],
    segments: [] as RFMSegment[],
    totalOrganicRevenue: 0,
    ga4: {
      totals: { sessions: 0, users: 0, newUsers: 0, bounceRate: 0, conversions: 0 },
      weeklyChange: null,
      hasData: false,
    },
    alerts: [] as AutomationAlert[],
    brandName: 'Acme',
  };

  it('defaults to loaded when the caller says nothing', () => {
    expect(collectBriefingData(base).revenue.campaignsLoaded).toBe(true);
  });

  it('carries a false flag so an empty list is not read as "no advertising ran"', () => {
    const data = collectBriefingData({ ...base, campaignsLoaded: false });
    expect(data.revenue.campaignsLoaded).toBe(false);
    expect(data.revenue.campaignCount).toBe(0);
  });
});
