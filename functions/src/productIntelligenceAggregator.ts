import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { computeProcurementSignals } from './procurementSignals';
import { buildIsNonStocked, readNonMerchandise } from './nonMerchandise';

let db: Firestore;

export function setDb(firestore: Firestore): void {
  db = firestore;
}

type ProductSourceKind = 'erp' | 'connector_catalog' | 'manual';
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
  /** Declared parent (Magento itemGroupId) — real relations only, never heuristics. */
  parent_sku?: string;
  /** The Magento configurable's own name — the grouped row's title. */
  parent_name?: string;
  /** Sibling rows sharing parent_sku (incl. this one). */
  variant_count?: number;
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
  brands?: string[];
  tags?: string[];
  margin?: 'all' | 'high' | 'medium' | 'low';
  stockAge?: 'all' | 'dead' | 'near-dead' | 'high-margin-low-stock';
  sortField?: SortField;
  sortDirection?: SortDirection;
  dateFrom?: string;
  dateTo?: string;
  dateMode?: 'imported' | 'first_available';
  includeNoStock?: boolean;
  /** Collapse variants sharing a declared parent_sku into one row per parent. */
  groupByParent?: boolean;
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
  /** Summary over the full filtered set (not just the page) so cards can follow active filters (PER-178). */
  summary?: InventorySummaryPayload;
  /** PER-188: actionable dropdown options (own dimension omitted → Excel semantics). */
  facets?: QueryFacets;
};

type QueryFacets = {
  categories: Array<{ id: string; count: number }>;
  brands: Array<{ id: string; count: number }>;
  tags: Array<{ id: string; count: number }>;
};

const READ_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 150;
const PAGE_WRITE_BATCH_SIZE = 1;
const INVENTORY_LOOKUP_CHUNK_BYTES = 850_000;
const BUCKETS: PageBucket[] = ['all', 'healthy', 'excess', 'dead', 'low', 'no_stock'];
const SALES_PERIOD_DAYS = 30;
const MEGAVENTORY_NORMALIZED_SOURCE = 'megaventory_custom_report';
const MEGAVENTORY_API_CATALOG_SOURCE = 'megaventory_api_catalog';

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

interface StockThresholds {
  velocityWindowDays: number;
  lowDaysOfCover: number;
  excessDaysOfCover: number;
  newStockGraceDays: number;
  deadStockDays: number;
}
const DEFAULT_STOCK_THRESHOLDS: StockThresholds = {
  velocityWindowDays: SALES_PERIOD_DAYS,
  lowDaysOfCover: 30,
  excessDaysOfCover: 120,
  newStockGraceDays: 60,
  deadStockDays: 60,
};
/** Platform floor for supplier lead time (days) when neither supplier nor brand default sets one. */
const DEFAULT_LEAD_DAYS = 30;

/** Per-brand thresholds for the current aggregation run; set at the top of refreshProductIntelligenceAggregate
 * (brands are processed sequentially, so a module-level value is safe) and read by stockBucket's default. */
let activeStockThresholds: StockThresholds = DEFAULT_STOCK_THRESHOLDS;

/** Per-brand supplier lead times (days) for the current run: supplier name (normalized) → lead_time,
 * plus a brand-wide fallback. Feeds the PER-276 reorder-point low threshold. */
let activeSupplierLeadByName = new Map<string, number>();
let activeDefaultLeadDays = 0;
const normSupplierName = (s?: string | null): string => (s ?? '').trim().toLowerCase();
/** Effective lead time for a product's supplier: per-supplier lead_time, else brand default, else 0. */
function leadDaysForSupplier(supplier?: string | null): number {
  const perSupplier = activeSupplierLeadByName.get(normSupplierName(supplier));
  return perSupplier != null && perSupplier > 0 ? perSupplier : activeDefaultLeadDays;
}

/** Load per-supplier lead times for a brand (suppliers collection is small — a few dozen docs). */
async function loadSupplierLeadTimes(brandId: string): Promise<Map<string, number>> {
  const firestore = assertDb();
  const map = new Map<string, number>();
  const snap = await firestore.collection('suppliers').where('brandId', '==', brandId).get().catch(() => null);
  if (!snap) return map;
  for (const doc of snap.docs) {
    const name = normSupplierName(text(doc.data().name));
    const lead = num(doc.data().lead_time);
    if (name && lead > 0) map.set(name, lead);
  }
  return map;
}

/** Resolve a brand's inventoryThresholds onto a full StockThresholds, each field defaulting when unset/invalid. */
function resolveStockThresholds(raw: unknown): StockThresholds {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pos = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    velocityWindowDays: pos(r.velocityWindowDays, DEFAULT_STOCK_THRESHOLDS.velocityWindowDays),
    lowDaysOfCover: pos(r.lowDaysOfCover, DEFAULT_STOCK_THRESHOLDS.lowDaysOfCover),
    excessDaysOfCover: pos(r.excessDaysOfCover, DEFAULT_STOCK_THRESHOLDS.excessDaysOfCover),
    newStockGraceDays: pos(r.newStockGraceDays, DEFAULT_STOCK_THRESHOLDS.newStockGraceDays),
    deadStockDays: pos(r.deadStockDays, DEFAULT_STOCK_THRESHOLDS.deadStockDays),
  };
}

function stockBucket(
  stockLevel: number,
  qtySoldPeriod: number | null,
  qtySoldLifetime: number | null = null,
  shelfAgeDays: number | null = null,
  leadDays = 0,
  t: StockThresholds = activeStockThresholds
): StockBucket {
  if (stockLevel <= 0) return 'no_stock';
  if (qtySoldPeriod != null && qtySoldPeriod > 0) {
    const daysOfStock = stockLevel / (qtySoldPeriod / t.velocityWindowDays);
    // PER-276: low = stock can't cover demand through the supplier replenishment lead time (reorder point).
    if (daysOfStock <= t.lowDaysOfCover + leadDays) return 'low';
    if (daysOfStock > t.excessDaysOfCover) return 'excess';
    return 'healthy';
  }
  // PER-310: no recent sales → 'dead' only beyond both the grace and dead-stock thresholds; no age signal → lifetime fallback.
  if (shelfAgeDays != null) return shelfAgeDays > Math.max(t.newStockGraceDays, t.deadStockDays) ? 'dead' : 'healthy';
  if (qtySoldPeriod == null) return 'healthy';
  return qtySoldLifetime != null && qtySoldLifetime > 0 ? 'dead' : 'healthy';
}

function marginTier(marginPercentage: number): CompactProduct['margin_tier'] {
  if (marginPercentage > 30) return 'high';
  if (marginPercentage > 15) return 'medium';
  return 'low';
}

