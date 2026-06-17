import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import { useAttribution } from '../contexts/AttributionContext';
import type { Campaign, MetaAttributionWindow } from '../types';
import { isMetaChannel } from '../utils/roiUtils';

/** Applies the selected Meta attribution window over Meta campaigns: swaps aggregate purchase
 * fields for the window's, scales dailyMetrics + conversionActions purchases, zeroes if no window data. */
function applyMetaAttributionWindow(
  campaigns: Campaign[],
  window: MetaAttributionWindow
): Campaign[] {
  if (window === 'default') return campaigns;

  return campaigns.map((c) => {
    if (!isMetaChannel(c.channel)) return c;
    const mw = (c as Campaign & { metaWindows?: Record<string, { conversions: number; value: number }> })
      .metaWindows;

    // No metaWindows at all (old sync or campaign without purchase data) -> unchanged.
    if (!mw || Object.keys(mw).length === 0) return c;

    // metaWindows exists but this window has no data — zero out explicitly instead of
    // returning default values, to avoid mixed aggregates.
    if (!mw[window]) {
      const zeroedCa = c.conversionActions
        ? Object.fromEntries(
            Object.entries(c.conversionActions as Record<string, { conversions: number; value: number }>).map(
              ([label, vals]) =>
                label.toLowerCase().includes('purchase')
                  ? [label, { conversions: 0, value: 0 }]
                  : [label, vals]
            )
          )
        : c.conversionActions;
      return {
        ...c,
        purchase_conversions: 0,
        purchase_conversion_value: 0,
        roas: 0,
        conversionActions: zeroedCa,
      } as Campaign;
    }

    const target = mw[window];
    const currConv = c.purchase_conversions || 0;
    const currVal = c.purchase_conversion_value || 0;
    const convScale = currConv > 0 ? target.conversions / currConv : 0;
    const valScale = currVal > 0 ? target.value / currVal : 0;

    // Scale only purchase entries in conversionActions — non-purchase actions (Lead etc.)
    // have no per-window data from the Meta API, so they stay unchanged.
    let newConversionActions = c.conversionActions;
    if (c.conversionActions) {
      const ca = c.conversionActions as Record<string, { conversions: number; value: number }>;
      newConversionActions = Object.fromEntries(
        Object.entries(ca).map(([label, vals]) => {
          if (!label.toLowerCase().includes('purchase')) return [label, vals];
          return [
            label,
            {
              conversions: Math.round((vals.conversions || 0) * convScale * 100) / 100,
              value: Math.round((vals.value || 0) * valScale * 100) / 100,
            },
          ];
        })
      ) as typeof c.conversionActions;
    }

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
      conversionActions: newConversionActions,
      dailyMetrics: newDailyMetrics,
    } as Campaign;
  });
}

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const { metaWindow } = useAttribution();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';
  const queryKey = ['campaigns', brandId, syncVersion] as const;

  const { data: rawCampaigns = [], isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!brandId) return [] as Campaign[];
      // No forceServer — with memoryLocalCache getDocs hits the network anyway when online;
      // freshness is ensured by write-site invalidations.
      return CampaignsService.getAll(brandId) as Promise<Campaign[]>;
    },
    // Don't fetch under the throwaway 'pending' syncVersion key — warm boots dedupe for
    // free (brandSyncVersion is persisted); cold boots cost +<=1 RTT.
    enabled: !!brandId && syncVersion !== 'pending',
    /** Bounded staleness: Infinity with a first fetch of `[]` locked ROI to empty data without refetch. */
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  });

  // Applies the selected Meta attribution window on-the-fly to all downstream reads.
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
