/** PER-166 — reads the server-precomputed Product Intelligence `dead` bucket pages so Channel
 * Activation no longer loads the ~222k-product catalog and re-classifies stock-health client-side.
 * It can't classify faithfully anyway: the raw `products` docs carry no `qty_sold_period`, so the
 * client marks every stocked SKU as dead. These pages come from the same server classification that
 * produces the dashboard's dead-stock count, so the numbers now agree. When the aggregate isn't
 * ready the caller falls back to the local list (graceful degradation). */
import { useQuery } from '@tanstack/react-query';
import {
  fetchProductIntelligenceAggregate,
  fetchProductIntelligencePage,
} from '../services/productIntelligenceAggregate';
import { useBrand } from './useBrand';
import type { Product } from '../types';

/** Flatten the loaded `dead` bucket pages into one product list, tolerating missing pages/products.
 *  Pure — exported for unit testing. */
export function flattenDeadPages(pages: Array<{ products?: Product[] } | null>): Product[] {
  return pages.flatMap((p) => p?.products ?? []);
}

async function loadBucket(brandId: string, pageCount: number): Promise<Product[]> {
  if (pageCount <= 0) return [];
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => fetchProductIntelligencePage(brandId, 'dead', i + 1))
  );
  return flattenDeadPages(pages);
}

export function useChannelActivationInsight() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['channel_activation_insight', brandId],
    queryFn: async (): Promise<{ deadProducts: Product[] } | null> => {
      if (!brandId) return null;
      const agg = await fetchProductIntelligenceAggregate(brandId, null);
      if (!agg || agg.status !== 'ready') return null;
      const deadProducts = await loadBucket(brandId, agg.pagesByBucket?.dead ?? 0);
      return { deadProducts };
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    /** Dead-stock products from the server aggregate, or [] when not ready (→ caller falls back). */
    deadProducts: data?.deadProducts ?? [],
    /** True only when the server aggregate was ready and its dead bucket was loaded. */
    ready: !!data,
    isLoading: isPending,
  };
}
