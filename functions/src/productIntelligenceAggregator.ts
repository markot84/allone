import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let db: Firestore;

export function setDb(firestore: Firestore): void {
  db = firestore;
}

type ProductSourceKind = 'erp' | 'connector_catalog';
type StockBucket = 'healthy' | 'excess' | 'dead' | 'low' | 'no_stock';

type CompactProduct = {
  id: string;
  productId?: string;
  sku: string;
  name: string;
  category: string;
  subcategory?: string;
  margin_tier: 'high' | 'medium' | 'low';
  margin_percentage: number;
  stock_level: number;
  stock_capacity: number;
  stock_on_hand?: number;
  available_stock?: number;
  priority_tag: StockBucket;
  price: number;
  cost_price?: number;
  list_price?: number;
  qty_sold_period?: number;
  qty_sold_lifetime?: number;
  last_sale_at?: string;
  first_available_date?: string;
  supplier?: string;
  brand?: string;
  barcode?: string;
  procurement_status?: string;
  abc_class?: string;
  flow_group?: string;
  seasonality_tag?: string;
  reorder_point?: number;
  reorder_qty?: number;
  source?: string;
  createdAt?: string;
};

type StockOverlay = {
  stock_level: number;
  stock_capacity: number;
  stock_on_hand?: number;
  available_stock?: number;
  priority_tag: StockBucket;
  price?: number;
  cost_price?: number;
  list_price?: number;
  margin_percentage?: number;
  margin_tier?: 'high' | 'medium' | 'low';
  qty_sold_period?: number;
  qty_sold_lifetime?: number;
  last_sale_at?: string;
  first_available_date?: string;
  category?: string;
  supplier?: string;
  brand?: string;
  barcode?: string;
  procurement_status?: string;
  abc_class?: string;
  flow_group?: string;
  seasonality_tag?: string;
  reorder_point?: number;
  reorder_qty?: number;
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
type SortField = 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
type SortDirection = 'asc' | 'desc';

export type ProductIntelligenceQueryParams = {
  brandId: string;
  page?: number;
  pageSize?: number;
  bucket?: PageBucket;
  search?: string;
  categories?: string[];
  tags?: string[];
  margin?: 'all' | 'high' | 'medium' | 'low';
  stockAge?: 'all' | 'dead' | 'near-dead' | 'high-margin-low-stock';
  sortField?: SortField;
  sortDirection?: SortDirection;
  dateFrom?: string;
  dateTo?: string;
  dateMode?: 'imported' | 'first_available';
  includeNoStock?: boolean;
};

type ProductIntelligenceQueryResult = {
  brandId: string;
  status: 'ready';
  sourceLabel: string;
  sourceKind: ProductSourceKind;
  totalCount: number;
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  bucket: PageBucket;
  products: CompactProduct[];
};

const READ_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 150;
const PAGE_WRITE_BATCH_SIZE = 1;
const INVENTORY_LOOKUP_CHUNK_BYTES = 850_000;
const BUCKETS: PageBucket[] = ['all', 'healthy', 'excess', 'dead', 'low', 'no_stock'];
const SALES_PERIOD_DAYS = 30;
const MEGAVENTORY_NORMALIZED_SOURCE = 'megaventory_custom_report';

type SkuStatsRow = {
  stock?: number;
  sold?: number;
  sold7d?: number;
  sold30d?: number;
  sold90d?: number;
  lastSaleAt?: string | null;
};

type CompetitiveInventoryRow = {
  stock: number;
  sold: number;
};

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

function isNonMerchandiseProduct(row: Pick<CompactProduct, 'name' | 'sku'>): boolean {
  const sku = row.sku.toLowerCase();
  const name = row.name.toLowerCase();
  return sku === 'discount' || sku.includes('shipping') || name.includes('shipping πωλήσεων');
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

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const n = num(value);
    if (n > 0) return n;
  }
  return 0;
}

