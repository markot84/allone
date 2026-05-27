import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useCampaigns } from './useCampaigns';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProcurement } from './useProcurement';
import { useProcurementSignals } from './useProcurementSignals';
import { fetchDataAnalysisOrders } from '../services/ecommerceRawOrders';
import {
  buildSkuNameMapFromPricingRows,
  buildUnitCostBySku,
  shiftIsoDate,
  type SkuWindowMetrics,
} from '../services/commercialScenarioMetrics';
import { analyzePriceChangeImpact } from '../services/priceChangeImpact';
import { analyzeMarginCostImpact } from '../services/marginCostImpact';
import { analyzeStockoutImpact, buildStockContextFromProcurementSignals } from '../services/stockoutImpact';
import { analyzeMarketingSpendImpact } from '../services/marketingSpendImpact';
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

const ERP_SCENARIO_CACHE_MS = 24 * 60 * 60 * 1000;

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

  const costBySku = useMemo(
    () => buildUnitCostBySku(procurement.data.pricing_policy ?? []),
    [procurement.data.pricing_policy]
  );

  const skuNames = useMemo(
    () => buildSkuNameMapFromPricingRows(procurement.data.pricing_policy ?? []),
    [procurement.data.pricing_policy]
  );

  const stockBySku = useMemo(
    () => buildStockContextFromProcurementSignals(procurementSignals.signalsBySku),
    [procurementSignals.signalsBySku]
  );
  const canLoadImpacts =
    !!brandId &&
    !!period?.fromDate &&
    !!period?.toDate &&
    !ecomm.isLoading &&
    !procurement.isLoading &&
    !procurementSignals.isLoading;

  const query = useQuery({
    queryKey: [
      'commercial_scenario_impacts',
      brandId,
      period?.fromDate,
      period?.toDate,
      [...ecomm.connectedPlatforms].sort().join('|'),
      costBySku.size,
      stockBySku.size,
    ],
    queryFn: async () => {
      if (!brandId || !period) {
        return emptyPayload();
      }

      const lookbackFrom = shiftIsoDate(period.fromDate, -30);
      const orders = await fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, {
        sinceDate: lookbackFrom,
        untilDate: period.toDate,
        cacheFirst: true,
        revenueMode: 'all',
      });

      const priceRows = [];
      const marginRows = [];
      const stockoutRows = [];

      for (const window of monthWindows(period.fromDate, period.toDate)) {
        const base = {
          orders,
          periodFrom: window.startDate,
          periodTo: window.endDate,
          costBySku,
          skuNames,
        };
        priceRows.push(...analyzePriceChangeImpact(base).rows);
        marginRows.push(...analyzeMarginCostImpact(base).rows);
        stockoutRows.push(...analyzeStockoutImpact({ ...base, stockBySku }).rows);
      }

      priceRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
      marginRows.sort((a, b) => Math.abs(b.marginPctChange ?? 0) - Math.abs(a.marginPctChange ?? 0));
      stockoutRows.sort((a, b) => (a.revenueChangePct ?? 0) - (b.revenueChangePct ?? 0));

      const price = { rows: priceRows, summary: summarizeRows(priceRows) };
      const margin = { rows: marginRows, summary: summarizeRows(marginRows) };
      const stockout = { rows: stockoutRows, summary: summarizeRows(stockoutRows) };
      const marketing = analyzeMarketingSpendImpact({
        campaigns: campaigns as Campaign[],
        orders,
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        costBySku,
      });

      const ordersWithLines = orders.filter((o) => o.lineItems.length > 0).length;

      return { price, margin, stockout, marketing, orderCount: orders.length, ordersWithLines };
    },
    enabled: canLoadImpacts,
    staleTime: ERP_SCENARIO_CACHE_MS,
    gcTime: ERP_SCENARIO_CACHE_MS * 2,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  });

  const isLoading =
    !query.data && (query.isPending || procurement.isLoading || procurementSignals.isLoading || campaignsLoading);

  return {
    price: query.data?.price,
    margin: query.data?.margin,
    stockout: query.data?.stockout,
    marketing: query.data?.marketing,
    orderCount: query.data?.orderCount ?? 0,
    ordersWithLines: query.data?.ordersWithLines ?? 0,
    isLoading,
    isRefreshing: !!query.data && (query.isFetching || procurement.isRefreshing || procurementSignals.isLoading || campaignsLoading),
    hasOrderLines: (query.data?.ordersWithLines ?? 0) > 0,
    hasCostData: costBySku.size > 0,
    hasStockSignals: stockBySku.size > 0,
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
