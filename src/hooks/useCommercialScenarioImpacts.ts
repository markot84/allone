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

      const base = {
        orders,
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        costBySku,
        skuNames,
      };

      const price = analyzePriceChangeImpact(base);
      const margin = analyzeMarginCostImpact(base);
      const stockout = analyzeStockoutImpact({ ...base, stockBySku });
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
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
