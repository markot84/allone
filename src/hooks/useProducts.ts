import { useQuery } from '@tanstack/react-query';
import { limit, where } from 'firebase/firestore';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Product } from '../types';
import { excludeDemoProducts } from '../utils/productUtils';

type UseProductsOptions = {
  maxDocs?: number;
  inStockOnly?: boolean;
};

export function useProducts(options: UseProductsOptions = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const maxDocs = options.maxDocs;
  const inStockOnly = options.inStockOnly ?? false;

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId, maxDocs ?? 'all', inStockOnly ? 'in-stock' : 'all-stock'],
    queryFn: async () => {
      if (!brandId) return [] as Product[];
      const constraints = [
        ...(inStockOnly ? [where('stock_level', '>', 0)] : []),
        ...(maxDocs ? [limit(maxDocs)] : []),
      ];
      try {
        return await ProductsService.getAll(brandId, constraints) as Product[];
      } catch (error) {
        if (!inStockOnly) throw error;
        console.warn('[useProducts] stock-only query failed; falling back to capped product query', error);
        return await ProductsService.getAll(brandId, maxDocs ? [limit(maxDocs)] : []) as Product[];
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  const { data: serverCount } = useQuery({
    queryKey: ['products', brandId, 'count'],
    queryFn: () => (brandId ? ProductsService.getCount(brandId) : Promise.resolve(0)),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!brandId && !!maxDocs,
  });

  /** Αγνόησε demo products από όλες τις λίστες (όνομα/SKU περιέχει "demo"). */
  const productRows = Array.isArray(firestoreProducts) ? firestoreProducts : [];
  const products = excludeDemoProducts((brandId ? productRows : []) as Product[])
    .filter((p) => !inStockOnly || ((p.stock_level ?? p.available_stock ?? p.stock_on_hand ?? 0) > 0));

  return {
    products,
    count: products.length,
    totalCount: serverCount ?? products.length,
    isLoading: isPending,
    hasImported: products.length > 0,
  };
}
