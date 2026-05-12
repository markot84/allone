import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface PriceBenchmark {
  productId: string;
  title: string;
  brand?: string;
  gtin: string;
  yourPrice: number;
  benchmarkPrice: number;
  priceDiff: number;
  currency: string;
  country: string;
  updatedAt: string;
}

async function fetchBenchmarks(brandId: string, maxDocs?: number): Promise<PriceBenchmark[]> {
  const colRef = collection(db, 'price_benchmarks', brandId, 'skus');
  const snap = await getDocs(maxDocs ? query(colRef, limit(maxDocs)) : colRef);
  return snap.docs.map((d) => ({ ...d.data() } as PriceBenchmark));
}

type UsePriceBenchmarksOptions = {
  maxDocs?: number;
};

export function usePriceBenchmarks(options: UsePriceBenchmarksOptions = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const maxDocs = options.maxDocs;

  const {
    data: benchmarks = [],
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['priceBenchmarks', brandId, maxDocs ?? 'all'],
    queryFn: () => (brandId ? fetchBenchmarks(brandId, maxDocs) : Promise.resolve([])),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!brandId,
    retry: 1,
    meta: { persist: false },
  });

  const withMarket = benchmarks.filter((b) => b.benchmarkPrice > 0);
  const aboveMarket = withMarket.filter((b) => b.priceDiff > 0).length;
  const belowMarket = withMarket.filter((b) => b.priceDiff < 0).length;
  const avgDiff =
    withMarket.length > 0
      ? Math.round((withMarket.reduce((s, b) => s + b.priceDiff, 0) / withMarket.length) * 10) / 10
      : 0;

  /** Νεότερο `updatedAt` μεταξύ όλων των SKU — όχι `benchmarks[0]` (η σειρά getDocs δεν είναι εγγυημένη). */
  const lastBenchmarkSyncedAt = useMemo(() => {
    if (benchmarks.length === 0) return null;
    let maxMs = 0;
    for (const b of benchmarks) {
      const t = Date.parse(b.updatedAt);
      if (!Number.isNaN(t) && t > maxMs) maxMs = t;
    }
    return maxMs > 0 ? new Date(maxMs) : null;
  }, [benchmarks]);

  return {
    benchmarks,
    isLoading: isPending,
    isFetching,
    isError,
    error: error instanceof Error ? error : error != null ? new Error(String(error)) : null,
    refetch,
    count: benchmarks.length,
    withMarketBenchmarkCount: withMarket.length,
    aboveMarket,
    belowMarket,
    avgDiff,
    lastBenchmarkSyncedAt,
  };
}
