import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let db: Firestore;

export function setDb(firestore: Firestore): void {
  db = firestore;
}

type ProductSourceKind = 'erp' | 'connector_catalog';
type StockBucket = 'healthy' | 'excess' | 'dead' | 'low';

type CompactProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  margin_tier: 'high' | 'medium' | 'low';
  margin_percentage: number;
  stock_level: number;
  stock_capacity: number;
  priority_tag: StockBucket;
  price: number;
  cost_price?: number;
  qty_sold_period?: number;
  first_available_date?: string;
  source?: string;
};

type StockOverlay = {
  stock_level: number;
  stock_capacity: number;
  priority_tag: StockBucket;
  price?: number;
  cost_price?: number;
  margin_percentage?: number;
  margin_tier?: 'high' | 'medium' | 'low';
  qty_sold_period?: number;
  first_available_date?: string;
  category?: string;
  source: 'erp';
};

type InventorySummaryPayload = {
  total_skus: number;
  total_value: number;
  healthy_stock: { count: number; percentage: number };
  excess_stock: { count: number; percentage: number; value: number };
  dead_stock: { count: number; percentage: number; value: number };
  low_stock: { count: number; percentage: number };
};

type PageBucket = 'all' | StockBucket;

const READ_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 150;
const PAGE_WRITE_BATCH_SIZE = 20;
const BUCKETS: PageBucket[] = ['all', 'healthy', 'excess', 'dead', 'low'];
const SALES_PERIOD_DAYS = 30;
const MEGAVENTORY_NORMALIZED_SOURCE = 'megaventory_custom_report';

function assertDb(): Firestore {
  if (!db) throw new Error('productIntelligenceAggregator db is not initialized');
  return db;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function num(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim().replace(/\s/g, '');
  if (!s) return 0;
  return s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0 : parseFloat(s) || 0;
}

function normalizeSku(value: unknown): string {
  return text(value).toLowerCase();
}

function isDemoProduct(row: Pick<CompactProduct, 'name' | 'sku'>): boolean {
  return row.name.toLowerCase().includes('demo') || row.sku.toLowerCase().includes('demo');
}

function arrayLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return text(item);
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return text(row.name ?? row.label ?? row.title ?? row.value);
      }
      return '';
    })
    .filter(Boolean);
}

function splitCategoryPath(value: unknown): string[] {
  if (Array.isArray(value)) return arrayLabels(value);
  const raw = text(value);
  if (!raw) return [];
  return raw
    .split(/>|\/|\||,/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function categoryPathFromRow(row: Record<string, unknown>): string[] {
  const path = splitCategoryPath(row.categoryPath);
  if (path.length > 0) return path;
  const names = arrayLabels(row.categoryNames);
  if (names.length > 0) return names;
  const cats = arrayLabels(row.categories);
  if (cats.length > 0) return cats;
  return [text(row.category ?? row.category_name), text(row.subcategory ?? row.sub_category)].filter(Boolean);
}

function asIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  const raw = text(value);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw;
}

function stockBucket(stockLevel: number, qtySoldPeriod: number): StockBucket {
  if (stockLevel <= 0) return 'low';
  if (qtySoldPeriod <= 0) return 'dead';
  const daysOfStock = stockLevel / (qtySoldPeriod / SALES_PERIOD_DAYS);
  if (daysOfStock <= 30) return 'low';
  if (daysOfStock > 120) return 'excess';
  return 'healthy';
}

function marginTier(marginPercentage: number): CompactProduct['margin_tier'] {
  if (marginPercentage > 30) return 'high';
  if (marginPercentage > 15) return 'medium';
  return 'low';
}

function productFromRow(docId: string, row: Record<string, unknown>, sourceKind: ProductSourceKind): CompactProduct | null {
  const sku = text(row.sku ?? row.SKU ?? row.productSku ?? row.ProductSKU);
  if (!sku) return null;
  const path = categoryPathFromRow(row);
  const category = text(row.category ?? row.category_name ?? path[0]) || 'Uncategorized';
  const price =
    num(row.price) ||
    num(row.sell_price) ||
    num(row.sellingPrice) ||
    num(row.specialPrice) ||
    num(row.list_price) ||
    num(row.compare_at_price) ||
    num(row.regularPrice);
  const cost = num(row.cost_price ?? row.costPrice ?? row.purchasePrice ?? row.cost);
  const stock =
    num(row.stock_level) ||
    num(row.available_stock) ||
    num(row.stock_on_hand) ||
    num(row.stockOnHand) ||
    num(row.qty) ||
    num(row.quantity);
  const qtySold =
    num(row.qty_sold_period) ||
    num(row.qtySoldPeriod) ||
    num(row.qty_sold_last_30d) ||
    num(row.qtySold) ||
    num(row.qty_sold_lifetime);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, qtySold);
  const product: CompactProduct = {
    id: docId,
    sku,
    name: text(row.name ?? row.title ?? row.productName ?? row.ProductDescription) || sku,
    category,
    margin_tier: marginTier(margin),
    margin_percentage: Math.round(margin * 10) / 10,
    stock_level: Math.round(stock * 100) / 100,
    stock_capacity: Math.max(Math.round(stock * 2 * 100) / 100, Math.round(stock * 100) / 100, 1),
    priority_tag: bucket,
    price: Math.round(price * 100) / 100,
    ...(cost > 0 ? { cost_price: Math.round(cost * 100) / 100 } : {}),
    ...(qtySold > 0 ? { qty_sold_period: Math.round(qtySold * 100) / 100 } : {}),
    ...(asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) ? { first_available_date: asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) } : {}),
    source: sourceKind,
  };
  return isDemoProduct(product) ? null : product;
}