function productFromRow(docId: string, row: Record<string, unknown>, sourceKind: ProductSourceKind): CompactProduct | null {
  // ERP-deleted products must not enter Product Intelligence: discontinued_at (tombstones) or
  // mvDeletedAt (raw megaventory_products, which enter bySku first) both exclude the row.
  if (row.discontinued_at || row.mvDeletedAt) return null;
  let sku = text(row.sku ?? row.SKU ?? row.productSku ?? row.ProductSKU ?? row.model ?? row.Model);
  if (!sku) sku = text(row.productId ?? row.ProductID ?? row.ProductId);
  if (!sku && docId.startsWith('oc_')) sku = docId.slice(3);
  if (!sku && docId.startsWith('mv_p_')) sku = docId.slice(5);
  if (!sku) return null;
  const path = categoryPathFromRow(row);
  const category = text(row.category ?? row.category_name ?? path[0]) || 'Uncategorized';
  const price =
    firstPositive(row.price, row.sell_price, row.sellingPrice, row.specialPrice, row.list_price, row.compare_at_price, row.regularPrice);
  const cost = firstPositive(row.cost_price, row.costPrice, row.purchasePrice, row.cost);
  const stock =
    firstPositive(
      row.stock_level,
      row.available_stock,
      row.stock_on_hand,
      row.stockOnHand,
      row.stock_on_hand_total,
      row.qty,
      row.quantity
    );
  // Period fields only (no lifetime leak into 30-day velocity); pass null when none exist so
  // stockBucket classifies by stock-presence.
  const qtySold =
    firstPositive(row.qty_sold_period, row.qtySoldPeriod, row.qty_sold_last_30d, row.qtySold);
  const hasPeriodField =
    row.qty_sold_period != null || row.qtySoldPeriod != null || row.qty_sold_last_30d != null || row.qtySold != null;
  const qtySoldLifetime = firstPositive(row.qty_sold_lifetime, row.qtySoldLifetime);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, hasPeriodField ? qtySold : null, qtySoldLifetime, null, leadDaysForSupplier(text(row.supplier)));
  const product: CompactProduct = {
    id: docId,
    ...(text(row.productId ?? row.ProductID ?? row.ProductId) ? { productId: text(row.productId ?? row.ProductID ?? row.ProductId) } : {}),
    sku,
    name: text(row.name ?? row.title ?? row.productName ?? row.ProductDescription ?? row.longDescription) || sku,
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
    ...(text(row.brand ?? row.manufacturer) ? { brand: text(row.brand ?? row.manufacturer) } : {}),
    ...(text(row.barcode ?? row.gtin) ? { barcode: text(row.barcode ?? row.gtin) } : {}),
    ...(text(row.procurement_status ?? row.status) ? { procurement_status: text(row.procurement_status ?? row.status) } : {}),
    ...(text(row.abc_class) ? { abc_class: text(row.abc_class) } : {}),
    ...(text(row.flow_group) ? { flow_group: text(row.flow_group) } : {}),
    ...(text(row.seasonality_tag) ? { seasonality_tag: text(row.seasonality_tag) } : {}),
    ...(optionalNumber(row.reorder_point) != null ? { reorder_point: optionalNumber(row.reorder_point) } : {}),
    ...(optionalNumber(row.reorder_qty) != null ? { reorder_qty: optionalNumber(row.reorder_qty) } : {}),
    // itemGroupId = declared Magento parent (configurable_product_links).
    ...(text(row.itemGroupId) && text(row.itemGroupId) !== sku ? { parent_sku: text(row.itemGroupId) } : {}),
    ...(asIsoDate(row.createdAt ?? row.updatedAt) ? { createdAt: asIsoDate(row.createdAt ?? row.updatedAt) } : {}),
    source: sourceKind,
  };
  return isDemoProduct(product) || isNonMerchandiseProduct(product) ? null : product;
}

