/** PER-167 — reads the bounded in-stock Product Intelligence bucket pages (healthy+low+dead+excess)
 * so the Commercial Strategy page scores ~14k products instead of loading + scoring the full ~222k
 * catalog on the main thread (the freeze). Same precomputed pages as PER-166 — no server change.
 * Out-of-stock (no_stock) products are intentionally excluded: they can't be prioritized or sold.
 * When the aggregate isn't ready (e.g. a brand with no Product Intelligence) `ready` is false and the
 * caller falls back to the local product source. */
import { useQuery } from '@tanstack/react-query';
import {
  fetchProductIntelligenceAggregate,
  fetchProductIntelligencePage,
  type ProductIntelligenceBucket,
} from '../services/productIntelligenceAggregate';
import { useBrand } from './useBrand';
import type { Product } from '../types';

const IN_STOCK_BUCKETS: ProductIntelligenceBucket[] = ['healthy', 'low', 'dead', 'excess'];

async function loadBucket(brandId: string, bucket: ProductIntelligenceBucket, pageCount: number): Promise<Product[]> {
  if (pageCount <= 0) return [];
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => fetchProductIntelligencePage(brandId, bucket, i + 1))
  );
  return pages.flatMap((p) => p?.products ?? []);
}

export function useInStockProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['in_stock_products', brandId],
    queryFn: async (): Promise<Product[] | null> => {
      if (!brandId) return null;
      const agg = await fetchProductIntelligenceAggregate(brandId, null);
      if (!agg || agg.status !== 'ready') return null; // not ready → caller falls back
      const lists = await Promise.all(
        IN_STOCK_BUCKETS.map((b) => loadBucket(brandId, b, agg.pagesByBucket?.[b] ?? 0))
      );
      return lists.flat();
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    /** In-stock products from the server aggregate, or [] when not ready (→ caller falls back). */
    products: data ?? [],
    /** True only when the aggregate was ready and the in-stock pages were loaded. */
    ready: data != null,
    isLoading: isPending,
  };
}
