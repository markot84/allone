import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderBy } from 'firebase/firestore';
import { FirestoreService } from '../services/firestore';
import { useBrand } from './useBrand';
import { scenarios } from '../data';
import { useMemo } from 'react';

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
        // Get active strategy for this brand
        const strategies = await FirestoreService.getDocuments<ActiveStrategy>(
          'active_strategies',
          [orderBy('updatedAt', 'desc')],
          brandId
        );
        
        // Helper to get timestamp for sorting (prefer updatedAt, fallback to ID which contains Date.now())
        const getTime = (s: ActiveStrategy) => {
          const u = s.updatedAt;
          if (u) {
            if (typeof u === 'string') return new Date(u).getTime();
            if (typeof (u as any)?.toMillis === 'function') return (u as any).toMillis();
          }
          // Fallback: parse timestamp from id (format: strategy_brandId_1234567890)
          const match = s.id?.match(/_(\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        };

        // Return the most recent implementing or approved strategy
        const implementing = strategies.filter(s => s.approvalStatus === 'implementing');
        if (implementing.length > 0) {
          const mostRecent = implementing.sort((a, b) => getTime(b) - getTime(a))[0];
          return mostRecent;
        }
        
        const approved = strategies.filter(s => s.approvalStatus === 'approved');
        if (approved.length > 0) {
          const mostRecent = approved.sort((a, b) => getTime(b) - getTime(a))[0];
          return mostRecent;
        }
        
        // If no implementing/approved, return the most recent draft
        const drafts = strategies.filter(s => s.approvalStatus === 'draft');
        if (drafts.length > 0) {
          const sorted = [...drafts].sort((a, b) => getTime(b) - getTime(a));
          return sorted[0];
        }
        
        return null;
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
    }) => {
      if (!brandId) throw new Error('No brand selected');
      
      const now = new Date().toISOString();
      const strategyId = `strategy_${brandId}_${Date.now()}`;
      
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeStrategy', brandId] }).then(() => {
        queryClient.refetchQueries({ queryKey: ['activeStrategy', brandId] });
      }).catch(() => {});
    },
  });

  const getStrategyName = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return scenario?.name || 'Custom Strategy';
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
    getStrategyName,
  };
}
