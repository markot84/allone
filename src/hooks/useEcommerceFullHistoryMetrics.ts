import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import {
  aggregateRevenueOrdersFromRaw,
  fetchAllEcommerceOrders,
  sortDailyRevenueRows,
  sortOrdersByDayRows,
  topPlatformInDateRange,
} from '../services/ecommerceRawOrders';
import { monthlyRevenueFromDailyRecord } from '../utils/roiUtils';

/**
 * E-shop metrics από Firestore: μετά τη φόρτωση raw orders, τα ημερήσια/μηνιαία στοιχεία
 * καλύπτουν όλο το ιστορικό (όχι μόνο το server summary ~90 ημ.). Μέχρι να φορτώσουν, fallback στο summary.
 */
export function useEcommerceFullHistoryMetrics() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary();
  const platformsKey = [...ecomm.connectedPlatforms].sort().join('|');

  const { data, isSuccess: rawLoaded, isPending: rawLoading, isFetching } = useQuery({
    queryKey: ['ecommerceOrdersRaw', brandId, platformsKey],
    queryFn: () => (brandId ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms) : Promise.resolve([])),
    enabled: !!brandId && ecomm.connectedPlatforms.length > 0,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const getTopPlatformInRange = useCallback(
    (fromDate: string, toDate: string) => {
      if (!rawLoaded || !data) return null;
      return topPlatformInDateRange(data, fromDate, toDate);
    },
    [rawLoaded, data]
  );

  return useMemo(() => {
    const fromSummary: Record<string, number> = {};
    for (const r of ecomm.dailyRevenue) {
      fromSummary[r.date] = r.revenue;
    }

    if (!rawLoaded || !data) {
      return {
        revenueByDayRecord: fromSummary,
        dailyRevenueRows: ecomm.dailyRevenue,
        ordersByDay: ecomm.ordersByDay,
        monthlyRevenue: ecomm.monthlyRevenue,
        rawLoaded: false,
        rawLoading: rawLoading || isFetching,
        source: 'summary' as const,
        getTopPlatformInRange,
      };
    }

    const { revenueByDay, ordersByDay: ordByDay } = aggregateRevenueOrdersFromRaw(data);
    const dailyRevenueRows = sortDailyRevenueRows(revenueByDay);
    return {
      revenueByDayRecord: revenueByDay,
      dailyRevenueRows,
      ordersByDay: sortOrdersByDayRows(ordByDay),
      monthlyRevenue: monthlyRevenueFromDailyRecord(revenueByDay),
      rawLoaded: true,
      rawLoading: false,
      source: 'raw' as const,
      getTopPlatformInRange,
    };
  }, [
    ecomm.dailyRevenue,
    ecomm.monthlyRevenue,
    ecomm.ordersByDay,
    rawLoaded,
    rawLoading,
    isFetching,
    data,
    getTopPlatformInRange,
  ]);
}
