import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import {
  fetchProductIntelligenceAggregate,
  fetchProductIntelligencePage,
  queryProductIntelligencePage,
  type ProductIntelligenceBucket,
  type ProductIntelligenceQuery,
  type ProductIntelligenceQueryResult,
} from '../services/productIntelligenceAggregate';

/** Aggregate doc only (`product_intelligence/{brandId}`, 1 read); shares the full hook's queryKey
 *  so Dashboard / AI Insights hit one cache. Import-only brands (status 'skipped') ⇒ null. */
export function useProductIntelligenceAggregateDoc() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersion = useBrandSyncVersion(brandId).data?.version ?? 'pending';
  const aggregateQuery = useQuery({
    queryKey: ['productIntelligenceAggregate', brandId, syncVersion],
    queryFn: () => (brandId ? fetchProductIntelligenceAggregate(brandId, syncVersion) : Promise.resolve(null)),
    // Don't fetch under the throwaway 'pending' syncVersion key.
    enabled: !!brandId && syncVersion !== 'pending',
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return {
    // Keep the last-good aggregate visible while a recompute runs: the backend merges status:'running'
    // onto the prior data, so returning it (instead of null) lets the page show data + a "refreshing"
    // banner instead of blanking to skeletons and re-triggering a rebuild. Consumers gate on isBuilding.
    aggregate:
      aggregateQuery.data?.status === 'ready' || aggregateQuery.data?.status === 'running'
        ? aggregateQuery.data
        : null,
    isLoading: aggregateQuery.isPending,
    isBuilding: aggregateQuery.data?.status === 'running',
    error: aggregateQuery.error,
    // A failed build must not render as "nothing imported yet".
    buildFailed: aggregateQuery.data?.status === 'failed',
    buildError: String(aggregateQuery.data?.error || ''),
  };
}

export function useProductIntelligenceAggregate(
  bucket: ProductIntelligenceBucket,
  page: number,
  query: Omit<ProductIntelligenceQuery, 'bucket' | 'page'> = {},
  opts?: { staticFirstPage?: boolean; staticDefault?: boolean },
) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';
  const queryKey = JSON.stringify(query);

  // Aggregate doc from the extracted hook (same queryKey ⇒ React Query dedupes).
  const docHook = useProductIntelligenceAggregateDoc();
  const aggregate = docHook.aggregate;
  const safePage = useMemo(() => Math.max(1, page), [page]);
  const useStaticFirstPage = opts?.staticFirstPage === true && safePage === 1;
  // PER-319: precomputed grouped default view (any page/bucket via getDoc); absent field = not-yet-rebuilt brand → CF path.
  const useStaticDefault =
    opts?.staticDefault === true && aggregate?.groupedPagesByBucket?.[bucket] != null;

  const pageQuery = useQuery({
    // 'static'|'cf' key discriminator keeps the static page doc and CF result from clobbering each other.
    queryKey: ['productIntelligencePage', brandId, bucket, safePage, queryKey, aggregate?.syncVersion ?? syncVersion, useStaticDefault ? 'static-g' : useStaticFirstPage ? 'static' : 'cf'],
    queryFn: async () => {
      if (!brandId) return null;
      if (useStaticDefault && aggregate) {
        const totalPages = aggregate.groupedPagesByBucket?.[bucket] ?? 1;
        const pageDoc = await fetchProductIntelligencePage(brandId, bucket, Math.min(safePage, totalPages), true);
        if (pageDoc) {
          const result: ProductIntelligenceQueryResult = {
            brandId,
            status: 'ready',
            sourceLabel: aggregate.sourceLabel,
            sourceKind: aggregate.sourceKind,
            totalCount: aggregate.totalCount,
            totalRows: pageDoc.totalRows,
            page: pageDoc.page,
            pageSize: pageDoc.pageSize,
            totalPages,
            bucket,
            products: pageDoc.products,
            summary: aggregate.summary,
            groupedSummary: aggregate.groupedSummary,
          };
          return result;
        }
        // Missing grouped page doc (mid-rebuild edge) → CF fallback below.
      }
      if (useStaticFirstPage) {
        // Static page doc (1 read) for unfiltered page 1, avoiding the CF's whole-bucket resolve
        // (~1.5k reads/call). Synthesize the QueryResult from page doc + aggregate.
        const pageDoc = await fetchProductIntelligencePage(brandId, bucket, 1);
        if (!pageDoc || !aggregate) return null; // enabled doesn't narrow the closure type
        const result: ProductIntelligenceQueryResult = {
          brandId,
          status: 'ready',
          sourceLabel: aggregate.sourceLabel,
          sourceKind: aggregate.sourceKind,
          totalCount: aggregate.totalCount,
          totalRows: pageDoc.totalRows,
          page: 1,
          pageSize: pageDoc.pageSize,
          totalPages: aggregate.pagesByBucket?.[bucket] ?? 1,
          bucket,
          products: pageDoc.products,
          summary: aggregate.summary, // static (unfiltered) path → whole-catalog summary
        };
        return result;
      }
      return queryProductIntelligencePage(brandId, { ...query, bucket, page: safePage });
    },
    enabled: !!brandId && !!aggregate,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Keep the previous page visible while a new query loads (page change, or post-recompute
    // syncVersion bump) so the table never blanks mid-recompute.
    placeholderData: keepPreviousData,
  });

  return {
    aggregate,
    page: pageQuery.data,
    // Placeholder (previous page's) data must not report its page — the component's sync-effect would bounce back.
    safePage: (pageQuery.isPlaceholderData ? undefined : pageQuery.data?.page) ?? safePage,
    isAggregateLoading: docHook.isLoading,
    isPageLoading: !!aggregate && pageQuery.isPending,
    isLoading: docHook.isLoading || (!!aggregate && pageQuery.isPending),
    isBuilding: docHook.isBuilding,
    error: docHook.error ?? pageQuery.error,
    buildFailed: docHook.buildFailed,
    buildError: docHook.buildError,
  };
}

