/** Coverage for roiUtils.ts daily/monthly attributed value/spend/conversions builders, the
 * purchase-slice anti-ROAS-inflation rule, fallbacks, Meta legacy month buckets, and organic merges. */
import { describe, expect, it } from 'vitest';
import type { Campaign } from '../types';
import { makeCampaign, makeCampaignDaily } from '../test/helpers';
import {
  buildRoiTrendSeries,
  buildRoiTrendSeriesDaily,
  calculateCampaignMetrics,
  calculateChannelPerformance,
  calculateTotalRevenue,
  daysInMonthIntersectingRange,
  eachCalendarMonthInclusive,
  formatMonthKeyShort,
  getCampaignDailyAttributedConversionsInPeriod,
  getCampaignDailyAttributedSpendInPeriod,
  getCampaignDailyAttributedValueInPeriod,
  getCampaignDateForMonth,
  getCampaignMonthlyAttributedValue,
  getCampaignMonthlyAttributedValueInPeriod,
  mergeGa4OrganicDailyWithChannelFallback,
  mergeOrganicByMonthWithGa4,
  monthKeyFromDate,
  monthlyRevenueFromDailyRecord,
  normalizeOrganicPeriodToYm,
  organicRevenueForSingleDay,
  sumConversionActions,
  sumDailyRevenueInPeriod,
} from './roiUtils';

/** Sum a Map<string, number> of per-day/per-month attributed values. */
function sumMap(m: Map<string, number>): number {
  return [...m.values()].reduce((a, b) => a + b, 0);
}

describe('getCampaignDailyAttributedValueInPeriod — purchase-slice semantics', () => {
  it('uses purchase_conversion_value per day for every day once a purchase slice exists (NOT conversion_value)', () => {
    // Campaign reports purchases, so the 0-purchase day must attribute 0; its conversion_value
    // is non-purchase noise that would inflate ROAS.
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversion_value: 200, purchase_conversion_value: 150 }),
        '2026-03-08': makeCampaignDaily({ conversion_value: 90, purchase_conversion_value: 0 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(150);
    // 0-purchase day: NOT 90 (that would be the inflating fallback the design rejects).
    expect(m.get('2026-03-08')).toBeUndefined();
    expect(sumMap(m)).toBe(150);
  });

  it('a campaign with NO purchase slice anywhere falls back to conversion_value per day', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversion_value: 200 }),
        '2026-03-08': makeCampaignDaily({ conversion_value: 90 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(200);
    expect(m.get('2026-03-08')).toBe(90);
    expect(sumMap(m)).toBe(290);
  });

  it('presence of purchase_conversions (count only) on any row also flips the whole campaign to purchase mode', () => {
    // Slice detector keys off purchase_conversions OR purchase_conversion_value on ANY row, so a
    // value-less purchase count still makes other days use purchase value (0 here).
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversion_value: 200, purchase_conversions: 1 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    // purchase slice active, but no purchase_conversion_value on this row → 0 attributed value.
    expect(m.get('2026-03-07')).toBeUndefined();
    expect(sumMap(m)).toBe(0);
  });
});

