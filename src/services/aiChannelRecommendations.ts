import { callGemini } from './geminiProxy';
import {
  CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT,
  buildChannelRecommendationsUserPrompt,
  type FitLevel,
  type CampaignPerformanceData,
  type PromptContext,
} from '../data/channelRecommendationsPrompt';
import type { ChannelRecommendation, BudgetAction } from '../types';
import type { Scenario } from '../types';
import type { RFMSegment } from '../types';

const MODEL_NAME = 'gemini-2.5-flash';

function parseAIResponse(text: string): ChannelRecommendation | null {
  try {
    const cleaned = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const primary = Array.isArray(parsed.primary)
      ? (parsed.primary as string[]).filter((s) => typeof s === 'string')
      : [];
    const secondary = Array.isArray(parsed.secondary)
      ? (parsed.secondary as string[]).filter((s) => typeof s === 'string')
      : [];
    const budget_allocation =
      typeof parsed.budget_allocation === 'object' && parsed.budget_allocation !== null
        ? (parsed.budget_allocation as Record<string, number>)
        : {};
    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale : 'AI-generated recommendation.';

    if (primary.length === 0) return null;

    const actions: BudgetAction[] = Array.isArray(parsed.actions)
      ? (parsed.actions as BudgetAction[]).filter(
          a => a && typeof a.channel === 'string' && typeof a.type === 'string'
        )
      : [];

    return {
      primary,
      secondary,
      budget_allocation,
      rationale,
      ...(actions.length > 0 ? { actions } : {}),
    };
  } catch {
    return null;
  }
}

export interface BrandContext {
  brandName: string;
  brandType: 'B2B' | 'B2C';
  topCategories: string[];
}

export interface SegmentFitInfo {
  name: string;
  fit: 'ideal' | 'good' | 'partial';
}

export interface GenerateRecommendationsParams {
  scenario: Scenario;
  segment: RFMSegment;
  fitLevel?: FitLevel;
  brandContext?: BrandContext;
  segmentFitList?: SegmentFitInfo[];
  totalBudget?: number;
  campaignPerformance?: CampaignPerformanceData[];
  context?: PromptContext;
}

export async function generateChannelRecommendations(
  params: GenerateRecommendationsParams
): Promise<ChannelRecommendation | null> {
  const { scenario, segment, fitLevel, brandContext, segmentFitList, totalBudget, campaignPerformance, context } = params;

  try {
    const userPrompt = buildChannelRecommendationsUserPrompt({
      scenarioName: scenario.name,
      scenarioDescription: scenario.description || '',
      segmentName: segment.name,
      segmentDescription: segment.description || '',
      segmentCount: segment.count,
      revenueShare: segment.revenue_share,
      fitLevel,
      brandName: brandContext?.brandName,
      brandType: brandContext?.brandType,
      topCategories: brandContext?.topCategories,
      segmentFitList,
      totalBudget,
      campaignPerformance,
      context,
    });

    const text = await callGemini({
      systemPrompt: CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT,
      userPrompt,
      model: MODEL_NAME,
      temperature: 0,
    });

    if (!text) return null;

    return parseAIResponse(text);
  } catch (error) {
    console.error('[aiChannelRecommendations]', error);
    return null;
  }
}