function overlayFromMegaventoryProduct(row: Record<string, unknown>): StockOverlay | null {
  const stock =
    num(row.stock_level) ||
    num(row.available_stock) ||
    num(row.stock_on_hand) ||
    num(row.stockOnHand) ||
    num(row.qty) ||
    num(row.quantity);
  const qtySold =
    num(row.qty_sold_period) ||
    num(row.qtySoldPeriod) ||
    num(row.qty_sold_last_30d) ||
    num(row.qty_sold_lifetime) ||
    num(row.qtySold) ||
    num(row.revenue_period);
  const price = num(row.price) || num(row.sell_price) || num(row.list_price) || num(row.sellingPrice);
  const cost = num(row.cost_price) || num(row.costPrice) || num(row.purchasePrice);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, qtySold);
  return {
    stock_level: Math.round(stock * 100) / 100,
    stock_capacity: Math.max(Math.round(stock * 2 * 100) / 100, Math.round(stock * 100) / 100, 1),
    priority_tag: bucket,
    ...(price > 0 ? { price: Math.round(price * 100) / 100 } : {}),
    ...(cost > 0 ? { cost_price: Math.round(cost * 100) / 100 } : {}),
    ...(margin > 0 ? { margin_percentage: Math.round(margin * 10) / 10, margin_tier: marginTier(margin) } : {}),
    ...(qtySold > 0 ? { qty_sold_period: Math.round(qtySold * 100) / 100 } : {}),
    ...(asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) ? { first_available_date: asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) } : {}),
    ...(text(row.category ?? row.category_name) ? { category: text(row.category ?? row.category_name) } : {}),
    source: 'erp',
  };
}

function applyStockOverlay(product: CompactProduct, overlay: StockOverlay): CompactProduct {
  const next: CompactProduct = {
    ...product,
    stock_level: overlay.stock_level,
    stock_capacity: overlay.stock_capacity,
    priority_tag: overlay.priority_tag,
    source: 'erp',
  };
  if (overlay.price != null) next.price = overlay.price;
  if (overlay.cost_price != null) next.cost_price = overlay.cost_price;
  if (overlay.margin_percentage != null) next.margin_percentage = overlay.margin_percentage;
  if (overlay.margin_tier) next.margin_tier = overlay.margin_tier;
  if (overlay.qty_sold_period != null) next.qty_sold_period = overlay.qty_sold_period;
  if (overlay.first_available_date) next.first_available_date = overlay.first_available_date;
  if (overlay.category && (!next.category || next.category === 'Uncategorized')) next.category = overlay.category;
  return next;
}

async function hasConnectorCatalog(brandId: string): Promise<{ connected: boolean; sourceLabel: string; hasErp: boolean }> {
  const firestore = assertDb();
  const snap = await firestore.doc(`connectors/${brandId}`).get();
  const data = snap.data() || {};
  const hasObject = (key: string) => {
    const value = data[key];
    return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).connected !== false;
  };
  const erp = hasObject('megaventory') || hasObject('softone') || hasObject('epsilon_net') || hasObject('epsilonNet') || hasObject('entersoft');
  const ecommerce = hasObject('magento') || hasObject('shopify') || hasObject('woocommerce') || hasObject('opencart');
  return { connected: erp || ecommerce, sourceLabel: erp ? 'ERP' : 'E-shop catalog', hasErp: erp };
}

