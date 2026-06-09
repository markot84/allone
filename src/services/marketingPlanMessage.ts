import { parseJsonObject } from '../utils/aiJson';
import { logger } from '../utils/logger';
import { callGemini } from './geminiProxy';
import { buildFallbackCoreMessage, type MarketingPlanCoreMessage } from './marketingPlanEngine';
import type { MarketingPlanInsight } from './marketingPlanInsights';

// Flash: το core message είναι σύντομο (headline + παράγραφος)· το flash είναι αρκετό και
// πολύ ταχύτερο/φθηνότερο από το pro. Είναι non-blocking με deterministic fallback.
const MODEL_NAME = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a senior retail marketing strategist.
Return only valid JSON with:
{
  "headline": "short Greek campaign headline",
  "campaignAngle": "one concise Greek paragraph",
  "proofPoints": ["up to 3 evidence bullets in Greek"],
  "ctaIdeas": ["up to 3 CTA ideas in Greek"]
}
Use only the provided evidence. Do not invent metrics. Brand profile guides tone, positioning, ICP, CTAs and campaign angle, but it must not override hard performance evidence.`;

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

function buildUserPrompt(
  insight: MarketingPlanInsight,
  brandName?: string,
  commercialInfoText?: string,
  brandProfileText?: string
): string {
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
    // Εμπορική γνώση/ένστικτο επιχειρηματία (από τη σελίδα «Εμπορικές Πληροφορίες»).
    commercialContext: commercialInfoText && commercialInfoText.trim() ? commercialInfoText : undefined,
    // Brand identity context: tone/archetype/ICPs. Δεν αντικαθιστά τα evidence metrics.
    brandProfileContext: brandProfileText && brandProfileText.trim() ? brandProfileText : undefined,
    instruction:
      'Γράψε το βασικό μήνυμα της περιόδου για marketing plan. Να συνδέεται με περσινή ζήτηση, τρέχον απόθεμα και εμπορική προτεραιότητα. Αν υπάρχει commercialContext, ενσωμάτωσέ τον ως ισχυρό σήμα για την κατεύθυνση/χρονισμό της καμπάνιας. Αν υπάρχει brandProfileContext, κράτησε το μήνυμα συμβατό με το archetype, tone of voice και ICPs, χωρίς να επινοήσεις νέα νούμερα.',
  });
}

export async function generateMarketingPlanMessage(input: {
  insight: MarketingPlanInsight;
  brandName?: string;
  /** Συμπυκνωμένες ενεργές εμπορικές πληροφορίες (formatCommercialInfoForPrompt). */
  commercialInfoText?: string;
  /** Συμπυκνωμένο Brand Profile context (formatBrandProfileForPrompt). */
  brandProfileText?: string;
}): Promise<MarketingPlanCoreMessage> {
  const fallback = buildFallbackCoreMessage(input.insight);
  const hasContext = !!(input.commercialInfoText && input.commercialInfoText.trim());
  // Με εμπορικές πληροφορίες αξίζει AND να παράγουμε μήνυμα ακόμη κι αν τα data είναι μέτρια.
  if (!hasContext && (input.insight.dataQuality.level === 'weak' || input.insight.reorderPlan.length === 0)) {
    return fallback;
  }
  try {
    const text = await callGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input.insight, input.brandName, input.commercialInfoText, input.brandProfileText),
      model: MODEL_NAME,
      temperature: 0.2,
    });
    return parseMarketingPlanMessage(text) ?? fallback;
  } catch (error) {
    logger.warn('[marketingPlanMessage]', { err: error });
    return fallback;
  }
}
