import type { RFMSegment } from '../types';

export type FitLevel = 'ideal' | 'good' | 'partial';

export interface ScoredSegment {
  segment: RFMSegment;
  score: number;
  fit: FitLevel;
}

const NAME_TRAITS: Record<string, { value: number; volume: number; growth: number }> = {
  champion:   { value: 1.0, volume: 0.4, growth: 0.3 },
  loyal:      { value: 0.8, volume: 0.5, growth: 0.3 },
  "can't lose": { value: 0.9, volume: 0.3, growth: 0.1 },
  vip:        { value: 1.0, volume: 0.3, growth: 0.2 },
  potential:  { value: 0.3, volume: 0.4, growth: 0.9 },
  promising:  { value: 0.3, volume: 0.5, growth: 1.0 },
  new:        { value: 0.2, volume: 0.6, growth: 1.0 },
  attention:  { value: 0.4, volume: 0.5, growth: 0.6 },
  risk:       { value: 0.5, volume: 0.7, growth: 0.2 },
  hibernat:   { value: 0.2, volume: 0.8, growth: 0.1 },
  lost:       { value: 0.1, volume: 0.9, growth: 0.1 },
  sleep:      { value: 0.3, volume: 0.6, growth: 0.2 },
};

function getNameTraits(name: string): { value: number; volume: number; growth: number } {
  const lower = name.toLowerCase();
  for (const [key, traits] of Object.entries(NAME_TRAITS)) {
    if (lower.includes(key)) return traits;
  }
  return { value: 0.5, volume: 0.5, growth: 0.5 };
}

/**
 * Scores a segment's relevance (0-100) for a given strategy.
 *
 * Strategy weights map to segment traits:
 * - profit + revenue → favor high-value segments (high revenue_share)
 * - stock            → favor high-volume segments (high count/percentage)
 * - strategic        → favor growth-potential segments (new, promising)
 * - fit              → neutral, based on overall data quality
 */
export function scoreSegmentForStrategy(
  segment: RFMSegment,
  weights: Record<string, number>
): { score: number; fit: FitLevel } {
  const traits = getNameTraits(segment.name);

  const revenueNorm = Math.min(segment.revenue_share / 50, 1);
  const countNorm = Math.min(segment.percentage / 30, 1);

  const valueSignal = (traits.value * 0.6 + revenueNorm * 0.4);
  const volumeSignal = (traits.volume * 0.5 + countNorm * 0.5);
  const growthSignal = traits.growth;

  const profitW = (weights.profit ?? 20) / 100;
  const revenueW = (weights.revenue ?? 20) / 100;
  const stockW = (weights.stock ?? 20) / 100;
  const strategicW = (weights.strategic ?? 20) / 100;
  const fitW = (weights.fit ?? 20) / 100;

  const raw =
    valueSignal * (profitW + revenueW) +
    volumeSignal * stockW +
    growthSignal * strategicW +
    ((valueSignal + volumeSignal) / 2) * fitW;

  const score = Math.round(Math.min(raw * 100, 100));

  const fit: FitLevel = score >= 55 ? 'ideal' : score >= 35 ? 'good' : 'partial';

  return { score, fit };
}

export function rankSegments(
  segments: RFMSegment[],
  weights: Record<string, number> | null
): ScoredSegment[] {
  const w = weights ?? { profit: 20, stock: 20, strategic: 20, revenue: 20, fit: 20 };
  return segments
    .map((segment) => {
      const { score, fit } = scoreSegmentForStrategy(segment, w);
      return { segment, score, fit };
    })
    .sort((a, b) => b.score - a.score);
}
