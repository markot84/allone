import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import { useAttribution } from '../contexts/AttributionContext';
import type { Campaign, MetaAttributionWindow } from '../types';
import { isMetaChannel } from '../utils/roiUtils';

/**
 * Εφαρμόζει το επιλεγμένο Meta attribution window πάνω σε Meta campaigns.
 * - Αντικαθιστά aggregate purchase_conversions / purchase_conversion_value με τις τιμές του window.
 * - Κλιμακώνει αναλογικά τα per-day purchase fields στο dailyMetrics, ώστε να παραμένουν συνεπή
 *   όταν φιλτράρουμε σε date range (date-range aware metrics αθροίζουν daily purchases).
 * - Κλιμακώνει τα purchase entries στο conversionActions ώστε το conversion-type filter να παραμένει
 *   συνεπές με το επιλεγμένο window (αποφεύγουμε εμφάνιση default-window τιμών όταν το filter είναι active).
 * - Αν το metaWindows υπάρχει αλλά δεν έχει δεδομένα για το επιλεγμένο window, μηδενίζει τα purchase
 *   fields (αντί να επιστρέφει ανέπαφο το campaign με default τιμές → μεικτά aggregates).
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

    // Δεν υπάρχει καθόλου metaWindows (παλιό sync ή campaign χωρίς purchase data) → αμετάβλητο.
    if (!mw || Object.keys(mw).length === 0) return c;

    // metaWindows υπάρχει αλλά το συγκεκριμένο window δεν έχει δεδομένα (= 0 conversions).
    // Μηδενίζουμε ρητά αντί να επιστρέψουμε τις default τιμές → αποφυγή μεικτών aggregates.
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

    // Κλιμακώνει μόνο τα purchase entries στο conversionActions — non-purchase actions (Lead κ.λπ.)
    // δεν έχουν per-window δεδομένα από το Meta API, οπότε παραμένουν αμετάβλητα.
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
      // PER-130 (P1): χωρίς forceServer — με memoryLocalCache (config/firebase.ts:75-78) το
      // getDocs πάει ούτως ή άλλως στο δίκτυο όταν είμαστε online· αυτό απλώς προσθέτει
      // offline/flaky fallback + latency-compensated own writes. Η φρεσκάδα εξασφαλίζεται
      // από τα write-site invalidations (ROIAttribution, CampaignsPage, DataImport, ConnectorsPanel).
      return CampaignsService.getAll(brandId) as Promise<Campaign[]>;
    },
    enabled: !!brandId,
    /** Bounded staleness: Infinity με πρώτο fetch `[]` κλείδωνε το ROI σε κενά δεδομένα χωρίς refetch. */
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: true,
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
