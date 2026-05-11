import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Product } from '../types';
import { FirestoreService } from './firestore';
import { normalizeSku } from './ecommerceAffinityKey';

/** Mirror of catalogAlignment / rfm COMPUTER mappings — unified `products` vs connector collections */
const PLATFORM_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_products',
  woocommerce: 'woo_products',
  magento: 'magento_products',
  opencart: 'opencart_products',
  megaventory: 'megaventory_products',
};

export type UnifiedCatalogFetchMeta = {
  /** True όταν βρέθηκαν επιπλέον SKU από connector collections (δηλ. merge πρόσθεσε νέα SKU) */
  extendedWithConnectorCatalog: boolean;
  /** Platforms που ήταν configured (connected) αλλά δεν επέστρεψαν products (π.χ. 401 error) */
  connectedButEmptyPlatforms: string[];
  /** Πόσα connector SKU προστέθηκαν */
  connectorSkusAdded: number;
};

export type UnifiedCatalogFetchResult = {
  products: Product[];
  meta: UnifiedCatalogFetchMeta;
};

function parseMoney(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function pickMargin(price: number, cost: number): Pick<Product, 'margin_tier' | 'margin_percentage'> {
  if (price <= 0 || cost <= 0 || cost >= price) {
    return { margin_tier: 'low', margin_percentage: 0 };
  }
  const pct = Math.round(((price - cost) / price) * 1000) / 10;
  const margin_tier: Product['margin_tier'] =
    pct > 30 ? 'high' : pct > 15 ? 'medium' : 'low';
  return { margin_tier, margin_percentage: pct };
}

function magentoRowToProduct(docId: string, row: Record<string, unknown>): Product | null {
  const sku = String(row.sku ?? '').trim();
  if (!sku) return null;
  const price = parseMoney(row.price);
  const special = parseMoney(row.specialPrice);
  const effectivePrice = special > 0 && special < price ? special : price;
  const stockRaw = row.stockQuantity;
  const stockNum = stockRaw != null && stockRaw !== '' ? Number(stockRaw) : 0;
  const stock_level = Number.isFinite(stockNum) ? stockNum : 0;

  const name = String(row.name ?? sku).trim() || sku;
  const cat = String(row.category ?? '').trim();
  const sub = String(row.subcategory ?? '').trim();
  const brand = String(row.manufacturer ?? row.brand ?? '').trim();

  const marginFields = pickMargin(effectivePrice, 0);

  return {
    id: docId,
    name,
    sku,
    category: cat || 'Magento',
    ...(sub ? { subcategory: sub } : {}),
    ...marginFields,
    stock_level,
    stock_capacity: stock_level > 0 ? stock_level * 2 : 0,
    price: effectivePrice || price,
    ...(brand ? { brand } : {}),
    status: row.status ? String(row.status) : undefined,
    gtin: row.gtin ? String(row.gtin) : undefined,
  };
}

function shopifyDocToSkuProducts(docId: string, row: Record<string, unknown>): Product[] {
  const title = String(row.title ?? '').trim();
  const vendor = String(row.vendor ?? '').trim();
  const productType = String(row.productType ?? '').trim();
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const out: Product[] = [];
  variants.forEach((raw, idx) => {
    const v = raw as Record<string, unknown>;
    const sku = String(v.sku ?? '').trim();
    if (!sku) return;
    const price = parseMoney(v.price);
    const iq = v.inventoryQuantity;
    const stockNum = iq != null && iq !== '' ? Number(iq) : 0;
    const stock_level = Number.isFinite(stockNum) ? stockNum : 0;
    const vTitle = String(v.title ?? '').trim();
    const name = (
      `${title}${vTitle ? ' — ' + vTitle : ''}`.trim() ||
      title ||
      sku
    ).trim();
    const marginFields = pickMargin(price, 0);
    out.push({
      id: `${docId}_v${idx}`,
      name,
      sku,
      category: productType || 'Shopify',
      ...marginFields,
      stock_level,
      stock_capacity: stock_level > 0 ? stock_level * 2 : 0,
      price,
      ...(vendor ? { brand: vendor } : {}),
    });
  });
  return out;
}

function wooRowToProduct(docId: string, row: Record<string, unknown>): Product | null {
  const sku = String(row.sku ?? '').trim();
  if (!sku) return null;
  const price = parseMoney(row.salePrice) || parseMoney(row.price) || parseMoney(row.regularPrice);
  const stockRaw = row.stockQuantity;
  const stockNum = stockRaw != null && stockRaw !== '' ? Number(stockRaw) : 0;
  const stock_level = Number.isFinite(stockNum) ? stockNum : 0;
  const name = String(row.name ?? sku).trim() || sku;
  const cats = Array.isArray(row.categories) ? row.categories.map(String).filter(Boolean) : [];
  const tags = Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean) : [];
  const marginFields = pickMargin(price, 0);
  return {
    id: docId,
    name,
    sku,
    category: cats[0] || 'WooCommerce',
    ...(cats.length > 1 ? { subcategory: cats[cats.length - 1] } : {}),
    ...marginFields,
    stock_level,
    stock_capacity: stock_level > 0 ? stock_level * 2 : 0,
    price,
    ...(tags[0] ? { brand: tags[0] } : {}),
    status: row.status ? String(row.status) : undefined,
  };
}

