import { useQuery } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import type { Product } from '../types';
import { excludeDemoProducts } from '../utils/productUtils';
import { fetchMergedCatalogForBrand } from '../services/unifiedCatalogProducts';

export function useProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['products', brandId],
    queryFn: async () => {
      if (!brandId) {
        return { products: [] as Product[], extendedWithConnectorCatalog: false };
      }
      const result = await fetchMergedCatalogForBrand(brandId);
      return {
        products: result.products,
        extendedWithConnectorCatalog: result.meta.extendedWithConnectorCatalog,
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    enabled: !!brandId,
  });

  /** Αγνόησε demo products από όλες τις λίστες (όνομα/SKU περιέχει "demo"). */
  const products = excludeDemoProducts((brandId ? (data?.products ?? []) : []) as Product[]);

  return {
    products,
    count: products.length,
    isLoading: isPending,
    hasImported: products.length > 0,
    extendedWithConnectorCatalog: Boolean(data?.extendedWithConnectorCatalog),
  };
}
