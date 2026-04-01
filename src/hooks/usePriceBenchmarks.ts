import { useQuery } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
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

async function fetchBenchmarks(brandId: string): Promise<PriceBenchmark[]> {
  const colRef = collection(db, 'price_benchmarks', brandId, 'skus');
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ ...d.data() } as PriceBenchmark));
}

export function usePriceBenchmarks() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: benchmarks = [], isPending } = useQuery({
    queryKey: ['priceBenchmarks', brandId],
    queryFn: () => (brandId ? fetchBenchmarks(brandId) : Promise.resolve([])),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!brandId,
  });

  const withMarket = benchmarks.filter((b) => b.benchmarkPrice > 0);
  const aboveMarket = withMarket.filter((b) => b.priceDiff > 0).length;
  const belowMarket = withMarket.filter((b) => b.priceDiff < 0).length;
  const avgDiff =
    withMarket.length > 0
      ? Math.round((withMarket.reduce((s, b) => s + b.priceDiff, 0) / withMarket.length) * 10) / 10
      : 0;

  return {
    benchmarks,
    isLoading: isPending,
    count: benchmarks.length,
    withMarketBenchmarkCount: withMarket.length,
    aboveMarket,
    belowMarket,
    avgDiff,
  };
}
