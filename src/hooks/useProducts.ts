import { useQuery } from '@tanstack/react-query';
import { limit, where } from 'firebase/firestore';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import type { Product } from '../types';
import { excludeDemoProducts } from '../utils/productUtils';
import { logger } from '../utils/logger';

type UseProductsOptions = {
  maxDocs?: number;
  inStockOnly?: boolean;
};

export function useProducts(options: UseProductsOptions = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const maxDocs = options.maxDocs;
  const inStockOnly = options.inStockOnly ?? false;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId, syncVersion, maxDocs ?? 'all', inStockOnly ? 'in-stock' : 'all-stock'],
    queryFn: async () => {
      if (!brandId) return [] as Product[];
      const constraints = [
        ...(inStockOnly ? [where('stock_level', '>', 0)] : []),
        ...(maxDocs ? [limit(maxDocs)] : []),
      ];
      try {
        return await ProductsService.getAll(brandId, constraints, { forceServer: true }) as Product[];
      } catch (error) {
        if (!inStockOnly) throw error;
        logger.warn('[useProducts] stock-only query failed; falling back to capped product query', { err: error });
        return await ProductsService.getAll(brandId, maxDocs ? [limit(maxDocs)] : [], { forceServer: true }) as Product[];
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: serverCount } = useQuery({
    queryKey: ['products', brandId, syncVersion, 'count'],
    queryFn: () => (brandId ? ProductsService.getCount(brandId) : Promise.resolve(0)),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!brandId && !!maxDocs,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  /** Αγνόησε demo products από όλες τις λίστες (όνομα/SKU περιέχει "demo"). */
  const productRows = Array.isArray(firestoreProducts) ? firestoreProducts : [];
  const products = excludeDemoProducts((brandId ? productRows : []) as Product[])
    // PER-60/PER-130 (1B): τα ERP-διαγραμμένα προϊόντα κρατούνται μόνο για ιστορικό/στατιστικά
    // (απόφαση Makis 12-06) — εξαιρούνται από ΟΛΕΣ τις client λίστες (Ads feed, charts, automation,
    // procurement) ώστε client & server να συμφωνούν με το 8.1a/8.1b. Single-point filter εδώ.
    .filter((p) => !(p as { discontinued_at?: unknown }).discontinued_at)
    .filter((p) => !inStockOnly || ((p.stock_level ?? p.available_stock ?? p.stock_on_hand ?? 0) > 0));

  return {
    products,
    count: products.length,
    totalCount: serverCount ?? products.length,
    isLoading: isPending,
    hasImported: products.length > 0,
  };
}
