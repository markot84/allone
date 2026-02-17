import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OrganicService } from '../services/firestore';
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
      const period = r.period || '';
      let key = period;
      if (period.match(/^\d{4}-\d{2}-\d{2}/)) {
        const d = new Date(period);
        key = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      } else if (period.match(/(\w+)\s+(\d{4})/)) {
        key = period;
      }
      map.set(key, (map.get(key) || 0) + (r.organic_revenue || 0));
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
