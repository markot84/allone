import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OrganicService } from '../services/firestore';
import { normalizeOrganicPeriodToYm } from '../utils/roiUtils';
import { useBrand } from './useBrand';
import type { OrganicRevenue } from '../types';

export function useOrganic() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: records = [], isPending } = useQuery({
    queryKey: ['organic', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      return (await OrganicService.getAll(brandId)) as OrganicRevenue[];
    },
  });

  const totalOrganicRevenue = useMemo(
    () => records.reduce((sum, r) => sum + (r.organic_revenue || 0), 0),
    [records]
  );

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      const ym = normalizeOrganicPeriodToYm(r.period);
      if (!ym) return;
      map.set(ym, (map.get(ym) || 0) + (r.organic_revenue || 0));
    });
    return map;
  }, [records]);

  return {
    records,
    totalOrganicRevenue,
    byMonth,
    hasImported: records.length > 0,
    isLoading: isPending,
  };
}
