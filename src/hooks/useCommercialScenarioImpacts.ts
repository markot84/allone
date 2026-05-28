import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useCampaigns } from './useCampaigns';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProcurement } from './useProcurement';
import { useProcurementSignals } from './useProcurementSignals';
import { useProducts } from './useProducts';
import { fetchDataAnalysisOrders } from '../services/ecommerceRawOrders';
import {
  buildSkuNameMapFromPricingRows,
  buildUnitCostBySku,
  shiftIsoDate,
  type SkuWindowMetrics,
} from '../services/commercialScenarioMetrics';
import { analyzeMarketingSpendImpact } from '../services/marketingSpendImpact';
import { analyzePriceChangeImpact } from '../services/priceChangeImpact';
import {
  readScenarioCache,
  writeScenarioCache,
  clearScenarioCache,
  SCENARIO_CACHE_TTL_MS,
} from '../services/commercialScenarioCache';
import type { Campaign } from '../types';

export interface CommercialScenarioPeriod {
  fromDate: string;
  toDate: string;
}

type WindowedScenarioRow = {
  verdict: 'positive' | 'negative' | 'neutral' | 'insufficient';
  before: SkuWindowMetrics;
  after: SkuWindowMetrics;
  confidence?: 'low' | 'medium' | 'high';
};

const ERP_SCENARIO_CACHE_MS = SCENARIO_CACHE_TTL_MS;

function monthWindows(periodFrom: string, periodTo: string): Array<{ startDate: string; endDate: string }> {
  const [fy, fm] = periodFrom.split('-').map(Number);
  const [ty, tm] = periodTo.split('-').map(Number);
  if (!fy || !fm || !ty || !tm || periodFrom > periodTo) return [];

  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(fy, fm - 1, 1);
  const last = new Date(ty, tm - 1, 1);

  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEndDt = new Date(y, m + 1, 0);
    const monthEnd = `${monthEndDt.getFullYear()}-${String(monthEndDt.getMonth() + 1).padStart(2, '0')}-${String(monthEndDt.getDate()).padStart(2, '0')}`;
    windows.push({
      startDate: monthStart > periodFrom ? monthStart : periodFrom,
      endDate: monthEnd < periodTo ? monthEnd : periodTo,
    });
    cursor = new Date(y, m + 1, 1);
  }

  return windows.filter((w) => w.startDate <= w.endDate);
}

function summarizeRows<T extends WindowedScenarioRow>(rows: T[], lookbackDays = 30) {
  const actionableRows = rows.filter((row) => isActionableScenarioRow(row));
  const costedRows = actionableRows.filter((row) => row.after.unitCost > 0 || row.before.unitCost > 0);
  const hasMarginCoverage = costedRows.length > 0;
  const revenueDeltas = actionableRows.map((row) => row.after.revenue - row.before.revenue);
  return {
    detected: actionableRows.length,
    positive: actionableRows.filter((r) => r.verdict === 'positive').length,
    negative: actionableRows.filter((r) => r.verdict === 'negative').length,
    neutral: rows.filter((r) => r.verdict === 'neutral').length,
    insufficient: rows.filter((r) => r.verdict === 'insufficient').length,
    totalRevenueBefore: actionableRows.reduce((s, r) => s + r.before.revenue, 0),
    totalRevenueAfter: actionableRows.reduce((s, r) => s + r.after.revenue, 0),
    netRevenueDelta: revenueDeltas.reduce((s, delta) => s + delta, 0),
    positiveRevenueDelta: revenueDeltas.filter((delta) => delta > 0).reduce((s, delta) => s + delta, 0),
    negativeRevenueDelta: revenueDeltas.filter((delta) => delta < 0).reduce((s, delta) => s + delta, 0),
    totalMarginBefore: hasMarginCoverage ? costedRows.reduce((s, r) => s + r.before.margin, 0) : null,
    totalMarginAfter: hasMarginCoverage ? costedRows.reduce((s, r) => s + r.after.margin, 0) : null,
    marginSkuCount: costedRows.length,
    hasMarginCoverage,
    lookbackDays,
  };
}

function isActionableScenarioRow(row: WindowedScenarioRow): boolean {
  if (row.verdict !== 'positive' && row.verdict !== 'negative') return false;
  return row.confidence == null || row.confidence !== 'low';
}

