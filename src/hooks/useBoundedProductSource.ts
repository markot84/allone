/** PER-167 — drop-in replacement for useProductSource on the Commercial Strategy surface. Serves the
 * bounded in-stock set (PI bucket pages, ~14k) and only falls back to the full ~222k catalog when the
 * aggregate isn't ready (e.g. a brand with no Product Intelligence). Several strategy components
 * (WeightConfigurator, TriageCard, the impact preview/modal, the seasonal panel) each loaded the full
 * catalog independently — collectively the page freeze. This hook bounds them all the same way.
 * Returns the same shape as useProductSource so it swaps in unchanged. */
import { useInStockProducts } from './useInStockProducts';
import { useProductSource } from './useProductSource';

export function useBoundedProductSource(options: { maxProducts?: number } = {}) {
  const inStock = useInStockProducts();
  // Load the full catalog only when the bounded set isn't available.
  const fallback = useProductSource({
    maxProducts: options.maxProducts,
    enabled: !inStock.isLoading && !inStock.ready,
  });

  if (inStock.ready) {
    return { ...fallback, products: inStock.products, count: inStock.products.length, isLoading: false };
  }
  // The fallback must honor the same in-stock contract as the bucket pages: brands
  // without a PI aggregate were the one path still showing zero-stock products on Commercial Strategy.
  const fallbackInStock = fallback.products.filter((p) => (p.stock_level ?? 0) > 0);
  return {
    ...fallback,
    products: fallbackInStock,
    count: fallbackInStock.length,
    isLoading: inStock.isLoading || fallback.isLoading,
  };
}
