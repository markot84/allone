import { useQuery } from '@tanstack/react-query';
import { limit, where } from 'firebase/firestore';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import type { Product } from '../types';
import { excludeNonStockedProducts } from '../utils/productUtils';
import { logger } from '../utils/logger';

type UseProductsOptions = {
  maxDocs?: number;
  inStockOnly?: boolean;
  /** Gate the (potentially unbounded) fetch. Defaults to true. PER-157 sets this false on the
   *  Marketing Plan page when the server-precomputed insight is used, so the ~222k-doc catalog is
   *  never loaded in the common case. */
  enabled?: boolean;
};

export function useProducts(options: UseProductsOptions = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const maxDocs = options.maxDocs;
  const inStockOnly = options.inStockOnly ?? false;
  const enabled = options.enabled ?? true;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId, syncVersion, maxDocs ?? 'all', inStockOnly ? 'in-stock' : 'all-stock'],
    enabled,
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
    enabled: enabled && !!brandId && !!maxDocs,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  /** Ignore demo + non-merchandise products in all lists (platform rule + brand's own PER-293 rules). */
  const productRows = Array.isArray(firestoreProducts) ? firestoreProducts : [];
  const products = excludeNonStockedProducts((brandId ? productRows : []) as Product[], currentBrand?.nonMerchandise)
    // ERP-deleted products are kept only for history/stats; single-point filter excludes them
    // from ALL client lists (Ads feed, charts, automation, procurement) so client & server agree.
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
