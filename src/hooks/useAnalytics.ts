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
      if (!brandId) {
        if (import.meta.env.MODE === 'development') {
          console.debug('[useAnalytics] No brandId, returning empty array');
        }
        return [];
      }
      if (import.meta.env.MODE === 'development') {
        console.debug('[useAnalytics] Fetching analytics for brandId:', brandId);
      }
      const records = await AnalyticsService.getAll(brandId);
      if (import.meta.env.MODE === 'development') {
        console.debug('[useAnalytics] Fetched records:', records.length, records);
      }
      return records as unknown as AnalyticsRecord[];
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const revenueData = useMemo(() => {
    if (analyticsRecords.length === 0) {
      if (import.meta.env.MODE === 'development') {
        console.debug('[useAnalytics] No analytics records, returning empty revenueData');
      }
      return [];
    }
    const toDate = (d: unknown) => {
      if (d && typeof (d as any).toDate === 'function') {
        return (d as any).toDate();
      }
      if (typeof d === 'string') {
        return new Date(d);
      }
      return new Date();
    };
    const sorted = [...analyticsRecords].sort(
      (a, b) => toDate((a as any).date).getTime() - toDate((b as any).date).getTime()
    );
    const result = sorted.map((r) => {
      const dateVal = (r as any).date;
      const date = toDate(dateVal);
      return {
        month: date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        total: ((r as any).total_revenue ?? 0) / 1000,
        /** Έσοδα καμπανιών (Firestore: `attributed_revenue` — legacy όνομα στήλης στο import). */
        campaignsRevenue: ((r as any).attributed_revenue ?? 0) / 1000,
      };
    });
    if (import.meta.env.MODE === 'development') {
      console.debug('[useAnalytics] Processed revenueData:', result);
    }
    return result;
  }, [analyticsRecords]);

  return {
    revenueData,
    analyticsRecords,
    hasImported: analyticsRecords.length > 0,
    isLoading: isPending,
  };
}
