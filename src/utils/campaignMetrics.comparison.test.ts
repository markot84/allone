/**
 * Συγκριτικά tests: «canonical» metrics (roiUtils) vs αφελή αθροίσματα / edge cases.
 * Τρέξιμο: npm test
 */
import { describe, expect, it } from 'vitest';
import type { Campaign } from '../types';
import {
  bucketOverlapFraction,
  getCampaignDailyAttributedValueInPeriod,
  getEffectiveConversionValue,
  getEffectiveConversions,
  getMetaPrimaryPurchaseFromActions,
  isMetaChannel,
  metaUsesLegacyMonthBuckets,
} from './roiUtils';

function naiveSumConversionActions(
  ca: Record<string, { conversions?: number; value?: number }>
): { conv: number; value: number } {
  let conv = 0;
  let value = 0;
  for (const a of Object.values(ca)) {
    conv += a.conversions ?? 0;
    value += a.value ?? 0;
  }
  return { conv, value };
}

describe('isMetaChannel', () => {
  it('ανιχνεύει Meta case-insensitive', () => {
    expect(isMetaChannel('Meta')).toBe(true);
    expect(isMetaChannel('meta')).toBe(true);
    expect(isMetaChannel(' META ')).toBe(true);
    expect(isMetaChannel('Google Ads')).toBe(false);
  });
});

describe('getMetaPrimaryPurchaseFromActions', () => {
  it('προτιμά Purchase (Ads Manager / deduped) πριν το Pixel όταν και τα δύο έχουν δεδομένα', () => {
    const ca = {
      Purchase: { conversions: 10, value: 200 },
      'Purchase (Pixel)': { conversions: 3, value: 150 },
    };
    const row = getMetaPrimaryPurchaseFromActions(ca);
    expect(row).toEqual({ conversions: 10, value: 200 });
  });

  it('χρησιμοποιεί Purchase (Pixel) αν λείπει το standard Purchase', () => {
    const ca = {
      Purchase: { conversions: 7, value: 99 },
    };
    expect(getMetaPrimaryPurchaseFromActions(ca)).toEqual({ conversions: 7, value: 99 });
  });
});

describe('Meta effective metrics vs αφελές άθροισμα όλων των actions', () => {
  it('αποκλείει omni_purchase από effective — το naive sum θα ήταν φουσκωμένο', () => {
    const conversionActions = {
      'Purchase (Pixel)': { conversions: 2, value: 80 },
      omni_purchase: { conversions: 40, value: 8000 },
    };
    const c = { channel: 'Meta', conversionActions } as unknown as Campaign;
    const effectiveC = getEffectiveConversions(c);
    const effectiveV = getEffectiveConversionValue(c);
    const naive = naiveSumConversionActions(conversionActions);

    expect(effectiveC).toBe(2);
    expect(effectiveV).toBe(80);
    expect(naive.conv).toBe(42);
    expect(naive.value).toBe(8080);
    expect(naive.conv - effectiveC).toBe(40);
  });

  it('ίδιο row για conv και value (όχι διαφορετική ετικέτα ανά μέτρο)', () => {
    const conversionActions = {
      'Purchase (Pixel)': { conversions: 5, value: 250 },
      Purchase: { conversions: 99, value: 1 },
    };
    const c = { channel: 'Meta', conversionActions } as unknown as Campaign;
    const primary = getMetaPrimaryPurchaseFromActions(conversionActions);
    expect(primary).not.toBeNull();
    expect(primary!.conversions).toBe(99);
    expect(primary!.value).toBe(1);
    expect(getEffectiveConversions(c)).toBe(primary!.conversions);
    expect(getEffectiveConversionValue(c)).toBe(primary!.value);
  });
});