describe('getCampaignDailyAttributedValueInPeriod — date filtering and key validation', () => {
  it('drops days outside [fromDate, toDate]', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      dailyMetrics: {
        '2026-03-05': makeCampaignDaily({ conversion_value: 10 }),
        '2026-03-15': makeCampaignDaily({ conversion_value: 20 }),
        '2026-03-25': makeCampaignDaily({ conversion_value: 40 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-10', '2026-03-20');
    expect(m.get('2026-03-05')).toBeUndefined();
    expect(m.get('2026-03-15')).toBe(20);
    expect(m.get('2026-03-25')).toBeUndefined();
  });

  it('ignores malformed daily keys (non YYYY-MM-DD)', () => {
    const c = {
      channel: 'Google Ads',
      dailyMetrics: {
        'not-a-date': { conversion_value: 999 },
        '2026/03/15': { conversion_value: 999 },
        '2026-03-15': { conversion_value: 20 },
      },
    } as unknown as Campaign;
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-15')).toBe(20);
    expect(sumMap(m)).toBe(20);
  });
});

describe('getCampaignDailyAttributedValueInPeriod — campaign-level fallbacks', () => {
  it('when dailyMetrics is absent, attributes the whole effective value on the campaign date inside the period', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      start_date: '2026-03-12',
      conversion_value: 500,
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-12')).toBe(500);
    expect(sumMap(m)).toBe(500);
  });

  it('no dailyMetrics and campaign date outside the period → empty map', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      start_date: '2026-02-01',
      conversion_value: 500,
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.size).toBe(0);
  });

  it('dailyMetrics present but all in-period days sum to 0 → falls back to campaign-level effective value on its date', () => {
    // In-period dailyMetrics sum to 0, so the helper plants the aggregate effective value on the
    // campaign date if that date is in-period.
    const c = makeCampaign({
      channel: 'Google Ads',
      start_date: '2026-03-15',
      conversion_value: 777,
      dailyMetrics: {
        '2026-01-10': makeCampaignDaily({ conversion_value: 50 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-15')).toBe(777);
    expect(sumMap(m)).toBe(777);
  });
});

describe('getCampaignDailyAttributedValueInPeriod — Meta legacy month buckets', () => {
  it('spreads a single YYYY-MM-01 month total equally over the overlapping days', () => {
    // Legacy Meta: one row keyed at the 1st holds the whole month; a 6-day window attributes
    // monthTotal * (6/30) spread equally over those 6 days.
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-04-01': makeCampaignDaily({ conversion_value: 300 }),
      },
    });
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-04-10', '2026-04-15');
    expect(m.size).toBe(6);
    const expectedMonthShare = 300 * (6 / 30); // = 60
    expect(sumMap(m)).toBeCloseTo(expectedMonthShare, 6);
    // Equal per-day share.
    expect(m.get('2026-04-10')).toBeCloseTo(expectedMonthShare / 6, 6);
    expect(m.get('2026-04-15')).toBeCloseTo(expectedMonthShare / 6, 6);
  });

  it('legacy month bucket honors purchase-slice: month total uses purchase_conversion_value', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-04-01': makeCampaignDaily({ conversion_value: 300, purchase_conversion_value: 120 }),
      },
    });
    // Full month window → no fractional clipping; whole purchase month total is spread.
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-04-01', '2026-04-30');
    expect(sumMap(m)).toBeCloseTo(120, 6);
  });
});

describe('getCampaignDailyAttributedSpendInPeriod — ROAS pairing (spend leg)', () => {
  it('emits amount_spent per day for normal daily rows in-period', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      dailyMetrics: {
        '2026-03-05': makeCampaignDaily({ amount_spent: 30 }),
        '2026-03-06': makeCampaignDaily({ amount_spent: 70 }),
      },
    });
    const m = getCampaignDailyAttributedSpendInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-05')).toBe(30);
    expect(m.get('2026-03-06')).toBe(70);
    expect(sumMap(m)).toBe(100);
  });

  it('spend is NOT subject to the purchase slice — it always uses amount_spent even when value is 0', () => {
    // Critical for ROAS: a day with spend but 0 purchase value must still report its spend, else
    // it looks like infinite efficiency.
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ amount_spent: 50, purchase_conversion_value: 0 }),
      },
    });
    const spend = getCampaignDailyAttributedSpendInPeriod(c, '2026-03-01', '2026-03-31');
    const value = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(spend.get('2026-03-07')).toBe(50);
    expect(value.get('2026-03-07')).toBeUndefined();
  });

  it('falls back to campaign-level amount_spent on the campaign date when dailyMetrics is missing', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      start_date: '2026-03-20',
      amount_spent: 250,
    });
    const m = getCampaignDailyAttributedSpendInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-20')).toBe(250);
  });
});

describe('getCampaignDailyAttributedConversionsInPeriod — AOV pairing (count leg)', () => {
  it('uses purchase_conversions per day once a purchase slice exists', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversions: 9, purchase_conversions: 4 }),
        '2026-03-08': makeCampaignDaily({ conversions: 5, purchase_conversions: 0 }),
      },
    });
    const m = getCampaignDailyAttributedConversionsInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(4);
    expect(m.get('2026-03-08')).toBeUndefined();
    expect(sumMap(m)).toBe(4);
  });

  it('falls back to raw conversions per day when no purchase slice exists', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversions: 9 }),
      },
    });
    const m = getCampaignDailyAttributedConversionsInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(9);
  });
});