function optionalNumber(value: unknown): number | undefined {
  const n = num(value);
  return n > 0 ? Math.round(n * 100) / 100 : undefined;
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
  if (stockLevel <= 0) return 'no_stock';
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
  const sku = text(row.sku ?? row.SKU ?? row.productSku ?? row.ProductSKU ?? row.model ?? row.Model);
  if (!sku) return null;
  const path = categoryPathFromRow(row);
  const category = text(row.category ?? row.category_name ?? path[0]) || 'Uncategorized';
  const price =
    firstPositive(row.price, row.sell_price, row.sellingPrice, row.specialPrice, row.list_price, row.compare_at_price, row.regularPrice);
  const cost = firstPositive(row.cost_price, row.costPrice, row.purchasePrice, row.cost);
  const stock =
    firstPositive(row.stock_level, row.available_stock, row.stock_on_hand, row.stockOnHand, row.qty, row.quantity);
  const qtySold =
    firstPositive(row.qty_sold_period, row.qtySoldPeriod, row.qty_sold_last_30d, row.qtySold, row.qty_sold_lifetime);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, qtySold);
  const product: CompactProduct = {
    id: docId,
    ...(text(row.productId ?? row.ProductID ?? row.ProductId) ? { productId: text(row.productId ?? row.ProductID ?? row.ProductId) } : {}),
    sku,
    name: text(row.name ?? row.title ?? row.productName ?? row.ProductDescription) || sku,
    category,
    ...(path[1] ? { subcategory: path[1] } : {}),
    margin_tier: marginTier(margin),
    margin_percentage: Math.round(margin * 10) / 10,
    stock_level: Math.round(stock * 100) / 100,
    stock_capacity: Math.max(Math.round(stock * 2 * 100) / 100, Math.round(stock * 100) / 100, 1),
    ...(optionalNumber(row.stock_on_hand ?? row.stockOnHand) != null ? { stock_on_hand: optionalNumber(row.stock_on_hand ?? row.stockOnHand) } : {}),
    ...(optionalNumber(row.available_stock) != null ? { available_stock: optionalNumber(row.available_stock) } : {}),
    priority_tag: bucket,
    price: Math.round(price * 100) / 100,
    ...(cost > 0 ? { cost_price: Math.round(cost * 100) / 100 } : {}),
    ...(optionalNumber(row.list_price ?? row.compare_at_price) != null ? { list_price: optionalNumber(row.list_price ?? row.compare_at_price) } : {}),
    ...(qtySold > 0 ? { qty_sold_period: Math.round(qtySold * 100) / 100 } : {}),
    ...(optionalNumber(row.qty_sold_lifetime) != null ? { qty_sold_lifetime: optionalNumber(row.qty_sold_lifetime) } : {}),
    ...(asIsoDate(row.last_sale_at ?? row.lastSaleAt) ? { last_sale_at: asIsoDate(row.last_sale_at ?? row.lastSaleAt) } : {}),
    ...(asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) ? { first_available_date: asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) } : {}),
    ...(text(row.supplier) ? { supplier: text(row.supplier) } : {}),
    ...(text(row.brand) ? { brand: text(row.brand) } : {}),
    ...(text(row.barcode ?? row.gtin) ? { barcode: text(row.barcode ?? row.gtin) } : {}),
    ...(text(row.procurement_status ?? row.status) ? { procurement_status: text(row.procurement_status ?? row.status) } : {}),
    ...(text(row.abc_class) ? { abc_class: text(row.abc_class) } : {}),
    ...(text(row.flow_group) ? { flow_group: text(row.flow_group) } : {}),
    ...(text(row.seasonality_tag) ? { seasonality_tag: text(row.seasonality_tag) } : {}),
    ...(optionalNumber(row.reorder_point) != null ? { reorder_point: optionalNumber(row.reorder_point) } : {}),
    ...(optionalNumber(row.reorder_qty) != null ? { reorder_qty: optionalNumber(row.reorder_qty) } : {}),
    ...(asIsoDate(row.createdAt ?? row.updatedAt) ? { createdAt: asIsoDate(row.createdAt ?? row.updatedAt) } : {}),
    source: sourceKind,
  };
  return isDemoProduct(product) || isNonMerchandiseProduct(product) ? null : product;
}

