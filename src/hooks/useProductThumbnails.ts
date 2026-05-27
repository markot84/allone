import { useCallback, useMemo } from 'react';
import { useMagentoProductEnrichment } from './useMagentoProductEnrichment';
import {
  imageUrlFromProductRecord,
  resolveProductThumbnailUrl,
  type ThumbnailSource,
} from '../services/productThumbnailResolver';

export function useProductThumbnails() {
  const magento = useMagentoProductEnrichment();

  const maps = useMemo(
    () => ({
      magentoBySku: magento.bySku,
      magentoBySkuLower: magento.bySkuLower,
      magentoByItemGroupId: magento.byItemGroupId,
      magentoByItemGroupIdLower: magento.byItemGroupIdLower,
    }),
    [magento.byItemGroupId, magento.byItemGroupIdLower, magento.bySku, magento.bySkuLower]
  );

  const getThumbnailUrl = useCallback(
    (sku: string, productOrImageUrl?: unknown): { url: string; source: ThumbnailSource } => {
      const importImageUrl =
        typeof productOrImageUrl === 'string'
          ? productOrImageUrl
          : imageUrlFromProductRecord(productOrImageUrl);
      return resolveProductThumbnailUrl(sku, { importImageUrl, maps });
    },
    [maps]
  );

  return {
    getThumbnailUrl,
    isLoading: magento.isLoading,
    magentoConnected: magento.isConnected,
    magentoProductCatalogAccess: magento.productCatalogAccess,
    magentoProductCount: magento.count,
    magentoLastSyncError: magento.lastSyncError,
    magentoLastSyncProducts: magento.lastSyncProducts,
  };
}
