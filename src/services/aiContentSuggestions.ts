import { getAI, getGenerativeModel } from 'firebase/ai';
import app from '../config/firebase';
import { buildContentSuggestionsUserPrompt, type StrategyContext } from '../data/contentSuggestionsPrompt';
import { strategyContentMap } from '../data/mockContent';
import { scenarios } from '../data/mockScenarios';

const MODEL_NAME = 'gemini-2.0-flash';

export interface OrganicAction {
  type: string;
  title: string;
  description: string;
  channel: string;
  priority: 'high' | 'medium' | 'low';
  headline_suggestion?: string;
}

export interface ContentSuggestionsResult {
  actions: OrganicAction[];
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

    if (actions.length === 0) return null;
    return { actions };
  } catch {
    return null;
  }
}

export interface GenerateContentSuggestionsParams {
  scenarioId: string;
  scenarioName: string;
  weights: Record<string, number> | null;
}

export async function generateContentSuggestions(
  params: GenerateContentSuggestionsParams
): Promise<ContentSuggestionsResult | null> {
  const { scenarioId, scenarioName, weights } = params;

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
  };

  try {
    const ai = getAI(app);
    const model = getGenerativeModel(ai, { model: MODEL_NAME });

    const userPrompt = buildContentSuggestionsUserPrompt(ctx);

    const result = (await model.generateContent(userPrompt)) as {
      text?: () => string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let text = '';
    if (typeof result?.text === 'function') {
      text = result.text();
    } else if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = result.candidates[0].content.parts[0].text;
    }

    if (!text) return null;
    return parseAIResponse(text);
  } catch (error) {
    console.error('[aiContentSuggestions]', error);
    return null;
  }
}
