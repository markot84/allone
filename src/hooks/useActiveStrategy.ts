import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { limit, orderBy } from 'firebase/firestore';
import { FirestoreService } from '../services/firestore';
import { logger } from '../utils/logger';
import { useBrand } from './useBrand';
import { scenarios } from '../data';
import { useMemo } from 'react';
import type {
  ChannelRecommendation,
  MarketingCostLine,
  PLCostCategory,
  PriceBenchmarkStrategyScope,
  SalesBaseScope,
  ProfitMaxScope,
} from '../types';
import type { ContentSuggestionsResult } from '../services/aiContentSuggestions';
import type { SeasonalDiscountConfig } from '../components/strategy/SeasonalDiscountPanel';

export interface MixConfig {
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
}

export interface SeasonalProposal {
  periodId: string;
  periodName: string;
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
  description?: string;
  activatedAt: string;
}

export interface ActiveStrategy {
  id: string;
  brandId: string;
  scenarioId: string;
  weights: Record<string, number>;
  duration?: number | 'ongoing';
  approvalStatus: 'draft' | 'pending_review' | 'approved' | 'implementing';
  approvedAt?: string;
  approvedBy?: string;
  implementedAt?: string;
  mixConfig?: MixConfig;
  monthlyBudget?: number;
  /** Additional marketing costs for a fuller ROI (beyond ad spend). */
  marketingCostLines?: MarketingCostLine[];
  /** Business P&L cost categories (Fixed Costs, Transportation, etc.). */
  costCategories?: PLCostCategory[];
  channelRecommendation?: ChannelRecommendation;
  activationRecommendation?: ChannelRecommendation;
  contentSuggestions?: ContentSuggestionsResult;
  /** SKU participation filter for Sales Optimization (sales_base) */
  salesBaseScope?: SalesBaseScope;
  /** SKU participation filter for Price Benchmarking (price_benchmark) */
  priceBenchmarkScope?: PriceBenchmarkStrategyScope;
  /** Scope filter for Profit Maximization (profit_max) */
  profitMaxScope?: ProfitMaxScope;
  /** Seasonal/discount period parameters (seasonal_discount) */
  seasonalDiscount?: SeasonalDiscountConfig;
  /** Parallel seasonal proposal running alongside the main commercial policy. */
  seasonalProposal?: SeasonalProposal;
  /** Origin from Decision Buckets triage (if the strategy came from a bucket CTA). */
  triageOrigin?: TriageOrigin;
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of the bucket choice from TriageCard — pins SKU scope onto the active policy. */
export interface TriageOrigin {
  /** Bucket identifier — see utils/decisionBuckets.BucketId */
  bucket: string;
  /** Human-readable label (e.g. "Dead capital"). */
  label: string;
  /** List of SKUs targeted by the bucket. */
  skus: string[];
  /** Optional allowlist of product ids for UI filtering / strategy scopes. */
  productIds?: string[];
  /** Total tied-up capital (€) — KPI for context. */
  tiedCapital?: number;
  /** ISO timestamp when the bucket was selected. */
  selectedAt: string;
}

export function useActiveStrategy() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const { data: activeStrategy, isLoading } = useQuery({
    queryKey: ['activeStrategy', brandId],
    queryFn: async () => {
      if (!brandId) return null;
      
      try {
        const strategies = await FirestoreService.getDocuments<ActiveStrategy>(
          'active_strategies',
          [orderBy('updatedAt', 'desc'), limit(1)],
          brandId
        );
        
        if (strategies.length === 0) return null;

        const getTime = (s: ActiveStrategy) => {
          const u = s.updatedAt;
          if (u) {
            if (typeof u === 'string') return new Date(u).getTime();
            if (typeof (u as any)?.toMillis === 'function') return (u as any).toMillis();
          }
          const match = s.id?.match(/_(\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        };

        // Always return the most recently updated strategy
        const sorted = [...strategies].sort((a, b) => getTime(b) - getTime(a));
        return sorted[0];
      } catch (error: any) {
        // If index is building, return null (fallback) so saves still work.
        if (error?.code === 'failed-precondition' || error?.message?.includes('index')) {
          logger.debug('Index building, query unavailable. Saves will still work.');
          return null;
        }
        throw error;
      }
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    retry: (failureCount, error: any) => {
      // Don't retry if index is building
      if (error?.code === 'failed-precondition' || error?.message?.includes('index')) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const saveActiveStrategy = useMutation({
    mutationFn: async (strategy: {
      scenarioId: string;
      weights: Record<string, number>;
      duration?: number | 'ongoing';
      approvalStatus: ActiveStrategy['approvalStatus'];
      approvedBy?: string;
      mixConfig?: MixConfig;
      monthlyBudget?: number;
      channelRecommendation?: ChannelRecommendation;
      salesBaseScope?: SalesBaseScope;
      priceBenchmarkScope?: PriceBenchmarkStrategyScope;
      profitMaxScope?: ProfitMaxScope;
      seasonalDiscount?: SeasonalDiscountConfig;
      seasonalProposal?: SeasonalProposal;
      triageOrigin?: TriageOrigin;
    }) => {
      if (!brandId) throw new Error('No brand selected');

      const now = new Date().toISOString();
      // Stable id per brand prevents orphaning channel_activations; older timestamp-based
      // docs remain but aren't read (the stable doc always has a newer updatedAt).
      const strategyId = `strategy_${brandId}`;
      
      // Build clean object without undefined values
      const strategyData: Record<string, unknown> = {
        id: strategyId,
        brandId,
        scenarioId: strategy.scenarioId,
        weights: strategy.weights,
        approvalStatus: strategy.approvalStatus,
        createdAt: now,
        updatedAt: now,
      };

      if (strategy.duration !== undefined) {
        strategyData.duration = strategy.duration;
      }

      if (strategy.mixConfig) {
        strategyData.mixConfig = strategy.mixConfig;
      }
      
      if (strategy.monthlyBudget !== undefined) {
        strategyData.monthlyBudget = strategy.monthlyBudget;
      }

      if (strategy.channelRecommendation) {
        strategyData.channelRecommendation = JSON.parse(JSON.stringify(strategy.channelRecommendation));
      }

      if (strategy.salesBaseScope) {
        strategyData.salesBaseScope = JSON.parse(JSON.stringify(strategy.salesBaseScope));
      }

      if (strategy.priceBenchmarkScope) {
        strategyData.priceBenchmarkScope = JSON.parse(JSON.stringify(strategy.priceBenchmarkScope));
      }

      if (strategy.profitMaxScope) {
        strategyData.profitMaxScope = JSON.parse(JSON.stringify(strategy.profitMaxScope));
      }

      if (strategy.seasonalDiscount) {
        strategyData.seasonalDiscount = JSON.parse(JSON.stringify(strategy.seasonalDiscount));
      }

      if (strategy.seasonalProposal ?? activeStrategy?.seasonalProposal) {
        strategyData.seasonalProposal = JSON.parse(
          JSON.stringify(strategy.seasonalProposal ?? activeStrategy?.seasonalProposal)
        );
      }

      if (strategy.triageOrigin) {
        strategyData.triageOrigin = JSON.parse(JSON.stringify(strategy.triageOrigin));
      }

      // Only add optional fields if they have values (Firestore doesn't accept undefined)
      if (strategy.approvedBy) {
        strategyData.approvedBy = strategy.approvedBy;
      }
      if (strategy.approvalStatus === 'approved' || strategy.approvalStatus === 'implementing') {
        strategyData.approvedAt = now;
      }
      if (strategy.approvalStatus === 'implementing') {
        strategyData.implementedAt = now;
      }
      
      await FirestoreService.setDocument('active_strategies', strategyId, strategyData);
      
      // Return the saved strategy data
      return {
        ...strategyData,
        id: strategyId,
      } as ActiveStrategy;
    },
    onSuccess: (savedStrategy) => {
      queryClient.setQueryData(['activeStrategy', brandId], savedStrategy);
      queryClient.invalidateQueries({ queryKey: ['activeStrategy', brandId] }).catch(() => {});
    },
  });

  const updateBudget = useMutation({
    mutationFn: async (monthlyBudget: number) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      const now = new Date().toISOString();
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        monthlyBudget,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, monthlyBudget, updatedAt: now };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  const updateMarketingCostLines = useMutation({
    mutationFn: async (marketingCostLines: MarketingCostLine[]) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      if (activeStrategy.id.startsWith('default_')) throw new Error('Cannot save to default strategy');
      const now = new Date().toISOString();
      const clean = JSON.parse(JSON.stringify(marketingCostLines)) as MarketingCostLine[];
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        marketingCostLines: clean,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, marketingCostLines: clean, updatedAt: now } as ActiveStrategy;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  const updateCostCategories = useMutation({
    mutationFn: async (costCategories: PLCostCategory[]) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      if (activeStrategy.id.startsWith('default_')) throw new Error('Cannot save to default strategy');
      const now = new Date().toISOString();
      const clean = JSON.parse(JSON.stringify(costCategories)) as PLCostCategory[];
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        costCategories: clean,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, costCategories: clean, updatedAt: now } as ActiveStrategy;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  // Channel ↔ Activation sync: writing either one mirrors both fields.
  // Prevents divergence between the Channel Activation page and RFM exports.
  const saveRecommendation = useMutation({
    mutationFn: async (recommendation: ChannelRecommendation) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      if (activeStrategy.id.startsWith('default_')) throw new Error('Cannot save to default strategy');
      const now = new Date().toISOString();
      const cleanRec = JSON.parse(JSON.stringify(recommendation));
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        channelRecommendation: cleanRec,
        activationRecommendation: cleanRec,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, channelRecommendation: cleanRec, activationRecommendation: cleanRec, updatedAt: now };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  const saveActivationRecommendation = useMutation({
    mutationFn: async (recommendation: ChannelRecommendation) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      if (activeStrategy.id.startsWith('default_')) throw new Error('Cannot save to default strategy');
      const now = new Date().toISOString();
      const cleanRec = JSON.parse(JSON.stringify(recommendation));
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        activationRecommendation: cleanRec,
        channelRecommendation: cleanRec,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, activationRecommendation: cleanRec, channelRecommendation: cleanRec, updatedAt: now };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  const saveContentSuggestions = useMutation({
    mutationFn: async (suggestions: ContentSuggestionsResult) => {
      if (!activeStrategy?.id || !brandId) throw new Error('No active strategy');
      if (activeStrategy.id.startsWith('default_')) throw new Error('Cannot save to default strategy');
      const now = new Date().toISOString();
      const clean = JSON.parse(JSON.stringify(suggestions));
      await FirestoreService.setDocument('active_strategies', activeStrategy.id, {
        ...activeStrategy,
        contentSuggestions: clean,
        updatedAt: now,
      } as Record<string, unknown>);
      return { ...activeStrategy, contentSuggestions: clean, updatedAt: now };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['activeStrategy', brandId], updated);
    },
  });

  const getStrategyName = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return scenario?.name || 'Custom Strategy';
  };

  /** Single source of truth for channel recommendation: prefers activation (Channel page),
   * falls back to channel (RFM/exports legacy). */
  const getEffectiveChannelRecommendation = (
    strategy?: Pick<ActiveStrategy, 'activationRecommendation' | 'channelRecommendation'> | null,
  ): ChannelRecommendation | undefined => {
    const s = strategy ?? effectiveStrategy ?? undefined;
    return s?.activationRecommendation ?? s?.channelRecommendation;
  };

  // Fallback to default strategy if none exists
  const effectiveStrategy = useMemo(() => {
    if (activeStrategy) return activeStrategy;

    // No Firestore strategy: return default (Profit Maximization); optional fields
    // (approvedAt, approvedBy, implementedAt) omitted since undefined by default.
    if (!isLoading && brandId) {
      return {
        id: 'default_profit_max',
        brandId: brandId,
        scenarioId: scenarios[0].id,
        weights: scenarios[0].weights,
        approvalStatus: 'draft' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as ActiveStrategy;
    }
    
    return null;
  }, [activeStrategy, isLoading, brandId]);

  return {
    activeStrategy: effectiveStrategy,
    isLoading,
    saveActiveStrategy: saveActiveStrategy.mutateAsync,
    isSaving: saveActiveStrategy.isPending,
    updateBudget: updateBudget.mutateAsync,
    isSavingBudget: updateBudget.isPending,
    updateMarketingCostLines: updateMarketingCostLines.mutateAsync,
    isSavingMarketingCostLines: updateMarketingCostLines.isPending,
    updateCostCategories: updateCostCategories.mutateAsync,
    isSavingCostCategories: updateCostCategories.isPending,
    saveRecommendation: saveRecommendation.mutateAsync,
    saveActivationRecommendation: saveActivationRecommendation.mutateAsync,
    saveContentSuggestions: saveContentSuggestions.mutateAsync,
    getStrategyName,
    getEffectiveChannelRecommendation,
  };
}
