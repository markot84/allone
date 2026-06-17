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

export type EcommerceFullHistoryMode =
  /** Load all orders from Firestore — slow, for pages that need parity/detail. */
  | 'full'
  /** Server aggregate only (`ecommerce_summary`) — fast Dashboard. */
  | 'summary_only';

/** E-shop metrics from Firestore: `full` loads raw orders for full daily/monthly history (summary
 * fallback until then); `summary_only` trusts `ecommerce_summary` computed at sync. */
export function useEcommerceFullHistoryMetrics(options?: { mode?: EcommerceFullHistoryMode }) {
  const mode = options?.mode ?? 'summary_only';
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const platformsKey = [...ecomm.connectedPlatforms].sort().join('|');

  /** Cutoff in the Firestore query — same meaning as the client clamp; fewer docs when historyStartDate is set. */
  const historyCutoff = getBrandHistoryStartISO(currentBrand);
  const revenueModeKey = currentBrand?.revenueSourceMode ?? 'eshop_classified';

  const { data, isSuccess: rawLoaded, isPending: rawLoading, isFetching } = useQuery({
    queryKey: ['ecommerceOrdersRaw', brandId, platformsKey, historyCutoff ?? '', revenueModeKey],
    queryFn: () =>
      brandId
        ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, {
            ...(historyCutoff ? { sinceDate: historyCutoff } : {}),
          })
        : Promise.resolve([]),
    enabled: mode === 'full' && !!brandId && ecomm.connectedPlatforms.length > 0,
    /** Not "yesterday only": the query downloads the full history to recompute KPIs — large staleTime + cache-first reduces repeated waiting. */
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
      ? ecomm.monthlyRevenue.filter((r) => {
          // A month is in range if ANY day is ≥ the cutoff — compare its LAST day so a
          // mid-month historyStartDate doesn't drop the partially-in-range month.
          const [y, m] = r.month.split('-').map(Number);
          const lastDay = new Date(y, m, 0).getDate();
          return passesBrandHistory(`${r.month}-${String(lastDay).padStart(2, '0')}`, currentBrand);
        })
      : ecomm.monthlyRevenue;

    if (!rawLoaded || !clampedRawOrders) {
      return {
        revenueByDayRecord: fromSummary,
        dailyRevenueRows: dailyRevenueClamped,
        ordersByDay: ordersByDayClamped,
        allOrdersByDay: historyCutoff
          ? ecomm.allOrdersByDay.filter((r) => passesBrandHistory(r.date, currentBrand))
          : ecomm.allOrdersByDay,
        monthlyRevenue: monthlyRevenueClamped,
        rawLoaded: false,
        rawLoading: mode === 'full' && (rawLoading || isFetching),
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
      allOrdersByDay: historyCutoff
        ? ecomm.allOrdersByDay.filter((r) => passesBrandHistory(r.date, currentBrand))
        : ecomm.allOrdersByDay,
      monthlyRevenue: monthlyRevenueFromDailyRecord(revenueByDay),
      rawLoaded: true,
      rawLoading: false,
      source: 'raw' as const,
      getTopPlatformInRange,
    };
  }, [
    ecomm.dailyRevenue,
    ecomm.allOrdersByDay,
    ecomm.monthlyRevenue,
    ecomm.ordersByDay,
    rawLoaded,
    rawLoading,
    isFetching,
    clampedRawOrders,
    getTopPlatformInRange,
    historyCutoff,
    currentBrand,
    mode,
  ]);
}
