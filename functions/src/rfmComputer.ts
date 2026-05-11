/**
 * Server-side RFM pre-computation.
 *
 * Reads all orders for a brand (ERP first, fallback to e-shop),
 * computes RFM quintile scores, assigns segments, and persists to:
 *   rfm_computed/{brandId}          — metadata + segment summaries + chunked customer JSON
 *   rfm_computed/{brandId}/chunks/{i} — customer list JSON chunks (<900KB each)
 *   rfm_snapshots/{brandId}/history/{yyyyMM} — monthly snapshot (overwritten per run)
 *
 * Scoring logic mirrors src/services/rfmFromOrders.ts exactly.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface RFMCustomer {
  customerId: string;
  customerName: string;
  email?: string;
  segment: string;
  segmentId: string;
  rfmScore: string;
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  lastOrderDate: string;
  orderCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  daysSinceLastOrder: number;
}

export interface RFMSegmentSummary {
  segment: string;
  segmentId: string;
  count: number;
  revenue: number;
  avgOrderValue: number;
  pct: number;
}

export interface RFMComputedResult {
  brandId: string;
  computedAt: FirebaseFirestore.Timestamp;
  dataSource: 'erp' | 'eshop';
  dataSourcePlatforms: string[];
  totalCustomers: number;
  totalOrders: number;
  ordersAttributed: number;
  guestOrdersSkipped: number;
  segments: RFMSegmentSummary[];
  chunkCount: number;
  migration?: MigrationResult;
}

export interface MigrationFlow {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  count: number;
  revenue: number;
  sampleCustomerIds: string[];
}

export interface SegmentDelta {
  segmentId: string;
  segmentName: string;
  prevCount: number;
  newCount: number;
  countDelta: number;
  prevRevenue: number;
  newRevenue: number;
  revenueDelta: number;
}

export interface MigrationResult {
  comparedAt: FirebaseFirestore.Timestamp | null;
  periodDays: number;
  comparedCustomers: number;
  totalFlowsCount: number;
  flows: MigrationFlow[];
  segmentDeltas: SegmentDelta[];
}

const EMPTY_MIGRATION: MigrationResult = {
  comparedAt: null,
  periodDays: 0,
  comparedCustomers: 0,
  totalFlowsCount: 0,
  flows: [],
  segmentDeltas: [],
};

/** Hard cap on chunks read for migration diff. Each chunk ~900KB, so 50 chunks ~45MB. */
const MIGRATION_MAX_CHUNKS = 50;

// ─── Internal types ─────────────────────────────────────────────────────────

interface OrderLineItem {
  sku?: string;
  productId?: string;
  productName?: string;
  productType?: string;
  revenue: number;
  qty: number;
}

interface OrderRecord {
  customerId: string;
  customerName: string;
  email?: string;
  revenue: number;
  date: string; // YYYY-MM-DD
  platform: string;
  /** Optional line items — present on e-shop orders, absent on Megaventory/SoftOne invoices. */
  lineItems?: OrderLineItem[];
}

// ─── Catalog index types (mirror src/services/catalogAlignment.ts) ──────────

interface CatalogDims {
  brand?: string;
  category?: string;
  subcategory?: string;
  categoryPath?: string[];
  stockOnHand?: number;
  qtySold?: number;
}

interface CatalogIndexes {
  /** key = `${platform}:${productId}` */
  byProductId: Map<string, CatalogDims>;
  /** key = `${platform}:${normalizedSku}` */
  bySku: Map<string, CatalogDims>;
  /** ERP/unified products by normalized SKU. */
  erpBySku: Map<string, CatalogDims>;
}

interface PerSegmentBehavioral {
  catalog_match: {
    revenue_matched_pct: number;
    lines_matched_pct: number;
    lines_total: number;
    lines_matched: number;
  } | null;
  brand_affinity: AffinityRow[];
  category_affinity: AffinityRow[];
  category_affinity_catalog: AffinityRow[];
  subcategory_affinity: AffinityRow[];
  sku_affinity: AffinityRow[];
  price_sensitivity: 'low' | 'medium' | 'high' | null;
  preferred_channels: PreferredChannel[];
}

interface AffinityRow {
  name: string;
  affinity: number;
  avg_order: number;
  revenue_eur: number;
  revenue_share_pct: number;
  stock_on_hand?: number;
  qty_sold?: number;
  category_path?: string[];
}

interface PreferredChannel {
  channel: string;
  orders: number;
  revenue: number;
  share_pct: number;
}

interface CustomerAgg {
  customerId: string;
  customerName: string;
  email?: string;
  orderCount: number;
  revenue: number;
  lastOrderDate: string;
  firstOrderDate: string;
}

// ─── DB singleton ────────────────────────────────────────────────────────────

let _db: Firestore | null = null;

export function setDb(db: Firestore): void {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Ανάθεση βαθμίδων 1–5: lowIsHighScore = true όταν μικρότερη τιμή = καλύτερο (recency days). */
function assignQuintileScores(values: number[], lowIsHighScore: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => (lowIsHighScore ? a.v - b.v : b.v - a.v));
  const out: number[] = new Array(n).fill(1);
  for (let band = 0; band < 5; band++) {
    const score = 5 - band;
    const start = Math.floor((band * n) / 5);
    const end = Math.max(start, Math.floor(((band + 1) * n) / 5) - 1);
    for (let j = start; j <= end; j++) {
      out[idx[j].i] = score;
    }
  }
  return out;
}

/** Χάρτης R-F-M scores → segment id/name (ίδιος με rfmFromOrders.ts). */
function segmentFromRfmScores(r: number, f: number, m: number): { id: string; name: string } {
  if (r >= 4 && f >= 4 && m >= 3) return { id: 'champions', name: 'Champions' };
  if (f <= 2 && r >= 4 && m >= 2) return { id: 'recent_customers', name: 'Recent Customers' };
  if (f <= 2 && r >= 4) return { id: 'new_customers', name: 'New Customers' };
  if (r >= 3 && f >= 3 && m >= 3) return { id: 'loyal', name: 'Loyal Customers' };
  if (r >= 3 && f >= 2 && f <= 3 && m >= 2) return { id: 'potential', name: 'Potential Loyalists' };
  if (r <= 2 && f >= 4 && m >= 4) return { id: 'cant_lose_them', name: "Can't Lose Them" };
  if (r <= 2 && f >= 3 && m >= 3) return { id: 'at_risk', name: 'At Risk' };
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3) return { id: 'customers_needing_attention', name: 'Customers Needing Attention' };
  if (r <= 2 && f <= 2 && m <= 2) return { id: 'hibernating', name: 'Hibernating' };
  if (r === 1) return { id: 'lost', name: 'Lost' };
  return { id: 'potential', name: 'Potential Loyalists' };
}

// ─── ERP order readers ───────────────────────────────────────────────────────

function megaventoryCustomerKey(d: Record<string, unknown>): string {
  const id = String(d.clientId ?? '').trim();
  if (id) return `mv_customer_${id}`;
  const name = String(d.clientName ?? '').trim();
  if (name) return `mv_customer_${name.toLocaleUpperCase('el-GR')}`;
  return '';
}

