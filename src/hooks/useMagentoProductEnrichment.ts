/**
 * Magento product enrichment για Ads Feed:
 * - Συγκεντρώνει τα ωμά Magento products από `magento_products` (ανά brandId)
 *   και το connector config (`storeWebUrl`, `mediaBaseUrl`) από `connectors/{brandId}.magento`.
 * - Επιστρέφει lookup map ανά SKU με image_link, link, description, gtin, mpn,
 *   color, size, item_group_id (parent SKU), category path κ.λπ.
 *
 * Δεν αγγίζει το unified `products` collection — η συγχώνευση γίνεται στο UI layer
 * όπου χρειάζεται (π.χ. Channel Activation → Ads Feed export/preview).
 */
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
  if (!imageRelative) return '';
  if (/^https?:\/\//i.test(imageRelative)) return imageRelative;
  if (!mediaBaseUrl) return '';
  const cleanedBase = mediaBaseUrl.replace(/\/+$/, '');
  const cleanedRel = imageRelative.replace(/^\/+/, '');
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

export function useMagentoProductEnrichment() {
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
      return {
        storeWebUrl: String(m.storeWebUrl || m.storeUrl || ''),
        mediaBaseUrl: String(m.mediaBaseUrl || ''),
        storeUrl: String(m.storeUrl || ''),
        connected: Boolean(m.connected),
      };
    },
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const productsQuery = useQuery({
    queryKey: ['magentoProductsRaw', brandId],
    queryFn: async (): Promise<RawMagentoProductDoc[]> => {
      if (!brandId) return [];
      return FirestoreService.getDocuments<RawMagentoProductDoc>('magento_products', [], brandId);
    },
    enabled: !!brandId && (connectorQuery.data?.connected ?? false),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const config = connectorQuery.data ?? { storeWebUrl: '', mediaBaseUrl: '', storeUrl: '', connected: false };
  const rawProducts = productsQuery.data ?? [];

  const bySku = new Map<string, MagentoProductEnrichment>();
  const bySkuLower = new Map<string, MagentoProductEnrichment>();

  for (const p of rawProducts) {
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
  }

  return {
    config,
    bySku,
    bySkuLower,
    isLoading: connectorQuery.isPending || productsQuery.isPending,
    isConnected: config.connected,
    count: bySku.size,
  };
}

/** Public utilities (tested separately) */
export const __test = {
  buildImageLink,
  buildProductLink,
};