describe('getCampaignMonthlyAttributedValue (whole-history monthly)', () => {
  it('groups dailyMetrics by calendar month with purchase-slice semantics', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': makeCampaignDaily({ conversion_value: 200, purchase_conversion_value: 150 }),
        '2026-03-20': makeCampaignDaily({ conversion_value: 200, purchase_conversion_value: 50 }),
        '2026-04-02': makeCampaignDaily({ conversion_value: 999, purchase_conversion_value: 80 }),
      },
    });
    const m = getCampaignMonthlyAttributedValue(c);
    expect(m.get('2026-03')).toBe(200); // 150 + 50, NOT 400 (conversion_value)
    expect(m.get('2026-04')).toBe(80);
  });

  it('no dailyMetrics → one bucket from campaign date + effective value', () => {
    const c = makeCampaign({ channel: 'Google Ads', start_date: '2026-05-09', conversion_value: 321 });
    const m = getCampaignMonthlyAttributedValue(c);
    expect(m.get('2026-05')).toBe(321);
  });

  it('dailyMetrics that sum to 0 → falls back to a single effective-value bucket on the campaign month', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      start_date: '2026-06-15',
      conversion_value: 444,
      dailyMetrics: {
        '2026-06-10': makeCampaignDaily({ conversion_value: 0 }),
      },
    });
    const m = getCampaignMonthlyAttributedValue(c);
    expect(m.get('2026-06')).toBe(444);
    expect(m.size).toBe(1);
  });
});

describe('getCampaignMonthlyAttributedValueInPeriod (period-clipped monthly)', () => {
  it('only counts months whose days overlap the period', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      dailyMetrics: {
        '2026-02-15': makeCampaignDaily({ conversion_value: 10 }),
        '2026-03-15': makeCampaignDaily({ conversion_value: 20 }),
        '2026-04-15': makeCampaignDaily({ conversion_value: 40 }),
      },
    });
    const m = getCampaignMonthlyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03')).toBe(20);
    expect(m.has('2026-02')).toBe(false);
    expect(m.has('2026-04')).toBe(false);
  });

  it('Meta legacy month bucket is scaled by overlap fraction within the month', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-04-01': makeCampaignDaily({ conversion_value: 300 }),
      },
    });
    // 6-day window inside April (30 days) → 300 * 6/30 = 60.
    const m = getCampaignMonthlyAttributedValueInPeriod(c, '2026-04-10', '2026-04-15');
    expect(m.get('2026-04')).toBeCloseTo(60, 6);
  });

  it('respects purchase-slice when clipping to a period', () => {
    const c = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-10': makeCampaignDaily({ conversion_value: 500, purchase_conversion_value: 120 }),
      },
    });
    const m = getCampaignMonthlyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03')).toBe(120);
  });
});

describe('calculateCampaignMetrics — ROAS / CPA / CTR edge cases', () => {
  it('zero spend → ROAS is 0 (not Infinity)', () => {
    const c = makeCampaign({ channel: 'Google Ads', amount_spent: 0, conversion_value: 500 });
    const m = calculateCampaignMetrics([c]);
    expect(m.totalSpend).toBe(0);
    expect(m.totalRevenue).toBe(500);
    expect(m.roas).toBe(0);
  });

  it('zero conversions → CPA is 0 (not Infinity)', () => {
    const c = makeCampaign({ channel: 'Google Ads', amount_spent: 100, conversions: 0 });
    const m = calculateCampaignMetrics([c]);
    expect(m.cpa).toBe(0);
  });

  it('zero impressions → CTR is 0 (not NaN)', () => {
    const c = makeCampaign({ channel: 'Google Ads', amount_spent: 100, impressions: 0, clicks: 5 });
    const m = calculateCampaignMetrics([c]);
    expect(m.ctr).toBe(0);
  });

  it('positive spend and value → ROAS = revenue / spend', () => {
    const c = makeCampaign({
      channel: 'Google Ads',
      amount_spent: 100,
      conversion_value: 350,
      conversions: 7,
      impressions: 1000,
      clicks: 50,
    });
    const m = calculateCampaignMetrics([c]);
    expect(m.roas).toBeCloseTo(3.5, 6);
    expect(m.cpa).toBeCloseTo(100 / 7, 6);
    expect(m.ctr).toBeCloseTo(5, 6); // 50/1000 * 100
  });

  it('empty campaign list → all-zero metrics, no division by zero', () => {
    const m = calculateCampaignMetrics([]);
    expect(m).toEqual({ totalSpend: 0, totalRevenue: 0, totalConversions: 0, roas: 0, cpa: 0, ctr: 0 });
  });
});

