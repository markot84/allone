import { useQuery } from '@tanstack/react-query';
import { generateContentSuggestions } from '../services/aiContentSuggestions';
import { useActiveStrategy, type TriageOrigin } from './useActiveStrategy';
import { buildTriagePromptContext } from '../utils/aiPromptContext';
import type { ProvenanceContentContext } from '../data/contentSuggestionsPrompt';

export interface UseAIContentSuggestionsOptions {
  aiEnabled: boolean;
  brandName?: string;
  topCategories?: string[];
  segmentNames?: string[];
  /** Provenance snapshot από caller που έχει `useProductSignals.coverage`. */
  provenance?: ProvenanceContentContext | null;
}

export function useAIContentSuggestions({
  aiEnabled,
  brandName,
  topCategories,
  segmentNames,
  provenance,
}: UseAIContentSuggestionsOptions) {
  const { activeStrategy, getStrategyName, isLoading: strategyLoading } = useActiveStrategy();

  // Triage origin: επανερμηνεύεται αυτόματα από το αποθηκευμένο active_strategies
  // doc — έτσι κάθε caller παίρνει context-aware content "δωρεάν".
  const savedTriage = (activeStrategy as { triageOrigin?: TriageOrigin } | null)?.triageOrigin ?? null;
  const triagePromptCtx = buildTriagePromptContext(savedTriage);

  const { data: result, isLoading: suggestionsLoading, refetch } = useQuery({
    queryKey: [
      'aiContentSuggestions', 'v3',
      activeStrategy?.scenarioId, activeStrategy?.id, aiEnabled, brandName,
      triagePromptCtx?.bucketLabel, triagePromptCtx?.skuCount,
      provenance?.connectorPct, provenance?.totalProducts,
    ],
    queryFn: async () => {
      if (!activeStrategy) return null;
      return generateContentSuggestions({
        scenarioId: activeStrategy.scenarioId,
        scenarioName: getStrategyName(activeStrategy.scenarioId),
        weights: activeStrategy.weights ?? null,
        brandName,
        topCategories,
        segmentNames,
        triage: triagePromptCtx,
        provenance: provenance ?? undefined,
      });
    },
    enabled: !!activeStrategy && aiEnabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    suggestions: result?.actions ?? [],
    directions: result?.directions ?? [],
    brief: result?.brief ?? '',
    isLoading: strategyLoading || suggestionsLoading,
    refetch,
    hasStrategy: !!activeStrategy,
  };
}
