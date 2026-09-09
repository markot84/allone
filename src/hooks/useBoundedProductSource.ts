/** PER-167 — drop-in replacement for useProductSource on the Commercial Strategy surface. Serves the
 * bounded in-stock set (PI bucket pages, ~14k) and only falls back to the full ~222k catalog when the
 * aggregate isn't ready (e.g. a brand with no Product Intelligence). Several strategy components
 * (WeightConfigurator, TriageCard, the impact preview/modal, the seasonal panel) each loaded the full
 * catalog independently — collectively the page freeze. This hook bounds them all the same way.
 * Returns the same shape as useProductSource so it swaps in unchanged. */
import { useMemo } from 'react';
import { getEffectiveStockLevel } from '../utils/productUtils';
import { useInStockProducts } from './useInStockProducts';
import { useProductSource } from './useProductSource';

export function useBoundedProductSource(options: { maxProducts?: number } = {}) {
  const inStock = useInStockProducts();
  // Load the full catalog only when the bounded set isn't available.
  const fallback = useProductSource({
    maxProducts: options.maxProducts,
    enabled: !inStock.isLoading && !inStock.ready,
  });

  // PER-179 — both branches serve only effective (available-first) stock > 0, same convention as the PI query CF.
  const readyInStock = useMemo(
    () => inStock.products.filter((p) => getEffectiveStockLevel(p) > 0),
    [inStock.products]
  );

  if (inStock.ready) {
    return {
      ...fallback,
      products: readyInStock,
      count: readyInStock.length,
      /** What a row in `products` actually is, so callers can name it instead of guessing. */
      productScope: inStock.grouped ? ('pi_parent' as const) : ('pi_variant' as const),
      isLoading: false,
    };
  }
  const fallbackInStock = fallback.products.filter((p) => getEffectiveStockLevel(p) > 0);
  return {
    ...fallback,
    products: fallbackInStock,
    count: fallbackInStock.length,
    productScope: 'catalog' as const,
    isLoading: inStock.isLoading || fallback.isLoading,
  };
}

/** A row in `useBoundedProductSource().products`: a collapsed Parent SKU from the grouped Product
 * Intelligence pages, a variant SKU from the ungrouped ones, or a variant SKU from the full catalog
 * fallback. Sales Optimization labels its counts from this — a Parent SKU total and a variant SKU
 * total are different questions and must never be printed under the same word. */
export type BoundedProductScope = 'pi_parent' | 'pi_variant' | 'catalog';

/** How each scope names its rows on screen, and where they came from. One table so every count on
 * the surface uses the same word for the same thing. */
export const BOUNDED_SCOPE_COPY: Record<
  BoundedProductScope,
  { unit: string; unitSingular: string; origin: string }
> = {
  pi_parent: { unit: 'Parent SKUs', unitSingular: 'Parent SKU', origin: 'Product Intelligence' },
  pi_variant: { unit: 'SKU', unitSingular: 'SKU', origin: 'Product Intelligence' },
  catalog: { unit: 'SKU', unitSingular: 'SKU', origin: 'κατάλογος προϊόντων' },
};
