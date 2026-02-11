import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Product } from '../types';

export function useProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId],
    queryFn: () => (brandId ? ProductsService.getAll(brandId) : Promise.resolve([])) as Promise<Product[]>,
    staleTime: 5 * 60 * 1000, // 5 min - avoid refetch on every mount/refresh
    gcTime: 30 * 60 * 1000, // 30 min - keep in cache
    placeholderData: (previousData) => previousData, // keep previous data visible during refetch
  });

  // When brandId is set: show real data only. When no brand: empty (no mock).
  const products = (brandId ? (firestoreProducts ?? []) : []) as Product[];

  return {
    products,
    count: products.length,
    isLoading: isPending,
    hasImported: firestoreProducts?.length > 0,
  };
}