describe('calculateChannelPerformance', () => {
  it('groups by channel, computes per-channel ROAS, sorts by spend desc', () => {
    const rows = calculateChannelPerformance([
      makeCampaign({ id: 'a', channel: 'Google Ads', amount_spent: 100, conversion_value: 400 }),
      makeCampaign({ id: 'b', channel: 'Google Ads', amount_spent: 50, conversion_value: 100 }),
      makeCampaign({ id: 'c', channel: 'Meta', amount_spent: 200, conversionActions: { Purchase: { conversions: 1, value: 600 } } }),
    ]);
    const google = rows.find(r => r.channel === 'Google Ads')!;
    const meta = rows.find(r => r.channel === 'Meta')!;
    expect(google.spent).toBe(150);
    expect(google.revenue).toBe(500);
    expect(google.roas).toBeCloseTo(500 / 150, 6);
    expect(google.campaignCount).toBe(2);
    expect(meta.revenue).toBe(600);
    // Sorted by spend descending → Meta (200) before Google (150).
    expect(rows[0].channel).toBe('Meta');
  });

  it('zero-spend channel → ROAS 0', () => {
    const rows = calculateChannelPerformance([
      makeCampaign({ id: 'x', channel: 'Other', amount_spent: 0, conversion_value: 10 }),
    ]);
    expect(rows[0].roas).toBe(0);
  });
});

describe('calculateTotalRevenue', () => {
  it('adds organic revenue to summed campaign display conversion value', () => {
    const total = calculateTotalRevenue(1000, [
      makeCampaign({ channel: 'Google Ads', conversion_value: 200 }),
      makeCampaign({ channel: 'Google Ads', conversion_value: 300 }),
    ]);
    expect(total).toBe(1500);
  });
});

describe('sumConversionActions', () => {
  it('sums conversions and value across all action rows', () => {
    const res = sumConversionActions({
      Purchase: { conversions: 3, value: 90 },
      Lead: { conversions: 5, value: 0 },
    });
    expect(res).toEqual({ conv: 8, value: 90 });
  });

  it('undefined input → zeros', () => {
    expect(sumConversionActions(undefined)).toEqual({ conv: 0, value: 0 });
  });
});

describe('sumDailyRevenueInPeriod', () => {
  it('sums and rounds revenueByDay over the inclusive local range', () => {
    const revenueByDay = {
      '2026-03-01': 10.4,
      '2026-03-02': 20.3,
      '2026-03-03': 5,
      '2026-03-10': 999, // outside range, must be ignored
    };
    const s = sumDailyRevenueInPeriod(revenueByDay, '2026-03-01', '2026-03-03');
    expect(s).toBe(Math.round(10.4 + 20.3 + 5)); // 36
  });

  it('undefined map → 0', () => {
    expect(sumDailyRevenueInPeriod(undefined, '2026-03-01', '2026-03-03')).toBe(0);
  });
});

describe('organicRevenueForSingleDay', () => {
  it('spreads the monthly import total evenly across the days of the month', () => {
    // April has 30 days; €3000 month → €100/day, rounded.
    const organicByMonth = new Map([['2026-04', 3000]]);
    expect(organicRevenueForSingleDay('2026-04-15', organicByMonth)).toBe(100);
  });

  it('uses GA4 per-day value when there is no monthly import for that month', () => {
    const organicByMonth = new Map<string, number>();
    const ga4 = { '2026-04-15': 42.6 };
    expect(organicRevenueForSingleDay('2026-04-15', organicByMonth, ga4)).toBe(43);
  });

  it('monthly import takes precedence over GA4 daily when both exist', () => {
    const organicByMonth = new Map([['2026-04', 3000]]);
    const ga4 = { '2026-04-15': 9999 };
    expect(organicRevenueForSingleDay('2026-04-15', organicByMonth, ga4)).toBe(100);
  });
});

describe('mergeOrganicByMonthWithGa4', () => {
  it('fills months that have no import with the GA4 daily sum for that month', () => {
    const organicByMonth = new Map([['2026-03', 500]]);
    const ga4 = {
      '2026-04-01': 100,
      '2026-04-02': 50,
      '2026-03-15': 9999, // March already imported → must NOT be overwritten
    };
    const out = mergeOrganicByMonthWithGa4(organicByMonth, ga4);
    expect(out.get('2026-03')).toBe(500);
    expect(out.get('2026-04')).toBe(150);
  });

  it('returns a copy unchanged when GA4 map is empty', () => {
    const organicByMonth = new Map([['2026-03', 500]]);
    const out = mergeOrganicByMonthWithGa4(organicByMonth, {});
    expect(out.get('2026-03')).toBe(500);
    expect(out).not.toBe(organicByMonth);
  });
});