function opencartRowToProduct(docId: string, row: Record<string, unknown>): Product | null {
  const sku =
    String(row.sku ?? '').trim() ||
    String(row.model ?? '').trim();
  if (!sku) return null;
  const price = parseMoney(row.price);
  const qtyRaw = row.quantity;
  const stockNum = qtyRaw != null && qtyRaw !== '' ? Number(qtyRaw) : 0;
  const stock_level = Number.isFinite(stockNum) ? stockNum : 0;
  const name = String(row.name ?? sku).trim() || sku;
  const mfg = String(row.manufacturer ?? '').trim();
  const marginFields = pickMargin(price, 0);
  return {
    id: docId,
    name,
    sku,
    category: 'OpenCart',
    ...marginFields,
    stock_level,
    stock_capacity: stock_level > 0 ? stock_level * 2 : 0,
    price,
    ...(mfg ? { brand: mfg } : {}),
    status: row.status ? String(row.status) : undefined,
  };
}

function megaventoryRowToProduct(docId: string, row: Record<string, unknown>): Product | null {
  const sku = String(row.sku ?? '').trim();
  if (!sku) return null;
  const price = parseMoney(row.sellingPrice);
  const cost = parseMoney(row.purchasePrice);
  const stockRaw = row.stockOnHand;
  const stockNum = stockRaw != null && stockRaw !== '' ? Number(stockRaw) : 0;
  const stock_level = Number.isFinite(stockNum) ? stockNum : 0;
  const name = String(row.name ?? sku).trim() || sku;
  const cat = String(row.category ?? '').trim();
  const marginFields = pickMargin(price, cost);
  return {
    id: docId,
    name,
    sku,
    category: cat || 'ERP',
    ...marginFields,
    stock_level,
    stock_capacity: stock_level > 0 ? stock_level * 2 : 0,
    price,
    cost_price: cost > 0 ? cost : undefined,
    status: 'active',
  };
}


function platformDocToProducts(platform: string, docId: string, row: Record<string, unknown>): Product[] {
  switch (platform) {
    case 'shopify':
      return shopifyDocToSkuProducts(docId, row);
    case 'woocommerce': {
      const one = wooRowToProduct(docId, row);
      return one ? [one] : [];
    }
    case 'magento': {
      const one = magentoRowToProduct(docId, row);
      return one ? [one] : [];
    }
    case 'opencart': {
      const one = opencartRowToProduct(docId, row);
      return one ? [one] : [];
    }
    case 'megaventory': {
      const one = megaventoryRowToProduct(docId, row);
      return one ? [one] : [];
    }
    default:
      return [];
  }
}

