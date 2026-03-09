import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { generateChannelRecommendations } from '../services/aiChannelRecommendations';
import { channelRecommendations as staticRecommendations, scenarios } from '../data';
import type { ChannelRecommendation } from '../types';
import type { RFMSegment } from '../types';
import type { FitLevel } from '../utils/segmentRelevance';
import type { CampaignPerformanceData, PromptContext } from '../data/channelRecommendationsPrompt';

export interface MixConfigForAI {
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
}

export interface BrandContext {
  brandName: string;
  brandType: 'B2B' | 'B2C';
  topCategories: string[];
}

export interface SegmentFitInfo {
  name: string;
  fit: FitLevel;
}

export interface UseAIChannelRecommendationsOptions {
  selectedScenarioId: string | null;
  segments: RFMSegment[];
  selectedSegmentId: string;
  fitLevel?: FitLevel;
  mixConfig?: MixConfigForAI | null;
  brandContext?: BrandContext | null;
  segmentFitList?: SegmentFitInfo[];
  useAI?: boolean;
  totalBudget?: number;
  campaignPerformance?: CampaignPerformanceData[];
  context?: PromptContext;
  saveVersion?: number;
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
  fitLevel = 'good',
  mixConfig,
  brandContext,
  segmentFitList,
  useAI = true,
  totalBudget,
  campaignPerformance,
  context = 'strategy',
  saveVersion = 0,
}: UseAIChannelRecommendationsOptions) {
  const [aiEnabled, setAiEnabled] = useState(useAI);

  // Force AI on when a new save triggers generation
  useEffect(() => {
    if (saveVersion > 0) setAiEnabled(true);
  }, [saveVersion]);

  const segment = useMemo(
    () => segments.find((s) => s.id === selectedSegmentId) ?? segments[0] ?? null,
    [segments, selectedSegmentId]
  );

  const scenario = useMemo(() => {
    if (selectedScenarioId === 'mixed' && mixConfig) {
      const a = scenarios.find(s => s.id === mixConfig.scenarioA);
      const b = scenarios.find(s => s.id === mixConfig.scenarioB);
      if (a && b) {
        return {
          ...a,
          id: 'mixed' as string,
          name: `Μικτή: ${a.name} ${mixConfig.percentA}% + ${b.name} ${mixConfig.percentB}%`,
          description: `Συνδυασμός στρατηγικών: ${a.name} (${a.description}) στο ${mixConfig.percentA}% και ${b.name} (${b.description}) στο ${mixConfig.percentB}%. Η πρώτη στρατηγική κυριαρχεί${mixConfig.percentA >= 60 ? ' σημαντικά' : ''} — προσάρμοσε τις προτάσεις ώστε να εξυπηρετούν κυρίως τον στόχο "${a.description}" αλλά ταυτόχρονα να συμβάλλουν και στο "${b.description}".`
        };
      }
    }
    const id = selectedScenarioId === 'custom' ? 'profit_max' : selectedScenarioId;
    return scenarios.find((s) => s.id === id) ?? scenarios[0];
  }, [selectedScenarioId, mixConfig]);

  const staticFallback = useMemo((): ChannelRecommendation | null => {
    const fallbackId = selectedScenarioId === 'mixed' && mixConfig
      ? mixConfig.scenarioA
      : selectedScenarioId;
    const scenarioRecs = fallbackId && fallbackId !== 'custom'
      ? staticRecommendations[fallbackId] || staticRecommendations.profit_max
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
    queryKey: ['aiChannelRecommendations', 'v10', selectedScenarioId, selectedSegmentId, fitLevel, aiEnabled, mixConfig?.scenarioA, mixConfig?.scenarioB, mixConfig?.percentA, brandContext?.brandName, totalBudget, context, saveVersion],
    queryFn: async () => {
      if (!scenario || !segment || !aiEnabled) return null;
      return generateChannelRecommendations({
        scenario, segment, fitLevel,
        brandContext: brandContext ?? undefined,
        segmentFitList: segmentFitList ?? undefined,
        totalBudget,
        campaignPerformance,
        context,
      });
    },
    enabled: !!scenario && !!segment && aiEnabled && selectedSegmentId !== '',
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
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
    aiOnlyResult: aiRecommendation ?? null,
    isLoading: aiLoading,
    error: aiError,
    aiEnabled,
    toggleAI,
    refetch,
    isAIGenerated: aiEnabled && !!aiRecommendation
  };
}
