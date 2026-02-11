import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnalyticsService } from '../services/firestore';
import { useBrand } from './useBrand';

export interface AnalyticsRecord {
  id: string;
  date: string;
  total_revenue?: number;
  attributed_revenue?: number;
  attribution_rate?: number;
}

export function useAnalytics() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: analyticsRecords = [], isPending } = useQuery({
    queryKey: ['analytics', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const records = await AnalyticsService.getAll(brandId);
      return records as unknown as AnalyticsRecord[];
    },
  });

  const revenueData = useMemo(() => {
    if (analyticsRecords.length === 0) return [];
    const toDate = (d: unknown) => d && typeof (d as any).toDate === 'function' ? (d as any).toDate() : new Date(d as string);
    const sorted = [...analyticsRecords].sort(
      (a, b) => toDate((a as any).date).getTime() - toDate((b as any).date).getTime()
    );
    return sorted.map((r) => {
      const dateVal = (r as any).date;
      const date = toDate(dateVal);
      return {
        month: date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        total: ((r as any).total_revenue ?? 0) / 1000,
        attributed: ((r as any).attributed_revenue ?? 0) / 1000,
      };
    });
  }, [analyticsRecords]);

  return {
    revenueData,
    analyticsRecords,
    hasImported: analyticsRecords.length > 0,
    isLoading: isPending,
  };
}
