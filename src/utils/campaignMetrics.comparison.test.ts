/** Comparison tests: canonical metrics (roiUtils) vs naive sums / edge cases. */
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
  it('detects Meta case-insensitively', () => {
    expect(isMetaChannel('Meta')).toBe(true);
    expect(isMetaChannel('meta')).toBe(true);
    expect(isMetaChannel(' META ')).toBe(true);
    expect(isMetaChannel('Google Ads')).toBe(false);
  });
});

describe('getMetaPrimaryPurchaseFromActions', () => {
  it('prefers Purchase (Ads Manager / deduped) over Pixel when both have data', () => {
    const ca = {
      Purchase: { conversions: 10, value: 200 },
      'Purchase (Pixel)': { conversions: 3, value: 150 },
    };
    const row = getMetaPrimaryPurchaseFromActions(ca);
    expect(row).toEqual({ conversions: 10, value: 200 });
  });

  it('uses Purchase (Pixel) when the standard Purchase is missing', () => {
    const ca = {
      Purchase: { conversions: 7, value: 99 },
    };
    expect(getMetaPrimaryPurchaseFromActions(ca)).toEqual({ conversions: 7, value: 99 });
  });
});

describe('Meta effective metrics vs naive sum of all actions', () => {
  it('excludes omni_purchase from effective — the naive sum would be inflated', () => {
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

  it('same row for conv and value (not a different label per metric)', () => {
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

describe('Non-Meta: effective returns conversion_value when > 0', () => {
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

describe('bucketOverlapFraction (calendar vs range)', () => {
  it('day inside the range → 1', () => {
    expect(bucketOverlapFraction('2025-06-15', '2025-06-01', '2025-06-30')).toBe(1);
  });

  it('day outside the range → 0', () => {
    expect(bucketOverlapFraction('2025-07-01', '2025-06-01', '2025-06-30')).toBe(0);
  });

  it('legacy Meta month bucket: key YYYY-MM-01 splits days across the month', () => {
    const frac = bucketOverlapFraction('2025-06-01', '2025-06-15', '2025-06-20', {
      metaMonthBuckets: true,
    });
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThanOrEqual(1);
    // 6 days / 30 (June) ≈ 0.2
    expect(frac).toBeCloseTo(6 / 30, 5);
  });
});

describe('metaUsesLegacyMonthBuckets', () => {
  it('true only when all keys are day 01', () => {
    const c = {
      channel: 'Meta',
      dailyMetrics: {
        '2025-05-01': { impressions: 1 },
        '2025-06-01': { impressions: 1 },
      },
    };
    expect(metaUsesLegacyMonthBuckets(c)).toBe(true);
  });

  it('false when a real daily day exists', () => {
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

describe('getCampaignDailyAttributedValueInPeriod (daily ROAS chart)', () => {
  // If a campaign reports purchases, daily revenue uses purchase_conversion_value per day (0-purchase day → 0);
  // falling back to conversion_value would inflate ROAS. conversion_value is used ONLY when no purchase slice exists.
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
          conversion_value: 200, // total conversion value (may include non-purchase)
          purchase_conversion_value: 150, // actual purchase revenue, this is what ROAS should use
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
