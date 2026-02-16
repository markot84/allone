import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { generateChannelRecommendations } from '../services/aiChannelRecommendations';
import { channelRecommendations as staticRecommendations, scenarios } from '../data';
import type { ChannelRecommendation } from '../types';
import type { RFMSegment } from '../types';

export interface UseAIChannelRecommendationsOptions {
  selectedScenarioId: string | null;
  segments: RFMSegment[];
  selectedSegmentId: string;
  useAI?: boolean;
}

export function useAIChannelRecommendations({
  selectedScenarioId,
  segments,
  selectedSegmentId,
  useAI = true
}: UseAIChannelRecommendationsOptions) {
  const [aiEnabled, setAiEnabled] = useState(useAI);

  const segment = useMemo(
    () => segments.find((s) => s.id === selectedSegmentId) ?? segments[0] ?? null,
    [segments, selectedSegmentId]
  );

  const scenario = useMemo(() => {
    const id = selectedScenarioId === 'custom' ? 'profit_max' : selectedScenarioId;
    return scenarios.find((s) => s.id === id) ?? scenarios[0];
  }, [selectedScenarioId]);

  const staticRec = useMemo(() => {
    if (!selectedScenarioId || selectedScenarioId === 'custom') {
      return staticRecommendations.profit_max;
    }
    return staticRecommendations[selectedScenarioId] || staticRecommendations.profit_max;
  }, [selectedScenarioId]);

  const {
    data: aiRecommendations,
    isLoading: aiLoading,
    error: aiError,
    refetch
  } = useQuery({
    queryKey: ['aiChannelRecommendations', selectedScenarioId, selectedSegmentId, aiEnabled],
    queryFn: async () => {
      if (!scenario || !segment || !aiEnabled) return null;
      return generateChannelRecommendations({ scenario, segment });
    },
    enabled: !!scenario && !!segment && aiEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1
  });

  const currentRecommendations: Record<string, ChannelRecommendation> = useMemo(() => {
    const base = { ...staticRec };
    if (segment && aiEnabled && aiRecommendations) {
      base[segment.id] = aiRecommendations;
    }
    return base;
  }, [staticRec, segment, aiEnabled, aiRecommendations]);

  const toggleAI = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  return {
    currentRecommendations,
    isLoading: aiLoading,
    error: aiError,
    aiEnabled,
    toggleAI,
    refetch,
    isAIGenerated: aiEnabled && !!aiRecommendations
  };
}