function overlayFromMegaventoryProduct(row: Record<string, unknown>): StockOverlay | null {
  const stock =
    firstPositive(row.stock_level, row.available_stock, row.stock_on_hand, row.stockOnHand, row.qty, row.quantity);
  const qtySold =
    firstPositive(row.qty_sold_period, row.qtySoldPeriod, row.qty_sold_last_30d, row.qty_sold_lifetime, row.qtySold);
  const price = firstPositive(row.price, row.sell_price, row.list_price, row.sellingPrice);
  const cost = firstPositive(row.cost_price, row.costPrice, row.purchasePrice);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, qtySold);
  return {
    stock_level: Math.round(stock * 100) / 100,
    stock_capacity: Math.max(Math.round(stock * 2 * 100) / 100, Math.round(stock * 100) / 100, 1),
    ...(optionalNumber(row.stock_on_hand ?? row.stockOnHand) != null ? { stock_on_hand: optionalNumber(row.stock_on_hand ?? row.stockOnHand) } : {}),
    ...(optionalNumber(row.available_stock) != null ? { available_stock: optionalNumber(row.available_stock) } : {}),
    priority_tag: bucket,
    ...(price > 0 ? { price: Math.round(price * 100) / 100 } : {}),
    ...(cost > 0 ? { cost_price: Math.round(cost * 100) / 100 } : {}),
    ...(optionalNumber(row.list_price) != null ? { list_price: optionalNumber(row.list_price) } : {}),
    ...(margin > 0 ? { margin_percentage: Math.round(margin * 10) / 10, margin_tier: marginTier(margin) } : {}),
    ...(qtySold > 0 ? { qty_sold_period: Math.round(qtySold * 100) / 100 } : {}),
    ...(optionalNumber(row.qty_sold_lifetime) != null ? { qty_sold_lifetime: optionalNumber(row.qty_sold_lifetime) } : {}),
    ...(asIsoDate(row.last_sale_at ?? row.lastSaleAt) ? { last_sale_at: asIsoDate(row.last_sale_at ?? row.lastSaleAt) } : {}),
    ...(asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) ? { first_available_date: asIsoDate(row.first_available_date ?? row.firstAvailableDate ?? row.createdAt) } : {}),
    ...(text(row.category ?? row.category_name) ? { category: text(row.category ?? row.category_name) } : {}),
    ...(text(row.supplier) ? { supplier: text(row.supplier) } : {}),
    ...(text(row.brand) ? { brand: text(row.brand) } : {}),
    ...(text(row.barcode ?? row.gtin) ? { barcode: text(row.barcode ?? row.gtin) } : {}),
    ...(text(row.procurement_status ?? row.status) ? { procurement_status: text(row.procurement_status ?? row.status) } : {}),
    ...(text(row.abc_class) ? { abc_class: text(row.abc_class) } : {}),
    ...(text(row.flow_group) ? { flow_group: text(row.flow_group) } : {}),
    ...(text(row.seasonality_tag) ? { seasonality_tag: text(row.seasonality_tag) } : {}),
    ...(optionalNumber(row.reorder_point) != null ? { reorder_point: optionalNumber(row.reorder_point) } : {}),
    ...(optionalNumber(row.reorder_qty) != null ? { reorder_qty: optionalNumber(row.reorder_qty) } : {}),
    source: 'erp',
  };
}

