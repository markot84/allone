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

const SEGMENT_NAME_MAP: Record<string, string> = {
  champions: 'champions',
  champion: 'champions',
  loyal: 'champions',
  'loyal customers': 'champions',
  'potential loyalists': 'potential',
  potential: 'potential',
  'at risk': 'at_risk',
  'at-risk': 'at_risk',
  at_risk: 'at_risk',
  hibernating: 'at_risk',
  lost: 'at_risk',
  'cant lose': 'champions',
  "can't lose them": 'champions',
  "can't lose": 'champions',
  'needs attention': 'potential',
  'customers needing attention': 'potential',
  'about to sleep': 'at_risk',
  'new customers': 'potential',
  promising: 'potential',
};

function mapSegmentToStaticKey(segment: RFMSegment): string {
  const name = segment.name.toLowerCase().trim();
  if (SEGMENT_NAME_MAP[name]) return SEGMENT_NAME_MAP[name];
  if (SEGMENT_NAME_MAP[segment.id]) return SEGMENT_NAME_MAP[segment.id];
  if (name.includes('champion') || name.includes('loyal') || name.includes('vip') || name.includes("can't lose")) return 'champions';
  if (name.includes('risk') || name.includes('lost') || name.includes('hibernat') || name.includes('sleep')) return 'at_risk';
  if (name.includes('potential') || name.includes('promis') || name.includes('new') || name.includes('attention')) return 'potential';
  return 'champions';
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

  const staticFallback = useMemo((): ChannelRecommendation | null => {
    const scenarioRecs = selectedScenarioId && selectedScenarioId !== 'custom'
      ? staticRecommendations[selectedScenarioId] || staticRecommendations.profit_max
      : staticRecommendations.profit_max;
    if (!segment) return Object.values(scenarioRecs)[0] || null;
    const staticKey = mapSegmentToStaticKey(segment);
    return scenarioRecs[staticKey] || Object.values(scenarioRecs)[0] || null;
  }, [selectedScenarioId, segment]);

  const {
    data: aiRecommendation,
    isLoading: aiLoading,
    error: aiError,
    refetch
  } = useQuery({
    queryKey: ['aiChannelRecommendations', 'v2', selectedScenarioId, selectedSegmentId, aiEnabled],
    queryFn: async () => {
      if (!scenario || !segment || !aiEnabled) return null;
      return generateChannelRecommendations({ scenario, segment });
    },
    enabled: !!scenario && !!segment && aiEnabled && selectedSegmentId !== '',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1
  });

  const recommendation = useMemo((): ChannelRecommendation | null => {
    if (aiEnabled && aiRecommendation) return aiRecommendation;
    return staticFallback;
  }, [aiEnabled, aiRecommendation, staticFallback]);

  const toggleAI = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  return {
    recommendation,
    isLoading: aiLoading,
    error: aiError,
    aiEnabled,
    toggleAI,
    refetch,
    isAIGenerated: aiEnabled && !!aiRecommendation
  };
}
