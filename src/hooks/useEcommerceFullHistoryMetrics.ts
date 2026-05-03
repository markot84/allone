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
import { filterByBrandHistory, getBrandHistoryStartISO, passesBrandHistory } from '../utils/brandHistoryStart';

/**
 * E-shop metrics από Firestore: μετά τη φόρτωση raw orders, τα ημερήσια/μηνιαία στοιχεία
 * καλύπτουν όλο το ιστορικό (όχι μόνο το server summary ~90 ημ.). Μέχρι να φορτώσουν, fallback στο summary.
 */
export function useEcommerceFullHistoryMetrics() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary();
  const platformsKey = [...ecomm.connectedPlatforms].sort().join('|');

  /** Cutoff στο Firestore query — ίδια σημασιά με το client clamp· λιγότερα docs για e-shop όταν έχει οριστεί historyStartDate. */
  const historyCutoff = getBrandHistoryStartISO(currentBrand);
  const revenueModeKey = currentBrand?.revenueSourceMode ?? 'eshop_classified';

  const { data, isSuccess: rawLoaded, isPending: rawLoading, isFetching } = useQuery({
    queryKey: ['ecommerceOrdersRaw', brandId, platformsKey, historyCutoff ?? '', revenueModeKey],
    queryFn: () =>
      brandId
        ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, {
            cacheFirst: true,
            ...(historyCutoff ? { sinceDate: historyCutoff } : {}),
          })
        : Promise.resolve([]),
    enabled: !!brandId && ecomm.connectedPlatforms.length > 0,
    /** Όχι «η χθεσινή μέρα μόνο»: το query κατεβάζει όλο το ιστορικό για επανυπολογισμό KPI — μεγάλο staleTime + cache πρώτα μειώνει επαναλαμβανόμενη αναμονή. */
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const clampedRawOrders = useMemo(() => {
    if (!data) return data;
    if (!historyCutoff) return data;
    return filterByBrandHistory(data, (o) => o.createdAt, currentBrand);
  }, [data, historyCutoff, currentBrand]);

  const getTopPlatformInRange = useCallback(
    (fromDate: string, toDate: string) => {
      if (!rawLoaded || !clampedRawOrders) return null;
      return topPlatformInDateRange(clampedRawOrders, fromDate, toDate);
    },
    [rawLoaded, clampedRawOrders]
  );

  return useMemo(() => {
    const fromSummary: Record<string, number> = {};
    for (const r of ecomm.dailyRevenue) {
      if (historyCutoff && !passesBrandHistory(r.date, currentBrand)) continue;
      fromSummary[r.date] = r.revenue;
    }
    const dailyRevenueClamped = historyCutoff
      ? ecomm.dailyRevenue.filter((r) => passesBrandHistory(r.date, currentBrand))
      : ecomm.dailyRevenue;
    const ordersByDayClamped = historyCutoff
      ? ecomm.ordersByDay.filter((r) => passesBrandHistory(r.date, currentBrand))
      : ecomm.ordersByDay;
    const monthlyRevenueClamped = historyCutoff
      ? ecomm.monthlyRevenue.filter((r) => passesBrandHistory(`${r.month}-01`, currentBrand))
      : ecomm.monthlyRevenue;

    if (!rawLoaded || !clampedRawOrders) {
      return {
        revenueByDayRecord: fromSummary,
        dailyRevenueRows: dailyRevenueClamped,
        ordersByDay: ordersByDayClamped,
        monthlyRevenue: monthlyRevenueClamped,
        rawLoaded: false,
        rawLoading: rawLoading || isFetching,
        source: 'summary' as const,
        getTopPlatformInRange,
      };
    }

    const { revenueByDay, ordersByDay: ordByDay } = aggregateRevenueOrdersFromRaw(clampedRawOrders);
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
    clampedRawOrders,
    getTopPlatformInRange,
    historyCutoff,
    currentBrand,
  ]);
}
