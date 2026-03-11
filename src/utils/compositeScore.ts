import type { Product } from '../types';
import { getDaysOfStock, getProductTod } from './productUtils';

/**
 * Calculate composite score for a product based on weights and strategy
 */
export function calculateCompositeScore(
  product: Product,
  weights: Record<string, number>,
  segmentAffinities?: Record<string, number>,
  strategyId?: string,
  supplierTodMap?: Map<string, number>
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
  
  const fitScore = segmentAffinities ? 
    Object.values(segmentAffinities).reduce((sum, aff) => sum + aff, 0) / Object.keys(segmentAffinities).length :
    50;

  // Weights are percentages (0-100), so divide by 100 to get multipliers (0-1)
  const total = 
    (profitScore * (weights.profit || 0) / 100) +
    (inventoryScore * (weights.stock || 0) / 100) +
    (strategicScore * (weights.strategic || 0) / 100) +
    (revenueScore * (weights.revenue || 0) / 100) +
    (fitScore * (weights.fit || 0) / 100);

  return Math.round(total);
}
