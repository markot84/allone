import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT,
  buildChannelRecommendationsUserPrompt
} from '../data/channelRecommendationsPrompt';
import type { ChannelRecommendation } from '../types';
import type { Scenario } from '../types';
import type { RFMSegment } from '../types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
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

    return {
      primary,
      secondary,
      budget_allocation,
      rationale
    };
  } catch {
    return null;
  }
}

export interface GenerateRecommendationsParams {
  scenario: Scenario;
  segment: RFMSegment;
}

export async function generateChannelRecommendations(
  params: GenerateRecommendationsParams
): Promise<ChannelRecommendation | null> {
  const { scenario, segment } = params;

  try {
    if (!GEMINI_API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: CHANNEL_RECOMMENDATIONS_SYSTEM_PROMPT
    });

    const userPrompt = buildChannelRecommendationsUserPrompt({
      scenarioName: scenario.name,
      scenarioDescription: scenario.description || '',
      segmentName: segment.name,
      segmentDescription: segment.description || '',
      segmentCount: segment.count,
      revenueShare: segment.revenue_share
    });

    const result = await model.generateContent(userPrompt);
    const text = result.response.text();

    if (!text) return null;

    return parseAIResponse(text);
  } catch (error) {
    console.error('[aiChannelRecommendations]', error);
    return null;
  }
}
