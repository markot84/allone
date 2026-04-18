import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderBy } from 'firebase/firestore';
import { FirestoreService } from '../services/firestore';
import { useBrand } from './useBrand';
import { scenarios } from '../data';
import { useMemo } from 'react';
import type {
  ChannelRecommendation,
  MarketingCostLine,
  PriceBenchmarkStrategyScope,
  SalesBaseScope,
} from '../types';
import type { ContentSuggestionsResult } from '../services/aiContentSuggestions';
import type { SeasonalDiscountConfig } from '../components/strategy/SeasonalDiscountPanel';

export interface MixConfig {
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
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
  /** Επιπλέον κόστη marketing για πληρέστερο ROI (εκτός ad spend). */
  marketingCostLines?: MarketingCostLine[];
  channelRecommendation?: ChannelRecommendation;
  activationRecommendation?: ChannelRecommendation;
  contentSuggestions?: ContentSuggestionsResult;
  /** Φίλτρο συμμετοχής SKU για Sales Optimization (sales_base) */
  salesBaseScope?: SalesBaseScope;
  /** Φίλτρο συμμετοχής SKU για Price Benchmarking (price_benchmark) */
  priceBenchmarkScope?: PriceBenchmarkStrategyScope;
  /** Παράμετροι εποχιακής/εκπτωτικής περιόδου (seasonal_discount) */
  seasonalDiscount?: SeasonalDiscountConfig;
  createdAt: string;
  updatedAt: string;
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
          [orderBy('updatedAt', 'desc')],
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
        // If index is building, return null (will use fallback)
        // This allows saves to work even if query fails
        if (error?.code === 'failed-precondition' || error?.message?.includes('index')) {
          console.debug('Index building, query unavailable. Saves will still work.');
          return null;
        }
        throw error;
      }
    },
    enabled: !!brandId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
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
      seasonalDiscount?: SeasonalDiscountConfig;
    }) => {
      if (!brandId) throw new Error('No brand selected');

      const now = new Date().toISOString();
      // Σταθερό id per brand → αποτρέπει το orphaning των channel_activations σε κάθε save.
      // Παλιά timestamp-based docs παραμένουν στο Firestore αλλά δεν επιστρέφονται από τον reader,
      // γιατί το νέο stable doc έχει πάντα πιο πρόσφατο updatedAt.
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

      if (strategy.seasonalDiscount) {
        strategyData.seasonalDiscount = JSON.parse(JSON.stringify(strategy.seasonalDiscount));
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

  // Channel ↔ Activation sync: όταν γράφεται οποιοδήποτε από τα δύο, mirror-άρει και τα δύο πεδία.
  // Αποτρέπει divergence ανάμεσα σε Channel Activation page και RFM exports.
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

  /** Single source of truth για channel recommendation. Προτιμά activation (Channel page),
   * fallback σε channel (RFM/exports legacy). */
  const getEffectiveChannelRecommendation = (
    strategy?: Pick<ActiveStrategy, 'activationRecommendation' | 'channelRecommendation'> | null,
  ): ChannelRecommendation | undefined => {
    const s = strategy ?? effectiveStrategy ?? undefined;
    return s?.activationRecommendation ?? s?.channelRecommendation;
  };

  // Fallback to default strategy if none exists
  const effectiveStrategy = useMemo(() => {
    if (activeStrategy) return activeStrategy;
    
    // If no strategy found in Firestore, return default (Profit Maximization)
    // Don't include optional fields (approvedAt, approvedBy, implementedAt) - they're undefined by default
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
    saveRecommendation: saveRecommendation.mutateAsync,
    saveActivationRecommendation: saveActivationRecommendation.mutateAsync,
    saveContentSuggestions: saveContentSuggestions.mutateAsync,
    getStrategyName,
    getEffectiveChannelRecommendation,
  };
}
