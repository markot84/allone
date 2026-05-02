import type { EcommerceRawLineItem } from './ecommerceRawOrders';
import type { Product } from '../types';
import { FirestoreService } from './firestore';
import { ecommerceLineAffinityKey, normalizeSku } from './ecommerceAffinityKey';

export type CatalogMatchSource = 'erp_product' | 'platform_catalog' | 'line_fallback';

export type ErpSkuDims = {
  brand?: string;
  category?: string;
  subcategory?: string;
};

/** Lookup keys: `${platform}:${productId}` or `${platform}:${normalizedSku}` */
export type CatalogIndexes = {
  byProductId: Map<string, ErpSkuDims>;
  bySku: Map<string, ErpSkuDims>;
};

function coerceErpSkuDims(v: unknown): ErpSkuDims {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  return {
    ...(typeof o.brand === 'string' && o.brand.trim() ? { brand: String(o.brand).trim() } : {}),
    ...(typeof o.category === 'string' && o.category.trim() ? { category: String(o.category).trim() } : {}),
    ...(typeof o.subcategory === 'string' && o.subcategory.trim() ? { subcategory: String(o.subcategory).trim() } : {}),
  };
}

/**
 * React Query persist (localStorage) serializes Map → `{}`. RFM catalog code calls `.has()` — revive Maps from Map or plain record.
 */
export function coerceToSkuDimsMap(raw: unknown): Map<string, ErpSkuDims> {
  if (raw instanceof Map) {
    const out = new Map<string, ErpSkuDims>();
    for (const [k, v] of raw.entries()) {
      if (typeof k === 'string') out.set(k, coerceErpSkuDims(v));
    }
    return out;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const out = new Map<string, ErpSkuDims>();
  for (const [k, v] of Object.entries(raw)) {
    out.set(k, coerceErpSkuDims(v));
  }
  return out;
}

export function normalizeCatalogAlignmentPayload(
  data: { indexes?: unknown; erpBySku?: unknown } | null | undefined
): { indexes: CatalogIndexes; erpBySku: Map<string, ErpSkuDims> } | null {
  if (!data || typeof data !== 'object') return null;
  const idx = data.indexes;
  let byProductId: unknown;
  let bySku: unknown;
  if (idx && typeof idx === 'object' && !Array.isArray(idx)) {
    const i = idx as { byProductId?: unknown; bySku?: unknown };
    byProductId = i.byProductId;
    bySku = i.bySku;
  }
  return {
    indexes: {
      byProductId: coerceToSkuDimsMap(byProductId),
      bySku: coerceToSkuDimsMap(bySku),
    },
    erpBySku: coerceToSkuDimsMap(data.erpBySku),
  };
}

export type ResolvedCatalogLine = {
  match_source: CatalogMatchSource;
  brandLabel: string;
  categoryLabel: string;
  subcategoryLabel: string;
  skuLabel: string;
};

const PRODUCT_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_products',
  woocommerce: 'woo_products',
  magento: 'magento_products',
  opencart: 'opencart_products',
};

function pk(platform: string, id: string): string {
  return `${platform}:${id}`;
}

function trimLabel(s: unknown): string {
  const t = String(s ?? '').trim();
  return t;
}

function meaningfulLabel(value: unknown): string {
  const text = trimLabel(value);
  if (!text || text === '—') return '';
  if (/^\d+$/.test(text)) return '';
  return text;
}

function arrayLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return meaningfulLabel(item);
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return (
          meaningfulLabel(o.name) ||
          meaningfulLabel(o.label) ||
          meaningfulLabel(o.title) ||
          meaningfulLabel(o.value)
        );
      }
      return '';
    })
    .filter(Boolean);
}

function splitCategoryPath(value: unknown): string[] {
  if (Array.isArray(value)) return arrayLabels(value);
  const raw = trimLabel(value);
  if (!raw) return [];
  return raw
    .split(/\s*(?:>|\/|»|\||→)\s*/g)
    .map(meaningfulLabel)
    .filter(Boolean)
    .filter((label) => !/^(root catalog|default category|root|catalog)$/i.test(label));
}

function pickFirstLabel(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = meaningfulLabel(row[key]);
    if (value) return value;
  }
  return '';
}

