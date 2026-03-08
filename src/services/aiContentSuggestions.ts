import { GoogleGenerativeAI } from '@google/generative-ai';
import { CONTENT_SUGGESTIONS_SYSTEM_PROMPT, buildContentSuggestionsUserPrompt, type StrategyContext } from '../data/contentSuggestionsPrompt';
import { strategyContentMap } from '../data/mockContent';
import { scenarios } from '../data/mockScenarios';

const MODEL_NAME = 'gemini-2.5-flash';

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

function getFallbackSuggestions(scenarioId: string, scenarioName: string): OrganicAction[] {
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
    title: `${type} – ${scenarioName}`,
    description: `Δημιουργήστε ${type.toLowerCase()} με ${tone.toLowerCase()} τόνο. ${mapEntry.avoid?.length ? `Αποφύγετε: ${mapEntry.avoid.slice(0, 2).join(', ')}.` : ''}`,
    channel: channels[i % channels.length] ?? 'Email',
    priority: (i < 2 ? 'high' : i < 4 ? 'medium' : 'low') as OrganicAction['priority'],
    headline_suggestion: headlines[i % headlines.length],
  }));
}

export interface ContentSuggestionsResult {
  actions: OrganicAction[];
  directions: ContentDirection[];
  brief: string;
}

function parseAIResponse(text: string): ContentSuggestionsResult | null {
  try {
    const cleaned = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

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
  topCategories?: string[];
  segmentNames?: string[];
}

export async function generateContentSuggestions(
  params: GenerateContentSuggestionsParams
): Promise<ContentSuggestionsResult | null> {
  const { scenarioId, scenarioName, weights, brandName, topCategories, segmentNames } = params;

  const mapEntry = scenarioId && scenarioId !== 'custom'
    ? strategyContentMap[scenarioId as keyof typeof strategyContentMap]
    : undefined;
  const scenario = scenarios.find((s) => s.id === scenarioId);

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
    topCategories,
    segmentNames,
  };

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: CONTENT_SUGGESTIONS_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0,
      },
    });

    const userPrompt = buildContentSuggestionsUserPrompt(ctx);

    const result = await model.generateContent(userPrompt);
    const text = result.response.text();

    if (!text) {
      return { actions: getFallbackSuggestions(scenarioId, scenarioName), directions: [], brief: '' };
    }
    const parsed = parseAIResponse(text);
    if (parsed && (parsed.actions.length > 0 || parsed.directions.length > 0)) return parsed;
    return { actions: getFallbackSuggestions(scenarioId, scenarioName), directions: [], brief: '' };
  } catch (error) {
    console.error('[aiContentSuggestions]', error);
    return { actions: getFallbackSuggestions(scenarioId, scenarioName), directions: [], brief: '' };
  }
}
