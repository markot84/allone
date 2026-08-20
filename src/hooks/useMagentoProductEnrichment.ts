/** Magento product enrichment for the Ads Feed: builds a per-SKU lookup from `magento_products`
 * + `connectors/{brandId}.magento`; doesn't touch `products` (merge happens in the UI). */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { FirestoreService } from '../services/firestore';
import { useBrand } from './useBrand';

export interface MagentoProductEnrichment {
  sku: string;
  productId: string;
  imageLink: string;
  link: string;
  description: string;
  shortDescription: string;
  gtin: string;
  mpn: string;
  color: string;
  size: string;
  manufacturer: string;
  itemGroupId: string;
  categoryIds: string[];
  type: string;
  visibility: number;
}

export interface MagentoConnectorConfig {
  storeWebUrl: string;
  mediaBaseUrl: string;
  storeUrl: string;
  connected: boolean;
  productCatalogAccess?: boolean;
  lastSyncProducts?: number;
  lastSyncError?: string;
  lastSyncStatus?: string;
}

interface RawMagentoProductDoc {
  brandId?: string;
  productId?: string;
  sku?: string;
  type?: string;
  visibility?: number;
  imageRelative?: string;
  urlKey?: string;
  description?: string;
  shortDescription?: string;
  gtin?: string;
  mpn?: string;
  color?: string;
  size?: string;
  manufacturer?: string;
  itemGroupId?: string;
  categoryIds?: string[];
}

const CATALOG_PRODUCT_PATH = 'catalog/product';

