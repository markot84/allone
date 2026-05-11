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
        return { products: [] as Product[], extendedWithConnectorCatalog: false, connectedButEmptyPlatforms: [] as string[], connectorSkusAdded: 0 };
      }
      const result = await fetchMergedCatalogForBrand(brandId);
      return {
        products: result.products,
        extendedWithConnectorCatalog: result.meta.extendedWithConnectorCatalog,
        connectedButEmptyPlatforms: result.meta.connectedButEmptyPlatforms,
        connectorSkusAdded: result.meta.connectorSkusAdded,
      };
    },
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
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
    connectedButEmptyPlatforms: (data?.connectedButEmptyPlatforms ?? []) as string[],
    connectorSkusAdded: data?.connectorSkusAdded ?? 0,
  };
}
