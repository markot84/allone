import { callGemini } from './geminiProxy';
import {
  CONTENT_SUGGESTIONS_SYSTEM_PROMPT,
  buildContentSuggestionsUserPrompt,
  type StrategyContext,
  type TriageContentContext,
  type ProvenanceContentContext,
  type AudienceContentContext,
} from '../data/contentSuggestionsPrompt';
import { strategyContentMap } from '../data/mockContent';
import { scenarios } from '../data/mockScenarios';
import { parseJsonObject } from '../utils/aiJson';
import { hashBrandProfilePromptText } from './brandProfile';

const MODEL_NAME = 'gemini-2.5-pro';

export interface OrganicAction {
  type: string;
  title: string;
  description: string;
  channel: string;
  priority: 'high' | 'medium' | 'low';
  headline_suggestion?: string;
}

export interface ContentDirection {
  channel: string;
  theme: string;
  reasoning: string;
  targetSegments?: string[];
  suggestedCategories?: string[];
}

function fillTemplate(text: string, brandName?: string, topCategories?: string[]): string {
  const firstCategory = topCategories?.[0] ?? 'την κύρια κατηγορία';
  return text
    .replace(/\[Brand\]/g, brandName || 'το brand')
    .replace(/\[Product\]/g, firstCategory)
    .replace(/\[Need\]/g, 'την ανάγκη του πελάτη')
    .replace(/\[Segment\]/g, 'βασικά κοινά')
    .replace(/\[Period\]/g, 'την περίοδο')
    .replace(/\[X\]/g, '15');
}

function getFallbackSuggestions(
  scenarioId: string,
  scenarioName: string,
  brandName?: string,
  topCategories?: string[]
): OrganicAction[] {
  const mapEntry = scenarioId && scenarioId !== 'custom'
    ? strategyContentMap[scenarioId as keyof typeof strategyContentMap]
    : undefined;
  if (!mapEntry) return [];

  const types = mapEntry.content_types ?? [];
  const channels = mapEntry.channels ?? [];
  const headlines = mapEntry.sample_headlines ?? [];
  const tone = mapEntry.content_tone ?? '';

  return types.slice(0, 6).map((type, i) => ({
    type,
    title: `${type}: ${scenarioName}`,
    description: `Προτείνεται ${type.toLowerCase()} με ύφος ${tone.toLowerCase()}. ${mapEntry.avoid?.length ? `Αποφύγετε κυρίως: ${mapEntry.avoid.slice(0, 2).join(', ')}.` : ''}`,
    channel: channels[i % channels.length] ?? 'Email',
    priority: (i < 2 ? 'high' : i < 4 ? 'medium' : 'low') as OrganicAction['priority'],
    headline_suggestion: fillTemplate(headlines[i % headlines.length], brandName, topCategories),
  }));
}

export interface ContentSuggestionsResult {
  actions: OrganicAction[];
  directions: ContentDirection[];
  brief: string;
  brandProfileContextSig?: string;
}

function parseAIResponse(text: string): ContentSuggestionsResult | null {
  try {
    const parsed = parseJsonObject(text);
    if (!parsed) return null;

    const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions: OrganicAction[] = actionsRaw
      .filter((a): a is Record<string, unknown> => a && typeof a === 'object')
      .map((a) => ({
        type: String(a.type ?? ''),
        title: String(a.title ?? ''),
        description: String(a.description ?? ''),
        channel: String(a.channel ?? ''),
        priority: ['high', 'medium', 'low'].includes(String(a.priority)) ? (a.priority as OrganicAction['priority']) : 'medium',
        headline_suggestion: a.headline_suggestion ? String(a.headline_suggestion) : undefined,
      }))
      .filter((a) => a.title && a.description);

    const directionsRaw = Array.isArray(parsed.directions) ? parsed.directions : [];
    const directions: ContentDirection[] = directionsRaw
      .filter((d): d is Record<string, unknown> => d && typeof d === 'object')
      .map((d) => ({
        channel: String(d.channel ?? ''),
        theme: String(d.theme ?? ''),
        reasoning: String(d.reasoning ?? ''),
        targetSegments: Array.isArray(d.targetSegments) ? d.targetSegments.map(String) : undefined,
        suggestedCategories: Array.isArray(d.suggestedCategories) ? d.suggestedCategories.map(String) : undefined,
      }))
      .filter((d) => d.channel && d.theme);

    const brief = typeof parsed.brief === 'string' ? parsed.brief : '';

    if (actions.length === 0 && directions.length === 0) return null;
    return { actions, directions, brief };
  } catch {
    return null;
  }
}

export interface GenerateContentSuggestionsParams {
  scenarioId: string;
  scenarioName: string;
  weights: Record<string, number> | null;
  brandName?: string;
  brandProfileText?: string;
  topCategories?: string[];
  segmentNames?: string[];
  triage?: TriageContentContext;
  provenance?: ProvenanceContentContext;
  audience?: AudienceContentContext;
}

export async function generateContentSuggestions(
  params: GenerateContentSuggestionsParams
): Promise<ContentSuggestionsResult | null> {
  const { scenarioId, scenarioName, weights, brandName, brandProfileText, topCategories, segmentNames, triage, provenance, audience } = params;

  const mapEntry = scenarioId && scenarioId !== 'custom'
    ? strategyContentMap[scenarioId as keyof typeof strategyContentMap]
    : undefined;
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const brandProfileContextSig = hashBrandProfilePromptText(brandProfileText);

  const ctx: StrategyContext = {
    scenarioId,
    scenarioName,
    weights: weights ?? scenario?.weights ?? {},
    contentTone: mapEntry?.content_tone,
    contentTypes: mapEntry?.content_types,
    channels: mapEntry?.channels,
    ctaStyle: mapEntry?.cta_style,
    avoid: mapEntry?.avoid,
    sampleHeadlines: mapEntry?.sample_headlines,
    brandName,
    brandProfileText,
    topCategories,
    segmentNames,
    triage,
    provenance,
    audience,
  };

  try {
    const userPrompt = buildContentSuggestionsUserPrompt(ctx);

    const text = await callGemini({
      systemPrompt: CONTENT_SUGGESTIONS_SYSTEM_PROMPT,
      userPrompt,
      model: MODEL_NAME,
      temperature: 0,
    });

    if (!text) {
      return { actions: getFallbackSuggestions(scenarioId, scenarioName, brandName, topCategories), directions: [], brief: '', brandProfileContextSig };
    }
    const parsed = parseAIResponse(text);
    if (parsed && (parsed.actions.length > 0 || parsed.directions.length > 0)) return { ...parsed, brandProfileContextSig };
    return { actions: getFallbackSuggestions(scenarioId, scenarioName, brandName, topCategories), directions: [], brief: '', brandProfileContextSig };
  } catch (error) {
    console.error('[aiContentSuggestions]', error);
    return { actions: getFallbackSuggestions(scenarioId, scenarioName, brandName, topCategories), directions: [], brief: '', brandProfileContextSig };
  }
}
