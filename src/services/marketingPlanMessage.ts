import { parseJsonObject } from '../utils/aiJson';
import { callGemini } from './geminiProxy';
import { buildFallbackCoreMessage, type MarketingPlanCoreMessage } from './marketingPlanEngine';
import type { MarketingPlanInsight } from './marketingPlanInsights';

const MODEL_NAME = 'gemini-2.5-pro';

const SYSTEM_PROMPT = `You are a senior retail marketing strategist.
Return only valid JSON with:
{
  "headline": "short Greek campaign headline",
  "campaignAngle": "one concise Greek paragraph",
  "proofPoints": ["up to 3 evidence bullets in Greek"],
  "ctaIdeas": ["up to 3 CTA ideas in Greek"]
}
Use only the provided evidence. Do not invent metrics.`;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3)
    : [];
}

export function parseMarketingPlanMessage(text: string): MarketingPlanCoreMessage | null {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;
  const headline = String(parsed.headline ?? '').trim();
  const campaignAngle = String(parsed.campaignAngle ?? '').trim();
  if (!headline || !campaignAngle) return null;
  return {
    headline,
    campaignAngle,
    proofPoints: asStringArray(parsed.proofPoints),
    ctaIdeas: asStringArray(parsed.ctaIdeas),
    source: 'ai',
  };
}

function buildUserPrompt(insight: MarketingPlanInsight, brandName?: string): string {
  const topGroups = insight.reorderPlan.slice(0, 5).map((row) => ({
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    lastYearRevenue: row.lastYearRevenue,
    lastYearUnits: row.lastYearUnits,
    currentStock: row.currentStock,
    suggestedReorderQty: row.estimatedReorderQty,
    action: row.action,
    confidence: row.confidence,
  }));
  return JSON.stringify({
    brandName: brandName || '',
    targetPeriod: {
      label: insight.period.periodLabel,
      from: insight.period.fromDate,
      to: insight.period.toDate,
    },
    lastYearEvidence: insight.evidence,
    dataQuality: insight.dataQuality,
    topGroups,
    instruction:
      'Γράψε το βασικό μήνυμα της περιόδου για marketing plan. Να συνδέεται με περσινή ζήτηση, τρέχον απόθεμα και εμπορική προτεραιότητα.',
  });
}

export async function generateMarketingPlanMessage(input: {
  insight: MarketingPlanInsight;
  brandName?: string;
}): Promise<MarketingPlanCoreMessage> {
  const fallback = buildFallbackCoreMessage(input.insight);
  if (input.insight.dataQuality.level === 'weak' || input.insight.reorderPlan.length === 0) {
    return fallback;
  }
  try {
    const text = await callGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input.insight, input.brandName),
      model: MODEL_NAME,
      temperature: 0.2,
    });
    return parseMarketingPlanMessage(text) ?? fallback;
  } catch (error) {
    console.warn('[marketingPlanMessage]', error);
    return fallback;
  }
}