function pickCategoryDims(row: Record<string, unknown>, fallbackCategory = ''): Pick<ErpSkuDims, 'category' | 'subcategory'> {
  const path =
    splitCategoryPath(row.categoryPath).length > 0
      ? splitCategoryPath(row.categoryPath)
      : arrayLabels(row.categoryNames).length > 0
        ? arrayLabels(row.categoryNames)
        : arrayLabels(row.categories);

  const explicitCategory = pickFirstLabel(row, ['category', 'categoryName', 'productCategory']);
  const explicitSubcategory = pickFirstLabel(row, ['subcategory', 'subCategory', 'subcategoryName', 'productSubcategory']);
  const category = explicitCategory || path[0] || meaningfulLabel(fallbackCategory);
  const subcategory = explicitSubcategory || (path.length > 1 ? path[path.length - 1] : '');
  return {
    ...(category ? { category } : {}),
    ...(subcategory && subcategory !== category ? { subcategory } : {}),
  };
}

function setDims(
  map: Map<string, ErpSkuDims>,
  key: string,
  dims: ErpSkuDims,
  merge = true
): void {
  const prev = map.get(key);
  if (!merge || !prev) {
    map.set(key, { ...dims });
    return;
  }
  map.set(key, {
    brand: dims.brand ?? prev.brand,
    category: dims.category ?? prev.category,
    subcategory: dims.subcategory ?? prev.subcategory,
  });
}

function ingestShopifyRows(rows: Record<string, unknown>[], indexes: CatalogIndexes): void {
  const platform = 'shopify';
  for (const d of rows) {
    const pid = trimLabel(d.productId);
    const vendor = trimLabel(d.vendor);
    const productType = trimLabel(d.productType);
    const base: ErpSkuDims = {
      ...(vendor ? { brand: vendor } : {}),
      ...(productType ? { category: productType } : {}),
    };
    if (pid) setDims(indexes.byProductId, pk(platform, pid), base);
    const variants = Array.isArray(d.variants) ? d.variants : [];
    for (const v of variants as Array<{ sku?: string }>) {
      const ns = normalizeSku(v?.sku);
      if (!ns) continue;
      setDims(indexes.bySku, pk(platform, ns), base);
    }
  }
}

function ingestWooRows(rows: Record<string, unknown>[], indexes: CatalogIndexes): void {
  const platform = 'woocommerce';
  for (const d of rows) {
    const pid = trimLabel(d.productId);
    const cats = Array.isArray(d.categories) ? (d.categories as unknown[]).map((c) => trimLabel(c)) : [];
    const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map((t) => trimLabel(t)) : [];
    const base: ErpSkuDims = {
      ...(tags[0] ? { brand: tags[0] } : {}),
      ...pickCategoryDims(d, cats[0]),
    };
    if (pid) setDims(indexes.byProductId, pk(platform, pid), base);
    const ns = normalizeSku(trimLabel(d.sku));
    if (ns) setDims(indexes.bySku, pk(platform, ns), base);
  }
}

function ingestMagentoRows(rows: Record<string, unknown>[], indexes: CatalogIndexes): void {
  const platform = 'magento';
  for (const d of rows) {
    const pid = trimLabel(d.productId);
    const skuRaw = trimLabel(d.sku);
    const brand = pickFirstLabel(d, ['brand', 'manufacturerLabel', 'manufacturer', 'vendor']);
    const base: ErpSkuDims = {
      ...(brand ? { brand } : {}),
      ...pickCategoryDims(d),
    };
    if (pid) setDims(indexes.byProductId, pk(platform, pid), base);
    const ns = normalizeSku(skuRaw);
    if (ns) setDims(indexes.bySku, pk(platform, ns), base);
  }
}

function ingestOpenCartRows(rows: Record<string, unknown>[], indexes: CatalogIndexes): void {
  const platform = 'opencart';
  for (const d of rows) {
    const pid = trimLabel(d.productId);
    const mfg = meaningfulLabel(d.manufacturer);
    const base: ErpSkuDims = {
      ...(mfg ? { brand: mfg } : {}),
      ...pickCategoryDims(d),
    };
    if (pid) setDims(indexes.byProductId, pk(platform, pid), base);
    const ns = normalizeSku(trimLabel(d.sku)) || normalizeSku(trimLabel(d.model));
    if (ns) setDims(indexes.bySku, pk(platform, ns), base);
  }
}

