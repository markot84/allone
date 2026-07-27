import { useMemo } from 'react';
import { useBrand } from './useBrand';
import type { BrandPlan } from '../types';

const ENTERPRISE_FEATURES = new Set([
  'procurement',
  'procurement_triggers',
  'erp_intelligence',
]);

export function usePlan() {
  const { currentBrand } = useBrand();
  const plan: BrandPlan = currentBrand?.plan ?? 'growth';
  const isEnterprise = plan === 'enterprise';

  const canAccess = useMemo(
    () => (feature: string) => {
      if (isEnterprise) return true;
      return !ENTERPRISE_FEATURES.has(feature);
    },
    [isEnterprise]
  );

  return { plan, isEnterprise, canAccess };
}