export function useCommercialScenarioImpacts(period?: CommercialScenarioPeriod) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary();
  const { campaigns, isLoading: campaignsLoading } = useCampaigns();
  const procurement = useProcurement({ sheets: ['pricing_policy'] });
  const procurementSignals = useProcurementSignals();
  const { products } = useProducts();
  const [forceRefreshKey, setForceRefreshKey] = useState(0);

  const costBySku = useMemo(
    () => buildUnitCostBySku(procurement.data.pricing_policy ?? []),
    [procurement.data.pricing_policy]
  );

  const skuNames = useMemo(
    () => buildSkuNameMapFromPricingRows(procurement.data.pricing_policy ?? []),
    [procurement.data.pricing_policy]
  );

  const stockBySku = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    // Source 1: products collection (eshop connectors — Shopify, WooCommerce, etc.)
    for (const p of products) {
      const sku = String(p.sku || '').trim().toUpperCase();
      if (!sku) continue;
      const stock = (p as any).stock_level ?? (p as any).available_stock ?? (p as any).stock_on_hand;
      if (stock != null) map.set(sku, Number(stock));
    }
    // Source 2: procurement signals (ERP / manual import) — overrides if present
    for (const [sku, sig] of Object.entries(procurementSignals.signalsBySku)) {
      if (sig.available_stock != null) map.set(sku.trim().toUpperCase(), sig.available_stock);
    }
    return map;
  }, [products, procurementSignals.signalsBySku]);

  const hasLocalCache = useMemo(
    () =>
      !!brandId && !!period?.fromDate && !!period?.toDate
        ? readScenarioCache(brandId, period.fromDate, period.toDate) !== null
        : false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brandId, period?.fromDate, period?.toDate, forceRefreshKey]
  );

  const canLoadImpacts =
    !!brandId &&
    !!period?.fromDate &&
    !!period?.toDate &&
    (hasLocalCache ||
      (!ecomm.isLoading && !procurement.isLoading && !procurementSignals.isLoading && !campaignsLoading));

  type ScenarioPayload = ReturnType<typeof emptyPayload>;

  const query = useQuery({
    queryKey: [
      'commercial_scenario_impacts',
      brandId,
      period?.fromDate,
      period?.toDate,
      [...ecomm.connectedPlatforms].sort().join('|'),
      costBySku.size,
      forceRefreshKey,
    ],
    queryFn: async () => {
      if (!brandId || !period) {
        return emptyPayload();
      }

      // Use localStorage cache unless forced refresh
      if (forceRefreshKey === 0) {
        const cached = readScenarioCache<ScenarioPayload>(brandId, period.fromDate, period.toDate);
        if (cached) return cached.data;
      }

      const lookbackFrom = shiftIsoDate(period.fromDate, -30);
      const orders = await fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, {
        sinceDate: lookbackFrom,
        untilDate: period.toDate,
        cacheFirst: true,
        revenueMode: 'all',
      });

      const priceRows = [];

      for (const window of monthWindows(period.fromDate, period.toDate)) {
        const base = {
          orders,
          periodFrom: window.startDate,
          periodTo: window.endDate,
          costBySku,
          skuNames,
        };
        priceRows.push(...analyzePriceChangeImpact(base).rows);
      }

      priceRows.sort((a, b) => Math.abs(b.after.revenue - b.before.revenue) - Math.abs(a.after.revenue - a.before.revenue));

      const price = { rows: priceRows, summary: summarizeRows(priceRows) };
      const marketing = analyzeMarketingSpendImpact({
        campaigns: campaigns as Campaign[],
        orders,
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        costBySku,
      });

      const ordersWithLines = orders.filter((o) => o.lineItems.length > 0).length;
      const result = { price, marketing, orderCount: orders.length, ordersWithLines };

      writeScenarioCache(brandId, period.fromDate, period.toDate, result);
      return result;
    },
    initialData: () => {
      if (!brandId || !period?.fromDate || !period?.toDate) return undefined;
      return readScenarioCache<ScenarioPayload>(brandId, period.fromDate, period.toDate)?.data ?? undefined;
    },
    initialDataUpdatedAt: () => {
      if (!brandId || !period?.fromDate || !period?.toDate) return undefined;
      return readScenarioCache<ScenarioPayload>(brandId, period.fromDate, period.toDate)?.savedAt ?? undefined;
    },
    enabled: canLoadImpacts,
    staleTime: ERP_SCENARIO_CACHE_MS,
    gcTime: ERP_SCENARIO_CACHE_MS * 2,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  });

  const isLoading = !query.data && (query.isPending || (!hasLocalCache && (procurement.isLoading || procurementSignals.isLoading || campaignsLoading)));

  const cachedAt = useMemo(() => {
    if (!brandId || !period?.fromDate || !period?.toDate) return null;
    return readScenarioCache(brandId, period.fromDate, period.toDate)?.savedAt ?? null;
  }, [brandId, period?.fromDate, period?.toDate, forceRefreshKey]);

  const refresh = () => {
    if (!brandId || !period?.fromDate || !period?.toDate) return;
    clearScenarioCache(brandId, period.fromDate, period.toDate);
    setForceRefreshKey((k) => k + 1);
  };

  return {
    price: query.data?.price,
    marketing: query.data?.marketing,
    orderCount: query.data?.orderCount ?? 0,
    ordersWithLines: query.data?.ordersWithLines ?? 0,
    isLoading,
    isRefreshing: !!query.data && query.isFetching,
    hasOrderLines: (query.data?.ordersWithLines ?? 0) > 0,
    hasCostData: costBySku.size > 0,
    stockBySku,
    cachedAt,
    refresh,
  };
}

function emptyPayload() {
  const emptySummary = {
    detected: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
    insufficient: 0,
    totalRevenueBefore: 0,
    totalRevenueAfter: 0,
    netRevenueDelta: 0,
    positiveRevenueDelta: 0,
    negativeRevenueDelta: 0,
    totalMarginBefore: 0,
    totalMarginAfter: 0,
    lookbackDays: 30,
  };
  return {
    price: { rows: [], summary: emptySummary },
    margin: { rows: [], summary: emptySummary },
    stockout: { rows: [], summary: emptySummary },
    marketing: {
      rows: [],
      summary: {
        detected: 0,
        positive: 0,
        negative: 0,
        neutral: 0,
        insufficient: 0,
        totalSpend: 0,
        totalRevenue: 0,
        totalMargin: 0,
        blendedRoas: null,
        lookbackDays: 30,
      },
    },
    orderCount: 0,
    ordersWithLines: 0,
  };
}