async function computeBrandSyncVersion(brandId: string): Promise<{ version: string; latestSyncAt: string | null }> {
  const firestore = assertDb();
  const dates: number[] = [];
  const push = (value: unknown) => {
    const raw = asIsoDate(value);
    if (!raw) return;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) dates.push(t);
  };
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (normalized === 'lastsyncat' || normalized.endsWith('syncat') || normalized === 'syncedat') push(child);
      collect(child);
    }
  };
  const [connectors, ecommerce, importJobs] = await Promise.all([
    firestore.doc(`connectors/${brandId}`).get().catch(() => null),
    firestore.doc(`ecommerce_summary/${brandId}`).get().catch(() => null),
    firestore.collection('import_jobs').where('brandId', '==', brandId).orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
  ]);
  if (connectors?.exists) collect(connectors.data());
  if (ecommerce?.exists) push(ecommerce.data()?.syncedAt);
  importJobs?.docs.forEach((doc) => push(doc.data().createdAt));
  const latest = dates.length ? Math.max(...dates) : 0;
  return { version: latest ? String(latest) : 'empty', latestSyncAt: latest ? new Date(latest).toISOString() : null };
}

async function loadCatalogCollection(
  brandId: string,
  collection: string,
  sourceKind: ProductSourceKind,
  bySku: Map<string, CompactProduct>,
  options: { filterByBrandInQuery?: boolean } = { filterByBrandInQuery: true }
): Promise<number> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let read = 0;
  for (;;) {
    let query = firestore.collection(collection).orderBy(FieldPath.documentId()).limit(READ_PAGE_SIZE);
    if (options.filterByBrandInQuery !== false) {
      query = query.where('brandId', '==', brandId);
    }
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    read += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data();
      if (options.filterByBrandInQuery === false && text(row.brandId) !== brandId) continue;
      const product = productFromRow(doc.id, row, sourceKind);
      if (!product) continue;
      const key = normalizeSku(product.sku);
      if (!key || bySku.has(key)) continue;
      bySku.set(key, product);
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return read;
}

async function loadMegaventoryProductOverlay(
  brandId: string,
  bySku: Map<string, CompactProduct>
): Promise<{ rowsRead: number; overlaysApplied: number; erpOnlyProducts: number }> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let rowsRead = 0;
  let overlaysApplied = 0;
  let erpOnlyProducts = 0;
  for (;;) {
    let query = firestore
      .collection('products')
      .where('brandId', '==', brandId)
      .where('source', '==', MEGAVENTORY_NORMALIZED_SOURCE)
      .orderBy(FieldPath.documentId())
      .limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    rowsRead += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data();
      const sku = normalizeSku(row.sku ?? row.SKU ?? row.productSku);
      if (!sku) continue;
      const overlay = overlayFromMegaventoryProduct(row);
      if (!overlay) continue;
      const existing = bySku.get(sku);
      if (existing) {
        bySku.set(sku, applyStockOverlay(existing, overlay));
        overlaysApplied += 1;
        continue;
      }
      const product = productFromRow(doc.id, row, 'erp');
      if (!product) continue;
      bySku.set(sku, applyStockOverlay(product, overlay));
      erpOnlyProducts += 1;
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return { rowsRead, overlaysApplied, erpOnlyProducts };
}

async function loadConnectorProducts(brandId: string, hasErp: boolean): Promise<{
  products: CompactProduct[];
  sourceRowsRead: number;
  megaventoryApiRowsRead: number;
  megaventoryRowsRead: number;
  stockOverlaysApplied: number;
  erpOnlyProducts: number;
}> {
  const bySku = new Map<string, CompactProduct>();
  const megaventoryApiRowsRead = hasErp
    ? await loadCatalogCollection(brandId, 'megaventory_products', 'erp', bySku, { filterByBrandInQuery: false })
    : 0;
  const magentoRowsRead = hasErp ? 0 : await loadCatalogCollection(brandId, 'magento_products', 'connector_catalog', bySku);
  const overlay = hasErp
    ? await loadMegaventoryProductOverlay(brandId, bySku)
    : { rowsRead: 0, overlaysApplied: 0, erpOnlyProducts: 0 };
  return {
    products: [...bySku.values()],
    sourceRowsRead: megaventoryApiRowsRead + magentoRowsRead + overlay.rowsRead,
    megaventoryApiRowsRead,
    megaventoryRowsRead: overlay.rowsRead,
    stockOverlaysApplied: overlay.overlaysApplied,
    erpOnlyProducts: overlay.erpOnlyProducts,
  };
}

