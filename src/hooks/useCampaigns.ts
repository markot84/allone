import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';
import { useAttribution } from '../contexts/AttributionContext';
import type { Campaign, MetaAttributionWindow } from '../types';
import { isMetaChannel } from '../utils/roiUtils';

/**
 * Εφαρμόζει το επιλεγμένο Meta attribution window πάνω σε Meta campaigns.
 * - Αντικαθιστά aggregate purchase_conversions / purchase_conversion_value με τις τιμές του window.
 * - Κλιμακώνει αναλογικά τα per-day purchase fields στο dailyMetrics, ώστε να παραμένουν συνεπή
 *   όταν φιλτράρουμε σε date range (date-range aware metrics αθροίζουν daily purchases).
 */
function applyMetaAttributionWindow(
  campaigns: Campaign[],
  window: MetaAttributionWindow
): Campaign[] {
  if (window === 'default') return campaigns;

  return campaigns.map((c) => {
    if (!isMetaChannel(c.channel)) return c;
    const mw = (c as Campaign & { metaWindows?: Record<string, { conversions: number; value: number }> })
      .metaWindows;
    if (!mw || !mw[window]) return c;

    const target = mw[window];
    const currConv = c.purchase_conversions || 0;
    const currVal = c.purchase_conversion_value || 0;
    const convScale = currConv > 0 ? target.conversions / currConv : 0;
    const valScale = currVal > 0 ? target.value / currVal : 0;

    let newDailyMetrics = c.dailyMetrics;
    if (c.dailyMetrics && (convScale > 0 || valScale > 0)) {
      newDailyMetrics = {} as typeof c.dailyMetrics;
      for (const [day, row] of Object.entries(c.dailyMetrics)) {
        newDailyMetrics![day] = {
          ...row,
          purchase_conversions:
            row.purchase_conversions != null
              ? Math.round((row.purchase_conversions || 0) * convScale * 100) / 100
              : row.purchase_conversions,
          purchase_conversion_value:
            row.purchase_conversion_value != null
              ? Math.round((row.purchase_conversion_value || 0) * valScale * 100) / 100
              : row.purchase_conversion_value,
        };
      }
    }

    return {
      ...c,
      purchase_conversions: target.conversions,
      purchase_conversion_value: Math.round(target.value * 100) / 100,
      roas: (c.amount_spent || 0) > 0 ? target.value / (c.amount_spent || 1) : 0,
      dailyMetrics: newDailyMetrics,
    } as Campaign;
  });
}

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const { metaWindow } = useAttribution();
  const brandId = currentBrand?.id ?? null;
  const queryKey = ['campaigns', brandId] as const;

  const { data: rawCampaigns = [], isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!brandId) return [] as Campaign[];
      return CampaignsService.getAll(brandId, { cacheFirst: true }) as Promise<Campaign[]>;
    },
    enabled: !!brandId,
    /** Bounded staleness: Infinity με πρώτο fetch `[]` κλείδωνε το ROI σε κενά δεδομένα χωρίς refetch. */
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  });

  // Εφαρμόζει on-the-fly το επιλεγμένο Meta attribution window σε όλα τα downstream reads.
  const campaigns = useMemo(
    () => applyMetaAttributionWindow(rawCampaigns as Campaign[], metaWindow),
    [rawCampaigns, metaWindow]
  );

  return {
    campaigns,
    count: campaigns.length,
    isLoading: isPending,
    hasImported: campaigns.length > 0,
  };
}
