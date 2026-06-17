import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useCampaigns } from './useCampaigns';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProcurement } from './useProcurement';
import { useProcurementSignals } from './useProcurementSignals';
import { useProducts } from './useProducts';
import { ECOMMERCE_ORDER_COLLECTIONS, fetchEcommercePlatformOrders } from '../services/ecommerceRawOrders';
import {
  buildSkuNameMapFromPricingRows,
  buildUnitCostBySku,
  buildUnitPriceBySku,
  shiftIsoDate,
  type SkuWindowMetrics,
} from '../services/commercialScenarioMetrics';
import { analyzeMarketingDecisions } from '../services/marketingSpendImpact';
import { analyzePriceChangeImpactAsync } from '../services/priceChangeImpact';
import {
  readScenarioCache,
  writeScenarioCache,
  clearScenarioCache,
  readScenarioCacheRemote,
  writeScenarioCacheRemote,
  clearScenarioCacheRemote,
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

type ProductStockFields = {
  stock_level?: unknown;
  available_stock?: unknown;
  stock_on_hand?: unknown;
};

const ERP_SCENARIO_CACHE_MS = SCENARIO_CACHE_TTL_MS;
const MAX_AUTO_ANALYSIS_DAYS = 120;

/** Yields to the main thread (next macrotask) so the UI can paint and not freeze. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

function daysBetweenInclusive(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.floor((to - from) / 86_400_000) + 1;
}

function quickAnalysisFromDate(periodFrom: string, periodTo: string): string {
  const boundedFrom = shiftIsoDate(periodTo, -(MAX_AUTO_ANALYSIS_DAYS - 1));
  return boundedFrom > periodFrom ? boundedFrom : periodFrom;
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
  // Only revenue/platforms used here — skip the skuStats + stock_movement download/parse
  // that froze Policy Impact on large catalogs (~44k SKUs).
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const { campaigns, isLoading: campaignsLoading } = useCampaigns();
  const procurement = useProcurement({ sheets: ['pricing_policy'] });
  const procurementSignals = useProcurementSignals();
  const { products } = useProducts();
  const [forceRefreshKey, setForceRefreshKey] = useState(0);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const scenarioPlatforms = useMemo(
    () => (ecomm.connectedPlatforms.length > 0 ? ecomm.connectedPlatforms : Object.keys(ECOMMERCE_ORDER_COLLECTIONS)),
    [ecomm.connectedPlatforms]
  );

  const costBySku = useMemo(
    () => buildUnitCostBySku(procurement.data.pricing_policy ?? []),
    [procurement.data.pricing_policy]
  );

  const priceBySku = useMemo(
    () => buildUnitPriceBySku(procurement.data.pricing_policy ?? []),
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
      const stockFields = p as typeof p & ProductStockFields;
      const stock = stockFields.stock_level ?? stockFields.available_stock ?? stockFields.stock_on_hand;
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
    // STABLE key: only brand + period + manual refresh. Excludes volatile derived values
    // (costBySku.size, connectedPlatforms) whose changes used to lose the in-memory cache.
    queryKey: [
      'commercial_scenario_impacts',
      brandId,
      period?.fromDate,
      period?.toDate,
      forceRefreshKey,
    ],
    queryFn: async () => {
      if (!brandId || !period) {
        return emptyPayload();
      }

      // Use cache unless forced refresh: localStorage first, then Firestore (durable);
      // remote hits get written back to localStorage.
      if (forceRefreshKey === 0) {
        const cached = readScenarioCache<ScenarioPayload>(brandId, period.fromDate, period.toDate);
        if (cached) return cached.data;
        const remote = await readScenarioCacheRemote<ScenarioPayload>(brandId, period.fromDate, period.toDate);
        if (remote) {
          writeScenarioCache(brandId, period.fromDate, period.toDate, remote.data);
          return remote.data;
        }
      }

      const shouldUseQuickInitialAnalysis =
        forceRefreshKey === 0 && daysBetweenInclusive(period.fromDate, period.toDate) > MAX_AUTO_ANALYSIS_DAYS;
      const analysisFrom = shouldUseQuickInitialAnalysis ? quickAnalysisFromDate(period.fromDate, period.toDate) : period.fromDate;
      const lookbackFrom = shiftIsoDate(analysisFrom, -30);
      setProgress({ loaded: 0, total: 0 });
      // Platform-only (e-shop) orders with line items — not the ERP-invoice double fetch.
      // Large initial range skips a full scan; full fetchAll runs on manual refresh.
      const orders = await fetchEcommercePlatformOrders(brandId, scenarioPlatforms, {
        sinceDate: lookbackFrom,
        untilDate: period.toDate,
        cacheFirst: true,
        revenueMode: 'all',
        fetchAll: !shouldUseQuickInitialAnalysis,
        onProgress: (info) => setProgress(info),
      });

      const priceRows = [];

      // Chunked & non-blocking: runs in batches, yielding to the main thread between
      // windows/chunks so high-volume brands don't freeze the page.
      for (const window of monthWindows(analysisFrom, period.toDate)) {
        const res = await analyzePriceChangeImpactAsync(
          { orders, periodFrom: window.startDate, periodTo: window.endDate, costBySku, priceBySku, skuNames },
          { chunkSize: 3000, yieldFn: yieldToMain }
        );
        priceRows.push(...res.rows);
        await yieldToMain();
      }

      priceRows.sort((a, b) => Math.abs(b.after.revenue - b.before.revenue) - Math.abs(a.after.revenue - a.before.revenue));
      await yieldToMain();

      // Summary uses ALL rows (correct counts); table shows only displayable ones (actionable
      // pos/neg not low-confidence, + neutral) so the cap can't starve neutrals and KPI count matches rows.
      const priceSummary = summarizeRows(priceRows);
      const displayablePriceRows = priceRows.filter(
        (r) => r.verdict === 'neutral' || ((r.verdict === 'positive' || r.verdict === 'negative') && r.confidence !== 'low')
      );
      const price = { rows: displayablePriceRows, summary: priceSummary };
      await yieldToMain();
      // Marketing: decision detection (before = the preceding equal-length window, computed in the service).
      const marketing = analyzeMarketingDecisions({
        campaigns: campaigns as Campaign[],
        orders,
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        costBySku,
      });

      const ordersWithLines = orders.filter((o) => o.lineItems.length > 0).length;
      const result = {
        price,
        marketing,
        orderCount: orders.length,
        ordersWithLines,
        analysisScope: {
          fromDate: analysisFrom,
          toDate: period.toDate,
          isQuickSample: shouldUseQuickInitialAnalysis,
        },
      };

      // Cap rows before caching: high enough for typical brands' footer totals but below the
      // Firestore 1MiB doc limit; already sorted by revenue impact so we keep the most significant.
      const MAX_PRICE_CACHE = 1200;
      const MAX_MKT_CACHE = 400;
      const cachePayload = {
        ...result,
        price: { ...result.price, rows: result.price.rows.slice(0, MAX_PRICE_CACHE) },
        marketing: { ...result.marketing, rows: result.marketing.rows.slice(0, MAX_MKT_CACHE) },
      };
      // Write the quick result to localStorage with `analysisScope.isQuickSample` so a page switch/back doesn't re-run it.
      writeScenarioCache(brandId, period.fromDate, period.toDate, cachePayload);
      if (!shouldUseQuickInitialAnalysis) {
        // Durable Firestore cache (fire-and-forget): so the heavy computation doesn't re-run on reload.
        void writeScenarioCacheRemote(brandId, period.fromDate, period.toDate, cachePayload);
      }
      setProgress(null);
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

  const cachedAt = (() => {
    if (!brandId || !period?.fromDate || !period?.toDate) return null;
    return readScenarioCache(brandId, period.fromDate, period.toDate)?.savedAt ?? null;
  })();

  const refresh = () => {
    if (!brandId || !period?.fromDate || !period?.toDate) return;
    clearScenarioCache(brandId, period.fromDate, period.toDate);
    void clearScenarioCacheRemote(brandId, period.fromDate, period.toDate);
    setForceRefreshKey((k) => k + 1);
  };

  return {
    price: query.data?.price,
    marketing: query.data?.marketing,
    orderCount: query.data?.orderCount ?? 0,
    ordersWithLines: query.data?.ordersWithLines ?? 0,
    isLoading,
    isRefreshing: !!query.data && query.isFetching,
    progress,
    analysisScope: query.data?.analysisScope,
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
        totalConversions: 0,
        totalNetProfit: null,
        blendedRoas: null,
        storeMarginRate: null,
        lookbackDays: 30,
      },
    },
    orderCount: 0,
    ordersWithLines: 0,
    analysisScope: null,
  };
}
