import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import {
  fetchProductIntelligenceAggregate,
  fetchProductIntelligencePage,
  type ProductIntelligenceBucket,
} from '../services/productIntelligenceAggregate';

export function useProductIntelligenceAggregate(bucket: ProductIntelligenceBucket, page: number) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? null;

  const aggregateQuery = useQuery({
    queryKey: ['productIntelligenceAggregate', brandId, syncVersion],
    queryFn: () => (brandId ? fetchProductIntelligenceAggregate(brandId, syncVersion) : Promise.resolve(null)),
    enabled: !!brandId && !!syncVersion,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const aggregate = aggregateQuery.data?.status === 'ready' ? aggregateQuery.data : null;
  const safePage = useMemo(() => {
    const max = aggregate?.pagesByBucket?.[bucket] ?? 1;
    return Math.max(1, Math.min(page, max));
  }, [aggregate, bucket, page]);

  const pageQuery = useQuery({
    queryKey: ['productIntelligencePage', brandId, bucket, safePage, aggregate?.syncVersion ?? syncVersion],
    queryFn: () => (brandId ? fetchProductIntelligencePage(brandId, bucket, safePage) : Promise.resolve(null)),
    enabled: !!brandId && !!aggregate,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    aggregate,
    page: pageQuery.data,
    safePage,
    isLoading: aggregateQuery.isPending || (!!aggregate && pageQuery.isPending),
    isBuilding: aggregateQuery.data?.status === 'running',
    error: aggregateQuery.error ?? pageQuery.error,
  };
}

