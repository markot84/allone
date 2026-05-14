import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
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

const FIRESTORE_MAX_LIMIT = 10000;
const BENCHMARK_PAGE_SIZE = 5000;

async function fetchBenchmarks(brandId: string, maxDocs?: number): Promise<PriceBenchmark[]> {
  const colRef = collection(db, 'price_benchmarks', brandId, 'skus');
  const target = maxDocs && maxDocs > 0 ? maxDocs : FIRESTORE_MAX_LIMIT;
  const pageSize = Math.min(BENCHMARK_PAGE_SIZE, FIRESTORE_MAX_LIMIT, target);
  const rowsById = new Map<string, PriceBenchmark>();
  let lastDocId: string | null = null;

  const pushDocs = (docs: { id: string; data: () => unknown }[]) => {
    for (const d of docs) {
      if (rowsById.size >= target) break;
      const data = d.data() as Record<string, unknown>;
      rowsById.set(d.id, { ...data } as unknown as PriceBenchmark);
    }
  };

  // Prioritize actual market benchmarks. A document-id slice can easily miss all benchmarked SKUs
  // in large GMC catalogs, making the UI look empty even when import_jobs has withMarketBenchmark > 0.
  try {
    const withMarketSnap = await getDocs(query(
      colRef,
      where('benchmarkPrice', '>', 0),
      orderBy('benchmarkPrice', 'desc'),
      limit(Math.min(target, FIRESTORE_MAX_LIMIT))
    ));
    pushDocs(withMarketSnap.docs);
  } catch (error) {
    console.warn('[usePriceBenchmarks] benchmark-first query failed; falling back to catalog slice', error);
  }

  while (rowsById.size < target) {
    const remaining = target - rowsById.size;
    const constraints: QueryConstraint[] = [
      orderBy(documentId()),
      limit(Math.min(pageSize, remaining, FIRESTORE_MAX_LIMIT)),
      ...(lastDocId ? [startAfter(lastDocId)] : []),
    ];
    const snap = await getDocs(query(colRef, ...constraints));
    if (snap.empty) break;
    pushDocs(snap.docs);
    lastDocId = snap.docs[snap.docs.length - 1].id;
    if (snap.size < Math.min(pageSize, remaining)) break;
  }

  return [...rowsById.values()];
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
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    enabled: !!brandId,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
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
