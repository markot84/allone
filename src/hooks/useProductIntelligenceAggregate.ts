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

export function useProductIntelligenceAggregate(bucket: ProductIntelligenceBucket, page: number, query: Omit<ProductIntelligenceQuery, 'bucket' | 'page'> = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? null;
  const queryKey = JSON.stringify(query);

  const aggregateQuery = useQuery({
    queryKey: ['productIntelligenceAggregate', brandId, syncVersion],
    queryFn: () => (brandId ? fetchProductIntelligenceAggregate(brandId, syncVersion) : Promise.resolve(null)),
    enabled: !!brandId && !!syncVersion,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const aggregate = aggregateQuery.data?.status === 'ready' ? aggregateQuery.data : null;
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
    isLoading: aggregateQuery.isPending || (!!aggregate && pageQuery.isPending),
    isBuilding: aggregateQuery.data?.status === 'running',
    error: aggregateQuery.error ?? pageQuery.error,
  };
}