describe('Μη-Meta: effective επιστρέφει conversion_value όταν > 0', () => {
  it('Google Ads aggregate field', () => {
    const c = {
      channel: 'Google Ads',
      conversion_value: 500,
      conversions: 12,
      conversionActions: { foo: { conversions: 1, value: 1 } },
    } as unknown as Campaign;
    expect(getEffectiveConversionValue(c)).toBe(500);
    expect(getEffectiveConversions(c)).toBe(12);
  });
});

describe('bucketOverlapFraction (ημερολόγιο vs range)', () => {
  it('ημέρα μέσα στο range → 1', () => {
    expect(bucketOverlapFraction('2025-06-15', '2025-06-01', '2025-06-30')).toBe(1);
  });

  it('ημέρα έξω από το range → 0', () => {
    expect(bucketOverlapFraction('2025-07-01', '2025-06-01', '2025-06-30')).toBe(0);
  });

  it('legacy Meta month bucket: κλειδί YYYY-MM-01 μοιράζει μέρες στο μήνα', () => {
    const frac = bucketOverlapFraction('2025-06-01', '2025-06-15', '2025-06-20', {
      metaMonthBuckets: true,
    });
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThanOrEqual(1);
    // 6 μέρες / 30 (Ιούνιος) ≈ 0.2
    expect(frac).toBeCloseTo(6 / 30, 5);
  });
});

describe('metaUsesLegacyMonthBuckets', () => {
  it('true μόνο όταν όλα τα keys είναι ημέρα 01', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2025-05-01': { impressions: 1 },
        '2025-06-01': { impressions: 1 },
      },
    };
    expect(metaUsesLegacyMonthBuckets(c)).toBe(true);
  });

  it('false αν υπάρχει πραγμαική ημερήσια ημέρα', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2025-06-01': { impressions: 1 },
        '2025-06-15': { impressions: 5 },
      },
    };
    expect(metaUsesLegacyMonthBuckets(c)).toBe(false);
  });
});

describe('getCampaignDailyAttributedValueInPeriod (ημερήσιο ROAS chart)', () => {
  // Intended business logic (roiUtils.dailyMetricsHasPurchaseSlice + DashboardOverview ROAS chart):
  // if a campaign reports purchases at all, daily attributed revenue uses purchase_conversion_value
  // PER DAY — so a 0-purchase day attributes 0. Falling back to total conversion_value there would
  // fold in non-purchase conversions and inflate ROAS ("ROAS πλασματικά υψηλό" / ad-platform
  // double-counting), which the code explicitly avoids. conversion_value is used ONLY for campaigns
  // with no purchase slice at all. (The earlier test asserted the inflating fallback — it contradicted
  // the documented design and had been failing since the first commit; corrected here. See TEST-F2.)
  it('Meta purchase-slice campaign: a 0-purchase day attributes 0 (no conversion_value inflation)', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': {
          amount_spent: 50,
          conversions: 2,
          conversion_value: 200,
          purchase_conversions: 0,
          purchase_conversion_value: 0,
        },
      },
    } as unknown as Campaign;
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    // Purchase slice present (purchase_* fields) → use purchase per day; 0 purchases → no revenue.
    expect(m.get('2026-03-07')).toBeUndefined();
  });

  it('Meta purchase-slice campaign: a day with purchase_conversion_value > 0 uses the purchase value', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': {
          amount_spent: 50,
          conversion_value: 200, // total conversions (may include non-purchase)
          purchase_conversion_value: 150, // actual purchase revenue → this is what ROAS should use
        },
      },
    } as unknown as Campaign;
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(150);
  });

  it('campaign with NO purchase slice at all: falls back to conversion_value', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2026-03-07': {
          amount_spent: 50,
          conversion_value: 200,
          // no purchase_conversions / purchase_conversion_value anywhere → no purchase slice
        },
      },
    } as unknown as Campaign;
    const m = getCampaignDailyAttributedValueInPeriod(c, '2026-03-01', '2026-03-31');
    expect(m.get('2026-03-07')).toBe(200);
  });
});
