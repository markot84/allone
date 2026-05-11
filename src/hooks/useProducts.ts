import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Product } from '../types';
import { excludeDemoProducts } from '../utils/productUtils';

export function useProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId],
    queryFn: () => (brandId ? ProductsService.getAll(brandId) : Promise.resolve([])) as Promise<Product[]>,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  /** Αγνόησε demo products από όλες τις λίστες (όνομα/SKU περιέχει "demo"). */
  const productRows = Array.isArray(firestoreProducts) ? firestoreProducts : [];
  const products = excludeDemoProducts((brandId ? productRows : []) as Product[]);

  return {
    products,
    count: products.length,
    isLoading: isPending,
    hasImported: products.length > 0,
  };
}
