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

async function loadBucket(brandId: string, bucket: ProductIntelligenceBucket, pageCount: number, grouped: boolean): Promise<Product[]> {
  if (pageCount <= 0) return [];
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => fetchProductIntelligencePage(brandId, bucket, i + 1, grouped))
  );
  return pages.flatMap((p) => p?.products ?? []);
}

export function useInStockProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    // _v3: the payload carries `grouped` alongside the rows, so callers can name what they counted.
    queryKey: ['in_stock_products_v3', brandId],
    queryFn: async (): Promise<{ products: Product[]; grouped: boolean } | null> => {
      if (!brandId) return null;
      const agg = await fetchProductIntelligenceAggregate(brandId, null);
      // Serve whenever pages exist — including while a rebuild is `running` or after one `failed`
      // (the previous build's pages stay readable, see writePageDocs write-then-cleanup). Only a brand
      // with no Product Intelligence at all (no pages) falls back to the full catalog.
      if (!agg || !agg.pagesByBucket) return null;
      // Parent SKUs by default everywhere products are shown: prefer the grouped `_g_` pages (PER-319).
      const grouped = !!agg.groupedPagesByBucket;
      const counts = grouped ? agg.groupedPagesByBucket : agg.pagesByBucket;
      const lists = await Promise.all(
        IN_STOCK_BUCKETS.map((b) => loadBucket(brandId, b, counts?.[b] ?? 0, grouped))
      );
      return { products: lists.flat(), grouped };
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    /** In-stock products from the server aggregate, or [] when not ready (→ caller falls back). */
    products: data?.products ?? [],
    /** True only when the aggregate was ready and the in-stock pages were loaded. */
    ready: data != null,
    /** True when the rows are collapsed Parent SKUs (`_g_` pages), false when they are variant SKUs.
     * Callers must not assume it: a brand whose Product Intelligence predates PER-319 has no grouped
     * pages and is served variant rows from the very same hook. */
    grouped: data?.grouped === true,
    isLoading: isPending,
  };
}
