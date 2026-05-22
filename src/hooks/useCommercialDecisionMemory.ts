import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useActiveStrategy } from './useActiveStrategy';
import { useCampaigns } from './useCampaigns';
import { useChannelActivations } from './useChannelActivations';
import { useCommercialActions } from './useCommercialActions';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProducts } from './useProducts';
import { useProductSignals } from './useProductSignals';
import {
  buildCampaignDecisionEvents,
  buildChannelDecisionEvents,
  buildLegacyActionDecisionEvents,
  buildProductSignalDecisionEvents,
  buildStrategyDecisionEvents,
  listCommercialDecisionEvents,
  mergeCommercialDecisionEvents,
  saveCommercialDecisionEvent,
  type CommercialDecisionEvent,
} from '../services/commercialDecisionMemory';
import {
  evaluateCommercialDecisionImpact,
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

export function useCommercialDecisionMemory() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const { activeStrategy, getStrategyName, isLoading: isStrategyLoading } = useActiveStrategy();
  const { campaigns, isLoading: isCampaignsLoading } = useCampaigns();
  const { activations, isLoading: isActivationsLoading } = useChannelActivations(activeStrategy?.id ?? null);
  const { actions, isLoading: isActionsLoading } = useCommercialActions();
  const ecomm = useEcommerceSummary({ includeSkuDetails: true, includeStockMovement: true });
  const { products, isLoading: isProductsLoading } = useProducts({ maxDocs: 750 });
  const productSignals = useProductSignals(products);

  const storedQuery = useQuery({
    queryKey: ['commercial_decision_events', brandId],
    queryFn: () => (brandId ? listCommercialDecisionEvents(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
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
      ...buildStrategyDecisionEvents(activeStrategy, getStrategyName),
      ...buildCampaignDecisionEvents(campaigns as Campaign[], brandId),
      ...buildChannelDecisionEvents(activations, brandId),
      ...buildLegacyActionDecisionEvents(actions, brandId),
      ...buildProductSignalDecisionEvents(products, productSignals.signalsBySku, brandId),
    ];
  }, [actions, activeStrategy, activations, brandId, campaigns, getStrategyName, productSignals.signalsBySku, products]);

  const revenueByDay = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const row of ecomm.dailyRevenue) byDay[row.date] = row.revenue;
    return byDay;
  }, [ecomm.dailyRevenue]);

  const events = useMemo(
    () => mergeCommercialDecisionEvents(storedQuery.data ?? [], derivedEvents),
    [derivedEvents, storedQuery.data]
  );

  const items = useMemo<DecisionMemoryItem[]>(() => {
    return events.map((event) => {
      const start = event.startDate || event.decisionDate;
      const end = event.endDate || start;
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
          targets: { revenueUpliftPct: 10, minRoas: 3 },
        }),
      };
    });
  }, [campaigns, ecomm.ordersByDay, events, productSignals.signalsBySku, revenueByDay]);

  const summary = useMemo(() => {
    return {
      winning: items.filter((item) => item.impact.verdict === 'winning').length,
      review: items.filter((item) => item.impact.verdict === 'neutral' || item.impact.confidence === 'low').length,
      avoid: items.filter((item) => item.impact.verdict === 'losing').length,
      active: items.filter((item) => item.event.status === 'active' || item.event.status === 'planned').length,
    };
  }, [items]);

  return {
    items,
    summary,
    saveDecisionEvent: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    isLoading:
      storedQuery.isPending ||
      isStrategyLoading ||
      isCampaignsLoading ||
      isActivationsLoading ||
      isActionsLoading ||
      ecomm.isLoading ||
      isProductsLoading ||
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
