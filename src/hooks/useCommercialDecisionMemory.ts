import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useCampaigns } from './useCampaigns';
import { useCommercialActions } from './useCommercialActions';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProducts } from './useProducts';
import { useProductSignals } from './useProductSignals';
import {
  buildCampaignDecisionEvents,
  buildLegacyActionDecisionEvents,
  listCommercialDecisionEvents,
  mergeCommercialDecisionEvents,
  saveCommercialDecisionEvent,
  type CommercialDecisionEvent,
} from '../services/commercialDecisionMemory';
import {
  evaluateCommercialDecisionImpact,
  eventOverlapsPeriod,
  intersectEventWithPeriod,
  type CommercialDecisionImpactResult,
} from '../services/policyImpactAnalysis';
import { calculateCampaignMetrics } from '../utils/roiUtils';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../utils/campaignDateRangeMetrics';
import type { Campaign } from '../types';

export interface DecisionMemoryItem {
  event: CommercialDecisionEvent;
  impact: CommercialDecisionImpactResult;
}

export interface CommercialDecisionMemoryPeriod {
  fromDate: string;
  toDate: string;
}

export function useCommercialDecisionMemory(period?: CommercialDecisionMemoryPeriod) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const { campaigns, isLoading: isCampaignsLoading } = useCampaigns();
  const { actions, isLoading: isActionsLoading } = useCommercialActions();
  const ecomm = useEcommerceSummary({ includeSkuDetails: true, includeStockMovement: true });
  const { products, isLoading: isProductsLoading } = useProducts({ maxDocs: 750 });
  const productSignals = useProductSignals(products);

  const storedQuery = useQuery({
    queryKey: ['commercial_decision_events', brandId],
    queryFn: () => (brandId ? listCommercialDecisionEvents(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const saveMutation = useMutation({
    mutationFn: (event: Parameters<typeof saveCommercialDecisionEvent>[1]) =>
      brandId ? saveCommercialDecisionEvent(brandId, event) : Promise.reject(new Error('No brand')),
    onSuccess: () => {
      if (brandId) queryClient.invalidateQueries({ queryKey: ['commercial_decision_events', brandId] });
    },
  });

  const derivedEvents = useMemo(() => {
    if (!brandId) return [] as CommercialDecisionEvent[];
    return [
      ...buildCampaignDecisionEvents(campaigns as Campaign[], brandId),
      ...buildLegacyActionDecisionEvents(actions, brandId),
    ];
  }, [actions, brandId, campaigns]);

  const revenueByDay = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const row of ecomm.dailyRevenue) byDay[row.date] = row.revenue;
    return byDay;
  }, [ecomm.dailyRevenue]);

  const events = useMemo(() => {
    const storedMeasuredEvents = (storedQuery.data ?? []).filter(
      (event) =>
        event.source !== 'channel_activation' &&
        event.source !== 'strategy' &&
        event.source !== 'product_signals' &&
        event.source !== 'erp_history'
    );
    return mergeCommercialDecisionEvents(storedMeasuredEvents, derivedEvents);
  }, [derivedEvents, storedQuery.data]);

  const items = useMemo<DecisionMemoryItem[]>(() => {
    const periodFrom = period?.fromDate;
    const periodTo = period?.toDate;

    return events
      .filter((event) => {
        if (!periodFrom || !periodTo) return true;
        return eventOverlapsPeriod(event, periodFrom, periodTo);
      })
      .map((event) => {
        const defaultStart = event.startDate || event.decisionDate;
        const defaultEnd = event.endDate || defaultStart;
        const analysisPeriod =
          periodFrom && periodTo
            ? intersectEventWithPeriod(event, periodFrom, periodTo) ?? { startDate: defaultStart, endDate: defaultEnd }
            : undefined;
        const start = analysisPeriod?.startDate ?? defaultStart;
        const end = analysisPeriod?.endDate ?? defaultEnd;
        const periodCampaigns = applyCampaignDateRangeToMetrics(
          filterCampaignsByScheduleDateOverlap(campaigns as Campaign[], start, end),
          start,
          end
        );
        const spend = calculateCampaignMetrics(periodCampaigns).totalSpend;
        return {
          event,
          impact: evaluateCommercialDecisionImpact({
            event,
            revenueByDay,
            ordersByDay: ecomm.ordersByDay,
            campaignSpendInPeriod: spend,
            signalsBySku: productSignals.signalsBySku,
            analysisPeriod,
            targets: { revenueUpliftPct: 10, minRoas: 3 },
          }),
        };
      });
  }, [campaigns, ecomm.ordersByDay, events, period?.fromDate, period?.toDate, productSignals.signalsBySku, revenueByDay]);

  const summary = useMemo(() => {
    return {
      winning: items.filter((item) => item.impact.verdict === 'winning').length,
      review: items.filter((item) => item.impact.verdict === 'neutral' || item.impact.confidence === 'low').length,
      avoid: items.filter((item) => item.impact.verdict === 'losing').length,
      active: items.filter((item) => item.event.status === 'active' || item.event.status === 'planned').length,
    };
  }, [items]);

  const hasVisibleDecisionData = items.length > 0 || storedQuery.data !== undefined;
  const isInitialLoading =
    !hasVisibleDecisionData &&
    (storedQuery.isPending ||
      isCampaignsLoading ||
      isActionsLoading ||
      ecomm.isLoading ||
      isProductsLoading ||
      productSignals.isLoading);

  return {
    items,
    summary,
    period: period ?? null,
    saveDecisionEvent: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    isLoading: isInitialLoading,
    isRefreshing:
      storedQuery.isFetching ||
      ecomm.isLoading ||
      productSignals.isLoading,
    dataCoverage: {
      hasRevenue: ecomm.hasData,
      campaigns: campaigns.length,
      products: products.length,
      productSignals: productSignals.signalsBySku.size,
      connectedPlatforms: ecomm.connectedPlatforms,
    },
  };
}

export type { CommercialDecisionEvent };