function megaventoryCustomerName(d: Record<string, unknown>): string {
  return String(d.clientName ?? d.clientCode ?? '').trim();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Megaventory `clientName` συχνά περιέχει email — εξάγουμε για χρήση σε hybrid ERP+e-shop catalog match. */
function megaventoryCustomerEmail(d: Record<string, unknown>): string {
  const name = String(d.clientName ?? '').trim();
  const m = name.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : '';
}

async function readMegaventoryOrders(db: Firestore, brandId: string): Promise<OrderRecord[]> {
  const snap = await db.collection('megaventory_invoices').where('brandId', '==', brandId).get();
  const out: OrderRecord[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const net = parseNumeric(d.netAmount);
    if (!(net > 0)) continue;
    const st = String(d.status || '');
    if (/(cancel|void|ακυρ|reject)/i.test(st)) continue;
    const ck = megaventoryCustomerKey(d);
    if (!ck) continue;
    const day = typeof d.date === 'string' ? d.date.slice(0, 10) : '';
    if (!day) continue;
    const email = megaventoryCustomerEmail(d);
    out.push({
      customerId: ck,
      customerName: megaventoryCustomerName(d),
      ...(email ? { email } : {}),
      revenue: net,
      date: day,
      platform: 'megaventory',
    });
  }
  return out;
}

function softOneNetAmount(d: Record<string, unknown>): number {
  const keys = [
    'SALDOC.NETAMOUNT', 'SALDOC.NETVALUE', 'SALDOC.NETVAL',
    'NETVALUE', 'TOTALNETVALUE', 'SUMNETVALUE', 'SALDOC.TOTALNET', 'TOTALNET',
  ];
  for (const k of keys) {
    const v = parseNumeric(d[k]);
    if (v !== 0) return Math.abs(v);
  }
  const gross = parseNumeric(d['SALDOC.TOTALAMOUNT'] ?? d['TOTALAMOUNT'] ?? d['SALDOC.TOTAL'] ?? d['TOTAL']);
  const vat = parseNumeric(d['SALDOC.VATAMOUNT'] ?? d['VATAMOUNT']);
  if (gross > 0 && vat >= 0) return Math.max(0, gross - vat);
  return Math.abs(parseNumeric(d['SALDOC.TOTALNET']));
}

function softOneCustomerKey(d: Record<string, unknown>): string {
  const trdr = d['SALDOC.TRDR'] ?? d.TRDR ?? d['TRDR.TRDR'];
  const trdrStr = trdr != null ? String(trdr).trim() : '';
  if (trdrStr && trdrStr !== '0') return `s1_customer_trdr:${trdrStr}`;
  const code = d['TRDR.CODE'] ?? d['CUSTOMER.CODE'];
  const codeStr = code != null ? String(code).trim() : '';
  if (codeStr) return `s1_customer_code:${codeStr}`;
  const nameKeys = ['CUSTOMER.NAME', 'TRDR.NAME', 'SALDOC.TRDRNAME', 'TRDRNAME'];
  for (const k of nameKeys) {
    const v = d[k];
    if (v != null && String(v).trim()) return `s1_customer_${String(v).trim().toLocaleUpperCase('el-GR')}`;
  }
  return '';
}

function softOneCustomerName(d: Record<string, unknown>): string {
  const keys = ['CUSTOMER.NAME', 'TRDR.NAME', 'SALDOC.TRDRNAME', 'TRDRNAME'];
  for (const k of keys) {
    const v = d[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function softOneDay(d: Record<string, unknown>): string {
  const raw = String(d.documentDate ?? d['SALDOC.TRNDATE'] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return '';
}

async function readSoftOneOrders(db: Firestore, brandId: string): Promise<OrderRecord[]> {
  const snap = await db.collection('softone_sales_documents').where('brandId', '==', brandId).get();
  const out: OrderRecord[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const net = softOneNetAmount(d);
    if (!(net > 0)) continue;
    const ck = softOneCustomerKey(d);
    if (!ck) continue;
    const day = softOneDay(d);
    if (!day) continue;
    out.push({
      customerId: ck,
      customerName: softOneCustomerName(d),
      revenue: net,
      date: day,
      platform: 'softone',
    });
  }
  return out;
}

// ─── E-shop order readers ────────────────────────────────────────────────────

const ESHOP_COLLECTION_MAP: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

const EXCLUDED_STATUSES = new Set([
  'cancelled', 'canceled', 'refunded', 'voided', 'failed',
  'ακυρώθηκε', 'ακυρωμένη', 'ακυρωμένο',
]);

function isExcludedStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return false;
  return EXCLUDED_STATUSES.has(s) || /\b(cancel|void|refund|ακυρ)\b/i.test(s);
}

function computeEshopRevenue(platform: string, d: Record<string, unknown>): number {
  const num = (v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? '0'));
    return Number.isFinite(n) ? n : 0;
  };
  if (platform === 'magento') {
    const baseSubtotal = num(d.baseSubtotal);
    const baseDiscount = Math.abs(num(d.baseDiscountAmount));
    if (baseSubtotal > 0) return Math.max(0, baseSubtotal - baseDiscount);
    const currency = String(d.currency || '').toUpperCase();
    const baseCurrency = String(d.baseCurrencyCode || '').toUpperCase();
    const isEur = !currency || currency === 'EUR' || (baseCurrency && currency === baseCurrency);
    if (!isEur) return 0;
    const subtotal = num(d.subtotal);
    const discount = Math.abs(num(d.discountAmount));
    if (subtotal > 0) return Math.max(0, subtotal - discount);
    return Math.max(0, num(d.grandTotal) - num(d.taxAmount));
  }
  if (platform === 'shopify') return Math.max(0, num(d.totalPrice) - num(d.totalTax));
  if (platform === 'woocommerce') return Math.max(0, num(d.total) - num(d.totalTax));
  if (platform === 'opencart') return Math.max(0, num(d.total) - num(d.totalTax));
  return num(d.total);
}

function eshopCustomerKey(platform: string, d: Record<string, unknown>): string {
  const emailHash = String(d.customerEmailHash ?? d.customer_email_hash ?? '').trim().toLowerCase();
  if (emailHash) return `email:${emailHash}`;
  const email = String(d.customerEmail ?? d.customer_email ?? '').trim().toLowerCase();
  if (email.includes('@')) return `email:${email}`;
  const rawId = d.customerId ?? d.customer_id;
  const idStr = rawId != null ? String(rawId).trim() : '';
  if (idStr && idStr !== '0' && idStr !== 'null' && idStr !== 'undefined') {
    return `${platform}:${idStr}`;
  }
  return '';
}

function coerceCreatedAt(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof (v as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    } catch { return ''; }
  }
  return '';
}

function isDemoLine(li: Record<string, unknown>): boolean {
  return `${li.sku || ''} ${li.title || ''} ${li.name || ''}`.toLowerCase().includes('demo');
}

function isAllDemoOrder(d: Record<string, unknown>): boolean {
  const items = Array.isArray(d.lineItems) ? d.lineItems as Record<string, unknown>[] : [];
  if (items.length === 0) return false;
  let nonDemoCount = 0;
  for (const li of items) {
    if (!isDemoLine(li)) nonDemoCount++;
  }
  return nonDemoCount === 0;
}

function lineItemRevenue(li: Record<string, unknown>): number {
  const row = parseNumeric(li.rowTotal ?? li.row_total ?? li.base_row_total);
  if (row > 0) return row;
  const price = parseNumeric(li.price);
  const qty = parseNumeric(li.quantity ?? li.qty_ordered);
  return Math.max(0, price * Math.max(1, qty || 1));
}

function normalizeLineItems(raw: unknown): OrderLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderLineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const li = item as Record<string, unknown>;
    if (isDemoLine(li)) continue;
    const sku = li.sku != null ? String(li.sku).trim() : '';
    const productId =
      li.productId != null ? String(li.productId).trim() :
      li.product_id != null ? String(li.product_id).trim() : '';
    const productName =
      (li.name != null && String(li.name).trim()) ||
      (li.title != null && String(li.title).trim()) || '';
    const productType =
      li.productType != null ? String(li.productType).trim() :
      li.product_type != null ? String(li.product_type).trim() : '';
    const revenue = lineItemRevenue(li);
    const qty = parseNumeric(li.quantity ?? li.qty_ordered);
    if (!sku && !productId && !productName) continue;
    out.push({
      ...(sku ? { sku } : {}),
      ...(productId ? { productId } : {}),
      ...(productName ? { productName } : {}),
      ...(productType ? { productType } : {}),
      revenue,
      qty: Math.max(1, qty || 1),
    });
  }
  return out;
}