function applyStockOverlay(product: CompactProduct, overlay: StockOverlay): CompactProduct {
  const finalQtySold = overlay.qty_sold_period ?? product.qty_sold_period ?? 0;
  const next: CompactProduct = {
    ...product,
    stock_level: overlay.stock_level,
    stock_capacity: overlay.stock_capacity,
    priority_tag: stockBucket(overlay.stock_level, finalQtySold),
    source: 'erp',
  };
  if (overlay.price != null) next.price = overlay.price;
  if (overlay.cost_price != null) next.cost_price = overlay.cost_price;
  if (overlay.list_price != null) next.list_price = overlay.list_price;
  if (overlay.margin_percentage != null) next.margin_percentage = overlay.margin_percentage;
  if (overlay.margin_tier) next.margin_tier = overlay.margin_tier;
  if (overlay.qty_sold_period != null) next.qty_sold_period = overlay.qty_sold_period;
  if (overlay.qty_sold_lifetime != null) next.qty_sold_lifetime = overlay.qty_sold_lifetime;
  if (overlay.stock_on_hand != null) next.stock_on_hand = overlay.stock_on_hand;
  if (overlay.available_stock != null) next.available_stock = overlay.available_stock;
  if (overlay.last_sale_at) next.last_sale_at = overlay.last_sale_at;
  if (overlay.first_available_date) next.first_available_date = overlay.first_available_date;
  if (overlay.category && (!next.category || next.category === 'Uncategorized')) next.category = overlay.category;
  if (overlay.supplier) next.supplier = overlay.supplier;
  if (overlay.brand) next.brand = overlay.brand;
  if (overlay.barcode) next.barcode = overlay.barcode;
  if (overlay.procurement_status) next.procurement_status = overlay.procurement_status;
  if (overlay.abc_class) next.abc_class = overlay.abc_class;
  if (overlay.flow_group) next.flow_group = overlay.flow_group;
  if (overlay.seasonality_tag) next.seasonality_tag = overlay.seasonality_tag;
  if (overlay.reorder_point != null) next.reorder_point = overlay.reorder_point;
  if (overlay.reorder_qty != null) next.reorder_qty = overlay.reorder_qty;
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

async function overlayMagentoCatalogDetails(brandId: string, bySku: Map<string, CompactProduct>): Promise<number> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let read = 0;
  for (;;) {
    let query = firestore
      .collection('magento_products')
      .where('brandId', '==', brandId)
      .orderBy(FieldPath.documentId())
      .limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    read += snap.size;
    for (const doc of snap.docs) {
      const detail = productFromRow(doc.id, doc.data(), 'connector_catalog');
      if (!detail) continue;
      const key = normalizeSku(detail.sku);
      const existing = bySku.get(key);
      if (!existing) continue;
      bySku.set(key, {
        ...existing,
        name: existing.name && existing.name !== existing.sku ? existing.name : detail.name,
        category: existing.category && existing.category !== 'Uncategorized' ? existing.category : detail.category,
        ...(existing.subcategory ? {} : detail.subcategory ? { subcategory: detail.subcategory } : {}),
        ...(existing.barcode ? {} : detail.barcode ? { barcode: detail.barcode } : {}),
      });
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return read;
}

async function loadMegaventoryStockByProductId(brandId: string): Promise<{ rowsRead: number; byProductId: Map<string, { available: number; physical: number }> }> {
  const firestore = assertDb();
  const byProductId = new Map<string, { available: number; physical: number }>();
  let cursor: QueryDocumentSnapshot | null = null;
  let rowsRead = 0;
  for (;;) {
    let query = firestore
      .collection('megaventory_stock')
      .where('brandId', '==', brandId)
      .orderBy(FieldPath.documentId())
      .limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    rowsRead += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data();
      const productId = text(row.productId ?? row.ProductID ?? row.ProductId);
      if (!productId) continue;
      const current = byProductId.get(productId) ?? { available: 0, physical: 0 };
      current.available += num(row.availableStock ?? row.productAvailableStockQty ?? row.ProductAvailableStockQty);
      current.physical += num(row.physicalStock ?? row.productPhysicalStockQty ?? row.ProductPhysicalStockQty);
      byProductId.set(productId, current);
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return { rowsRead, byProductId };
}

function applyMegaventoryStockOverlay(products: Map<string, CompactProduct>, stockByProductId: Map<string, { available: number; physical: number }>): number {
  let applied = 0;
  for (const [sku, product] of products.entries()) {
    if (!product.productId) continue;
    const stock = stockByProductId.get(product.productId);
    if (!stock) continue;
    const stockLevel = stock.available > 0 ? stock.available : stock.physical;
    const qtySold = product.qty_sold_period ?? 0;
    products.set(sku, {
      ...product,
      stock_level: Math.round(stockLevel * 100) / 100,
      stock_on_hand: Math.round(stock.physical * 100) / 100,
      available_stock: Math.round(stock.available * 100) / 100,
      stock_capacity: Math.max(Math.round(stockLevel * 2 * 100) / 100, Math.round(stockLevel * 100) / 100, 1),
      priority_tag: stockBucket(stockLevel, qtySold),
    });
    applied += 1;
  }
  return applied;
}

async function loadSkuStats(brandId: string): Promise<{ rowsRead: number; bySku: Map<string, SkuStatsRow> }> {
  const firestore = assertDb();
  const bySku = new Map<string, SkuStatsRow>();
  const parent = await firestore.doc(`sku_stats/${brandId}`).get().catch(() => null);
  const chunkCount = num(parent?.data()?.chunkCount);
  if (!parent?.exists || chunkCount <= 0) return { rowsRead: 0, bySku };
  const snap = await firestore.collection(`sku_stats/${brandId}/chunks`).orderBy(FieldPath.documentId()).get();
  for (const doc of snap.docs) {
    const raw = text(doc.data().skuStatsJson);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, SkuStatsRow>;
      for (const [sku, stats] of Object.entries(parsed)) {
        bySku.set(normalizeSku(sku), stats);
      }
    } catch (error) {
      logger.warn(`[ProductIntelligence] bad sku_stats chunk for ${brandId}/${doc.id}:`, error);
    }
  }
  return { rowsRead: snap.size, bySku };
}

function applySkuStatsOverlay(products: Map<string, CompactProduct>, statsBySku: Map<string, SkuStatsRow>): number {
  let applied = 0;
  for (const [sku, product] of products.entries()) {
    const stats = statsBySku.get(sku);
    if (!stats) continue;
    const sold30 = num(stats.sold30d);
    const sold90 = num(stats.sold90d);
    const qtySoldPeriod = sold30 > 0 ? sold30 : sold90 > 0 ? sold90 / 3 : 0;
    products.set(sku, {
      ...product,
      ...(qtySoldPeriod > 0 ? { qty_sold_period: Math.round(qtySoldPeriod * 100) / 100 } : {}),
      ...(num(stats.sold) > 0 ? { qty_sold_lifetime: Math.round(num(stats.sold) * 100) / 100 } : {}),
      ...(stats.lastSaleAt ? { last_sale_at: stats.lastSaleAt } : {}),
      priority_tag: stockBucket(product.stock_level, qtySoldPeriod),
    });
    applied += 1;
  }
  return applied;
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
  megaventoryStockRowsRead: number;
  megaventoryRowsRead: number;
  magentoDetailRowsRead: number;
  skuStatsRowsRead: number;
  stockByLocationApplied: number;
  skuStatsApplied: number;
  stockOverlaysApplied: number;
  erpOnlyProducts: number;
}> {
  const bySku = new Map<string, CompactProduct>();
  const megaventoryApiRowsRead = hasErp
    ? await loadCatalogCollection(brandId, 'megaventory_products', 'erp', bySku, { filterByBrandInQuery: false })
    : 0;
  const ecommerceCatalogRowsRead = hasErp
    ? 0
    : (await Promise.all([
        loadCatalogCollection(brandId, 'magento_products', 'connector_catalog', bySku),
        loadCatalogCollection(brandId, 'shopify_products', 'connector_catalog', bySku),
        loadCatalogCollection(brandId, 'woo_products', 'connector_catalog', bySku),
        loadCatalogCollection(brandId, 'opencart_products', 'connector_catalog', bySku),
      ])).reduce((sum, rowsRead) => sum + rowsRead, 0);
  const magentoDetailRowsRead = hasErp ? await overlayMagentoCatalogDetails(brandId, bySku) : 0;
  const stockResult = hasErp
    ? await loadMegaventoryStockByProductId(brandId)
    : { rowsRead: 0, byProductId: new Map<string, { available: number; physical: number }>() };
  const stockByLocationApplied = hasErp ? applyMegaventoryStockOverlay(bySku, stockResult.byProductId) : 0;
  const skuStats = await loadSkuStats(brandId);
  const skuStatsApplied = applySkuStatsOverlay(bySku, skuStats.bySku);
  const overlay = hasErp
    ? await loadMegaventoryProductOverlay(brandId, bySku)
    : { rowsRead: 0, overlaysApplied: 0, erpOnlyProducts: 0 };
  return {
    products: [...bySku.values()].filter((product) => !isDemoProduct(product) && !isNonMerchandiseProduct(product)),
    sourceRowsRead: megaventoryApiRowsRead + ecommerceCatalogRowsRead + magentoDetailRowsRead + stockResult.rowsRead + skuStats.rowsRead + overlay.rowsRead,
    megaventoryApiRowsRead,
    megaventoryStockRowsRead: stockResult.rowsRead,
    megaventoryRowsRead: overlay.rowsRead,
    magentoDetailRowsRead,
    skuStatsRowsRead: skuStats.rowsRead,
    stockByLocationApplied,
    skuStatsApplied,
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

function daysOfStock(product: CompactProduct): number {
  const stock = product.available_stock ?? product.stock_on_hand ?? product.stock_level ?? 0;
  if (stock <= 0) return 0;
  const sold = product.qty_sold_period ?? 0;
  if (sold <= 0) return Number.POSITIVE_INFINITY;
  return stock / (sold / SALES_PERIOD_DAYS);
}

function daysFromIso(value: string | undefined): number {
  if (!value) return -1;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return -1;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function ymd(value: string | undefined): string | null {
  if (!value) return null;
  const raw = text(value);
  if (!raw) return null;
  const numeric = parseFloat(raw);
  const d = !Number.isNaN(numeric) && numeric > 0
    ? new Date((numeric - 25569) * 86400 * 1000)
    : new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function categoryId(product: CompactProduct): string {
  return text(product.category) || '__EMPTY_CAT__';
}

function searchText(product: CompactProduct): string {
  return [
    product.sku,
    product.name,
    product.category,
    product.subcategory,
    product.supplier,
    product.brand,
    product.barcode,
    product.procurement_status,
    product.abc_class,
    product.flow_group,
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesQuery(product: CompactProduct, params: ProductIntelligenceQueryParams): boolean {
  const search = text(params.search).toLowerCase();
  if (search && !searchText(product).includes(search)) return false;

  const effectiveStock = product.available_stock ?? product.stock_on_hand ?? product.stock_level ?? 0;
  const effectiveTag = effectiveStock <= 0 ? 'no_stock' : text(product.priority_tag).toLowerCase();
  if (params.includeNoStock !== true && effectiveStock <= 0) return false;

  if (params.categories?.length) {
    const allowed = new Set(params.categories);
    if (!allowed.has(categoryId(product))) return false;
  }

  if (params.tags?.length) {
    const allowed = new Set(params.tags.map((tag) => tag.toLowerCase()));
    if (!allowed.has(effectiveTag)) return false;
  }

  if (params.margin && params.margin !== 'all' && product.margin_tier !== params.margin) return false;

  const stockAge = params.stockAge ?? 'all';
  if (stockAge === 'dead' && product.priority_tag !== 'dead') return false;
  if (stockAge === 'near-dead' && (product.priority_tag !== 'excess' || daysOfStock(product) === Number.POSITIVE_INFINITY)) return false;
  if (stockAge === 'high-margin-low-stock') {
    const highMargin = product.margin_tier === 'high' || (product.margin_percentage ?? 0) > 25;
    if (!highMargin || product.priority_tag !== 'low') return false;
  }

  if (params.dateFrom && params.dateTo) {
    const dateValue = params.dateMode === 'first_available'
      ? ymd(product.first_available_date)
      : ymd(product.createdAt);
    if (!dateValue || dateValue < params.dateFrom || dateValue > params.dateTo) return false;
  }

  return true;
}

function sortProducts(products: CompactProduct[], sortField: SortField, sortDirection: SortDirection): CompactProduct[] {
  const dir = sortDirection === 'asc' ? 1 : -1;
  const value = (product: CompactProduct): string | number => {
    if (sortField === 'stock_age_days') {
      const dos = daysOfStock(product);
      return dos === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : dos;
    }
    return product[sortField] ?? (sortField === 'name' ? '' : 0);
  };
  return [...products].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv), 'el') * dir || a.sku.localeCompare(b.sku, 'el');
    }
    return ((av as number) - (bv as number)) * dir || a.sku.localeCompare(b.sku, 'el');
  });
}

function chartDataForProducts(products: CompactProduct[]) {
  const marginDistribution = [
    { name: '0-10%', min: 0, max: 10, count: 0 },
    { name: '10-20%', min: 10, max: 20, count: 0 },
    { name: '20-30%', min: 20, max: 30, count: 0 },
    { name: '30-40%', min: 30, max: 40, count: 0 },
    { name: '40-50%', min: 40, max: 50, count: 0 },
    { name: '50%+', min: 50, max: Number.POSITIVE_INFINITY, count: 0 },
  ];
  const stockAgeDistribution = [
    { name: '0-30d', min: 0, max: 30, count: 0 },
    { name: '30-60d', min: 30, max: 60, count: 0 },
    { name: '60-90d', min: 60, max: 90, count: 0 },
    { name: '90-120d', min: 90, max: 120, count: 0 },
    { name: '120-180d', min: 120, max: 180, count: 0 },
    { name: '180d+', min: 180, max: Number.POSITIVE_INFINITY, count: 0 },
  ];
  const stockStatus: Record<StockBucket, number> = { healthy: 0, low: 0, excess: 0, dead: 0, no_stock: 0 };
  for (const product of products) {
    const margin = product.margin_percentage ?? 0;
    const m = marginDistribution.find((range) => margin >= range.min && margin < range.max);
    if (m) m.count += 1;
    const age = daysFromIso(product.first_available_date ?? product.createdAt);
    const a = stockAgeDistribution.find((range) => age >= range.min && age < range.max);
    if (a) a.count += 1;
    stockStatus[product.priority_tag] += 1;
  }
  return {
    marginDistribution: marginDistribution.map(({ name, count }) => ({ name, count })),
    stockAgeDistribution: stockAgeDistribution.map(({ name, count }) => ({ name, count })),
    stockStatus: [
      { name: 'Φυσιολογικό απόθεμα', value: stockStatus.healthy, color: '#22C55E' },
      { name: 'Χαμηλό απόθεμα', value: stockStatus.low, color: '#8B5CF6' },
      { name: 'Υπερβολικό απόθεμα', value: stockStatus.excess, color: '#F59E0B' },
      { name: 'Νεκρό απόθεμα', value: stockStatus.dead, color: '#EF4444' },
      { name: 'No stock', value: stockStatus.no_stock, color: '#94A3B8' },
    ],
    categoryBreakdown: categoryCounts(products).slice(0, 10),
    topProductsByMargin: [...products]
      .sort((a, b) => (b.margin_percentage ?? 0) - (a.margin_percentage ?? 0))
      .slice(0, 10)
      .map((product) => ({
        name: (product.name || product.sku || 'Unknown').substring(0, 20),
        margin: product.margin_percentage || 0,
        price: product.price || 0,
      })),
    stockAgeVsLevel: [...products]
      .filter((product) => (product.stock_level || 0) > 0 && daysFromIso(product.first_available_date ?? product.createdAt) >= 0)
      .sort((a, b) => daysFromIso(a.first_available_date ?? a.createdAt) - daysFromIso(b.first_available_date ?? b.createdAt))
      .slice(0, 100)
      .map((product) => ({
        age: daysFromIso(product.first_available_date ?? product.createdAt),
        level: product.stock_level || 0,
        margin: product.margin_percentage || 0,
      })),
  };
}

function bucketRows(products: CompactProduct[], bucket: PageBucket): CompactProduct[] {
  const rows = bucket === 'all' ? products : products.filter((product) => product.priority_tag === bucket);
  return [...rows].sort((a, b) => {
    if (bucket === 'all') {
      const stockA = a.available_stock ?? a.stock_on_hand ?? a.stock_level ?? 0;
      const stockB = b.available_stock ?? b.stock_on_hand ?? b.stock_level ?? 0;
      if (stockA !== stockB) return stockB - stockA;
      const soldA = a.qty_sold_period ?? a.qty_sold_lifetime ?? 0;
      const soldB = b.qty_sold_period ?? b.qty_sold_lifetime ?? 0;
      if (soldA !== soldB) return soldB - soldA;
    }
    return a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku);
  });
}

async function writePageDocs(brandId: string, products: CompactProduct[]): Promise<Record<PageBucket, number>> {
  const firestore = assertDb();
  const old = await firestore.collection('product_intelligence_pages').where('brandId', '==', brandId).get();
  for (let i = 0; i < old.docs.length; i += PAGE_WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    old.docs.slice(i, i + PAGE_WRITE_BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
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

async function loadBucketProductsFromPages(brandId: string, bucket: PageBucket, pageCount: number): Promise<CompactProduct[]> {
  const firestore = assertDb();
  const products: CompactProduct[] = [];
  const refs = Array.from({ length: pageCount }, (_, i) => firestore.doc(`product_intelligence_pages/${brandId}_${bucket}_${i + 1}`));
  const chunkSize = 250;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const snaps = await firestore.getAll(...refs.slice(i, i + chunkSize));
    for (const snap of snaps) {
      const rows = snap.exists ? (snap.data()?.products as CompactProduct[] | undefined) : undefined;
      if (Array.isArray(rows)) products.push(...rows);
    }
  }
  return products;
}

export async function queryProductIntelligenceRows(params: ProductIntelligenceQueryParams): Promise<ProductIntelligenceQueryResult> {
  const firestore = assertDb();
  const aggregateSnap = await firestore.doc(`product_intelligence/${params.brandId}`).get();
  const aggregate = aggregateSnap.data() as {
    status?: string;
    sourceLabel?: string;
    sourceKind?: ProductSourceKind;
    totalCount?: number;
    pagesByBucket?: Record<PageBucket, number>;
  } | undefined;
  if (!aggregateSnap.exists || aggregate?.status !== 'ready') {
    throw new Error('Product Intelligence aggregate is not ready');
  }

  const bucket = params.bucket ?? 'all';
  const pageSize = Math.max(1, Math.min(params.pageSize ?? TABLE_PAGE_SIZE, TABLE_PAGE_SIZE));
  const requestedPage = Math.max(1, Math.floor(params.page ?? 1));
  const pageCount = Math.max(1, aggregate.pagesByBucket?.[bucket] ?? 1);
  const rows = await loadBucketProductsFromPages(params.brandId, bucket, pageCount);
  const filtered = rows.filter((product) => matchesQuery(product, params));
  const sorted = sortProducts(
    filtered,
    params.sortField ?? 'margin_percentage',
    params.sortDirection ?? 'desc',
  );
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;

  return {
    brandId: params.brandId,
    status: 'ready',
    sourceLabel: aggregate.sourceLabel ?? 'ERP',
    sourceKind: aggregate.sourceKind ?? 'erp',
    totalCount: aggregate.totalCount ?? rows.length,
    totalRows,
    page,
    pageSize,
    totalPages,
    bucket,
    products: sorted.slice(start, start + pageSize),
  };
}

function competitiveInventoryForProducts(products: CompactProduct[]): Record<string, CompetitiveInventoryRow> {
  const rows: Record<string, CompetitiveInventoryRow> = {};
  const add = (key: string, product: CompactProduct) => {
    const normalized = normalizeSku(key);
    if (!normalized) return;
    const stock = Math.round((product.available_stock ?? product.stock_on_hand ?? product.stock_level ?? 0) * 100) / 100;
    const sold = Math.round((product.qty_sold_period ?? product.qty_sold_lifetime ?? 0) * 100) / 100;
    if (stock <= 0 && sold <= 0) return;
    const previous = rows[normalized];
    rows[normalized] = {
      stock: Math.max(previous?.stock ?? 0, stock),
      sold: Math.max(previous?.sold ?? 0, sold),
    };
  };
  for (const product of products) {
    add(product.sku, product);
    if (product.barcode) add(product.barcode, product);
  }
  return rows;
}

async function writeCompetitiveInventoryLookup(brandId: string, products: CompactProduct[]): Promise<{ chunks: number; keys: number }> {
  const firestore = assertDb();
  const rows = competitiveInventoryForProducts(products);
  const keys = Object.keys(rows).sort();
  const parent = firestore.doc(`product_intelligence_inventory/${brandId}`);
  const old = await parent.collection('chunks').get();
  for (const doc of old.docs) {
    await doc.ref.delete();
  }

  const chunks: Record<string, CompetitiveInventoryRow>[] = [];
  let bucket: Record<string, CompetitiveInventoryRow> = {};
  let bucketBytes = 2;
  for (const key of keys) {
    const entryJson = JSON.stringify({ [key]: rows[key] });
    const entryBytes = entryJson.length - 2;
    if (bucketBytes + entryBytes > INVENTORY_LOOKUP_CHUNK_BYTES && Object.keys(bucket).length > 0) {
      chunks.push(bucket);
      bucket = {};
      bucketBytes = 2;
    }
    bucket[key] = rows[key];
    bucketBytes += entryBytes + (Object.keys(bucket).length > 1 ? 1 : 0);
  }
  if (Object.keys(bucket).length > 0) chunks.push(bucket);

  for (let i = 0; i < chunks.length; i += 1) {
    await parent.collection('chunks').doc(String(i)).set({
      inventoryJson: JSON.stringify(chunks[i]),
      keyCount: Object.keys(chunks[i]).length,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await parent.set({
    brandId,
    chunkCount: chunks.length,
    keyCount: keys.length,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { chunks: chunks.length, keys: keys.length };
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
    const {
      products,
      sourceRowsRead,
      megaventoryApiRowsRead,
      megaventoryStockRowsRead,
      megaventoryRowsRead,
      magentoDetailRowsRead,
      skuStatsRowsRead,
      stockByLocationApplied,
      skuStatsApplied,
      stockOverlaysApplied,
      erpOnlyProducts,
    } = catalogResult;
    const summary = summaryForProducts(products);
    const pagesByBucket = await writePageDocs(brandId, products);
    const competitiveInventory = await writeCompetitiveInventoryLookup(brandId, products);
    const charts = chartDataForProducts(products);
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
      megaventoryStockRowsRead,
      megaventoryRowsRead,
      magentoDetailRowsRead,
      skuStatsRowsRead,
      stockByLocationApplied,
      skuStatsApplied,
      competitiveInventoryKeys: competitiveInventory.keys,
      competitiveInventoryChunks: competitiveInventory.chunks,
      stockOverlaysApplied,
      erpOnlyProducts,
      stockSource: 'megaventory',
      pageSize: TABLE_PAGE_SIZE,
      pagesByBucket,
      categories: categoryCounts(products),
      charts,
      summary,
      computedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    };
    await ref.set(payload, { merge: true });
    return {
      success: true,
      brandId,
      totalCount: products.length,
      megaventoryApiRowsRead,
      megaventoryStockRowsRead,
      megaventoryRowsRead,
      magentoDetailRowsRead,
      skuStatsRowsRead,
      stockByLocationApplied,
      skuStatsApplied,
      competitiveInventoryKeys: competitiveInventory.keys,
      competitiveInventoryChunks: competitiveInventory.chunks,
      stockOverlaysApplied,
      erpOnlyProducts,
      pagesByBucket,
    };
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

export async function refreshCompetitiveInventoryLookup(brandId: string): Promise<Record<string, unknown>> {
  const connector = await hasConnectorCatalog(brandId);
  if (!connector.connected) {
    return { brandId, status: 'skipped', reason: 'no_connector_catalog' };
  }
  const catalogResult = await loadConnectorProducts(brandId, connector.hasErp);
  const competitiveInventory = await writeCompetitiveInventoryLookup(brandId, catalogResult.products);
  return {
    brandId,
    status: 'ready',
    products: catalogResult.products.length,
    sourceRowsRead: catalogResult.sourceRowsRead,
    megaventoryApiRowsRead: catalogResult.megaventoryApiRowsRead,
    megaventoryStockRowsRead: catalogResult.megaventoryStockRowsRead,
    skuStatsRowsRead: catalogResult.skuStatsRowsRead,
    stockByLocationApplied: catalogResult.stockByLocationApplied,
    skuStatsApplied: catalogResult.skuStatsApplied,
    competitiveInventoryKeys: competitiveInventory.keys,
    competitiveInventoryChunks: competitiveInventory.chunks,
  };
}

