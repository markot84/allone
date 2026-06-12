import { useEffect, useRef } from 'react';
import { useBrand } from './useBrand';
import { useProducts } from './useProducts';
import { useSegments } from './useSegments';
import { useCampaigns } from './useCampaigns';
import { useSuppliers } from './useSuppliers';
import { useAuth } from './useAuth';
import { usePlan } from './usePlan';
import { usePriceBenchmarks } from './usePriceBenchmarks';
import { useGA4Data } from './useGA4Data';
import { runAutomationEvaluation } from '../services/automationEngine';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { logger } from '../utils/logger';
import type { Campaign } from '../types';

async function getRecentNewAdsCount(brandId: string): Promise<number> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const adsCol = collection(db, 'competitor_ads', brandId, 'ads');
    const snap = await getDocs(adsCol);
    return snap.docs.filter(d => (d.data().firstSeenAt || '') >= weekAgo).length;
  } catch {
    return 0;
  }
}

export function useAutomationRunner() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { plan } = usePlan();
  const { products } = useProducts();
  // PER-130 (0.1): segments από το έτοιμο μηνιαίο RFM aggregate — όχι 400 ημέρες παραγγελιών
  const { segments } = useSegments({ skipOrderHydration: true, useServerAggregate: true });
  const { campaigns } = useCampaigns();
  const { suppliers } = useSuppliers();
  const { benchmarks } = usePriceBenchmarks();
  const ga4 = useGA4Data();
  const hasRun = useRef<string | null>(null);

  useEffect(() => {
    if (!currentBrand?.id || !user?.uid) return;
    if (hasRun.current === currentBrand.id) return;
    if (products.length === 0 && segments.length === 0) return;

    hasRun.current = currentBrand.id;

    const brandId = currentBrand.id;
    const timer = setTimeout(() => {
      (async () => {
        const competitorNewAdsCount = await getRecentNewAdsCount(brandId);

        await runAutomationEvaluation({
          brandId,
          userId: user.uid,
          userName: user.displayName || user.email || '',
          plan: currentBrand.plan ?? 'growth',
          products,
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
  }, [currentBrand, user, plan, products, segments, campaigns, suppliers, benchmarks, ga4.hasData, ga4.dailyEntries, ga4.trafficSources, ga4.topPages]);
}
