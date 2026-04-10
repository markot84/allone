import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OrganicService } from '../services/firestore';
import { normalizeOrganicPeriodToYm } from '../utils/roiUtils';
import { useBrand } from './useBrand';
import { useGA4Data } from './useGA4Data';
import type { OrganicRevenue } from '../types';

export function useOrganic() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { totalOrganicRevenueFromChannels, isLoading: ga4Loading, hasData: hasGa4 } = useGA4Data();

  const { data: records = [], isPending } = useQuery({
    queryKey: ['organic', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      return (await OrganicService.getAll(brandId)) as OrganicRevenue[];
    },
  });

  const manualTotal = useMemo(
    () => records.reduce((sum, r) => sum + (r.organic_revenue || 0), 0),
    [records]
  );

  const totalOrganicRevenue = useMemo(() => {
    if (manualTotal > 0) return manualTotal;
    return totalOrganicRevenueFromChannels;
  }, [manualTotal, totalOrganicRevenueFromChannels]);

  /** True when CSV import exists or GA4 attributes organic revenue to channels (after GA4 loaded if no CSV). */
  const hasOrganicRevenue = useMemo(() => {
    if (records.length > 0) return true;
    if (!ga4Loading && hasGa4 && totalOrganicRevenueFromChannels > 0) return true;
    return false;
  }, [records.length, ga4Loading, hasGa4, totalOrganicRevenueFromChannels]);

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      const ym = normalizeOrganicPeriodToYm(r.period);
      if (!ym) return;
      map.set(ym, (map.get(ym) || 0) + (r.organic_revenue || 0));
    });
    return map;
  }, [records]);

  const isLoading =
    isPending || (records.length === 0 && ga4Loading);

  return {
    records,
    totalOrganicRevenue,
    byMonth,
    hasImported: records.length > 0,
    /** Organic revenue from GA4 channel breakdown when there is no manual import. */
    totalOrganicRevenueFromGA4Channels: totalOrganicRevenueFromChannels,
    organicRevenueSource:
      records.length > 0 ? ('import' as const) : totalOrganicRevenueFromChannels > 0 ? ('ga4' as const) : ('none' as const),
    hasOrganicRevenue,
    isLoading,
  };
}
