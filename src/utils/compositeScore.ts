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

/** Calculate composite score for a product based on weights and strategy. segmentAffinities are on
 *  the app-wide 0–1 scale; their average is scaled to 0–100 below (no-affinities default 50 = neutral). */
export function calculateCompositeScore(
  product: Product,
  weights: Record<string, number>,
  segmentAffinities?: Record<string, number>,
  strategyId?: string,
  supplierTodMap?: Map<string, number>,
  scoreContext?: CompositeScoreContext,
): number {
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
    return Math.round(total);
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
    return Math.round(total);
  }

  // Weights are percentages (0-100), so divide by 100 to get multipliers (0-1)
  const total = 
    (profitScore * (weights.profit || 0) / 100) +
    (inventoryScore * (weights.stock || 0) / 100) +
    (strategicScore * (weights.strategic || 0) / 100) +
    (revenueScore * (weights.revenue || 0) / 100) +
    (fitScore * (weights.fit || 0) / 100);

  return Math.round(total);
}
