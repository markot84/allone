/** PER-166 — feeds Channel Activation from the server Product Intelligence aggregate instead of
 * loading the ~222k-product catalog client-side (which froze the page) and re-classifying stock
 * health (which it can't do faithfully — the raw `products` carry no `qty_sold_period`).
 *
 * On mount it reads one cheap aggregate doc → instant counts/categories. The `dead` bucket pages
 * load only in the dead-stock play; the full in-stock feed loads only on demand (export/preview).
 * All reads are bounded by the precomputed bucket pages, which come from the same classification
 * that produces the dashboard numbers — so the page and the dashboard now agree. When the aggregate
 * isn't ready (e.g. a brand with no Product Intelligence) `ready` is false and the caller falls back
 * to the local product source. */
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProductIntelligenceAggregate,
  fetchProductIntelligencePage,
  type ProductIntelligenceAggregate,
  type ProductIntelligenceBucket,
} from '../services/productIntelligenceAggregate';
import { useBrand } from './useBrand';
import type { Product } from '../types';

/** The in-stock buckets that make up the Ads-feed «active products». */
const FEED_BUCKETS: ProductIntelligenceBucket[] = ['healthy', 'low', 'dead', 'excess'];

const QUERY_OPTS = { staleTime: 10 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000, refetchOnWindowFocus: false } as const;

/** Flatten loaded bucket pages into one product list, tolerating missing pages/products.
 *  Pure — exported for unit testing. */
export function flattenDeadPages(pages: Array<{ products?: Product[] } | null>): Product[] {
  return pages.flatMap((p) => p?.products ?? []);
}

async function loadBucket(brandId: string, bucket: ProductIntelligenceBucket, pageCount: number): Promise<Product[]> {
  if (pageCount <= 0) return [];
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => fetchProductIntelligencePage(brandId, bucket, i + 1))
  );
  return flattenDeadPages(pages);
}

/** Sum of the in-stock buckets — the «active variants with stock» count, shown without any page load. */
export function activeStockCountOf(agg: ProductIntelligenceAggregate | null): number {
  if (!agg?.summary) return 0;
  const s = agg.summary;
  return s.healthy_stock.count + s.low_stock.count + s.dead_stock.count + s.excess_stock.count;
}

export function useChannelActivationInsight(options: { loadDead?: boolean } = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const loadDead = !!options.loadDead;
  const [feedRequested, setFeedRequested] = useState(false);

  // 1) The aggregate doc — one cheap getDoc. Gives counts/categories with no page load.
  const aggQuery = useQuery({
    queryKey: ['channel_activation_agg', brandId],
    queryFn: async (): Promise<ProductIntelligenceAggregate | null> => {
      if (!brandId) return null;
      const agg = await fetchProductIntelligenceAggregate(brandId, null);
      return agg && agg.status === 'ready' ? agg : null;
    },
    enabled: !!brandId,
    ...QUERY_OPTS,
  });
  const agg = aggQuery.data ?? null;

  // 2) Dead bucket — only in the dead-stock play.
  const deadQuery = useQuery({
    queryKey: ['channel_activation_dead', brandId],
    queryFn: () => loadBucket(brandId!, 'dead', agg?.pagesByBucket?.dead ?? 0),
    enabled: !!brandId && !!agg && loadDead,
    ...QUERY_OPTS,
  });

  // 3) Full in-stock feed — only once requested (export/preview).
  const feedQuery = useQuery({
    queryKey: ['channel_activation_feed', brandId],
    queryFn: async () => {
      const lists = await Promise.all(FEED_BUCKETS.map((b) => loadBucket(brandId!, b, agg?.pagesByBucket?.[b] ?? 0)));
      return lists.flat();
    },
    enabled: !!brandId && !!agg && feedRequested,
    ...QUERY_OPTS,
  });

  return {
    /** True when the server aggregate was ready → use it; false → caller falls back to local source. */
    ready: !!agg,
    isLoading: aggQuery.isPending,
    /** Instant «active variants with stock» count from the summary (no page load). */
    activeStockCount: activeStockCountOf(agg),
    categories: agg?.categories ?? [],
    totalCount: agg?.totalCount ?? 0,
    /** Dead-stock products (loaded in the dead-stock play). */
    deadProducts: deadQuery.data ?? [],
    deadLoading: loadDead && !!agg && deadQuery.isPending,
    /** In-stock feed products (loaded after requestFeed). */
    feedProducts: feedQuery.data ?? [],
    feedLoading: feedRequested && !!agg && feedQuery.isPending,
    feedReady: !!feedQuery.data,
    requestFeed: useCallback(() => setFeedRequested(true), []),
  };
}