describe('mergeGa4OrganicDailyWithChannelFallback', () => {
  it('keeps GA4 daily values when the period already has organic data', () => {
    const ga4 = { '2026-03-10': 100, '2026-03-11': 200 };
    const out = mergeGa4OrganicDailyWithChannelFallback(
      ga4,
      9999,
      { start: '2026-03-01', end: '2026-03-31' },
      '2026-03-01',
      '2026-03-31',
    );
    // Sum-in-period > 0.5 → no channel fallback, GA4 days preserved untouched.
    expect(out['2026-03-10']).toBe(100);
    expect(out['2026-03-11']).toBe(200);
  });

  it('distributes the channel organic total over the overlap when GA4 has no data in the period', () => {
    // No GA4 data; channel total 310 over a 31-day sync, period overlaps 10 days →
    // scaledTotal = 310 * (10/31) = 100, spread over 10 days = 10/day.
    const out = mergeGa4OrganicDailyWithChannelFallback(
      {},
      310,
      { start: '2026-03-01', end: '2026-03-31' },
      '2026-03-01',
      '2026-03-10',
    );
    const keys = Object.keys(out);
    expect(keys.length).toBe(10);
    expect(out['2026-03-01']).toBeCloseTo(10, 6);
    const total = keys.reduce((s, k) => s + out[k], 0);
    expect(total).toBeCloseTo(100, 4);
  });

  it('no channel total and no GA4 → empty result', () => {
    const out = mergeGa4OrganicDailyWithChannelFallback(
      {},
      0,
      { start: '2026-03-01', end: '2026-03-31' },
      '2026-03-01',
      '2026-03-10',
    );
    expect(Object.keys(out).length).toBe(0);
  });
});

describe('calendar / month helpers', () => {
  it('eachCalendarMonthInclusive walks months across a year boundary', () => {
    expect(eachCalendarMonthInclusive('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('eachCalendarMonthInclusive returns the single month when from === to', () => {
    expect(eachCalendarMonthInclusive('2026-03', '2026-03')).toEqual(['2026-03']);
  });

  it('daysInMonthIntersectingRange counts only the days of the month within the range', () => {
    // March 2026: range 2026-03-10..2026-03-14 → 5 days; range entirely before the month → 0.
    expect(daysInMonthIntersectingRange('2026-03', '2026-03-10', '2026-03-14')).toBe(5);
    expect(daysInMonthIntersectingRange('2026-03', '2026-01-01', '2026-02-28')).toBe(0);
  });

  it('daysInMonthIntersectingRange caps at the real last day of the month', () => {
    // February 2026 (28 days): asking for the whole month bounds → 28.
    expect(daysInMonthIntersectingRange('2026-02', '2026-02-01', '2026-02-28')).toBe(28);
  });

  it('formatMonthKeyShort renders Mon YYYY and passes through invalid input', () => {
    expect(formatMonthKeyShort('2026-04')).toBe('Apr 2026');
    expect(formatMonthKeyShort('2026-13')).toBe('2026-13');
  });

  it('monthKeyFromDate produces a zero-padded YYYY-MM (local)', () => {
    expect(monthKeyFromDate(new Date(2026, 2, 9))).toBe('2026-03');
  });
});

describe('monthlyRevenueFromDailyRecord', () => {
  it('aggregates daily revenue into sorted month buckets', () => {
    const out = monthlyRevenueFromDailyRecord({
      '2026-03-01': 100,
      '2026-03-15': 50,
      '2026-02-20': 30,
      'bad-key': 9999,
    });
    expect(out).toEqual([
      { month: '2026-02', revenue: 30 },
      { month: '2026-03', revenue: 150 },
    ]);
  });
});

describe('getCampaignDateForMonth & normalizeOrganicPeriodToYm', () => {
  it('prefers start_date, then end_date', () => {
    const d = getCampaignDateForMonth(makeCampaign({ start_date: '2026-04-10', end_date: '2026-05-10' }));
    expect(d).not.toBeNull();
    expect(monthKeyFromDate(d!)).toBe('2026-04');
  });

  it('parses a "Month YYYY" period when no explicit dates', () => {
    const d = getCampaignDateForMonth(makeCampaign({ period: 'March 2026' }));
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
  });

  it('returns null when nothing parseable', () => {
    expect(getCampaignDateForMonth(makeCampaign({ period: 'whenever' }))).toBeNull();
  });

  it('normalizeOrganicPeriodToYm handles ISO, YYYY-MM, and "Month YYYY"', () => {
    expect(normalizeOrganicPeriodToYm('2026-04-15')).toBe('2026-04');
    expect(normalizeOrganicPeriodToYm('2026-04')).toBe('2026-04');
    expect(normalizeOrganicPeriodToYm('April 2026')).toBe('2026-04');
    expect(normalizeOrganicPeriodToYm(undefined)).toBeNull();
    expect(normalizeOrganicPeriodToYm('garbage')).toBeNull();
  });
});

describe('buildRoiTrendSeriesDaily (integration of the daily attributed value path)', () => {
  it('builds one row per day with rounded organic / campaigns / store and honors includeStore', () => {
    const organicByMonth = new Map([['2026-03', 300]]); // 31-day March → ~9.677/day
    const campaign = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-02': makeCampaignDaily({ conversion_value: 100, purchase_conversion_value: 80 }),
      },
    });
    const revenueByDay = { '2026-03-01': 500, '2026-03-02': 700 };

    const rows = buildRoiTrendSeriesDaily(
      organicByMonth,
      [campaign],
      revenueByDay,
      '2026-03-01',
      '2026-03-02',
      true,
    );
    expect(rows.length).toBe(2);
    const day2 = rows.find(r => r.date === '2026-03-02')!;
    // Purchase slice → campaigns = 80 (not 100), confirming the daily path is wired through.
    expect(day2.campaigns).toBe(80);
    expect(day2.storeRevenue).toBe(700);
    // 300 / 31 ≈ 9.677 → rounded 10.
    expect(rows[0].organic).toBe(10);
  });

  it('includeStore=false zeroes store revenue regardless of revenueByDay', () => {
    const rows = buildRoiTrendSeriesDaily(
      new Map(),
      [],
      { '2026-03-01': 500 },
      '2026-03-01',
      '2026-03-01',
      false,
    );
    expect(rows[0].storeRevenue).toBe(0);
  });
});

