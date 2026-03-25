import { useEffect, useRef } from 'react';
import { useBrand, useProducts, useSegments, useCampaigns, useSuppliers } from '.';
import { useAuth } from './useAuth';
import { usePlan } from './usePlan';
import { usePriceBenchmarks } from './usePriceBenchmarks';
import { runAutomationEvaluation } from '../services/automationEngine';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
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
  const { segments } = useSegments();
  const { campaigns } = useCampaigns();
  const { suppliers } = useSuppliers();
  const { benchmarks } = usePriceBenchmarks();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    if (!currentBrand?.id || !user?.uid) return;
    if (products.length === 0 && segments.length === 0) return;

    hasRun.current = true;

    (async () => {
      const competitorNewAdsCount = await getRecentNewAdsCount(currentBrand.id);

      await runAutomationEvaluation({
        brandId: currentBrand.id,
        userId: user.uid,
        userName: user.displayName || user.email || '',
        plan: currentBrand.plan ?? 'growth',
        products,
        segments,
        campaigns: (campaigns ?? []) as Campaign[],
        suppliers,
        priceBenchmarks: benchmarks.map(b => ({ priceDiff: b.priceDiff })),
        competitorNewAdsCount,
      });
    })().catch(err => console.error('Automation evaluation failed:', err));
  }, [currentBrand, user, plan, products, segments, campaigns, suppliers, benchmarks]);
}