/** SKU από import/ERP μένουν master· νέα SKU από connectors προστίθενται στο τέλος */
export function mergeImportedWithConnectorSkus(imported: Product[], fromConnectors: Product[]): Product[] {
  const seen = new Set<string>();
  const merged: Product[] = [];
  for (const p of imported) {
    const k = normalizeSku(p.sku);
    if (k) seen.add(k);
    merged.push(p);
  }
  for (const p of fromConnectors) {
    const k = normalizeSku(p.sku);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push(p);
  }
  return merged;
}

/**
 * Φορτώνει `products` + επιπλέον SKU από τις συλλογές των connectors (e-commerce + ERP).
 * Ελέγχει ΚΑΙ ecommerce_summary ΚΑΙ connectors doc — δεν κάνει early return.
 */
async function resolveConnectorCatalogPlatforms(brandId: string): Promise<string[]> {
  const found = new Set<string>();

  try {
    const summarySnap = await getDoc(doc(db, 'ecommerce_summary', brandId));
    if (summarySnap.exists()) {
      const raw = (summarySnap.data() as { connectedPlatforms?: string[] }).connectedPlatforms;
      if (Array.isArray(raw)) {
        raw.forEach((p) => { if (PLATFORM_COLLECTIONS[p]) found.add(p); });
      }
    }
  } catch { /* ignore */ }

  try {
    const connSnap = await getDoc(doc(db, 'connectors', brandId));
    if (connSnap.exists()) {
      const data = connSnap.data() as Record<string, unknown>;
      const pick = (key: string, platform: string) => {
        const block = data[key] as Record<string, unknown> | undefined;
        if (block?.connected && PLATFORM_COLLECTIONS[platform]) found.add(platform);
      };
      pick('shopify', 'shopify');
      pick('woocommerce', 'woocommerce');
      pick('magento', 'magento');
      pick('opencart', 'opencart');
      pick('megaventory', 'megaventory');
    }
  } catch { /* ignore */ }

  return [...found];
}

export async function fetchMergedCatalogForBrand(brandId: string): Promise<UnifiedCatalogFetchResult> {
  const imported = await ProductsServiceHelpers.getImportedProducts(brandId);

  let connected: string[] = [];
  try {
    connected = await resolveConnectorCatalogPlatforms(brandId);
  } catch {
    connected = [];
  }

  if (connected.length === 0) {
    return {
      products: imported,
      meta: { extendedWithConnectorCatalog: false, connectedButEmptyPlatforms: [], connectorSkusAdded: 0 },
    };
  }

  const fromConnectorsResults = await Promise.all(
    connected.map(async (pf) => {
      const coll = PLATFORM_COLLECTIONS[pf];
      // Large ERP/connector collections: use paginated fetch to avoid single huge request.
      const rows = await FirestoreService.getDocumentsAllPages<Record<string, unknown>>(
        coll,
        [],
        brandId,
        { pageSize: 500 }
      );
      const skuProducts: Product[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowId =
          typeof (row as { id?: unknown }).id === 'string'
            ? String((row as { id: string }).id)
            : `${pf}_${i}`;
        skuProducts.push(...platformDocToProducts(pf, rowId, row));
      }
      return { platform: pf, products: skuProducts };
    })
  );

  const connectedButEmptyPlatforms = fromConnectorsResults
    .filter((r) => r.products.length === 0)
    .map((r) => r.platform);

  const allConnectorProducts = fromConnectorsResults.flatMap((r) => r.products);
  const merged = mergeImportedWithConnectorSkus(imported, allConnectorProducts);
  const connectorSkusAdded = merged.length - imported.length;

  return {
    products: merged,
    meta: {
      extendedWithConnectorCatalog: connectorSkusAdded > 0,
      connectedButEmptyPlatforms,
      connectorSkusAdded,
    },
  };
}

/** Avoid circular static ref — thin wrapper για tests / clarity */
export const ProductsServiceHelpers = {
  getImportedProducts: (brandId: string) =>
    FirestoreService.getDocuments<Product>('products', [], brandId),
};
