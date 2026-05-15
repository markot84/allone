import { callGemini } from './geminiProxy';
import {
  CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT,
  buildChannelRecommendationsUserPrompt,
  type FitLevel,
  type CampaignPerformanceData,
  type PromptContext,
  type TriagePromptContext,
  type ProvenancePromptContext,
  type AudiencePromptContext,
} from '../data/channelRecommendationsPrompt';
import { parseJsonObject } from '../utils/aiJson';
import type {
  ChannelRecommendation,
  BudgetAction,
  RecommendedSegment,
  ChannelPlaybookEntry,
} from '../types';
import type { Scenario } from '../types';
import type { RFMSegment } from '../types';
import { deriveBehavioralProfile, derivePredictiveMetrics } from './behavioralEngine';

const MODEL_NAME = 'gemini-2.5-pro';

function parseAIResponse(text: string): ChannelRecommendation | null {
  try {
    const parsed = parseJsonObject(text);
    if (!parsed) return null;

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
      typeof parsed.rationale === 'string' ? parsed.rationale : 'Δεν ήταν διαθέσιμη αιτιολόγηση από το AI.';

    if (primary.length === 0) return null;

    const actions: BudgetAction[] = Array.isArray(parsed.actions)
      ? (parsed.actions as BudgetAction[]).filter(
          a => a && typeof a.channel === 'string' && typeof a.type === 'string'
        )
      : [];

    const targetSegments: RecommendedSegment[] = Array.isArray(parsed.targetSegments)
      ? (parsed.targetSegments as Array<Record<string, unknown>>)
          .filter((s) => s && typeof s.name === 'string')
          .map((s) => ({
            name: String(s.name),
            fit: s.fit === 'ideal' ? 'ideal' : 'good',
            rationale: typeof s.rationale === 'string' ? s.rationale : '',
          }))
      : [];

    const channelPlaybook: ChannelPlaybookEntry[] = Array.isArray(parsed.channelPlaybook)
      ? (parsed.channelPlaybook as Array<Record<string, unknown>>)
          .filter(
            (e) =>
              e &&
              typeof e.segment === 'string' &&
              typeof e.channel === 'string' &&
              (typeof e.message === 'string' || typeof e.marketingBrief === 'string')
          )
          .map((e) => {
            const priorityRaw = typeof e.priority === 'string' ? e.priority.toLowerCase() : '';
            const priority: 'primary' | 'secondary' | undefined =
              priorityRaw === 'primary' ? 'primary' : priorityRaw === 'secondary' ? 'secondary' : undefined;
            const shareNum = typeof e.budgetSharePct === 'number'
              ? e.budgetSharePct
              : typeof e.budgetSharePct === 'string'
                ? Number(e.budgetSharePct)
                : NaN;
            const budgetSharePct = Number.isFinite(shareNum) && shareNum >= 0 ? shareNum : undefined;
            return {
              segment: String(e.segment),
              channel: String(e.channel),
              message: typeof e.message === 'string' ? e.message : '',
              marketingBrief: typeof e.marketingBrief === 'string' ? e.marketingBrief : '',
              ...(priority ? { priority } : {}),
              ...(budgetSharePct !== undefined ? { budgetSharePct } : {}),
            };
          })
      : [];

    return {
      primary,
      secondary,
      budget_allocation,
      rationale,
      ...(actions.length > 0 ? { actions } : {}),
      ...(targetSegments.length > 0 ? { targetSegments } : {}),
      ...(channelPlaybook.length > 0 ? { channelPlaybook } : {}),
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
  triage?: TriagePromptContext;
  provenance?: ProvenancePromptContext;
  audience?: AudiencePromptContext;
}

export async function generateChannelRecommendations(
  params: GenerateRecommendationsParams
): Promise<ChannelRecommendation | null> {
  const { scenario, segment, fitLevel, brandContext, segmentFitList, totalBudget, campaignPerformance, context, triage, provenance, audience } = params;

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
    triage,
    provenance,
    audience,
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