describe('buildRoiTrendSeries (monthly trend) — period clip uses purchase-slice monthly path', () => {
  it('fills every month in range and clips campaign revenue to the period', () => {
    const organicByMonth = new Map([['2026-03', 1000]]);
    const campaign = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-02-15': makeCampaignDaily({ conversion_value: 200, purchase_conversion_value: 150 }),
        '2026-03-15': makeCampaignDaily({ conversion_value: 400, purchase_conversion_value: 300 }),
      },
    });
    const monthlyStore = [{ month: '2026-03', revenue: 5000 }];

    const rows = buildRoiTrendSeries(
      organicByMonth,
      [campaign],
      monthlyStore,
      '2026-02',
      '2026-03',
      true,
      { periodClip: { fromDate: '2026-03-01', toDate: '2026-03-31' } },
    );
    expect(rows.map(r => r.monthSort)).toEqual(['2026-02', '2026-03']);

    const march = rows.find(r => r.monthSort === '2026-03')!;
    const feb = rows.find(r => r.monthSort === '2026-02')!;
    expect(march.organic).toBe(1000);
    expect(march.storeRevenue).toBe(5000);
    // Period clip excludes February's campaign data; purchase slice keeps March at 300 (not 400).
    expect(march.campaigns).toBe(300);
    expect(feb.campaigns).toBe(0);
  });

  it('without periodClip, every month with dailyMetrics contributes (whole-history)', () => {
    const campaign = makeCampaign({
      channel: 'Meta',
      dailyMetrics: {
        '2026-02-15': makeCampaignDaily({ conversion_value: 200, purchase_conversion_value: 150 }),
        '2026-03-15': makeCampaignDaily({ conversion_value: 400, purchase_conversion_value: 300 }),
      },
    });
    const rows = buildRoiTrendSeries(new Map(), [campaign], [], '2026-02', '2026-03', false);
    const feb = rows.find(r => r.monthSort === '2026-02')!;
    const march = rows.find(r => r.monthSort === '2026-03')!;
    expect(feb.campaigns).toBe(150);
    expect(march.campaigns).toBe(300);
  });
});