export function mergePlatformProductDocs(platform: string, rows: Record<string, unknown>[], indexes: CatalogIndexes): void {
  switch (platform) {
    case 'shopify':
      ingestShopifyRows(rows, indexes);
      break;
    case 'woocommerce':
      ingestWooRows(rows, indexes);
      break;
    case 'magento':
      ingestMagentoRows(rows, indexes);
      break;
    case 'opencart':
      ingestOpenCartRows(rows, indexes);
      break;
    default:
      break;
  }
}

export function buildErpSkuMap(products: Product[]): Map<string, ErpSkuDims> {
  const out = new Map<string, ErpSkuDims>();
  for (const p of products) {
    const ns = normalizeSku(p.sku);
    if (!ns) continue;
    const brand = trimLabel(p.brand);
    const category = trimLabel(p.category);
    const subcategory = trimLabel(p.subcategory);
    out.set(ns, {
      ...(brand ? { brand } : {}),
      ...pickCategoryDims(p as unknown as Record<string, unknown>, category),
      ...(subcategory ? { subcategory } : {}),
    });
  }
  return out;
}

/**
 * Loads connector product collections + unified `products` for the brand.
 */
export async function fetchCatalogAlignmentData(
  brandId: string,
  platforms: string[]
): Promise<{ indexes: CatalogIndexes; erpBySku: Map<string, ErpSkuDims> }> {
  const indexes: CatalogIndexes = { byProductId: new Map(), bySku: new Map() };
  const connected = [...new Set(platforms)].filter((p) => PRODUCT_COLLECTIONS[p]);

  const [productRows, erpProducts] = await Promise.all([
    Promise.all(
      connected.map(async (platform) => {
        const coll = PRODUCT_COLLECTIONS[platform];
        const rows = await FirestoreService.getDocuments<Record<string, unknown>>(coll, [], brandId);
        return { platform, rows };
      })
    ),
    FirestoreService.getDocuments<Product>('products', [], brandId),
  ]);

  for (const { platform, rows } of productRows) {
    mergePlatformProductDocs(platform, rows, indexes);
  }

  const erpBySku = buildErpSkuMap(erpProducts);
  return { indexes, erpBySku };
}

export function resolveCatalogLineForOrderLine(
  platform: string,
  item: EcommerceRawLineItem,
  indexes: CatalogIndexes,
  erpBySku: Map<string, ErpSkuDims>
): ResolvedCatalogLine {
  const skuNorm = normalizeSku(item.sku);
  const pid = trimLabel(item.productId);
  const fallbackCategory = ecommerceLineAffinityKey(item);
  const skuLabel =
    skuNorm ||
    trimLabel(item.sku) ||
    trimLabel(item.title) ||
    trimLabel(item.name) ||
    pid ||
    'Άλλο';

  if (skuNorm && erpBySku.has(skuNorm)) {
    const e = erpBySku.get(skuNorm)!;
    const cat = trimLabel(e.category) || fallbackCategory;
    return {
      match_source: 'erp_product',
      brandLabel: trimLabel(e.brand) || 'Λοιπά',
      categoryLabel: cat,
      subcategoryLabel: trimLabel(e.subcategory) || '',
      skuLabel,
    };
  }

  let dims: ErpSkuDims | undefined;
  let catalogHit = false;
  if (pid && indexes.byProductId.has(pk(platform, pid))) {
    dims = indexes.byProductId.get(pk(platform, pid));
    catalogHit = true;
  } else if (skuNorm && indexes.bySku.has(pk(platform, skuNorm))) {
    dims = indexes.bySku.get(pk(platform, skuNorm));
    catalogHit = true;
  }

  if (catalogHit && dims) {
    return {
      match_source: 'platform_catalog',
      brandLabel: trimLabel(dims.brand) || 'Λοιπά',
      categoryLabel: trimLabel(dims.category) || fallbackCategory,
      subcategoryLabel: trimLabel(dims.subcategory) || '',
      skuLabel,
    };
  }

  return {
    match_source: 'line_fallback',
    brandLabel: 'Λοιπά',
    categoryLabel: fallbackCategory,
    subcategoryLabel: '',
    skuLabel,
  };
}