async function readEshopPlatformOrders(db: Firestore, brandId: string, platform: string): Promise<OrderRecord[]> {
  const coll = ESHOP_COLLECTION_MAP[platform];
  if (!coll) return [];
  const snap = await db.collection(coll).where('brandId', '==', brandId).get();
  const out: OrderRecord[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const status = String(d.status || d.financialStatus || d.financial_status || '');
    if (isExcludedStatus(status)) continue;
    if (isAllDemoOrder(d)) continue;
    const ck = eshopCustomerKey(platform, d);
    if (!ck) continue;
    const revenue = computeEshopRevenue(platform, d);
    if (!(revenue > 0)) continue;
    const rawCreated = coerceCreatedAt(d.createdAt ?? d.created_at);
    const day = rawCreated.slice(0, 10);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const email = String(d.customerEmail ?? d.customer_email ?? '').trim().toLowerCase();
    const lineItems = normalizeLineItems(d.lineItems);
    out.push({
      customerId: ck,
      customerName: String(d.customerName ?? d.customer_name ?? email).trim(),
      ...(email.includes('@') ? { email } : {}),
      revenue,
      date: day,
      platform,
      ...(lineItems.length > 0 ? { lineItems } : {}),
    });
  }
  return out;
}

// ─── Data source resolution ──────────────────────────────────────────────────

interface DataSourceResult {
  orders: OrderRecord[];
  dataSource: 'erp' | 'eshop';
  platforms: string[];
  guestOrdersSkipped: number;
  /** Additional e-shop orders used ONLY for catalog enrichment when ERP is primary (hybrid). */
  eshopHybridOrders: OrderRecord[];
  /** All e-shop platforms with `connected: true`; used for catalog index even on ERP path. */
  catalogPlatforms: string[];
}

async function resolveOrdersForBrand(db: Firestore, brandId: string): Promise<DataSourceResult> {
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const conn = (connDoc.data() || {}) as Record<string, unknown>;

  const mv = conn.megaventory as Record<string, unknown> | undefined;
  const s1 = conn.softone as Record<string, unknown> | undefined;

  const connectedEshop = ['shopify', 'woocommerce', 'opencart', 'magento'].filter(
    (p) => Boolean((conn[p] as Record<string, unknown> | undefined)?.connected)
  );

  // ERP first
  if (mv?.connected) {
    const orders = await readMegaventoryOrders(db, brandId);
    if (orders.length > 0) {
      logger.info(`[RFM] ${brandId}: ERP source = megaventory_invoices, ${orders.length} invoices`);
      // Hybrid: also fetch e-shop orders for catalog enrichment (Megaventory invoices have no line items).
      let eshopHybridOrders: OrderRecord[] = [];
      if (connectedEshop.length > 0) {
        const eshopRes = await Promise.all(connectedEshop.map((p) => readEshopPlatformOrders(db, brandId, p)));
        eshopHybridOrders = eshopRes.flat();
        logger.info(`[RFM] ${brandId}: hybrid catalog enrichment from ${connectedEshop.join(',')} = ${eshopHybridOrders.length} orders`);
      }
      return {
        orders,
        dataSource: 'erp',
        platforms: ['megaventory'],
        guestOrdersSkipped: 0,
        eshopHybridOrders,
        catalogPlatforms: connectedEshop,
      };
    }
  }
  if (s1?.connected === true && s1?.syncSalesDocs === true) {
    const orders = await readSoftOneOrders(db, brandId);
    if (orders.length > 0) {
      logger.info(`[RFM] ${brandId}: ERP source = softone_sales_documents, ${orders.length} docs`);
      let eshopHybridOrders: OrderRecord[] = [];
      if (connectedEshop.length > 0) {
        const eshopRes = await Promise.all(connectedEshop.map((p) => readEshopPlatformOrders(db, brandId, p)));
        eshopHybridOrders = eshopRes.flat();
      }
      return {
        orders,
        dataSource: 'erp',
        platforms: ['softone'],
        guestOrdersSkipped: 0,
        eshopHybridOrders,
        catalogPlatforms: connectedEshop,
      };
    }
  }

  // E-shop fallback
  if (connectedEshop.length === 0) {
    return { orders: [], dataSource: 'eshop', platforms: [], guestOrdersSkipped: 0, eshopHybridOrders: [], catalogPlatforms: [] };
  }

  const results = await Promise.all(connectedEshop.map((p) => readEshopPlatformOrders(db, brandId, p)));
  const orders = results.flat();
  logger.info(`[RFM] ${brandId}: E-shop source = ${connectedEshop.join(',')}, ${orders.length} orders`);
  return {
    orders,
    dataSource: 'eshop',
    platforms: connectedEshop,
    guestOrdersSkipped: 0,
    eshopHybridOrders: [],
    catalogPlatforms: connectedEshop,
  };
}

// ─── Catalog index (mirror src/services/catalogAlignment.ts logic) ─────────

function normalizeSkuKey(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

function trimLabel(s: unknown): string {
  return String(s ?? '').trim();
}

function meaningfulLabel(value: unknown): string {
  const t = trimLabel(value);
  if (!t || t === '—') return '';
  if (/^\d+$/.test(t)) return '';
  return t;
}

function arrayLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return meaningfulLabel(item);
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return meaningfulLabel(o.name) || meaningfulLabel(o.label) || meaningfulLabel(o.title) || meaningfulLabel(o.value);
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

function pickFirst(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = meaningfulLabel(row[k]);
    if (v) return v;
  }
  return '';
}