function buildImageLink(mediaBaseUrl: string, imageRelative: string): string {
  const cleanedImage = imageRelative.trim();
  if (!cleanedImage || cleanedImage === 'no_selection') return '';
  if (/^https?:\/\//i.test(cleanedImage)) return cleanedImage;
  if (!mediaBaseUrl) return '';
  const cleanedBase = mediaBaseUrl.replace(/\/+$/, '');
  const cleanedRel = cleanedImage.replace(/^\/+/, '');
  // Magento media gallery file paths are relative to /pub/media/catalog/product
  return `${cleanedBase}/${CATALOG_PRODUCT_PATH}/${cleanedRel}`.replace(/([^:]\/)\/+/g, '$1');
}

function buildProductLink(storeWebUrl: string, urlKey: string, sku: string): string {
  if (!storeWebUrl) return '';
  const base = storeWebUrl.replace(/\/+$/, '');
  if (urlKey) return `${base}/${urlKey.replace(/^\/+/, '')}.html`;
  if (sku) return `${base}/catalog/product/view/sku/${encodeURIComponent(sku)}`;
  return base;
}

function inferMagentoMediaBaseUrl(configuredMediaBaseUrl: string, storeUrl: string): string {
  if (configuredMediaBaseUrl) return configuredMediaBaseUrl;
  if (!storeUrl) return '';
  return `${storeUrl.replace(/\/+$/, '')}/media`;
}

/** `enabled: false` skips the full magento_products download for pages that only conditionally need it (PER-307). */
export function useMagentoProductEnrichment(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const connectorQuery = useQuery({
    queryKey: ['magentoConnectorConfig', brandId],
    queryFn: async (): Promise<MagentoConnectorConfig> => {
      if (!brandId) return { storeWebUrl: '', mediaBaseUrl: '', storeUrl: '', connected: false };
      const snap = await getDoc(doc(db, 'connectors', brandId));
      const data = snap.data() || {};
      const m = (data as Record<string, unknown>).magento as Record<string, unknown> | undefined;
      if (!m) return { storeWebUrl: '', mediaBaseUrl: '', storeUrl: '', connected: false };
      const storeWebUrl = String(m.storeWebUrl || m.storeUrl || '');
      const storeUrl = String(m.storeUrl || '');
      return {
        storeWebUrl,
        mediaBaseUrl: inferMagentoMediaBaseUrl(String(m.mediaBaseUrl || ''), storeWebUrl || storeUrl),
        storeUrl,
        connected: Boolean(m.connected),
        productCatalogAccess: typeof m.productCatalogAccess === 'boolean' ? m.productCatalogAccess : undefined,
        lastSyncProducts: Number(m.lastSyncProducts ?? 0) || 0,
        lastSyncError: String(m.lastSyncError || ''),
        lastSyncStatus: String(m.lastSyncStatus || ''),
      };
    },
    enabled: enabled && !!brandId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const productsQuery = useQuery({
    queryKey: ['magentoProductsRaw', brandId],
    queryFn: async (): Promise<RawMagentoProductDoc[]> => {
      if (!brandId) return [];
      return FirestoreService.getDocuments<RawMagentoProductDoc>('magento_products', [], brandId);
    },
    enabled: enabled && !!brandId && (connectorQuery.data?.connected ?? false) && connectorQuery.data?.productCatalogAccess !== false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const config = connectorQuery.data ?? { storeWebUrl: '', mediaBaseUrl: '', storeUrl: '', connected: false };
  const rawProducts = productsQuery.data;

  // PER-307: memoized — this O(catalog) loop used to re-run on every render of the consumer.
  const maps = useMemo(() => {
    const bySku = new Map<string, MagentoProductEnrichment>();
    const bySkuLower = new Map<string, MagentoProductEnrichment>();
    const byItemGroupId = new Map<string, MagentoProductEnrichment>();
    const byItemGroupIdLower = new Map<string, MagentoProductEnrichment>();

    for (const p of rawProducts ?? []) {
      const sku = String(p.sku || '').trim();
      if (!sku) continue;
      const enrichment: MagentoProductEnrichment = {
        sku,
        productId: String(p.productId || ''),
        imageLink: buildImageLink(config.mediaBaseUrl, p.imageRelative || ''),
        link: buildProductLink(config.storeWebUrl, p.urlKey || '', sku),
        description: String(p.description || p.shortDescription || ''),
        shortDescription: String(p.shortDescription || ''),
        gtin: String(p.gtin || ''),
        mpn: String(p.mpn || ''),
        color: String(p.color || ''),
        size: String(p.size || ''),
        manufacturer: String(p.manufacturer || ''),
        itemGroupId: String(p.itemGroupId || ''),
        categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds.map(String) : [],
        type: String(p.type || ''),
        visibility: Number(p.visibility ?? 0),
      };
      bySku.set(sku, enrichment);
      bySkuLower.set(sku.toLowerCase(), enrichment);
      if (enrichment.itemGroupId && enrichment.imageLink) {
        if (!byItemGroupId.has(enrichment.itemGroupId)) byItemGroupId.set(enrichment.itemGroupId, enrichment);
        const lower = enrichment.itemGroupId.toLowerCase();
        if (!byItemGroupIdLower.has(lower)) byItemGroupIdLower.set(lower, enrichment);
      }
    }
    return { bySku, bySkuLower, byItemGroupId, byItemGroupIdLower };
  }, [rawProducts, config.mediaBaseUrl, config.storeWebUrl]);
  const { bySku, bySkuLower, byItemGroupId, byItemGroupIdLower } = maps;

  return {
    config,
    bySku,
    bySkuLower,
    byItemGroupId,
    byItemGroupIdLower,
    // isPending alone stays true forever on disabled queries — require an actual in-flight fetch.
    isLoading: (connectorQuery.isPending && connectorQuery.isFetching) || (productsQuery.isPending && productsQuery.isFetching),
    isConnected: config.connected,
    productCatalogAccess: config.productCatalogAccess,
    lastSyncProducts: config.lastSyncProducts ?? 0,
    lastSyncError: config.lastSyncError ?? '',
    lastSyncStatus: config.lastSyncStatus ?? '',
    count: bySku.size,
  };
}

/** Public utilities (tested separately) */
export const __test = {
  buildImageLink,
  buildProductLink,
  inferMagentoMediaBaseUrl,
};
