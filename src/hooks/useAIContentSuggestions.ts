import { useQuery } from '@tanstack/react-query';
import { generateContentSuggestions } from '../services/aiContentSuggestions';
import { useActiveStrategy } from './useActiveStrategy';

export interface UseAIContentSuggestionsOptions {
  aiEnabled: boolean;
  brandName?: string;
  topCategories?: string[];
  segmentNames?: string[];
}

export function useAIContentSuggestions({ aiEnabled, brandName, topCategories, segmentNames }: UseAIContentSuggestionsOptions) {
  const { activeStrategy, getStrategyName, isLoading: strategyLoading } = useActiveStrategy();

  const { data: result, isLoading: suggestionsLoading, refetch } = useQuery({
    queryKey: ['aiContentSuggestions', 'v2', activeStrategy?.scenarioId, activeStrategy?.id, aiEnabled, brandName],
    queryFn: async () => {
      if (!activeStrategy) return null;
      return generateContentSuggestions({
        scenarioId: activeStrategy.scenarioId,
        scenarioName: getStrategyName(activeStrategy.scenarioId),
        weights: activeStrategy.weights ?? null,
        brandName,
        topCategories,
        segmentNames,
      });
    },
    enabled: !!activeStrategy && aiEnabled,
    staleTime: 5 * 60 * 1000,
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