function parseOpt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildCatalogDims(row: Record<string, unknown>, opts: { brandKeys?: string[]; categoryFallback?: string } = {}): CatalogDims {
  const brandKeys = opts.brandKeys || ['brand', 'manufacturerLabel', 'manufacturer', 'vendor'];
  const brand = pickFirst(row, brandKeys);
  const path =
    splitCategoryPath(row.categoryPath).length > 0
      ? splitCategoryPath(row.categoryPath)
      : arrayLabels(row.categoryNames).length > 0
        ? arrayLabels(row.categoryNames)
        : arrayLabels(row.categories);
  const explicitCategory = pickFirst(row, ['category', 'categoryName', 'productCategory']);
  const explicitSub = pickFirst(row, ['subcategory', 'subCategory', 'subcategoryName', 'productSubcategory']);
  const category = explicitCategory || path[0] || meaningfulLabel(opts.categoryFallback);
  const subcategory = explicitSub || (path.length > 1 ? path[path.length - 1] : '');
  const stockOnHand =
    parseOpt(row.stock_on_hand) ?? parseOpt(row.stockOnHand) ?? parseOpt(row.available_stock) ?? parseOpt(row.stock_level) ?? parseOpt(row.stockQuantity) ?? parseOpt(row.qty);
  const qtySold =
    parseOpt(row.qty_sold_period) ?? parseOpt(row.qty_sold_last_30d) ?? parseOpt(row.qty_sold_last_90d) ?? parseOpt(row.qty_sold_lifetime) ?? parseOpt(row.qtySold);
  return {
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    ...(subcategory && subcategory !== category ? { subcategory } : {}),
    ...(path.length ? { categoryPath: path } : {}),
    ...(stockOnHand != null ? { stockOnHand } : {}),
    ...(qtySold != null ? { qtySold } : {}),
  };
}

function setCatalogDims(map: Map<string, CatalogDims>, key: string, dims: CatalogDims): void {
  if (!key) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { ...dims });
    return;
  }
  map.set(key, {
    brand: dims.brand ?? prev.brand,
    category: dims.category ?? prev.category,
    subcategory: dims.subcategory ?? prev.subcategory,
    categoryPath: dims.categoryPath ?? prev.categoryPath,
    stockOnHand: dims.stockOnHand ?? prev.stockOnHand,
    qtySold: dims.qtySold ?? prev.qtySold,
  });
}

const PRODUCT_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_products',
  woocommerce: 'woo_products',
  magento: 'magento_products',
  opencart: 'opencart_products',
};

async function buildCatalogIndexes(db: Firestore, brandId: string, platforms: string[]): Promise<CatalogIndexes> {
  const idx: CatalogIndexes = { byProductId: new Map(), bySku: new Map(), erpBySku: new Map() };

  const eshop = platforms.filter((p) => PRODUCT_COLLECTIONS[p]);
  const tasks: Array<Promise<void>> = [];

  for (const platform of eshop) {
    const coll = PRODUCT_COLLECTIONS[platform];
    tasks.push(
      db.collection(coll).where('brandId', '==', brandId).get().then((snap) => {
        for (const doc of snap.docs) {
          const d = doc.data();
          const pid = trimLabel(d.productId) || trimLabel(d.id);
          if (platform === 'shopify') {
            const dims = buildCatalogDims(d, { brandKeys: ['vendor'], categoryFallback: trimLabel(d.productType) });
            if (pid) setCatalogDims(idx.byProductId, `${platform}:${pid}`, dims);
            const variants = Array.isArray(d.variants) ? d.variants : [];
            for (const v of variants as Array<{ sku?: string }>) {
              const ns = normalizeSkuKey(v?.sku);
              if (ns) setCatalogDims(idx.bySku, `${platform}:${ns}`, dims);
            }
          } else if (platform === 'woocommerce') {
            const tags = Array.isArray(d.tags) ? d.tags.map((t: unknown) => trimLabel(t)) : [];
            const dims = buildCatalogDims({ ...d, brand: tags[0] }, { brandKeys: ['brand', 'tags'] });
            if (pid) setCatalogDims(idx.byProductId, `${platform}:${pid}`, dims);
            const ns = normalizeSkuKey(d.sku);
            if (ns) setCatalogDims(idx.bySku, `${platform}:${ns}`, dims);
          } else if (platform === 'magento') {
            const dims = buildCatalogDims(d);
            if (pid) setCatalogDims(idx.byProductId, `${platform}:${pid}`, dims);
            const ns = normalizeSkuKey(d.sku);
            if (ns) setCatalogDims(idx.bySku, `${platform}:${ns}`, dims);
          } else if (platform === 'opencart') {
            const dims = buildCatalogDims(d);
            if (pid) setCatalogDims(idx.byProductId, `${platform}:${pid}`, dims);
            const ns = normalizeSkuKey(d.sku) || normalizeSkuKey(d.model);
            if (ns) setCatalogDims(idx.bySku, `${platform}:${ns}`, dims);
          }
        }
      })
    );
  }

  // Unified products (ERP / Procurement import)
  tasks.push(
    db.collection('products').where('brandId', '==', brandId).get().then((snap) => {
      for (const doc of snap.docs) {
        const d = doc.data();
        const ns = normalizeSkuKey(d.sku);
        if (!ns) continue;
        setCatalogDims(idx.erpBySku, ns, buildCatalogDims(d, { categoryFallback: trimLabel(d.category) }));
      }
    })
  );

  // Megaventory products (ERP without unified products import)
  tasks.push(
    db.collection('megaventory_products').where('brandId', '==', brandId).get().then((snap) => {
      for (const doc of snap.docs) {
        const d = doc.data();
        const ns = normalizeSkuKey(d.sku);
        if (!ns) continue;
        setCatalogDims(idx.erpBySku, ns, buildCatalogDims(d, { categoryFallback: trimLabel(d.category) }));
      }
    })
  );

  await Promise.all(tasks);
  return idx;
}

type ResolvedLine = {
  match: 'erp_product' | 'platform_catalog' | 'line_fallback';
  brand: string;
  category: string;
  subcategory: string;
  skuLabel: string;
  stockOnHand?: number;
  qtySold?: number;
  categoryPath?: string[];
};

function fallbackBucket(item: OrderLineItem): string {
  const t = item.productType?.trim().toLowerCase() || '';
  const ignore = new Set(['simple', 'configurable', 'grouped', 'bundle', 'virtual', 'downloadable']);
  if (item.productType && !ignore.has(t)) return item.productType.trim();
  return item.productName?.trim() || item.sku?.trim() || item.productId?.trim() || 'Άλλο';
}

function resolveCatalogLine(platform: string, item: OrderLineItem, indexes: CatalogIndexes): ResolvedLine {
  const skuNorm = normalizeSkuKey(item.sku);
  const pid = item.productId?.trim() || '';
  const fallback = fallbackBucket(item);
  const skuLabel = skuNorm || item.sku?.trim() || item.productName?.trim() || pid || 'Άλλο';

  if (skuNorm && indexes.erpBySku.has(skuNorm)) {
    const e = indexes.erpBySku.get(skuNorm)!;
    return {
      match: 'erp_product',
      brand: e.brand || 'Λοιπά',
      category: e.category || fallback,
      subcategory: e.subcategory || '',
      skuLabel,
      ...(e.stockOnHand != null ? { stockOnHand: e.stockOnHand } : {}),
      ...(e.qtySold != null ? { qtySold: e.qtySold } : {}),
      ...(e.categoryPath?.length ? { categoryPath: e.categoryPath } : {}),
    };
  }

  let dims: CatalogDims | undefined;
  if (pid) dims = indexes.byProductId.get(`${platform}:${pid}`);
  if (!dims && skuNorm) dims = indexes.bySku.get(`${platform}:${skuNorm}`);
  if (dims) {
    return {
      match: 'platform_catalog',
      brand: dims.brand || 'Λοιπά',
      category: dims.category || fallback,
      subcategory: dims.subcategory || '',
      skuLabel,
      ...(dims.stockOnHand != null ? { stockOnHand: dims.stockOnHand } : {}),
      ...(dims.qtySold != null ? { qtySold: dims.qtySold } : {}),
      ...(dims.categoryPath?.length ? { categoryPath: dims.categoryPath } : {}),
    };
  }

  return { match: 'line_fallback', brand: 'Λοιπά', category: fallback, subcategory: '', skuLabel };
}

