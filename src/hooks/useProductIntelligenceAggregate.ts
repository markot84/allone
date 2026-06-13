import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import {
  fetchProductIntelligenceAggregate,
  queryProductIntelligencePage,
  type ProductIntelligenceBucket,
  type ProductIntelligenceQuery,
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

export function useProductIntelligenceAggregate(bucket: ProductIntelligenceBucket, page: number, query: Omit<ProductIntelligenceQuery, 'bucket' | 'page'> = {}) {
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

  const pageQuery = useQuery({
    queryKey: ['productIntelligencePage', brandId, bucket, safePage, queryKey, aggregate?.syncVersion ?? syncVersion],
    queryFn: () => (brandId ? queryProductIntelligencePage(brandId, { ...query, bucket, page: safePage }) : Promise.resolve(null)),
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