function summaryForProducts(products: CompactProduct[]): InventorySummaryPayload {
  const total = products.length;
  const empty: InventorySummaryPayload = {
    total_skus: total,
    total_value: 0,
    healthy_stock: { count: 0, percentage: 0 },
    excess_stock: { count: 0, percentage: 0, value: 0 },
    dead_stock: { count: 0, percentage: 0, value: 0 },
    low_stock: { count: 0, percentage: 0 },
  };
  for (const product of products) {
    const value = Math.max(0, product.stock_level * product.price);
    empty.total_value += value;
    if (product.priority_tag === 'healthy') empty.healthy_stock.count += 1;
    if (product.priority_tag === 'low') empty.low_stock.count += 1;
    if (product.priority_tag === 'dead') {
      empty.dead_stock.count += 1;
      empty.dead_stock.value += value;
    }
    if (product.priority_tag === 'excess') {
      empty.excess_stock.count += 1;
      empty.excess_stock.value += value;
    }
  }
  const pct = (count: number) => total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  empty.total_value = Math.round(empty.total_value);
  empty.healthy_stock.percentage = pct(empty.healthy_stock.count);
  empty.low_stock.percentage = pct(empty.low_stock.count);
  empty.dead_stock.percentage = pct(empty.dead_stock.count);
  empty.dead_stock.value = Math.round(empty.dead_stock.value);
  empty.excess_stock.percentage = pct(empty.excess_stock.count);
  empty.excess_stock.value = Math.round(empty.excess_stock.value);
  return empty;
}

function categoryCounts(products: CompactProduct[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (product.category) counts.set(product.category, (counts.get(product.category) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 250)
    .map(([name, count]) => ({ name, count }));
}

function bucketRows(products: CompactProduct[], bucket: PageBucket): CompactProduct[] {
  const rows = bucket === 'all' ? products : products.filter((product) => product.priority_tag === bucket);
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
}

async function writePageDocs(brandId: string, products: CompactProduct[]): Promise<Record<PageBucket, number>> {
  const firestore = assertDb();
  const old = await firestore.collection('product_intelligence_pages').where('brandId', '==', brandId).get();
  for (let i = 0; i < old.docs.length; i += 450) {
    const batch = firestore.batch();
    old.docs.slice(i, i + 450).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const pagesByBucket = {} as Record<PageBucket, number>;
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const bucket of BUCKETS) {
    const rows = bucketRows(products, bucket);
    pagesByBucket[bucket] = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
    for (let page = 1; page <= pagesByBucket[bucket]; page += 1) {
      writes.push({
        id: `${brandId}_${bucket}_${page}`,
        data: {
          brandId,
          bucket,
          page,
          pageSize: TABLE_PAGE_SIZE,
          totalRows: rows.length,
          products: rows.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  for (let i = 0; i < writes.length; i += PAGE_WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    writes.slice(i, i + PAGE_WRITE_BATCH_SIZE).forEach((item) => {
      batch.set(firestore.doc(`product_intelligence_pages/${item.id}`), item.data);
    });
    await batch.commit();
  }
  return pagesByBucket;
}

export async function refreshProductIntelligenceAggregate(brandId: string): Promise<Record<string, unknown>> {
  const firestore = assertDb();
  const ref = firestore.doc(`product_intelligence/${brandId}`);
  const connector = await hasConnectorCatalog(brandId);
  if (!connector.connected) {
    await ref.set({
      brandId,
      status: 'skipped',
      reason: 'no_connector_catalog',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true, skipped: true, brandId };
  }

  await ref.set({
    brandId,
    status: 'running',
    sourceLabel: connector.sourceLabel,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const [syncVersion, catalogResult] = await Promise.all([
      computeBrandSyncVersion(brandId),
      loadConnectorProducts(brandId, connector.hasErp),
    ]);
    const { products, sourceRowsRead, megaventoryApiRowsRead, megaventoryRowsRead, stockOverlaysApplied, erpOnlyProducts } = catalogResult;
    const summary = summaryForProducts(products);
    const pagesByBucket = await writePageDocs(brandId, products);
    const payload = {
      brandId,
      status: 'ready',
      sourceLabel: connector.sourceLabel,
      sourceKind: 'erp',
      totalCount: products.length,
      syncVersion: syncVersion.version,
      latestSyncAt: syncVersion.latestSyncAt,
      sourceRowsRead,
      megaventoryApiRowsRead,
      megaventoryRowsRead,
      stockOverlaysApplied,
      erpOnlyProducts,
      stockSource: 'megaventory',
      pageSize: TABLE_PAGE_SIZE,
      pagesByBucket,
      categories: categoryCounts(products),
      summary,
      computedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    };
    await ref.set(payload, { merge: true });
    return { success: true, brandId, totalCount: products.length, megaventoryApiRowsRead, megaventoryRowsRead, stockOverlaysApplied, erpOnlyProducts, pagesByBucket };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[ProductIntelligence] failed brand=${brandId}: ${message}`);
    await ref.set({
      brandId,
      status: 'failed',
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

