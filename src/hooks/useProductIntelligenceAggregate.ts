import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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

/**
 * Μόνο το aggregate doc (`product_intelligence/{brandId}`, 1 read) — χωρίς page query.
 * Ίδιο queryKey με το πλήρες hook ώστε Dashboard / AI Insights να μοιράζονται το cache
 * (κανένα διπλό fetch· το key είναι persisted). Import-only brands: status 'skipped' ⇒ null.
 */
export function useProductIntelligenceAggregateDoc() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersion = useBrandSyncVersion(brandId).data?.version ?? 'pending';
  const aggregateQuery = useQuery({
    queryKey: ['productIntelligenceAggregate', brandId, syncVersion],
    queryFn: () => (brandId ? fetchProductIntelligenceAggregate(brandId, syncVersion) : Promise.resolve(null)),
    // PER-130 (P2): όχι fetch κάτω από το throwaway 'pending' syncVersion key.
    enabled: !!brandId && syncVersion !== 'pending',
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return {
    aggregate: aggregateQuery.data?.status === 'ready' ? aggregateQuery.data : null,
    isLoading: aggregateQuery.isPending,
    isBuilding: aggregateQuery.data?.status === 'running',
    error: aggregateQuery.error,
  };
}

export function useProductIntelligenceAggregate(
  bucket: ProductIntelligenceBucket,
  page: number,
  query: Omit<ProductIntelligenceQuery, 'bucket' | 'page'> = {},
  opts?: { staticFirstPage?: boolean },
) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';
  const queryKey = JSON.stringify(query);

  // PER-130 (0.4): το aggregate doc έρχεται από το extracted hook — ίδιο queryKey,
  // το React Query κάνει dedup, το pageQuery παρακάτω μένει ως έχει.
  const docHook = useProductIntelligenceAggregateDoc();
  const aggregate = docHook.aggregate;
  const safePage = useMemo(() => Math.max(1, page), [page]);
  const useStaticFirstPage = opts?.staticFirstPage === true && safePage === 1;

  const pageQuery = useQuery({
    // PER-130 (P5): discriminator 'static'|'cf' στο key — ξεχωρίζει το στατικό page doc
    // από το CF αποτέλεσμα ώστε να μην αλληλο-overwrite-άρονται στο cache.
    queryKey: ['productIntelligencePage', brandId, bucket, safePage, queryKey, aggregate?.syncVersion ?? syncVersion, useStaticFirstPage ? 'static' : 'cf'],
    queryFn: async () => {
      if (!brandId) return null;
      if (useStaticFirstPage) {
        // Στατικό page doc (1 read) — η CF υλοποιεί ΟΛΟ το bucket server-side (~1.5k reads/κλήση),
        // περιττό για το αφιλτράριστο page 1. Synthesize το QueryResult από page doc + aggregate.
        const pageDoc = await fetchProductIntelligencePage(brandId, bucket, 1);
        if (!pageDoc || !aggregate) return null; // το enabled δεν narrow-άρει το closure type
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
        };
        return result;
      }
      return queryProductIntelligencePage(brandId, { ...query, bucket, page: safePage });
    },
    enabled: !!brandId && !!aggregate,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    aggregate,
    page: pageQuery.data,
    safePage: pageQuery.data?.page ?? safePage,
    isAggregateLoading: docHook.isLoading,
    isPageLoading: !!aggregate && pageQuery.isPending,
    isLoading: docHook.isLoading || (!!aggregate && pageQuery.isPending),
    isBuilding: docHook.isBuilding,
    error: docHook.error ?? pageQuery.error,
  };
}

