import { callGemini } from './geminiProxy';
import { MARKET_BRIEF_SYSTEM_PROMPT, buildMarketBriefUserPrompt, type MarketBriefPromptContext } from '../data/marketBriefPrompt';
import { parseJsonObject } from '../utils/aiJson';

const MODEL_NAME = 'gemini-2.5-pro';

export type ProductFitLevel = 'strong' | 'moderate' | 'weak';

export interface MarketBriefSnapshot {
  size_signal: string;
  growth_outlook: string;
  maturity: string;
  key_channels: string[];
}

export interface MarketBriefCompetitor {
  name: string;
  position: string;
  notes: string;
}

export interface MarketBriefProductFit {
  label: string;
  fit: ProductFitLevel;
  rationale: string;
}

export interface MarketBriefPriceRow {
  category: string;
  indicative_low: number | null;
  indicative_high: number | null;
  currency: string;
  notes: string;
}

export interface MarketBriefRoute {
  recommended: string;
  rationale: string;
}

export interface MarketBrief {
  country_name: string;
  country_code: string;
  vertical_focus: string;
  executive_summary: string;
  market_snapshot: MarketBriefSnapshot;
  demand_drivers: string[];
  competitive_landscape: MarketBriefCompetitor[];
  product_fit: MarketBriefProductFit[];
  price_benchmarking: MarketBriefPriceRow[];
  route_to_market: MarketBriefRoute;
  risks_barriers: string[];
  next_validation_steps: string[];
  disclaimer: string;
}

function parseFit(v: unknown): ProductFitLevel {
  const s = String(v ?? '').toLowerCase();
  if (s === 'strong' || s === 'moderate' || s === 'weak') return s;
  return 'moderate';
}

export function parseMarketBriefFromText(text: string): MarketBrief | null {
  try {
    const p = parseJsonObject(text);
    if (!p) return null;
    const ms = (p.market_snapshot ?? {}) as Record<string, unknown>;
    const rtm = (p.route_to_market ?? {}) as Record<string, unknown>;

    const snapshot: MarketBriefSnapshot = {
      size_signal: typeof ms.size_signal === 'string' ? ms.size_signal : '',
      growth_outlook: typeof ms.growth_outlook === 'string' ? ms.growth_outlook : '',
      maturity: typeof ms.maturity === 'string' ? ms.maturity : '',
      key_channels: Array.isArray(ms.key_channels) ? ms.key_channels.map(String) : [],
    };

    const competitive = Array.isArray(p.competitive_landscape)
      ? (p.competitive_landscape as Record<string, unknown>[])
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            name: String(x.name ?? ''),
            position: String(x.position ?? ''),
            notes: String(x.notes ?? ''),
          }))
          .filter((x) => x.name)
      : [];

    const productFit = Array.isArray(p.product_fit)
      ? (p.product_fit as Record<string, unknown>[])
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            label: String(x.label ?? ''),
            fit: parseFit(x.fit),
            rationale: String(x.rationale ?? ''),
          }))
          .filter((x) => x.label)
      : [];

    const priceRows = Array.isArray(p.price_benchmarking)
      ? (p.price_benchmarking as Record<string, unknown>[])
          .filter((x) => x && typeof x === 'object')
          .map((x) => {
            const low = x.indicative_low;
            const high = x.indicative_high;
            return {
              category: String(x.category ?? ''),
              indicative_low: typeof low === 'number' && Number.isFinite(low) ? low : null,
              indicative_high: typeof high === 'number' && Number.isFinite(high) ? high : null,
              currency: String(x.currency ?? 'EUR'),
              notes: String(x.notes ?? ''),
            };
          })
          .filter((x) => x.category)
      : [];

    const route: MarketBriefRoute = {
      recommended: typeof rtm.recommended === 'string' ? rtm.recommended : '',
      rationale: typeof rtm.rationale === 'string' ? rtm.rationale : '',
    };

    const brief: MarketBrief = {
      country_name: String(p.country_name ?? ''),
      country_code: String(p.country_code ?? '').toUpperCase().slice(0, 2),
      vertical_focus: String(p.vertical_focus ?? ''),
      executive_summary: String(p.executive_summary ?? ''),
      market_snapshot: snapshot,
      demand_drivers: Array.isArray(p.demand_drivers) ? p.demand_drivers.map(String) : [],
      competitive_landscape: competitive,
      product_fit: productFit,
      price_benchmarking: priceRows,
      route_to_market: route,
      risks_barriers: Array.isArray(p.risks_barriers) ? p.risks_barriers.map(String) : [],
      next_validation_steps: Array.isArray(p.next_validation_steps) ? p.next_validation_steps.map(String) : [],
      disclaimer: String(p.disclaimer ?? ''),
    };

    if (!brief.country_name || !brief.executive_summary) return null;
    return brief;
  } catch {
    return null;
  }
}

export function marketBriefDocId(brandId: string, countryCode: string): string {
  const code = countryCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'XX';
  return `${brandId}_${code}`.replace(/[/\\]/g, '_');
}

export async function generateMarketBrief(ctx: MarketBriefPromptContext): Promise<MarketBrief> {
  const userPrompt = buildMarketBriefUserPrompt(ctx);
  const text = await callGemini({
    systemPrompt: MARKET_BRIEF_SYSTEM_PROMPT,
    userPrompt,
    model: MODEL_NAME,
    temperature: 0.2,
  });
  const parsed = parseMarketBriefFromText(text);
  if (!parsed) {
    console.error('[aiMarketBrief] parse failed, head:', text.slice(0, 400));
    throw new Error('Το AI brief δεν μπόρεσε να αναλυθεί. Δοκίμασε ξανά.');
  }
  parsed.country_code = ctx.countryCode.toUpperCase().slice(0, 2);
  parsed.country_name = ctx.countryName;
  if (ctx.verticalFocus) parsed.vertical_focus = ctx.verticalFocus;
  return parsed;
}