// ─── RFM computation ──────────────────────────────────────────────────────────

const RFM_LOOKBACK_DAYS = 365;
const CUSTOMER_CHUNK_BYTES = 900_000;

function aggregateCustomers(orders: OrderRecord[]): CustomerAgg[] {
  const byKey = new Map<string, CustomerAgg>();
  for (const o of orders) {
    const existing = byKey.get(o.customerId);
    if (!existing) {
      byKey.set(o.customerId, {
        customerId: o.customerId,
        customerName: o.customerName,
        ...(o.email ? { email: o.email } : {}),
        orderCount: 1,
        revenue: o.revenue,
        lastOrderDate: o.date,
        firstOrderDate: o.date,
      });
    } else {
      existing.orderCount += 1;
      existing.revenue += o.revenue;
      if (!existing.email && o.email) existing.email = o.email;
      if (!existing.customerName && o.customerName) existing.customerName = o.customerName;
      if (o.date > existing.lastOrderDate) existing.lastOrderDate = o.date;
      if (o.date < existing.firstOrderDate) existing.firstOrderDate = o.date;
    }
  }
  return [...byKey.values()];
}

export async function computeRFMSegmentsForBrand(brandId: string): Promise<void> {
  const db = getDb();

  const {
    orders: rawOrders,
    dataSource,
    platforms,
    guestOrdersSkipped,
    eshopHybridOrders,
    catalogPlatforms,
  } = await resolveOrdersForBrand(db, brandId);
  if (rawOrders.length === 0) {
    logger.info(`[RFM] ${brandId}: no orders found, skipping computation`);
    return;
  }

  // Apply RFM lookback window (last 365 days from most recent order)
  const latestDate = rawOrders.reduce((best, o) => (o.date > best ? o.date : best), '');
  const cutoffDate = (() => {
    const d = new Date(latestDate);
    d.setDate(d.getDate() - RFM_LOOKBACK_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  const windowedOrders = rawOrders.filter((o) => o.date >= cutoffDate);
  const customers = aggregateCustomers(windowedOrders);

  if (customers.length === 0) {
    logger.info(`[RFM] ${brandId}: no customers after windowing`);
    return;
  }

  const asOf = new Date(latestDate + 'T23:59:59Z');
  const nowMs = asOf.getTime();

  const recencyDays = customers.map((c) => {
    const ms = new Date(c.lastOrderDate + 'T23:59:59Z').getTime();
    return Math.max(0, Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000)));
  });
  const frequencies = customers.map((c) => c.orderCount);
  const monetaries = customers.map((c) => c.revenue);

  const rScores = assignQuintileScores(recencyDays, true);
  const fScores = assignQuintileScores(frequencies, false);
  const mScores = assignQuintileScores(monetaries, false);

  // Build per-customer data + segment aggregates + customerId→segmentId map (for behavioral pass)
  const segmentMap = new Map<string, { name: string; count: number; revenue: number; orders: number }>();
  const customerRecords: RFMCustomer[] = [];
  const customerSegmentById = new Map<string, string>();
  const customerEmailToSegmentId = new Map<string, string>();

  customers.forEach((c, i) => {
    const r = rScores[i] ?? 3;
    const f = fScores[i] ?? 3;
    const m = mScores[i] ?? 3;
    const { id, name } = segmentFromRfmScores(r, f, m);

    customerRecords.push({
      customerId: c.customerId,
      customerName: c.customerName || c.customerId,
      ...(c.email ? { email: c.email } : {}),
      segment: name,
      segmentId: id,
      rfmScore: `${r}-${f}-${m}`,
      recencyScore: r,
      frequencyScore: f,
      monetaryScore: m,
      lastOrderDate: c.lastOrderDate,
      orderCount: c.orderCount,
      totalRevenue: Math.round(c.revenue * 100) / 100,
      avgOrderValue: Math.round((c.revenue / c.orderCount) * 100) / 100,
      daysSinceLastOrder: recencyDays[i] ?? 0,
    });

    customerSegmentById.set(c.customerId, id);
    if (c.email) customerEmailToSegmentId.set(c.email.toLowerCase(), id);

    const seg = segmentMap.get(id) ?? { name, count: 0, revenue: 0, orders: 0 };
    seg.count += 1;
    seg.revenue += c.revenue;
    seg.orders += c.orderCount;
    segmentMap.set(id, seg);
  });

  const totalCustomers = customers.length;
  const segments: RFMSegmentSummary[] = [...segmentMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([segId, seg]) => ({
      segment: seg.name,
      segmentId: segId,
      count: seg.count,
      revenue: Math.round(seg.revenue * 100) / 100,
      avgOrderValue: seg.orders > 0 ? Math.round((seg.revenue / seg.orders) * 100) / 100 : 0,
      pct: totalCustomers > 0 ? Math.round((seg.count / totalCustomers) * 1000) / 10 : 0,
    }));

  // ─── Per-segment behavioral computation (single pass over orders) ─────────
  let segmentBehavioral: Map<string, PerSegmentBehavioral>;
  try {
    segmentBehavioral = await computeSegmentBehavioral({
      db,
      brandId,
      catalogPlatforms,
      primaryOrders: windowedOrders,
      hybridEshopOrders: eshopHybridOrders.filter((o) => o.date >= cutoffDate),
      customerSegmentById,
      customerEmailToSegmentId,
      segmentRevenueById: new Map(segmentMap.entries()),
      dataSource,
    });
  } catch (e) {
    logger.warn(`[RFM] ${brandId}: behavioral computation failed, continuing without it:`, e);
    segmentBehavioral = new Map();
  }

  // ─── Migration vs previous snapshot ──────────────────────────────────────
  const migration = await computeMigrationVsPrevious(db, brandId, customerRecords, segments);

  // ─── Write to Firestore ──────────────────────────────────────────────────
  await writeRfmComputedDoc(db, brandId, {
    dataSource,
    platforms,
    totalCustomers,
    totalOrders: windowedOrders.length,
    ordersAttributed: windowedOrders.length,
    guestOrdersSkipped,
    segments,
    customers: customerRecords,
    migration,
    segmentBehavioral,
  });

  // Monthly snapshot
  const yyyyMM = latestDate.slice(0, 7).replace('-', '');
  await db.doc(`rfm_snapshots/${brandId}/history/${yyyyMM}`).set({
    brandId,
    computedAt: FieldValue.serverTimestamp(),
    dataSource,
    dataSourcePlatforms: platforms,
    totalCustomers,
    totalOrders: windowedOrders.length,
    segments,
    month: yyyyMM,
  });

  logger.info(
    `[RFM] ${brandId}: computed segments=${segments.length} customers=${totalCustomers} source=${dataSource}:${platforms.join(',')} behavioralSegments=${segmentBehavioral.size}`
  );
}

// ─── Per-segment behavioral aggregation ─────────────────────────────────────

interface BehavioralBucket {
  segmentRevenue: number;
  segmentOrders: number;
  byBrand: Map<string, AffinityAgg>;
  byCategory: Map<string, AffinityAgg>;
  bySubcategory: Map<string, AffinityAgg>;
  bySku: Map<string, AffinityAgg>;
  byChannel: Map<string, { orders: Set<string>; revenue: number }>;
  lineCount: number;
  matchedLineCount: number;
  lineRevenue: number;
  matchedLineRevenue: number;
  /** All order line revenue (incl. ERP without items) + ERP customer revenue → for price_sensitivity heuristic. */
  basketSizes: number[];
}

interface AffinityAgg {
  revenue: number;
  qty: number;
  orderIds: Set<string>;
  skuKeys: Set<string>;
  stockOnHand?: number;
  qtySold?: number;
  categoryPath?: string[];
}

function emptyBehavioralBucket(): BehavioralBucket {
  return {
    segmentRevenue: 0,
    segmentOrders: 0,
    byBrand: new Map(),
    byCategory: new Map(),
    bySubcategory: new Map(),
    bySku: new Map(),
    byChannel: new Map(),
    lineCount: 0,
    matchedLineCount: 0,
    lineRevenue: 0,
    matchedLineRevenue: 0,
    basketSizes: [],
  };
}

function bumpAffinity(
  map: Map<string, AffinityAgg>,
  key: string,
  revenue: number,
  qty: number,
  orderId: string,
  skuKey: string,
  stockOnHand?: number,
  qtySold?: number,
  categoryPath?: string[]
): void {
  const k = key.trim();
  if (!k) return;
  const cur = map.get(k) ?? {
    revenue: 0,
    qty: 0,
    orderIds: new Set<string>(),
    skuKeys: new Set<string>(),
  };
  cur.revenue += revenue;
  cur.qty += qty;
  cur.orderIds.add(orderId);
  const sk = skuKey.trim();
  if (sk && !cur.skuKeys.has(sk)) {
    cur.skuKeys.add(sk);
    if (stockOnHand != null) cur.stockOnHand = (cur.stockOnHand ?? 0) + stockOnHand;
    if (qtySold != null) cur.qtySold = (cur.qtySold ?? 0) + qtySold;
    if (!cur.categoryPath?.length && categoryPath?.length) cur.categoryPath = categoryPath;
  }
  map.set(k, cur);
}

function affinityRows(map: Map<string, AffinityAgg>, segmentRevenue: number, topN: number): AffinityRow[] {
  const rows = [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, topN);
  if (rows.length === 0) return [];
  const maxRev = rows[0][1].revenue || 1;
  const seg = Math.max(segmentRevenue, 1e-6);
  return rows.map(([name, row]) => ({
    name,
    affinity: Math.round((row.revenue / maxRev) * 100) / 100,
    avg_order: row.qty > 0 ? Math.round(row.revenue / row.qty) : Math.round(row.revenue),
    revenue_eur: Math.round(row.revenue * 100) / 100,
    revenue_share_pct: Math.round((row.revenue / seg) * 1000) / 10,
    ...(row.stockOnHand != null && row.stockOnHand > 0 ? { stock_on_hand: Math.round(row.stockOnHand * 100) / 100 } : {}),
    ...(row.qtySold != null && row.qtySold > 0 ? { qty_sold: Math.round(row.qtySold * 100) / 100 } : {}),
    ...(row.categoryPath?.length ? { category_path: row.categoryPath } : {}),
  }));
}

interface BehavioralInput {
  db: Firestore;
  brandId: string;
  catalogPlatforms: string[];
  primaryOrders: OrderRecord[];
  hybridEshopOrders: OrderRecord[];
  customerSegmentById: Map<string, string>;
  customerEmailToSegmentId: Map<string, string>;
  segmentRevenueById: Map<string, { name: string; count: number; revenue: number; orders: number }>;
  dataSource: 'erp' | 'eshop';
}

async function computeSegmentBehavioral(input: BehavioralInput): Promise<Map<string, PerSegmentBehavioral>> {
  const { db, brandId, catalogPlatforms, primaryOrders, hybridEshopOrders, customerSegmentById, customerEmailToSegmentId, segmentRevenueById, dataSource } = input;

  const catalogIndexes = await buildCatalogIndexes(db, brandId, catalogPlatforms);
  logger.info(
    `[RFM] ${brandId}: catalog index — byProductId=${catalogIndexes.byProductId.size} bySku=${catalogIndexes.bySku.size} erpBySku=${catalogIndexes.erpBySku.size}`
  );

  const buckets = new Map<string, BehavioralBucket>();
  for (const segId of segmentRevenueById.keys()) buckets.set(segId, emptyBehavioralBucket());

  // Pass 1: primary orders → channel distribution, basket sizes, line items if any
  let totalLineItemsSeen = 0;
  for (const order of primaryOrders) {
    const segId = customerSegmentById.get(order.customerId);
    if (!segId) continue;
    const bucket = buckets.get(segId);
    if (!bucket) continue;
    bucket.segmentRevenue += order.revenue;
    bucket.segmentOrders += 1;
    bucket.basketSizes.push(order.revenue);

    const ch = bucket.byChannel.get(order.platform) ?? { orders: new Set<string>(), revenue: 0 };
    ch.orders.add(`${order.customerId}|${order.date}|${order.revenue}`);
    ch.revenue += order.revenue;
    bucket.byChannel.set(order.platform, ch);

    if (order.lineItems?.length) {
      totalLineItemsSeen += order.lineItems.length;
      for (const li of order.lineItems) {
        const resolved = resolveCatalogLine(order.platform, li, catalogIndexes);
        const orderId = `${order.customerId}|${order.date}|${order.platform}`;
        bucket.lineCount += 1;
        bucket.lineRevenue += li.revenue;
        if (resolved.match !== 'line_fallback') {
          bucket.matchedLineCount += 1;
          bucket.matchedLineRevenue += li.revenue;
        }
        bumpAffinity(bucket.byBrand, resolved.brand, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
        bumpAffinity(bucket.byCategory, resolved.category, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
        if (resolved.subcategory && resolved.subcategory.toLowerCase() !== resolved.category.toLowerCase()) {
          bumpAffinity(bucket.bySubcategory, resolved.subcategory, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
        }
        bumpAffinity(bucket.bySku, resolved.skuLabel, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
      }
    }
  }

  // Pass 2: ERP-primary brands with e-shop also connected → enrich catalog via email match.
  // We DO NOT touch segment revenue (RFM customer list stays ERP); we only attribute line items.
  let hybridMatched = 0;
  let hybridSkipped = 0;
  if (dataSource === 'erp' && hybridEshopOrders.length > 0) {
    for (const eOrder of hybridEshopOrders) {
      const email = (eOrder.email || '').toLowerCase();
      const segId = email ? customerEmailToSegmentId.get(email) : undefined;
      if (!segId) {
        hybridSkipped += 1;
        continue;
      }
      const bucket = buckets.get(segId);
      if (!bucket) {
        hybridSkipped += 1;
        continue;
      }
      hybridMatched += 1;
      if (eOrder.lineItems?.length) {
        for (const li of eOrder.lineItems) {
          const resolved = resolveCatalogLine(eOrder.platform, li, catalogIndexes);
          const orderId = `${eOrder.customerId}|${eOrder.date}|${eOrder.platform}`;
          bucket.lineCount += 1;
          bucket.lineRevenue += li.revenue;
          if (resolved.match !== 'line_fallback') {
            bucket.matchedLineCount += 1;
            bucket.matchedLineRevenue += li.revenue;
          }
          bumpAffinity(bucket.byBrand, resolved.brand, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
          bumpAffinity(bucket.byCategory, resolved.category, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
          if (resolved.subcategory && resolved.subcategory.toLowerCase() !== resolved.category.toLowerCase()) {
            bumpAffinity(bucket.bySubcategory, resolved.subcategory, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
          }
          bumpAffinity(bucket.bySku, resolved.skuLabel, li.revenue, li.qty, orderId, resolved.skuLabel, resolved.stockOnHand, resolved.qtySold, resolved.categoryPath);
        }
      }
    }
    logger.info(`[RFM] ${brandId}: hybrid catalog match — matched=${hybridMatched} skipped(no-email-match)=${hybridSkipped}`);
  }

  logger.info(
    `[RFM] ${brandId}: behavioral pass — primaryLineItems=${totalLineItemsSeen} hybridOrdersMatched=${hybridMatched}`
  );

  // Compute global AOV to anchor price_sensitivity
  const globalAovValues: number[] = [];
  for (const order of primaryOrders) globalAovValues.push(order.revenue);
  const globalAov = globalAovValues.length > 0
    ? globalAovValues.reduce((a, b) => a + b, 0) / globalAovValues.length
    : 0;

  const out = new Map<string, PerSegmentBehavioral>();
  for (const [segId, bucket] of buckets) {
    const segRevenue = bucket.segmentRevenue;
    const hasLines = bucket.lineCount > 0;

    const catalog_match = hasLines
      ? {
          revenue_matched_pct: bucket.lineRevenue > 0 ? Math.round((bucket.matchedLineRevenue / bucket.lineRevenue) * 1000) / 10 : 0,
          lines_matched_pct: bucket.lineCount > 0 ? Math.round((bucket.matchedLineCount / bucket.lineCount) * 1000) / 10 : 0,
          lines_total: bucket.lineCount,
          lines_matched: bucket.matchedLineCount,
        }
      : null;

    // Price sensitivity heuristic — mirrors client logic.
    const avgBasket = bucket.segmentOrders > 0 ? segRevenue / bucket.segmentOrders : 0;
    let priceSensitivity: 'low' | 'medium' | 'high' | null = null;
    if (avgBasket > 0 && globalAov > 0) {
      if (avgBasket >= globalAov * 1.25) priceSensitivity = 'low';
      else if (avgBasket < globalAov * 0.75) priceSensitivity = 'high';
      else priceSensitivity = 'medium';
    }

    // Preferred channels: by orders.
    const totalChannelOrders = [...bucket.byChannel.values()].reduce((sum, v) => sum + v.orders.size, 0);
    const channelRows: PreferredChannel[] = [...bucket.byChannel.entries()]
      .map(([channel, v]) => ({
        channel,
        orders: v.orders.size,
        revenue: Math.round(v.revenue * 100) / 100,
        share_pct: totalChannelOrders > 0 ? Math.round((v.orders.size / totalChannelOrders) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.orders - a.orders);

    out.set(segId, {
      catalog_match,
      brand_affinity: affinityRows(bucket.byBrand, segRevenue, 12),
      category_affinity: hasLines
        ? affinityRows(bucket.byCategory, segRevenue, 12)
        : [],
      category_affinity_catalog: hasLines ? affinityRows(bucket.byCategory, segRevenue, 12) : [],
      subcategory_affinity: affinityRows(bucket.bySubcategory, segRevenue, 12),
      sku_affinity: affinityRows(bucket.bySku, segRevenue, 20),
      price_sensitivity: priceSensitivity,
      preferred_channels: channelRows,
    });
  }

  return out;
}

// ─── Chunked customer storage (mirrors writeSkuStatsChunked pattern) ─────────

interface WriteRfmInput {
  dataSource: 'erp' | 'eshop';
  platforms: string[];
  totalCustomers: number;
  totalOrders: number;
  ordersAttributed: number;
  guestOrdersSkipped: number;
  segments: RFMSegmentSummary[];
  customers: RFMCustomer[];
  migration: MigrationResult;
  segmentBehavioral: Map<string, PerSegmentBehavioral>;
}

async function writeRfmComputedDoc(db: Firestore, brandId: string, input: WriteRfmInput): Promise<void> {
  const {
    dataSource, platforms, totalCustomers, totalOrders,
    ordersAttributed, guestOrdersSkipped, segments, customers, migration, segmentBehavioral,
  } = input;

  const fullJson = JSON.stringify(customers);
  const chunkPayloads: string[] = [];

  if (fullJson.length <= CUSTOMER_CHUNK_BYTES) {
    chunkPayloads.push(fullJson);
  } else {
    let chunk: RFMCustomer[] = [];
    let chunkBytes = 2; // [] wrapper
    for (const c of customers) {
      const entry = JSON.stringify(c) + ',';
      if (chunkBytes + entry.length > CUSTOMER_CHUNK_BYTES && chunk.length > 0) {
        chunkPayloads.push(JSON.stringify(chunk));
        chunk = [];
        chunkBytes = 2;
      }
      chunk.push(c);
      chunkBytes += entry.length;
    }
    if (chunk.length > 0) chunkPayloads.push(JSON.stringify(chunk));
  }

  const parentRef = db.doc(`rfm_computed/${brandId}`);
  const chunksColl = parentRef.collection('chunks');

  await Promise.all(
    chunkPayloads.map((json, idx) =>
      chunksColl.doc(String(idx)).set({
        customersJson: json,
        updatedAt: FieldValue.serverTimestamp(),
      })
    )
  );

  // Delete stale chunks
  const existing = await chunksColl.listDocuments();
  const stale = existing.filter((d) => {
    const idx = Number.parseInt(d.id, 10);
    return Number.isFinite(idx) && idx >= chunkPayloads.length;
  });
  if (stale.length) await Promise.all(stale.map((d) => d.delete()));

  // Per-segment behavioral subcollection
  const segmentsColl = parentRef.collection('segments');
  const segmentDocsWritten: string[] = [];
  await Promise.all(
    [...segmentBehavioral.entries()].map(async ([segId, behavioral]) => {
      const segMeta = segments.find((s) => s.segmentId === segId);
      await segmentsColl.doc(segId).set({
        brandId,
        segmentId: segId,
        segmentName: segMeta?.segment || segId,
        count: segMeta?.count ?? 0,
        revenue: segMeta?.revenue ?? 0,
        avgOrderValue: segMeta?.avgOrderValue ?? 0,
        pct: segMeta?.pct ?? 0,
        behavioral,
        computedAt: FieldValue.serverTimestamp(),
      });
      segmentDocsWritten.push(segId);
    })
  );

  // Delete stale segment docs (e.g. segments that disappeared between runs)
  const existingSegments = await segmentsColl.listDocuments();
  const staleSegments = existingSegments.filter((d) => !segmentBehavioral.has(d.id));
  if (staleSegments.length) await Promise.all(staleSegments.map((d) => d.delete()));

  await parentRef.set({
    brandId,
    computedAt: FieldValue.serverTimestamp(),
    dataSource,
    dataSourcePlatforms: platforms,
    totalCustomers,
    totalOrders,
    ordersAttributed,
    guestOrdersSkipped,
    segments,
    chunkCount: chunkPayloads.length,
    customersBytes: fullJson.length,
    migration,
    segmentDocCount: segmentDocsWritten.length,
  });

  logger.info(
    `[RFM] ${brandId}: customers persisted — ${totalCustomers} customers across ${chunkPayloads.length} chunk(s) (~${(fullJson.length / 1024).toFixed(1)}KB) · segmentDocs=${segmentDocsWritten.length}`
  );
}

// ─── Migration computation ───────────────────────────────────────────────────

interface PrevSnapshot {
  computedAt: FirebaseFirestore.Timestamp | null;
  segments: RFMSegmentSummary[];
  customers: RFMCustomer[];
}

/**
 * Reads previous snapshot (parent doc + chunked customers).
 * Returns null if no prior data exists.
 * Reads at most MIGRATION_MAX_CHUNKS chunks to bound memory; older brands with
 * massive customer bases will diff only against the prefix.
 */
async function readPreviousSnapshot(db: Firestore, brandId: string): Promise<PrevSnapshot | null> {
  const parentRef = db.doc(`rfm_computed/${brandId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) return null;

  const data = parentSnap.data() ?? {};
  const computedAt = (data.computedAt as FirebaseFirestore.Timestamp | undefined) ?? null;
  const segments = Array.isArray(data.segments) ? (data.segments as RFMSegmentSummary[]) : [];
  const declaredChunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 0;
  if (declaredChunkCount === 0) {
    return { computedAt, segments, customers: [] };
  }

  const chunksColl = parentRef.collection('chunks');
  const limit = Math.min(declaredChunkCount, MIGRATION_MAX_CHUNKS);
  const chunkSnap = await chunksColl.limit(limit).get();

  const customers: RFMCustomer[] = [];
  for (const doc of chunkSnap.docs) {
    const json = doc.get('customersJson');
    if (typeof json !== 'string' || !json) continue;
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) customers.push(...(parsed as RFMCustomer[]));
    } catch (e) {
      logger.warn(`[RFM] ${brandId}: failed to parse chunk ${doc.id} for migration`, e);
    }
  }

  return { computedAt, segments, customers };
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

async function computeMigrationVsPrevious(
  db: Firestore,
  brandId: string,
  newCustomers: RFMCustomer[],
  newSegments: RFMSegmentSummary[]
): Promise<MigrationResult> {
  const prev = await readPreviousSnapshot(db, brandId);
  if (!prev || prev.customers.length === 0) {
    return EMPTY_MIGRATION;
  }

  const prevById = new Map<string, RFMCustomer>();
  for (const c of prev.customers) prevById.set(c.customerId, c);

  const newById = new Map<string, RFMCustomer>();
  for (const c of newCustomers) newById.set(c.customerId, c);

  // Resolve segment names from both snapshots (new takes precedence).
  const segmentNameById = new Map<string, string>();
  for (const s of prev.segments) segmentNameById.set(s.segmentId, s.segment);
  for (const s of newSegments) segmentNameById.set(s.segmentId, s.segment);

  type FlowAgg = MigrationFlow & { _ranking: Array<{ id: string; revenue: number }> };
  const flowMap = new Map<string, FlowAgg>();
  let comparedCustomers = 0;

  for (const [customerId, prevCust] of prevById) {
    const next = newById.get(customerId);
    if (!next) continue;
    comparedCustomers += 1;
    if (prevCust.segmentId === next.segmentId) continue;

    const key = `${prevCust.segmentId}->${next.segmentId}`;
    const fromName = segmentNameById.get(prevCust.segmentId) || prevCust.segment || prevCust.segmentId;
    const toName = segmentNameById.get(next.segmentId) || next.segment || next.segmentId;
    const revenue = next.totalRevenue || 0;

    let flow = flowMap.get(key);
    if (!flow) {
      flow = {
        from: prevCust.segmentId,
        fromName,
        to: next.segmentId,
        toName,
        count: 0,
        revenue: 0,
        sampleCustomerIds: [],
        _ranking: [],
      };
      flowMap.set(key, flow);
    }
    flow.count += 1;
    flow.revenue += revenue;
    flow._ranking.push({ id: customerId, revenue });
  }

  const flows: MigrationFlow[] = [...flowMap.values()]
    .map((f) => ({
      from: f.from,
      fromName: f.fromName,
      to: f.to,
      toName: f.toName,
      count: f.count,
      revenue: Math.round(f.revenue * 100) / 100,
      sampleCustomerIds: f._ranking
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map((x) => x.id),
    }))
    .sort((a, b) => b.count - a.count);

  // Segment-level deltas (union of all segment ids across both snapshots).
  const prevSegMap = new Map<string, RFMSegmentSummary>();
  for (const s of prev.segments) prevSegMap.set(s.segmentId, s);
  const newSegMap = new Map<string, RFMSegmentSummary>();
  for (const s of newSegments) newSegMap.set(s.segmentId, s);

  const allSegIds = new Set<string>([...prevSegMap.keys(), ...newSegMap.keys()]);
  const segmentDeltas: SegmentDelta[] = [];
  for (const segId of allSegIds) {
    const prevS = prevSegMap.get(segId);
    const newS = newSegMap.get(segId);
    const prevCount = prevS?.count ?? 0;
    const newCount = newS?.count ?? 0;
    const prevRevenue = prevS?.revenue ?? 0;
    const newRevenue = newS?.revenue ?? 0;
    segmentDeltas.push({
      segmentId: segId,
      segmentName: segmentNameById.get(segId) || newS?.segment || prevS?.segment || segId,
      prevCount,
      newCount,
      countDelta: newCount - prevCount,
      prevRevenue: Math.round(prevRevenue * 100) / 100,
      newRevenue: Math.round(newRevenue * 100) / 100,
      revenueDelta: Math.round((newRevenue - prevRevenue) * 100) / 100,
    });
  }
  segmentDeltas.sort((a, b) => Math.abs(b.countDelta) - Math.abs(a.countDelta));

  const periodDays = prev.computedAt ? daysBetween(prev.computedAt.toDate(), new Date()) : 30;
  const totalFlowsCount = flows.reduce((sum, f) => sum + f.count, 0);

  logger.info(
    `[RFM] ${brandId}: migration computed — comparedCustomers=${comparedCustomers} flows=${flows.length} totalMoved=${totalFlowsCount} periodDays=${periodDays}`
  );

  return {
    comparedAt: prev.computedAt,
    periodDays,
    comparedCustomers,
    totalFlowsCount,
    flows,
    segmentDeltas,
  };
}
