import { useQuery } from '@tanstack/react-query';
import { generateContentSuggestions } from '../services/aiContentSuggestions';
import { useActiveStrategy } from './useActiveStrategy';

export function useAIContentSuggestions(aiEnabled: boolean) {
  const { activeStrategy, getStrategyName, isLoading: strategyLoading } = useActiveStrategy();

  const { data: suggestions, isLoading: suggestionsLoading, refetch } = useQuery({
    queryKey: ['aiContentSuggestions', activeStrategy?.scenarioId, activeStrategy?.id, aiEnabled],
    queryFn: async () => {
      if (!activeStrategy) return null;
      return generateContentSuggestions({
        scenarioId: activeStrategy.scenarioId,
        scenarioName: getStrategyName(activeStrategy.scenarioId),
        weights: activeStrategy.weights ?? null,
      });
    },
    enabled: !!activeStrategy && aiEnabled,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  return {
    suggestions: suggestions?.actions ?? [],
    isLoading: strategyLoading || suggestionsLoading,
    refetch,
    hasStrategy: !!activeStrategy,
  };
}