function overlayFromMegaventoryProduct(row: Record<string, unknown>): StockOverlay | null {
  const stock =
    firstPositive(row.stock_level, row.available_stock, row.stock_on_hand, row.stockOnHand, row.qty, row.quantity);
  // Same twin as productFromRow — period fields only, no lifetime leak into velocity.
  const qtySold =
    firstPositive(row.qty_sold_period, row.qtySoldPeriod, row.qty_sold_last_30d, row.qtySold);
  const hasPeriodField =
    row.qty_sold_period != null || row.qtySoldPeriod != null || row.qty_sold_last_30d != null || row.qtySold != null;
  const price = firstPositive(row.price, row.sell_price, row.list_price, row.sellingPrice);
  const cost = firstPositive(row.cost_price, row.costPrice, row.purchasePrice);
  const margin = num(row.margin_percentage) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
  const bucket = stockBucket(stock, hasPeriodField ? qtySold : null, null, null, leadDaysForSupplier(text(row.supplier)));
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
    ...(text(row.brand ?? row.manufacturer) ? { brand: text(row.brand ?? row.manufacturer) } : {}),
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

function applyStockOverlay(product: CompactProduct, overlay: StockOverlay, keepStock = false): CompactProduct {
  // Mutate in place rather than spreading a fresh object — called once per ERP catalog row (~90k on
  // large brands); the product is owned solely by the catalog map at this stage.
  const finalQtySold = overlay.qty_sold_period ?? product.qty_sold_period ?? 0;
  const next = product;
  // PER-177: keepStock preserves the warehouse-filtered mirror total over the report's all-warehouse stock.
  const effectiveStock = keepStock ? next.stock_level : overlay.stock_level;
  if (!keepStock) {
    next.stock_level = overlay.stock_level;
    next.stock_capacity = overlay.stock_capacity;
  }
  next.priority_tag = stockBucket(effectiveStock, finalQtySold, null, null, leadDaysForSupplier(overlay.supplier ?? next.supplier));
  next.source = 'erp';
  if (overlay.price != null) next.price = overlay.price;
  if (overlay.cost_price != null) next.cost_price = overlay.cost_price;
  if (overlay.list_price != null) next.list_price = overlay.list_price;
  if (overlay.margin_percentage != null) next.margin_percentage = overlay.margin_percentage;
  if (overlay.margin_tier) next.margin_tier = overlay.margin_tier;
  if (overlay.qty_sold_period != null) next.qty_sold_period = overlay.qty_sold_period;
  if (overlay.qty_sold_lifetime != null) next.qty_sold_lifetime = overlay.qty_sold_lifetime;
  if (!keepStock && overlay.stock_on_hand != null) next.stock_on_hand = overlay.stock_on_hand;
  if (!keepStock && overlay.available_stock != null) next.available_stock = overlay.available_stock;
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

/** Procurement-first gating: Enterprise plan + Procurement module → stock is authoritative from the
 * uploaded procurement file, so Product Intelligence is built from procurement_signals. */
async function shouldUseProcurementCatalog(brandId: string): Promise<boolean> {
  const firestore = assertDb();
  try {
    const snap = await firestore.doc(`brands/${brandId}`).get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const isEnterprise = String(data.plan || '').toLowerCase() === 'enterprise';
    if (!isEnterprise) return false;
    const modules = (data.enabledModules || {}) as Record<string, unknown>;
    // Default ON for enterprise — disabled only with an explicit false.
    return modules.procurement !== false;
  } catch {
    return false;
  }
}

/** Per-brand stock source override (brands/{brandId}.stockSourceMode). Null when unset/invalid → keep
 * the implicit default (procurement gating + connector ERP detection), so existing brands are unchanged. */
async function readStockSourceOverride(brandId: string): Promise<'erp' | 'ecommerce' | 'procurement' | null> {
  try {
    const snap = await assertDb().doc(`brands/${brandId}`).get();
    const mode = snap.exists ? (snap.data() || {}).stockSourceMode : undefined;
    return mode === 'erp' || mode === 'ecommerce' || mode === 'procurement' ? mode : null;
  } catch {
    return null;
  }
}

function procurementStockBucket(avail: number, daysOfCover: number | null, lifetimeQty: number | null): StockBucket {
  if (avail <= 0) return 'no_stock';
  if (daysOfCover != null && Number.isFinite(daysOfCover)) {
    if (daysOfCover <= 30) return 'low';
    if (daysOfCover > 120) return 'excess';
    return 'healthy';
  }
  // Without days-of-cover: anything that never sold is treated as dead stock.
  if (lifetimeQty != null && lifetimeQty <= 0) return 'dead';
  return 'healthy';
}

/** Builds a CompactProduct catalog from procurement data, calling computeProcurementSignals directly
 * (live read) instead of the stored procurement_signals doc so PI never depends on a stale one. */
async function loadProcurementCatalog(brandId: string): Promise<CompactProduct[]> {
  const { signals } = await computeProcurementSignals(brandId);
  if (!signals || Object.keys(signals).length === 0) return [];

  const products: CompactProduct[] = [];
  for (const [sku, sig] of Object.entries(signals)) {
    if (!sku || !sig) continue;
    const avail = num(sig.available_stock);
    const cost = num(sig.cost_unit);
    const price = firstPositive(sig.avg_sale_price, sig.list_price);
    const margin =
      num(sig.margin_pct) || (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0);
    const daysOfCover = sig.days_of_cover != null ? num(sig.days_of_cover) : null;
    const lifetime = sig.lifetime_qty != null ? num(sig.lifetime_qty) : null;
    const bucket = procurementStockBucket(avail, daysOfCover, lifetime);

    const product: CompactProduct = {
      id: `proc_${sku}`,
      sku,
      name: text(sig.description) || sku,
      category: text(sig.category) || 'Uncategorized',
      margin_tier: marginTier(margin),
      margin_percentage: Math.round(margin * 10) / 10,
      stock_level: Math.round(avail * 100) / 100,
      stock_capacity: Math.max(Math.round(avail * 2 * 100) / 100, Math.round(avail * 100) / 100, 1),
      available_stock: Math.round(avail * 100) / 100,
      priority_tag: bucket,
      price: Math.round(price * 100) / 100,
      ...(cost > 0 ? { cost_price: Math.round(cost * 100) / 100 } : {}),
      ...(num(sig.list_price) > 0 ? { list_price: Math.round(num(sig.list_price) * 100) / 100 } : {}),
      ...(lifetime != null ? { qty_sold_lifetime: Math.round(lifetime * 100) / 100 } : {}),
      ...(text(sig.supplier) ? { supplier: text(sig.supplier) } : {}),
      ...(text(sig.status) ? { procurement_status: text(sig.status) } : {}),
      ...(text(sig.flow_group) ? { flow_group: text(sig.flow_group) } : {}),
      ...(num(sig.replenishment_qty) > 0 ? { reorder_qty: Math.round(num(sig.replenishment_qty) * 100) / 100 } : {}),
      source: 'erp',
    };
    if (isDemoProduct(product) || isNonMerchandiseProduct(product)) continue;
    products.push(product);
  }
  return products;
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
  options: { filterByBrandInQuery?: boolean; allowMissingBrandId?: boolean } = { filterByBrandInQuery: true }
): Promise<number> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let read = 0;
  for (;;) {
    let query =
      options.filterByBrandInQuery === false
        ? firestore.collection(collection).orderBy(FieldPath.documentId()).limit(READ_PAGE_SIZE)
        : firestore
            .collection(collection)
            .where('brandId', '==', brandId)
            .orderBy(FieldPath.documentId())
            .limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    read += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data();
      const rowBrandId = text(row.brandId);
      if (options.filterByBrandInQuery === false) {
        if (rowBrandId && rowBrandId !== brandId) continue;
        if (!rowBrandId && !options.allowMissingBrandId) continue;
      }
      const product = productFromRow(doc.id, row, sourceKind);
      if (!product) continue;
      const key = normalizeSku(product.sku);
      if (!key) continue;
      const existing = bySku.get(key);
      if (existing) {
        // Prefer a doc carrying a productId (the stock overlay matches on it); upgrade a productId-less
        // entry (e.g. a gap-fill catalog doc) when a real mirror for the same SKU shows up.
        if (!existing.productId && product.productId) bySku.set(key, product);
        continue;
      }
      bySku.set(key, product);
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return read;
}

async function appendProductsBySource(
  brandId: string,
  source: string,
  bySku: Map<string, CompactProduct>
): Promise<number> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let read = 0;
  for (;;) {
    let query = firestore
      .collection('products')
      .where('brandId', '==', brandId)
      .where('source', '==', source)
      .limit(READ_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    read += snap.size;
    for (const doc of snap.docs) {
      const product = productFromRow(doc.id, doc.data(), 'erp');
      if (!product) continue;
      const key = normalizeSku(product.sku);
      if (!key) continue;
      const existing = bySku.get(key);
      if (existing) {
        // Prefer a doc carrying a productId (the stock overlay matches on it); upgrade a productId-less
        // entry (e.g. a gap-fill catalog doc) when a real mirror for the same SKU shows up.
        if (!existing.productId && product.productId) bySku.set(key, product);
        continue;
      }
      bySku.set(key, product);
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return read;
}

async function loadMegaventoryErpCatalog(
  brandId: string,
  bySku: Map<string, CompactProduct>
): Promise<{ apiProductsRead: number; apiCatalogGapRead: number }> {
  const firestore = assertDb();
  let apiProductsRead = await loadCatalogCollection(brandId, 'megaventory_products', 'erp', bySku, {
    filterByBrandInQuery: true,
  });
  let apiCatalogGapRead = await appendProductsBySource(brandId, MEGAVENTORY_API_CATALOG_SOURCE, bySku);

  const connector = await firestore.doc(`connectors/${brandId}`).get();
  const expectedProducts = Number(connector.data()?.megaventory?.lastSyncProducts ?? 0);
  const needsFallback =
    expectedProducts > 0
      ? bySku.size + 100 < expectedProducts
      : apiProductsRead > 0 && bySku.size === 0;

  if (needsFallback) {
    logger.warn(
      `[ProductIntelligence] megaventory catalog parsed ${bySku.size} SKUs from ${apiProductsRead} rows (lastSyncProducts=${expectedProducts}) — fallback scan`
    );
    apiProductsRead += await loadCatalogCollection(brandId, 'megaventory_products', 'erp', bySku, {
      filterByBrandInQuery: false,
      allowMissingBrandId: true,
    });
    if (bySku.size === 0) {
      apiCatalogGapRead += await appendProductsBySource(brandId, MEGAVENTORY_NORMALIZED_SOURCE, bySku);
    }
  }

  logger.info(
    `[ProductIntelligence] megaventory catalog for ${brandId}: ${bySku.size} SKUs (apiRows=${apiProductsRead}, gapFill=${apiCatalogGapRead}, lastSyncProducts=${expectedProducts})`
  );

  return { apiProductsRead, apiCatalogGapRead };
}

async function loadEcommerceCatalogCollection(
  brandId: string,
  collection: string,
  bySku: Map<string, CompactProduct>
): Promise<number> {
  let read = await loadCatalogCollection(brandId, collection, 'connector_catalog', bySku);
  if (bySku.size > 0) return read;

  const firestore = assertDb();
  const connector = await firestore.doc(`connectors/${brandId}`).get();
  const lastSyncProducts = Number(connector.data()?.opencart?.lastSyncProducts ?? 0);
  if (collection !== 'opencart_products' || lastSyncProducts <= 0) return read;

  if (read > 0) {
    logger.warn(
      `[ProductIntelligence] opencart_products read=${read} rows but parsed 0 SKUs for ${brandId} — fallback scan`
    );
  } else {
    logger.warn(
      `[ProductIntelligence] opencart_products brandId query returned 0 rows but lastSyncProducts=${lastSyncProducts} for ${brandId} — fallback scan`
    );
  }
  read += await loadCatalogCollection(brandId, collection, 'connector_catalog', bySku, {
    filterByBrandInQuery: false,
    allowMissingBrandId: true,
  });
  return read;
}

/** Stamp variant_count on every row with a declared parent_sku. */
function stampVariantCounts(products: CompactProduct[]): number {
  const sizes = new Map<string, number>();
  for (const p of products) {
    if (p.parent_sku) sizes.set(p.parent_sku, (sizes.get(p.parent_sku) || 0) + 1);
  }
  let stamped = 0;
  for (const p of products) {
    if (p.parent_sku) {
      p.variant_count = sizes.get(p.parent_sku);
      stamped++;
    }
  }
  return stamped;
}

async function overlayMagentoCatalogDetails(brandId: string, bySku: Map<string, CompactProduct>): Promise<number> {
  const firestore = assertDb();
  let cursor: QueryDocumentSnapshot | null = null;
  let read = 0;
  // Configurables match no ERP sku, so parent names live among the unmatched.
  // ponytail: holds every unmatched name (parents unknown until the walk ends); prune to referenced parents if this ever pressures the heap.
  const unmatchedNames = new Map<string, string>();
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
      if (!existing) {
        if (detail.name && detail.name !== detail.sku) unmatchedNames.set(key, detail.name);
        continue;
      }
      bySku.set(key, {
        ...existing,
        name: existing.name && existing.name !== existing.sku ? existing.name : detail.name,
        category: existing.category && existing.category !== 'Uncategorized' ? existing.category : detail.category,
        ...(existing.subcategory ? {} : detail.subcategory ? { subcategory: detail.subcategory } : {}),
        ...(existing.barcode ? {} : detail.barcode ? { barcode: detail.barcode } : {}),
        ...(existing.parent_sku ? {} : detail.parent_sku ? { parent_sku: detail.parent_sku } : {}),
      });
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  for (const product of bySku.values()) {
    const parentName = product.parent_sku ? unmatchedNames.get(normalizeSku(product.parent_sku)) : undefined;
    if (parentName) product.parent_name = parentName;
  }
  return read;
}

/** Per-product stock totals for the PI overlay, read from the pre-summed megaventory_products mirrors
 * (availableStockTotal/physicalStockTotal — already warehouse-filtered by the connector roll-up /
 * light recompute, incl. {0,0} zero-emit). Replaces the old full re-scan of the per-location
 * megaventory_stock collection (hundreds of thousands of docs → Firestore DEADLINE on large brands).
 * The warehouse filter now lives solely in the connector totals, so there's no re-filtering here. */
export async function loadMegaventoryStockByProductId(brandId: string): Promise<{ rowsRead: number; byProductId: Map<string, { available: number; physical: number }> }> {
  const firestore = assertDb();
  const byProductId = new Map<string, { available: number; physical: number }>();
  let cursor: QueryDocumentSnapshot | null = null;
  let rowsRead = 0;
  for (;;) {
    let query = firestore
      .collection('megaventory_products')
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
      // Only products that received a stock roll-up carry totals; others have no stock rows → leave the
      // catalog value as-is (matches the old behaviour where absent-from-stock products were untouched).
      if (row.availableStockTotal === undefined && row.physicalStockTotal === undefined) continue;
      byProductId.set(productId, {
        available: num(row.availableStockTotal),
        physical: num(row.physicalStockTotal),
      });
    }
    if (snap.size < READ_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return { rowsRead, byProductId };
}

function applyMegaventoryStockOverlay(products: Map<string, CompactProduct>, stockByProductId: Map<string, { available: number; physical: number }>): number {
  let applied = 0;
  for (const product of products.values()) {
    if (!product.productId) continue;
    const stock = stockByProductId.get(product.productId);
    if (!stock) continue;
    // PER-300: shelf units — MV's "available" adds unreceived orders.
    const stockLevel = stock.physical;
    const qtySold = product.qty_sold_period ?? 0;
    product.stock_level = Math.round(stockLevel * 100) / 100;
    product.stock_on_hand = Math.round(stock.physical * 100) / 100;
    product.available_stock = Math.round(stock.available * 100) / 100;
    product.stock_capacity = Math.max(Math.round(stockLevel * 2 * 100) / 100, Math.round(stockLevel * 100) / 100, 1);
    product.priority_tag = stockBucket(stockLevel, qtySold, null, null, leadDaysForSupplier(product.supplier));
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
      logger.warn(`[ProductIntelligence] bad sku_stats chunk for ${brandId}/${doc.id}:`, { err: error });
    }
  }
  return { rowsRead: snap.size, bySku };
}

/** All-channel ERP velocity (erp_sku_velocity/{brandId}); same chunked shape as sku_stats. */
async function loadErpSkuVelocity(brandId: string): Promise<{ rowsRead: number; bySku: Map<string, SkuStatsRow> }> {
  const firestore = assertDb();
  const bySku = new Map<string, SkuStatsRow>();
  const parent = await firestore.doc(`erp_sku_velocity/${brandId}`).get().catch(() => null);
  const chunkCount = num(parent?.data()?.chunkCount);
  if (!parent?.exists || chunkCount <= 0) return { rowsRead: 0, bySku };
  const snap = await firestore.collection(`erp_sku_velocity/${brandId}/chunks`).orderBy(FieldPath.documentId()).get();
  for (const doc of snap.docs) {
    const raw = text(doc.data().skuStatsJson);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, SkuStatsRow>;
      for (const [sku, stats] of Object.entries(parsed)) bySku.set(normalizeSku(sku), stats);
    } catch (error) {
      logger.warn(`[ProductIntelligence] bad erp_sku_velocity chunk for ${brandId}/${doc.id}:`, { err: error });
    }
  }
  return { rowsRead: snap.size, bySku };
}

/** Prefer ERP all-channel velocity per SKU; keep e-shop velocity only where the ERP has no row
 *  (per-capability fallback — ERP sales already include online, so no double counting). */
function mergeVelocityPreferErp(
  eshop: Map<string, SkuStatsRow>,
  erp: Map<string, SkuStatsRow>
): Map<string, SkuStatsRow> {
  if (erp.size === 0) return eshop;
  // Mutate the e-shop map in place instead of copying it: at large-brand scale (~137k SKUs) a full
  // Map copy is a big transient allocation that pushed the rebuild toward the heap ceiling. The caller
  // doesn't reuse the e-shop map after this, so the mutation is safe.
  for (const [sku, row] of erp) eshop.set(sku, row);
  return eshop;
}

function applySkuStatsOverlay(products: Map<string, CompactProduct>, statsBySku: Map<string, SkuStatsRow>): number {
  let applied = 0;
  // Mutate the catalog entries in place — spreading a fresh object per matched SKU across the whole
  // catalog (~90k) doubled the live product objects during the pass; the map owns these exclusively here.
  for (const [sku, product] of products.entries()) {
    const stats = statsBySku.get(sku);
    if (!stats) continue;
    const sold30 = num(stats.sold30d);
    const sold90 = num(stats.sold90d);
    const qtySoldPeriod = sold30 > 0 ? sold30 : sold90 > 0 ? sold90 / 3 : 0;
    if (qtySoldPeriod > 0) product.qty_sold_period = Math.round(qtySoldPeriod * 100) / 100;
    if (num(stats.sold) > 0) product.qty_sold_lifetime = Math.round(num(stats.sold) * 100) / 100;
    if (stats.lastSaleAt) product.last_sale_at = stats.lastSaleAt;
    product.priority_tag = stockBucket(product.stock_level, qtySoldPeriod, num(stats.sold), null, leadDaysForSupplier(product.supplier));
    applied += 1;
  }
  return applied;
}

/** Read the chunked supplier-receipt dates (megaventory_receipts/{brandId}) → normalized sku → YYYY-MM-DD. */
async function loadReceiptDates(brandId: string): Promise<Map<string, string>> {
  const firestore = assertDb();
  const bySku = new Map<string, string>();
  const parent = await firestore.doc(`megaventory_receipts/${brandId}`).get().catch(() => null);
  if (!parent?.exists || num(parent.data()?.chunkCount) <= 0) return bySku;
  const snap = await firestore.collection(`megaventory_receipts/${brandId}/chunks`).orderBy(FieldPath.documentId()).get();
  for (const doc of snap.docs) {
    const raw = text(doc.data().receiptDatesJson);
    if (!raw) continue;
    try {
      for (const [sku, date] of Object.entries(JSON.parse(raw) as Record<string, string>)) bySku.set(normalizeSku(sku), date);
    } catch (error) {
      logger.warn(`[ProductIntelligence] bad receipt chunk for ${brandId}/${doc.id}:`, { err: error });
    }
  }
  return bySku;
}

/** Read the chunked receipt suppliers (megaventory_receipts/{brandId}/supplier_chunks) → normalized sku → supplier name. */
async function loadReceiptSuppliers(brandId: string): Promise<Map<string, string>> {
  const firestore = assertDb();
  const bySku = new Map<string, string>();
  const parent = await firestore.doc(`megaventory_receipts/${brandId}`).get().catch(() => null);
  if (!parent?.exists || num(parent.data()?.supplierChunkCount) <= 0) return bySku;
  const snap = await firestore.collection(`megaventory_receipts/${brandId}/supplier_chunks`).orderBy(FieldPath.documentId()).get();
  for (const doc of snap.docs) {
    const raw = text(doc.data().receiptSuppliersJson);
    if (!raw) continue;
    try {
      for (const [sku, v] of Object.entries(JSON.parse(raw) as Record<string, { s?: string }>)) {
        if (v?.s) bySku.set(normalizeSku(sku), v.s);
      }
    } catch (error) {
      logger.warn(`[ProductIntelligence] bad supplier chunk for ${brandId}/${doc.id}:`, { err: error });
    }
  }
  return bySku;
}

/** Fill missing product.supplier from the latest inbound-receipt supplier (never overrides an ERP-declared one). */
function applyReceiptSupplierOverlay(products: Map<string, CompactProduct>, supplierBySku: Map<string, string>): number {
  if (supplierBySku.size === 0) return 0;
  let applied = 0;
  for (const [sku, product] of products.entries()) {
    if (product.supplier) continue;
    const supplier = supplierBySku.get(sku);
    if (!supplier) continue;
    product.supplier = supplier;
    applied += 1;
  }
  return applied;
}

/** Overlay real supplier-receipt dates onto first_available_date so Stock Age reflects when stock arrived.
 * When all-channel ERP velocity is present (useShelfAgeDead), also reclassify no-recent-sales stock by
 * shelf age — genuinely old, unsold-in-any-channel stock becomes dead. Without all-channel velocity the
 * date is set for the Age chart only (shelf age alone would wrongly flag in-store-selling stock as dead). */
function applyReceiptDateOverlay(
  products: Map<string, CompactProduct>,
  receiptsBySku: Map<string, string>,
  useShelfAgeDead: boolean
): number {
  if (receiptsBySku.size === 0) return 0;
  let applied = 0;
  for (const [sku, product] of products.entries()) {
    const receiptDate = receiptsBySku.get(sku);
    if (!receiptDate) continue;
    product.first_available_date = receiptDate;
    if (useShelfAgeDead) {
      const shelfAge = daysFromIso(receiptDate);
      product.priority_tag = stockBucket(
        product.stock_level,
        product.qty_sold_period ?? null,
        product.qty_sold_lifetime ?? null,
        shelfAge >= 0 ? shelfAge : null,
        leadDaysForSupplier(product.supplier)
      );
    }
    applied += 1;
  }
  return applied;
}

async function loadMegaventoryProductOverlay(
  brandId: string,
  bySku: Map<string, CompactProduct>,
  warehouseFilteredStock: Map<string, { available: number; physical: number }>
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
        const keepStock = !!existing.productId && warehouseFilteredStock.has(existing.productId);
        bySku.set(sku, applyStockOverlay(existing, overlay, keepStock));
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

async function loadConnectorProducts(brandId: string, hasErp: boolean, manual = false): Promise<{
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
  let megaventoryApiRowsRead = 0;
  let megaventoryApiCatalogGapRead = 0;
  let softoneRowsRead = 0;
  if (hasErp) {
    const catalog = await loadMegaventoryErpCatalog(brandId, bySku);
    megaventoryApiRowsRead = catalog.apiProductsRead;
    megaventoryApiCatalogGapRead = catalog.apiCatalogGapRead;
    // SoftOne ERP catalog: softone_items carries normalized sku/name/stock_level. Empty query (0 rows)
    // for non-SoftOne brands, so this is a no-op there.
    softoneRowsRead = await loadCatalogCollection(brandId, 'softone_items', 'erp', bySku);
  }
  // Manual mode: the brand's own `products` docs are the catalog.
  const ecommerceCatalogRowsRead = manual
    ? await loadCatalogCollection(brandId, 'products', 'manual', bySku)
    : hasErp
      ? 0
      : (await Promise.all([
          loadCatalogCollection(brandId, 'magento_products', 'connector_catalog', bySku),
          loadCatalogCollection(brandId, 'shopify_products', 'connector_catalog', bySku),
          loadCatalogCollection(brandId, 'woo_products', 'connector_catalog', bySku),
          loadEcommerceCatalogCollection(brandId, 'opencart_products', bySku),
        ])).reduce((sum, rowsRead) => sum + rowsRead, 0);
  const magentoDetailRowsRead = hasErp ? await overlayMagentoCatalogDetails(brandId, bySku) : 0;
  // #8: stock totals come from the pre-summed (already warehouse-filtered) megaventory_products mirrors
  // — no per-location re-scan of megaventory_stock (the old DEADLINE-prone read on large brands).
  const stockResult = hasErp
    ? await loadMegaventoryStockByProductId(brandId)
    : { rowsRead: 0, byProductId: new Map<string, { available: number; physical: number }>() };
  const stockByLocationApplied = hasErp ? applyMegaventoryStockOverlay(bySku, stockResult.byProductId) : 0;
  const skuStats = await loadSkuStats(brandId);
  // ERP-authoritative brands: all-channel velocity (in-store + online + B2B) wins per SKU; e-shop is
  // the fallback. Non-ERP brands keep e-shop velocity only.
  const erpVelocity = hasErp ? await loadErpSkuVelocity(brandId) : { rowsRead: 0, bySku: new Map<string, SkuStatsRow>() };
  const hasErpVelocity = erpVelocity.bySku.size > 0;
  const velocityBySku = hasErp ? mergeVelocityPreferErp(skuStats.bySku, erpVelocity.bySku) : skuStats.bySku;
  // Supplier fill must precede the velocity/receipt overlays — their priority_tag recomputes read leadDaysForSupplier.
  if (hasErp) applyReceiptSupplierOverlay(bySku, await loadReceiptSuppliers(brandId));
  const skuStatsApplied = applySkuStatsOverlay(bySku, velocityBySku);
  // Real supplier-receipt dates → stock age (ERP catalog only); shelf-age dead only when all-channel
  // ERP velocity backs it, so in-store-only sellers aren't mislabelled dead.
  if (hasErp) applyReceiptDateOverlay(bySku, await loadReceiptDates(brandId), hasErpVelocity);
  const overlay = hasErp
    ? await loadMegaventoryProductOverlay(brandId, bySku, stockResult.byProductId)
    : { rowsRead: 0, overlaysApplied: 0, erpOnlyProducts: 0 };
  // PER-293: brand additions (brands/{id}.nonMerchandise) join the platform demo/non-merch rule.
  const brandSnap = await assertDb().doc(`brands/${brandId}`).get().catch(() => null);
  const isNonStocked = buildIsNonStocked(readNonMerchandise(brandSnap?.data()));
  const products = [...bySku.values()].filter((product) => !isNonStocked(product));
  stampVariantCounts(products);
  return {
    products,
    sourceRowsRead:
      megaventoryApiRowsRead +
      megaventoryApiCatalogGapRead +
      softoneRowsRead +
      ecommerceCatalogRowsRead +
      magentoDetailRowsRead +
      stockResult.rowsRead +
      skuStats.rowsRead +
      erpVelocity.rowsRead +
      overlay.rowsRead,
    megaventoryApiRowsRead: megaventoryApiRowsRead + megaventoryApiCatalogGapRead,
    megaventoryStockRowsRead: stockResult.rowsRead,
    megaventoryRowsRead: overlay.rowsRead,
    magentoDetailRowsRead,
    skuStatsRowsRead: skuStats.rowsRead + erpVelocity.rowsRead,
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

function brandCounts(products: CompactProduct[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (product.brand) counts.set(product.brand, (counts.get(product.brand) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 250)
    .map(([name, count]) => ({ name, count }));
}

/** PER-300: stock means units on the shelf, never the ERP's on-hand (which adds unreceived orders). */
function effectiveStock(product: CompactProduct): number {
  return product.stock_on_hand ?? product.stock_level ?? 0;
}

/** Mirrors the effectiveTag rule in matchesQuery. */
function effectiveTagId(product: CompactProduct): string {
  const stock = effectiveStock(product);
  return stock <= 0 ? 'no_stock' : text(product.priority_tag).toLowerCase();
}

function facetCounts(
  rows: CompactProduct[],
  params: ProductIntelligenceQueryParams,
  omit: 'categories' | 'brands' | 'tags',
  idFn: (product: CompactProduct) => string,
): Array<{ id: string; count: number }> {
  const scoped = { ...params, [omit]: undefined };
  const counts = new Map<string, number>();
  for (const product of rows) {
    if (!matchesQuery(product, scoped)) continue;
    const id = idFn(product);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 250)
    .map(([id, count]) => ({ id, count }));
}

function buildQueryFacets(rows: CompactProduct[], params: ProductIntelligenceQueryParams): QueryFacets {
  return {
    categories: facetCounts(rows, params, 'categories', categoryId),
    brands: facetCounts(rows, params, 'brands', (p) => text(p.brand)), // empty brand dropped
    tags: facetCounts(rows, params, 'tags', effectiveTagId),
  };
}

function daysOfStock(product: CompactProduct): number {
  const stock = effectiveStock(product);
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

function brandFilterId(product: CompactProduct): string {
  return text(product.brand) || '__EMPTY_BRAND__';
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

  const stock = effectiveStock(product);
  const effectiveTag = stock <= 0 ? 'no_stock' : text(product.priority_tag).toLowerCase();
  if (params.includeNoStock !== true && stock <= 0) return false;

  if (params.categories?.length) {
    const allowed = new Set(params.categories);
    if (!allowed.has(categoryId(product))) return false;
  }

  if (params.brands?.length) {
    const allowed = new Set(params.brands);
    if (!allowed.has(brandFilterId(product))) return false;
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
      const stockA = effectiveStock(a);
      const stockB = effectiveStock(b);
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

  // Build the full new page set first.
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

  // WRITE-THEN-CLEANUP (PER-166/167): overwrite the new pages IN PLACE first, so the previous build's
  // pages stay readable throughout the rebuild. Readers serving the aggregate while status='running'
  // therefore never see a missing-page window (which would yield partial data or, for the strategy /
  // channel pages, a fall back to loading the full ~222k catalog). Only AFTER the new set is committed
  // do we delete the now-stale leftovers from a previous, larger build.
  for (let i = 0; i < writes.length; i += PAGE_WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    writes.slice(i, i + PAGE_WRITE_BATCH_SIZE).forEach((item) => {
      batch.set(firestore.doc(`product_intelligence_pages/${item.id}`), item.data);
    });
    await batch.commit();
  }

  const newIds = new Set(writes.map((w) => w.id));
  const existing = await firestore.collection('product_intelligence_pages').where('brandId', '==', brandId).get();
  const byId = new Map(existing.docs.map((doc) => [doc.id, doc.ref]));
  const staleRefs = stalePageIds([...byId.keys()], newIds).map((id) => byId.get(id)!);
  for (let i = 0; i < staleRefs.length; i += PAGE_WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    staleRefs.slice(i, i + PAGE_WRITE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return pagesByBucket;
}

/** Pages to delete after a write-then-cleanup rebuild: existing page docs NOT in the freshly-written
 *  set. Pages present in both are overwritten in place and must NEVER be deleted — otherwise readers
 *  serving the aggregate mid-rebuild would see a missing-page gap. */
export function stalePageIds(existingIds: string[], keptIds: Set<string>): string[] {
  return existingIds.filter((id) => !keptIds.has(id));
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

/** The table may serve from the existing page docs when the aggregate is `ready`, OR while a recompute
 * is `running` provided a prior build left page docs behind (pagesByBucket present). This mirrors the
 * UI's "keep last-good data visible during a refresh" behaviour and prevents a long/orphaned `running`
 * state (e.g. a crashed nightly refresh) from blanking the table indefinitely. */
function canServeAggregateQuery(status: string | undefined, hasPages: boolean): boolean {
  if (status === 'ready') return true;
  return status === 'running' && hasPages;
}

/** Watchdog decision for an aggregate left in a bad state by a crashed/timed-out rebuild. A 'running'
 * older than staleMs is provably dead (it exceeds the rebuild functions' own timeout, so no live writer
 * exists), and 'failed' is terminal-bad — both warrant a re-triggered rebuild, bounded by a cooldown and
 * an attempt cap so a brand that keeps failing can't livelock the worker. */
export function classifyAggregateRecovery(
  s: { status: string | undefined; updatedAtMs: number | null; selfHealAttempts: number; selfHealAtMs: number | null; nowMs: number },
  opts: { staleMs: number; cooldownMs: number; maxAttempts: number },
): 'ok' | 'heal' | 'cooldown' | 'giveup' {
  const stuckRunning = s.status === 'running' && s.updatedAtMs != null && s.nowMs - s.updatedAtMs >= opts.staleMs;
  const bad = s.status === 'failed' || stuckRunning;
  if (!bad) return 'ok';
  if (s.selfHealAttempts >= opts.maxAttempts) return 'giveup';
  if (s.selfHealAtMs != null && s.nowMs - s.selfHealAtMs < opts.cooldownMs) return 'cooldown';
  return 'heal';
}

/** Collapse rows by parent_sku: top-stock variant carries price/margin/name; quantities sum; unparented pass through. */
function collapseByParentSku(rows: CompactProduct[]): CompactProduct[] {
  const groups = new Map<string, CompactProduct[]>();
  const out: CompactProduct[] = [];
  for (const row of rows) {
    if (!row.parent_sku) { out.push(row); continue; }
    const g = groups.get(row.parent_sku);
    if (g) g.push(row); else groups.set(row.parent_sku, [row]);
  }
  for (const [parent, members] of groups) {
    const rep = members.reduce((a, b) => (b.stock_level > a.stock_level ? b : a));
    const sum = (f: (p: CompactProduct) => number | undefined) =>
      Math.round(members.reduce((t, p) => t + (f(p) || 0), 0) * 100) / 100;
    const lastSale = members.map((p) => p.last_sale_at || '').sort().pop();
    const stock = sum((p) => p.stock_level);
    const soldPeriod = members.some((p) => p.qty_sold_period != null) ? sum((p) => p.qty_sold_period) : null;
    const soldLifetime = members.some((p) => p.qty_sold_lifetime != null) ? sum((p) => p.qty_sold_lifetime) : null;
    out.push({
      ...rep,
      id: `parent_${parent}`,
      sku: parent,
      name: rep.parent_name ?? rep.name,
      stock_level: stock,
      stock_capacity: sum((p) => p.stock_capacity),
      ...(members.some((p) => p.stock_on_hand != null) ? { stock_on_hand: sum((p) => p.stock_on_hand) } : {}),
      ...(members.some((p) => p.available_stock != null) ? { available_stock: sum((p) => p.available_stock) } : {}),
      ...(soldPeriod != null ? { qty_sold_period: soldPeriod } : {}),
      ...(soldLifetime != null ? { qty_sold_lifetime: soldLifetime } : {}),
      ...(lastSale ? { last_sale_at: lastSale } : {}),
      variant_count: members.length,
      // The bucket describes the group, not its representative variant.
      priority_tag: stockBucket(stock, soldPeriod, soldLifetime, null, leadDaysForSupplier(rep.supplier)),
    });
  }
  return out;
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
  if (!aggregateSnap.exists || !aggregate || !canServeAggregateQuery(aggregate.status, !!aggregate.pagesByBucket)) {
    throw new Error('Product Intelligence aggregate is not ready');
  }

  const bucket = params.bucket ?? 'all';
  const pageSize = Math.max(1, Math.min(params.pageSize ?? TABLE_PAGE_SIZE, TABLE_PAGE_SIZE));
  const requestedPage = Math.max(1, Math.floor(params.page ?? 1));
  // PER-187: siblings scatter across buckets, so grouping reads the whole catalog and buckets the groups.
  const readBucket: PageBucket = params.groupByParent ? 'all' : bucket;
  const pageCount = Math.max(1, aggregate.pagesByBucket?.[readBucket] ?? 1);
  const rows = await loadBucketProductsFromPages(params.brandId, readBucket, pageCount);
  const filtered = rows.filter((product) => matchesQuery(product, params));
  // Collapse after filtering (variant-level filters stay precise), before sort/pagination.
  const display = params.groupByParent
    ? collapseByParentSku(filtered).filter((row) => bucket === 'all' || row.priority_tag === bucket)
    : filtered;
  const sorted = sortProducts(
    display,
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
    summary: summaryForProducts(filtered),
    facets: buildQueryFacets(rows, params),
  };
}

function competitiveInventoryForProducts(products: CompactProduct[]): Record<string, CompetitiveInventoryRow> {
  const rows: Record<string, CompetitiveInventoryRow> = {};
  const add = (key: string, product: CompactProduct) => {
    const normalized = normalizeSku(key);
    if (!normalized) return;
    const stock = Math.round(effectiveStock(product) * 100) / 100;
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

  // Per-brand stock source: an explicit setting wins; otherwise the implicit default (procurement
  // gating + connector ERP detection) is preserved unchanged.
  const stockOverride = await readStockSourceOverride(brandId);
  // Per-brand stock-health thresholds for this run (defaults preserve current behaviour when unset).
  const brandInventoryThresholds = (await firestore.doc(`brands/${brandId}`).get()).data()?.inventoryThresholds as
    | Record<string, unknown>
    | undefined;
  activeStockThresholds = resolveStockThresholds(brandInventoryThresholds);
  const rawLead = num(brandInventoryThresholds?.defaultLeadTimeDays);
  activeDefaultLeadDays = rawLead > 0 ? rawLead : DEFAULT_LEAD_DAYS;
  activeSupplierLeadByName = await loadSupplierLeadTimes(brandId);

  // Procurement-first: for Enterprise+Procurement brands stock is authoritative from the uploaded
  // procurement file and OVERRIDES any connector catalog.
  const useProcurement = stockOverride ? stockOverride === 'procurement' : await shouldUseProcurementCatalog(brandId);
  if (useProcurement) {
    const procProducts = await loadProcurementCatalog(brandId);
    if (procProducts.length > 0) {
      await ref.set(
        { brandId, status: 'running', sourceLabel: 'Procurement', updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      try {
        const syncVersion = await computeBrandSyncVersion(brandId);
        const summary = summaryForProducts(procProducts);
        const pagesByBucket = await writePageDocs(brandId, procProducts);
        const competitiveInventory = await writeCompetitiveInventoryLookup(brandId, procProducts);
        const charts = chartDataForProducts(procProducts);
        await ref.set(
          {
            brandId,
            status: 'ready',
            sourceLabel: 'Procurement',
            sourceKind: 'procurement',
            stockSource: 'procurement',
            totalCount: procProducts.length,
            syncVersion: syncVersion.version,
            latestSyncAt: syncVersion.latestSyncAt,
            sourceRowsRead: procProducts.length,
            competitiveInventoryKeys: competitiveInventory.keys,
            competitiveInventoryChunks: competitiveInventory.chunks,
            pageSize: TABLE_PAGE_SIZE,
            pagesByBucket,
            categories: categoryCounts(procProducts),
            brands: brandCounts(procProducts),
            charts,
            summary,
            computedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            error: FieldValue.delete(),
          },
          { merge: true }
        );
        logger.info(`[ProductIntelligence] ${brandId}: procurement catalog totalCount=${procProducts.length}`);
        return { success: true, brandId, totalCount: procProducts.length, source: 'procurement', pagesByBucket };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[ProductIntelligence] procurement failed brand=${brandId}: ${message}`, { alertKey: ALERT.productIntelligenceFailed });
        await ref.set(
          { brandId, status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        return { success: false, brandId, error: message };
      }
    }
    // Enterprise+Procurement but no procurement data yet → fall back to connector (if any).
  }

  const connector = await hasConnectorCatalog(brandId);
  // Explicit setting picks ERP vs e-shop catalog; unset → connector detection (current behaviour).
  const useErp = stockOverride ? stockOverride === 'erp' : connector.hasErp;
  // No catalog connector → build from the brand's imported `products` docs instead of skipping.
  const useManual = !connector.connected;
  const sourceLabel = useManual ? 'Manual upload' : connector.sourceLabel;

  await ref.set({
    brandId,
    status: 'running',
    sourceLabel,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const [syncVersion, catalogResult] = await Promise.all([
      computeBrandSyncVersion(brandId),
      loadConnectorProducts(brandId, useManual ? false : useErp, useManual),
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
    // Nothing imported either → skip as before.
    if (useManual && products.length === 0) {
      await ref.set({
        brandId,
        status: 'skipped',
        reason: 'no_connector_catalog',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { success: true, skipped: true, brandId };
    }
    const summary = summaryForProducts(products);
    const pagesByBucket = await writePageDocs(brandId, products);
    const competitiveInventory = await writeCompetitiveInventoryLookup(brandId, products);
    const charts = chartDataForProducts(products);
    // Which warehouses this aggregate reflects (empty = all) → drives the UI badge so ΚΑΠ-only numbers
    // aren't misleading. Read straight from the connector, independent of how the filter is applied
    // internally, so it survives the #1A refactor.
    const connSnap = await assertDb().doc(`connectors/${brandId}`).get();
    const mvConn = connSnap.data()?.megaventory as { stockLocations?: unknown; stockLocationLabels?: unknown } | undefined;
    const stockLocationsForBadge = Array.isArray(mvConn?.stockLocations)
      ? (mvConn!.stockLocations as unknown[]).map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
      : [];
    const stockLocationLabelsForBadge = Array.isArray(mvConn?.stockLocationLabels)
      ? (mvConn!.stockLocationLabels as unknown[]).map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
      : [];
    const payload = {
      brandId,
      status: 'ready',
      sourceLabel,
      sourceKind: useManual ? 'manual' : useErp ? 'erp' : 'connector_catalog',
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
      stockLocations: stockLocationsForBadge,
      stockLocationLabels: stockLocationLabelsForBadge,
      pageSize: TABLE_PAGE_SIZE,
      pagesByBucket,
      categories: categoryCounts(products),
      brands: brandCounts(products),
      charts,
      summary,
      computedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
      // A clean rebuild clears the watchdog's self-heal tracking so the attempt cap resets.
      piSelfHealAttempts: FieldValue.delete(),
      piSelfHealAt: FieldValue.delete(),
    };
    await ref.set(payload, { merge: true });
    logger.info(
      `[ProductIntelligence] ${brandId}: totalCount=${products.length} sourceRowsRead=${sourceRowsRead} sourceLabel=${sourceLabel}`
    );
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
    logger.error(`[ProductIntelligence] failed brand=${brandId}: ${message}`, { alertKey: ALERT.productIntelligenceFailed });
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


/** Test-only export — unit tests exercise the real code, not copies. */
export const __test = {
  effectiveStock,
  productFromRow,
  stampVariantCounts,
  collapseByParentSku,
  stockBucket,
  summaryForProducts,
  canServeAggregateQuery,
  stalePageIds,
  mergeVelocityPreferErp,
  applySkuStatsOverlay,
  applyStockOverlay,
  classifyAggregateRecovery,
  buildQueryFacets,
};
