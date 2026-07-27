import { useEffect, useRef } from 'react';
import { useBrand } from './useBrand';
import { useSegments } from './useSegments';
import { useCampaigns } from './useCampaigns';
import { useSuppliers } from './useSuppliers';
import { useAuth } from './useAuth';
import { usePlan } from './usePlan';
import { usePriceBenchmarks } from './usePriceBenchmarks';
import { useGA4Data } from './useGA4Data';
import { runAutomationEvaluation } from '../services/automationEngine';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { logger } from '../utils/logger';
import type { Campaign, Product } from '../types';

/** Inventory triggers run server-side (nightly scheduledAlerts); module-level
 * for a stable reference so the effect doesn't re-run. */
const EMPTY_PRODUCTS: Product[] = [];

async function getRecentNewAdsCount(brandId: string): Promise<number> {
  try {
    // firstSeenAt is an ISO string (not a Timestamp) so the range filter compares string vs
    // string; lexicographic ISO-8601 comparison == chronological.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const adsQ = query(collection(db, 'competitor_ads', brandId, 'ads'), where('firstSeenAt', '>=', weekAgo));
    // Aggregation count: no doc downloads — 1 read per ≤1000 index entries.
    const snap = await getCountFromServer(adsQ);
    return snap.data().count;
  } catch {
    return 0;
  }
}

export function useAutomationRunner() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { plan } = usePlan();
  // Segments from the precomputed monthly RFM aggregate — not 400 days of orders
  const { segments, isLoading: segmentsLoading } = useSegments({ skipOrderHydration: true, useServerAggregate: true });
  const { campaigns, isLoading: campaignsLoading } = useCampaigns();
  const { suppliers } = useSuppliers();
  const { benchmarks } = usePriceBenchmarks();
  const ga4 = useGA4Data();
  const hasRun = useRef<string | null>(null);

  useEffect(() => {
    if (!currentBrand?.id || !user?.uid) return;
    if (hasRun.current === currentBrand.id) return;
    // Gate on "still loading", not "empty" — a brand with no segments must still evaluate
    // GA4/campaigns/seasonal/competitive triggers normally.
    if (segmentsLoading || campaignsLoading) return;

    const brandId = currentBrand.id;
    const timer = setTimeout(() => {
      hasRun.current = brandId;
      (async () => {
        const competitorNewAdsCount = await getRecentNewAdsCount(brandId);

        await runAutomationEvaluation({
          brandId,
          userId: user.uid,
          userName: user.displayName || user.email || '',
          plan: currentBrand.plan ?? 'growth',
          products: EMPTY_PRODUCTS, // Inventory triggers are now server-side
          segments,
          campaigns: (campaigns ?? []) as Campaign[],
          suppliers,
          priceBenchmarks: benchmarks.map(b => ({ priceDiff: b.priceDiff })),
          competitorNewAdsCount,
          ga4: ga4.hasData ? {
            dailyEntries: ga4.dailyEntries,
            trafficSources: ga4.trafficSources,
            topPages: ga4.topPages,
          } : undefined,
        });
      })().catch(err => logger.error('Automation evaluation failed:', { err }));
    }, 10_000);

    return () => clearTimeout(timer);
  }, [currentBrand, user, plan, segments, segmentsLoading, campaigns, campaignsLoading, suppliers, benchmarks, ga4.hasData, ga4.dailyEntries, ga4.trafficSources, ga4.topPages]);
}
