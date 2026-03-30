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
import { deriveBehavioralProfile, derivePredictiveMetrics } from './behavioralEngine';

const MODEL_NAME = 'gemini-2.5-flash';

function extractJSON(text: string): string | null {
  let cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try direct parse first
  try { JSON.parse(cleaned); return cleaned; } catch { /* fall through */ }

  // Extract first {...} block (handles text before/after JSON)
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    let candidate = cleaned.slice(start, end + 1);
    try { JSON.parse(candidate); return candidate; } catch { /* try fixing */ }

    // Fix unescaped newlines inside JSON strings
    candidate = candidate.replace(/(?<=:\s*"[^"]*)\n/g, '\\n');
    try { JSON.parse(candidate); return candidate; } catch { /* fall through */ }
  }

  return null;
}

function parseAIResponse(text: string): ChannelRecommendation | null {
  const jsonStr = extractJSON(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

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

  const behavioral = deriveBehavioralProfile(segment);
  const predictive = derivePredictiveMetrics(segment);

  const behavioralContext = `
BEHAVIORAL PROFILE (${segment.name}):
- Persona: ${behavioral.persona} | Lifecycle: ${behavioral.lifecycle_stage}
- Συχνότητα αγορών: ${behavioral.purchase_frequency} | Μέσο καλάθι: €${behavioral.avg_basket_size}
- Preferred channels: ${behavioral.preferred_channels.join(', ')}
- Device: ${behavioral.device_preference} | Price sensitivity: ${behavioral.price_sensitivity}
- Upsell score: ${behavioral.upsell_score}% | Cross-sell score: ${behavioral.cross_sell_score}%
- Engagement: ${behavioral.engagement_score}%

PREDICTIVE METRICS (${segment.name}):
- Estimated LTV: €${predictive.estimated_ltv.toLocaleString()}
- Churn risk: ${predictive.churn_risk}% (${predictive.churn_risk_label})
- Next purchase: ${predictive.days_to_next_purchase} ημέρες (prob: ${predictive.next_purchase_probability}%)
- Demand trend: ${predictive.demand_trend}
- Retention score: ${predictive.retention_score}%

Λάβε υπόψη αυτά τα behavioral και predictive signals στις συστάσεις καναλιών.`;

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
  }) + behavioralContext;

  const text = await callGemini({
    systemPrompt: CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT,
    userPrompt,
    model: MODEL_NAME,
    temperature: 0,
  });

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  const result = parseAIResponse(text);
  if (!result) {
    console.error('[aiChannelRecommendations] Failed to parse AI response:', text.slice(0, 500));
    throw new Error('AI response could not be parsed');
  }

  return result;
}
