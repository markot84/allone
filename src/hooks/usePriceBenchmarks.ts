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

  const aboveMarket = benchmarks.filter((b) => b.priceDiff > 0).length;
  const belowMarket = benchmarks.filter((b) => b.priceDiff < 0).length;
  const avgDiff = benchmarks.length > 0
    ? Math.round(benchmarks.reduce((s, b) => s + b.priceDiff, 0) / benchmarks.length * 10) / 10
    : 0;

  return {
    benchmarks,
    isLoading: isPending,
    count: benchmarks.length,
    aboveMarket,
    belowMarket,
    avgDiff,
  };
}
