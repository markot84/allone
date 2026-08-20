import type { Product } from '../types';
import { getDaysOfStock, getProductTod } from './productUtils';
import { calculateSalesHeatScore, calculateSalesMomentumScore } from './salesBaseScore';
import type { BenchmarkPriceFields } from './priceBenchmarkStrategy';
import { calculatePriceBenchmarkAdvantageScore } from './priceBenchmarkStrategy';

export type CompositeScoreContext = {
  benchmarkLookup?: (p: Product) => BenchmarkPriceFields | undefined;
  /** PER-302: momentum is cold-first; positive sales presets invert it so hot sellers rank first. */
  invertMomentum?: boolean;
};

/** The five 0–100 sub-scores a composite score is blended from. */
export type FactorScores = {
  profit: number;
  stock: number;
  strategic: number;
  revenue: number;
  fit: number;
};

/**
 * A score the weights cannot influence: `sales_base` and `price_benchmark` blend their own fixed
 * coefficients, so moving a slider must not recompute them.
 */
export type FixedScore = { fixed: number };

export type ScoreParts = FactorScores | FixedScore;

export function isFixedScore(parts: ScoreParts): parts is FixedScore {
  return 'fixed' in parts;
}

/**
 * The weight-independent half of the composite score.
 *
 * Split out so the Weights Configurator can compute it once per catalogue and then re-rank on every
 * slider frame with nothing but a weighted sum — the difference between a 150ms debounce that still
 * stutters over 4.500 SKUs and a 60ms one that does not. `calculateCompositeScore` is unchanged in
 * behaviour and is now a thin wrapper over this.
 *
 * segmentAffinities are on the app-wide 0–1 scale; their average is scaled to 0–100 here
 * (no affinities → 50, neutral).
 */
export function calculateFactorScores(
  product: Product,
  segmentAffinities?: Record<string, number>,
  strategyId?: string,
  supplierTodMap?: Map<string, number>,
  scoreContext?: CompositeScoreContext,
): ScoreParts {
  const profitScore = Math.min(100, Math.max(0, (product.margin_percentage || 0) / 60 * 100));

  const tod = getProductTod(product, supplierTodMap);
  const dos = getDaysOfStock(product);
  const dosNorm = dos === Infinity ? 0 : Math.min(100, Math.max(0, (1 - Math.abs(dos - tod) / (tod * 2)) * 100));
  const stockScore = dosNorm;
  const stockAgeScore =
    strategyId === 'stock_clearance'
      ? (dos === Infinity ? 100 : Math.min(100, (dos / (tod * 2)) * 100))
      : (dos === Infinity ? 0 : Math.max(0, 100 - (dos / (tod * 2)) * 100));
  const inventoryScore = (stockScore + stockAgeScore) / 2;
  
  const strategicScore = product.priority_tag ? 
    (product.priority_tag === 'Brand Push' ? 90 :
     product.priority_tag === 'New Launch' ? 85 :
     product.priority_tag === 'Best Seller' ? 75 :
     product.priority_tag === 'Clearance' ? 65 : 50) : 50;
  
  const revenueScore = Math.min(100, Math.max(0, ((product.price || 0) / 500) * 100));
  
  // Affinities are 0–1, so ×100 to put the average on the 0–100 scale of the other
  // sub-scores; clamp for safety. No affinities → 50 neutral.
  const fitScore = segmentAffinities && Object.keys(segmentAffinities).length > 0
    ? Math.min(100, Math.max(0,
        (Object.values(segmentAffinities).reduce((sum, aff) => sum + aff, 0) / Object.keys(segmentAffinities).length) * 100))
    : 50;

  if (strategyId === 'sales_base') {
    // PER-302: positive presets use the hot-first heat score (cold-first momentum is branch-ordered, not invertible).
    const momentum = scoreContext?.invertMomentum
      ? calculateSalesHeatScore(product)
      : calculateSalesMomentumScore(product);
    const total =
      momentum * 0.52 +
      profitScore * 0.13 +
      inventoryScore * 0.13 +
      strategicScore * 0.06 +
      revenueScore * 0.09 +
      fitScore * 0.07;
    return { fixed: Math.round(total) };
  }

  if (strategyId === 'price_benchmark') {
    const b = scoreContext?.benchmarkLookup?.(product);
    const advantage = calculatePriceBenchmarkAdvantageScore(b);
    const total =
      advantage * 0.5 +
      profitScore * 0.14 +
      inventoryScore * 0.12 +
      strategicScore * 0.08 +
      revenueScore * 0.11 +
      fitScore * 0.05;
    return { fixed: Math.round(total) };
  }

  return {
    profit: profitScore,
    stock: inventoryScore,
    strategic: strategicScore,
    revenue: revenueScore,
    fit: fitScore,
  };
}

/** Blend pre-computed sub-scores with the current weights. This is all a slider frame has to do. */
export function blendFactorScores(parts: ScoreParts, weights: Record<string, number>): number {
  if (isFixedScore(parts)) return parts.fixed;

  // Weights are percentages (0-100), so divide by 100 to get multipliers (0-1)
  const total =
    (parts.profit * (weights.profit || 0) / 100) +
    (parts.stock * (weights.stock || 0) / 100) +
    (parts.strategic * (weights.strategic || 0) / 100) +
    (parts.revenue * (weights.revenue || 0) / 100) +
    (parts.fit * (weights.fit || 0) / 100);

  return Math.round(total);
}

/** Calculate composite score for a product based on weights and strategy. */
export function calculateCompositeScore(
  product: Product,
  weights: Record<string, number>,
  segmentAffinities?: Record<string, number>,
  strategyId?: string,
  supplierTodMap?: Map<string, number>,
  scoreContext?: CompositeScoreContext,
): number {
  return blendFactorScores(
    calculateFactorScores(product, segmentAffinities, strategyId, supplierTodMap, scoreContext),
    weights,
  );
}
