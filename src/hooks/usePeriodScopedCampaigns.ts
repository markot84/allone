import { useMemo } from 'react';
import type { Campaign } from '../types';
import { bucketOverlapFraction, metaUsesLegacyMonthBuckets } from '../utils/roiUtils';

/**
 * Προσαρμόζει τα `dailyMetrics` των καμπανιών στο κλειστό [fromDate, toDate]
 * (ίδια λογική με Dashboard / ROI για συνεπείς μετρήσεις περιόδου).
 */
export function usePeriodScopedCampaigns(
  campaigns: Campaign[] | undefined,
  periodDates: { fromDate: string; toDate: string }
): Campaign[] {
  return useMemo(() => {
    const list = campaigns ?? [];
    const { fromDate, toDate } = periodDates;
    return list.map((c) => {
      const dm = (c as unknown as { dailyMetrics?: Record<string, unknown> }).dailyMetrics as
        | Record<string, any>
        | undefined;
      if (!dm || Object.keys(dm).length === 0) return c;

      let impressions = 0,
        clicks = 0,
        conversions = 0,
        amount_spent = 0,
        conversion_value = 0;
      const convActions: Record<string, { conversions: number; value: number }> = {};

      const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
      for (const [date, m] of Object.entries(dm)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate, { metaMonthBuckets });
        if (frac <= 0) continue;
        impressions += Math.round((m.impressions || 0) * frac);
        clicks += Math.round((m.clicks || 0) * frac);
        conversions += (m.conversions || 0) * frac;
        amount_spent += (m.amount_spent || 0) * frac;
        conversion_value += (m.conversion_value || 0) * frac;
        if (m.conversionActions) {
          for (const [label, vals] of Object.entries(
            m.conversionActions as Record<string, { conversions: number; value: number }>
          )) {
            if (!convActions[label]) convActions[label] = { conversions: 0, value: 0 };
            convActions[label].conversions += (vals.conversions || 0) * frac;
            convActions[label].value += (vals.value || 0) * frac;
          }
        }
      }
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      amount_spent = Math.round(amount_spent * 100) / 100;
      return {
        ...c,
        impressions,
        clicks,
        conversions,
        amount_spent,
        conversion_value,
        ctr,
        conversionActions: convActions,
      };
    });
  }, [campaigns, periodDates.fromDate, periodDates.toDate]);
}
