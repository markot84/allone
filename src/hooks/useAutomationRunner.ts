import { useEffect, useRef } from 'react';
import { useBrand, useProducts, useSegments, useCampaigns, useSuppliers } from '.';
import { useAuth } from './useAuth';
import { usePlan } from './usePlan';
import { runAutomationEvaluation } from '../services/automationEngine';
import type { Campaign } from '../types';

export function useAutomationRunner() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { plan } = usePlan();
  const { products } = useProducts();
  const { segments } = useSegments();
  const { campaigns } = useCampaigns();
  const { suppliers } = useSuppliers();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    if (!currentBrand?.id || !user?.uid) return;
    if (products.length === 0 && segments.length === 0) return;

    hasRun.current = true;

    runAutomationEvaluation({
      brandId: currentBrand.id,
      userId: user.uid,
      userName: user.displayName || user.email || '',
      plan: currentBrand.plan ?? 'growth',
      products,
      segments,
      campaigns: (campaigns ?? []) as Campaign[],
      suppliers,
    }).catch(err => console.error('Automation evaluation failed:', err));
  }, [currentBrand, user, plan, products, segments, campaigns, suppliers]);
}
