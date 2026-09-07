/** Magento product enrichment for the Ads Feed: builds a per-SKU lookup from `magento_products`
 * + `connectors/{brandId}.magento`; doesn't touch `products` (merge happens in the UI). */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, where } from 'firebase/firestore';
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

/** Firestore `in` filters accept at most 30 values. */
const IN_CHUNK = 30;

/** At most this many Firestore reads run at once. `Promise.all` over every chunk opened two
 * queries per 30 SKUs simultaneously — a 30k-SKU feed asked the browser for 2.000 concurrent
 * reads and the tab stopped responding. */
const MAX_CONCURRENT_READS = 8;

/** Past this many SKUs the per-SKU path costs more round trips than reading the collection once
 * (a 30k-SKU feed = 2.000 queries), so above it we read once and filter locally to exactly the
 * same rows. Below it the scoped reads stay cheaper than pulling the whole catalog. */
const MAX_CHUNKED_SKUS = 3000;

/** Runs `task` over `items` with a bounded number in flight. */
async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i]);
  });
  await Promise.all(workers);
  return out;
}

/** PER-335: fetch only rows matching the given SKUs (by `sku` + `itemGroupId` for parent images) instead of the full catalog. */
async function fetchMagentoProductsForSkus(brandId: string, skus: string[]): Promise<RawMagentoProductDoc[]> {
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const byId = new Map<string, RawMagentoProductDoc>();

  if (unique.length > MAX_CHUNKED_SKUS) {
    // One read, then the same predicate the chunked path applies server-side (sku OR itemGroupId
    // in the wanted set), so both branches return an identical row set — the enriched-SKU count
    // on the page stays the feed's, not the catalog's.
    const wanted = new Set(unique);
    const all = await FirestoreService.getDocuments<RawMagentoProductDoc & { id: string }>('magento_products', [], brandId);
    for (const d of all) {
      if (wanted.has(String(d.sku || '').trim()) || wanted.has(String(d.itemGroupId || '').trim())) byId.set(d.id, d);
    }
    return [...byId.values()];
  }

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) chunks.push(unique.slice(i, i + IN_CHUNK));
  const results = await mapWithLimit(
    chunks.flatMap((chunk) => [
      { field: 'sku', chunk },
      { field: 'itemGroupId', chunk },
    ]),
    MAX_CONCURRENT_READS,
    ({ field, chunk }) =>
      FirestoreService.getDocuments<RawMagentoProductDoc & { id: string }>('magento_products', [where(field, 'in', chunk)], brandId)
  );
  for (const docs of results) for (const d of docs) byId.set(d.id, d);
  return [...byId.values()];
}

/** `enabled: false` skips the full magento_products download (PER-307); `skus` scopes the fetch to those SKUs only (PER-335). */
export function useMagentoProductEnrichment(options?: { enabled?: boolean; skus?: string[] }) {
  const enabled = options?.enabled ?? true;
  const skus = options?.skus;
  // Stable key: same SKU set in any order → same cached query. Memoized because the dedupe+sort
  // runs over the caller's whole feed — tens of thousands of SKUs on a large catalog, and React
  // Query re-hashes the joined string on top of that, on every single render.
  const skusKey = useMemo(
    () => (skus ? [...new Set(skus.map((s) => s.trim()).filter(Boolean))].sort().join('|') : null),
    [skus]
  );
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
    queryKey: skusKey == null ? ['magentoProductsRaw', brandId] : ['magentoProductsRaw', brandId, skusKey],
    queryFn: async (): Promise<RawMagentoProductDoc[]> => {
      if (!brandId) return [];
      if (skusKey != null) {
        return skusKey === '' ? [] : fetchMagentoProductsForSkus(brandId, skusKey.split('|'));
      }
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
  fetchMagentoProductsForSkus,
  mapWithLimit,
  MAX_CONCURRENT_READS,
  MAX_CHUNKED_SKUS,
};
