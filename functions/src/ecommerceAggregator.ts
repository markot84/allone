/** Reads platform order collections and writes summary metrics to ecommerce_summary/{brandId}. */

import * as admin from 'firebase-admin';
import { type Firestore, type QueryDocumentSnapshot, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import {
  aggregateOrderLinesForTopProducts,
  shouldSkipMagentoLineForTopProducts,
  filterMagentoLineItemsForTopProducts,
} from './productLineStats';
import {
  classifyEcommerceOrder,
  isExcludedEcommerceStatus,
  mergeSalesChannelRulesForBrand,
  type EcommerceExclusionReason,
  type EcommerceSalesChannel,
} from './ecommerceSalesChannel';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

/** Writes SKU stats in <900KB chunks under sku_stats/{brandId}/chunks/{idx} (parent holds metadata)
 * to stay under the Firestore 1 MiB/doc limit; stale chunks are deleted. */
const SKU_STATS_CHUNK_BYTES = 900_000;

type SkuStatsRow = {
  stock: number;
  sold: number;
  sold7d: number;
  sold30d: number;
  sold90d: number;
  lastSaleAt: string | null;
};

async function writeSkuStatsChunked(
  db: Firestore,
  brandId: string,
  skuStats: Record<string, SkuStatsRow>,
  skuCount: number
): Promise<void> {
  const fullJson = JSON.stringify(skuStats);
  const chunkPayloads: { json: string; count: number }[] = [];

  if (fullJson.length <= SKU_STATS_CHUNK_BYTES) {
    chunkPayloads.push({ json: fullJson, count: skuCount });
  } else {
    /** Split alphabetically to stay deterministic per run. Each chunk as close to the limit as possible. */
    const skus = Object.keys(skuStats).sort();
    let bucket: Record<string, SkuStatsRow> = {};
    let bucketBytes = 2;

    for (const sku of skus) {
      const entryJson = JSON.stringify({ [sku]: skuStats[sku] });
      const entryBytes = entryJson.length - 2;
      if (bucketBytes + entryBytes > SKU_STATS_CHUNK_BYTES && Object.keys(bucket).length > 0) {
        chunkPayloads.push({ json: JSON.stringify(bucket), count: Object.keys(bucket).length });
        bucket = {};
        bucketBytes = 2;
      }
      bucket[sku] = skuStats[sku];
      bucketBytes += entryBytes + (Object.keys(bucket).length > 1 ? 1 : 0);
    }
    if (Object.keys(bucket).length > 0) {
      chunkPayloads.push({ json: JSON.stringify(bucket), count: Object.keys(bucket).length });
    }
  }

  const parentRef = db.doc(`sku_stats/${brandId}`);
  const chunksColl = parentRef.collection('chunks');

  const writes = chunkPayloads.map((payload, idx) =>
    chunksColl.doc(String(idx)).set({
      skuStatsJson: payload.json,
      skuCount: payload.count,
      updatedAt: FieldValue.serverTimestamp(),
    })
  );
  await Promise.all(writes);

  /** Delete old chunks (if a previous run had more chunks). */
  const existing = await chunksColl.listDocuments();
  const stale = existing.filter((d) => {
    const idx = Number.parseInt(d.id, 10);
    return Number.isFinite(idx) && idx >= chunkPayloads.length;
  });
  if (stale.length) {
    await Promise.all(stale.map((d) => d.delete()));
  }

  await parentRef.set(
    {
      chunkCount: chunkPayloads.length,
      skuStatsCount: skuCount,
      bytes: fullJson.length,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info(
    `[EcommerceAgg] skuStats persisted for ${brandId}: ${skuCount} SKUs across ${chunkPayloads.length} chunk(s) (~${(fullJson.length / 1024).toFixed(1)}KB)`
  );
}

interface OrderRow {
  totalPrice: number;
  createdAt: string;
  platform: string;
  status: string;
  orderId: string;
  orderName?: string;
  currency: string;
  paymentMethod?: string;
  shippingMethod?: string;
  customerEmail?: string;
  customerName?: string;
  magentoStoreId?: number;
  orderStoreDomain?: string;
  salesChannel?: EcommerceSalesChannel;
  revenueIncluded?: boolean;
  exclusionReason?: EcommerceExclusionReason;
  lineItems?: Array<{
    sku?: string;
    title?: string;
    name?: string;
    quantity?: number;
    price?: number;
    productType?: string;
    itemId?: string | number | null;
    parentItemId?: string | number | null;
    rowTotal?: number;
  }>;
}

export const ECOMMERCE_PROVIDERS = ['shopify', 'woocommerce', 'opencart', 'magento'] as const;

function isCancelledOrderStatus(status: string | null | undefined): boolean {
  return isExcludedEcommerceStatus(status);
}

const OMIT_FROM_RECENT_ORDER_LIST = new Set(['viva_klarna_undefined']);

function isOmittedFromRecentOrderList(status: string | null | undefined): boolean {
  return OMIT_FROM_RECENT_ORDER_LIST.has(String(status || '').trim().toLowerCase());
}

/** Demo products (name/SKU contains "demo") are excluded from every aggregate. */
function isDemoLineItem(li: { sku?: string; title?: string; name?: string }): boolean {
  const needle = 'demo';
  const s = `${li.sku || ''} ${li.title || ''} ${li.name || ''}`.toLowerCase();
  return s.includes(needle);
}

/** Net revenue of an order after removing demo line items. */
function nonDemoRevenue(o: OrderRow): { revenue: number; isAllDemo: boolean } {
  const items = o.lineItems || [];
  if (items.length === 0) {
    // Fallback: lineItems unknown -> keep the order
    return { revenue: o.totalPrice, isAllDemo: false };
  }
  let demoTotal = 0;
  let nonDemoCount = 0;
  for (const li of items) {
    if (isDemoLineItem(li)) {
      demoTotal += (li.price || 0) * (li.quantity || 1);
    } else {
      nonDemoCount++;
    }
  }
  const revenue = Math.max(0, o.totalPrice - demoTotal);
  return { revenue, isAllDemo: nonDemoCount === 0 };
}

const COLLECTION_MAP: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

const PRODUCT_COLLECTION_MAP: Record<string, string> = {
  shopify: 'shopify_products',
  woocommerce: 'woo_products',
  opencart: 'opencart_products',
  magento: 'magento_products',
};

/** Reads product collections from each platform and returns a map SKU -> stock.
 * Used for the Price Benchmarking table (Stock column). */
export async function readPlatformStockBySku(
  db: Firestore,
  brandId: string,
  platform: string
): Promise<Map<string, number>> {
  const coll = PRODUCT_COLLECTION_MAP[platform];
  const out = new Map<string, number>();
  if (!coll) return out;

  // Perf: project only stock-bearing fields per platform; full-doc reads over a large catalog cost minutes of I/O.
  const STOCK_FIELDS: Record<string, string[]> = {
    shopify: ['variants'],
    woocommerce: ['sku', 'stockQuantity'],
    opencart: ['sku', 'model', 'quantity'],
    magento: ['sku', 'stockQuantity'],
  };
  const fields = STOCK_FIELDS[platform];
  let query = db.collection(coll).where('brandId', '==', brandId);
  if (fields) query = query.select(...fields) as typeof query;
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    if (platform === 'shopify') {
      for (const v of (d.variants || []) as Array<{ sku?: string; inventoryQuantity?: number | null }>) {
        const sku = (v.sku || '').trim();
        if (!sku) continue;
        const qty = typeof v.inventoryQuantity === 'number' ? v.inventoryQuantity : 0;
        out.set(sku, (out.get(sku) || 0) + qty);
      }
    } else if (platform === 'woocommerce') {
      const sku = (d.sku || '').trim();
      if (!sku) continue;
      const qty = typeof d.stockQuantity === 'number' ? d.stockQuantity : 0;
      out.set(sku, (out.get(sku) || 0) + qty);
    } else if (platform === 'opencart') {
      const sku = (d.sku || d.model || '').trim();
      if (!sku) continue;
      const qty = typeof d.quantity === 'number' ? d.quantity : 0;
      out.set(sku, (out.get(sku) || 0) + qty);
    } else if (platform === 'magento') {
      const sku = (d.sku || '').trim();
      if (!sku) continue;
      const qty = typeof d.stockQuantity === 'number' ? d.stockQuantity : 0;
      out.set(sku, (out.get(sku) || 0) + qty);
    }
  }
  return out;
}

const REVENUE_FIELD: Record<string, string> = {
  shopify: 'totalPrice',
  woocommerce: 'total',
  opencart: 'total',
  magento: 'grandTotal',
};

const TAX_FIELD: Record<string, string> = {
  shopify: 'totalTax',
  woocommerce: 'totalTax',
  opencart: 'totalTax',
  magento: 'taxAmount',
};

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Net products revenue ex-VAT. Magento: `baseSubtotal − |baseDiscountAmount|` (EUR fallback
 * `subtotal − |discountAmount|`; non-EUR without base_* → 0). Else `total − tax`. */
function computeOrderExVatRevenue(platform: string, d: Record<string, unknown>): number {
  if (platform === 'magento') {
    const baseSubtotal = parseNumeric(d.baseSubtotal);
    const baseDiscount = Math.abs(parseNumeric(d.baseDiscountAmount));
    if (baseSubtotal > 0) {
      return Math.max(0, baseSubtotal - baseDiscount);
    }
    const currency = String(d.currency || '').toUpperCase();
    const baseCurrency = String(d.baseCurrencyCode || '').toUpperCase();
    const isEur = !currency || currency === 'EUR' || (baseCurrency && currency === baseCurrency);
    if (!isEur) {
      return 0;
    }
    const subtotal = parseNumeric(d.subtotal);
    const discount = Math.abs(parseNumeric(d.discountAmount));
    if (subtotal > 0) {
      return Math.max(0, subtotal - discount);
    }
    return Math.max(0, parseNumeric(d.grandTotal) - parseNumeric(d.taxAmount));
  }
  const revenueField = REVENUE_FIELD[platform] || 'totalPrice';
  const taxField = TAX_FIELD[platform];
  const gross = parseNumeric(d[revenueField]);
  const tax = taxField ? parseNumeric(d[taxField]) : 0;
  return Math.max(0, gross - tax);
}

/** Read orders from a single platform collection for the brand (full history in Firestore). */
async function readPlatformOrders(db: Firestore, brandId: string, platform: string): Promise<OrderRow[]> {
  const collection = COLLECTION_MAP[platform];
  if (!collection) return [];

  const snap = await db
    .collection(collection)
    .where('brandId', '==', brandId)
    .get();

  const rows: OrderRow[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const createdAt = d.createdAt || '';

    const price = computeOrderExVatRevenue(platform, d);

    const sid =
      platform === 'magento'
        ? Number(d.magentoStoreId ?? (d as { store_id?: unknown }).store_id)
        : NaN;
    const magentoStoreId =
      platform === 'magento' && Number.isFinite(sid) && sid > 0 ? sid : undefined;
    const osdRaw = d.orderStoreDomain ?? (d as { order_store_domain?: unknown }).order_store_domain;
    const orderStoreDomain =
      platform === 'magento' && typeof osdRaw === 'string' && osdRaw.trim()
        ? String(osdRaw).trim().toLowerCase().replace(/^www\./, '')
        : undefined;

    rows.push({
      totalPrice: price,
      createdAt,
      platform,
      status: d.status || d.financialStatus || d.financial_status || '',
      orderId: d.orderId || d.incrementId || doc.id,
      orderName: d.orderName || d.orderNumber || d.incrementId || '',
      currency: d.currency || 'EUR',
      paymentMethod: d.paymentMethod || d.payment_method || '',
      shippingMethod: d.shippingMethod || d.shipping_method || d.shippingDescription || '',
      customerEmail: d.customerEmail || d.customer_email || '',
      ...(d.customerName ? { customerName: String(d.customerName) } : {}),
      lineItems: d.lineItems || [],
      ...(magentoStoreId != null ? { magentoStoreId } : {}),
      ...(orderStoreDomain ? { orderStoreDomain } : {}),
    });
  }

  return rows;
}

type ErpRevenueBackendId = 'megaventory_invoices' | 'softone_sales_documents';

function resolveErpRevenueBackend(connData: Record<string, unknown>): ErpRevenueBackendId | null {
  const mv = connData.megaventory as Record<string, unknown> | undefined;
  if (mv?.connected) return 'megaventory_invoices';
  const s1 = connData.softone as Record<string, unknown> | undefined;
  if (s1?.connected === true && s1?.syncSalesDocs === true) return 'softone_sales_documents';
  return null;
}

function softOneCustomerText(d: Record<string, unknown>): string {
  const keys = ['CUSTOMER.NAME', 'TRDR.NAME', 'SALDOC.TRDRNAME', 'TRDRNAME', 'CUSTOMER.CODE', 'TRDR.CODE'];
  for (const k of keys) {
    const v = d[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function softOneSalesDocNetAmount(d: Record<string, unknown>): number {
  const keys = [
    'SALDOC.NETAMOUNT',
    'SALDOC.NETVALUE',
    'SALDOC.NETVAL',
    'NETVALUE',
    'TOTALNETVALUE',
    'SUMNETVALUE',
    'SALDOC.TOTALNET',
    'TOTALNET',
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

async function readMegaventoryInvoiceOrderRows(db: Firestore, brandId: string): Promise<OrderRow[]> {
  const snap = await db.collection('megaventory_invoices').where('brandId', '==', brandId).get();
  const rows: OrderRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    // Credit notes are not sales — netted separately via readMegaventoryCreditNoteRows.
    if (d.kind === 'credit_note') continue;
    const net = parseNumeric(d.netAmount);
    if (!(net > 0)) continue;
    const st = String(d.status || '');
    if (/(cancel|void|ακυρ|reject)/i.test(st)) continue;
    const day = typeof d.date === 'string' ? d.date.slice(0, 10) : '';
    rows.push({
      totalPrice: net,
      createdAt: day ? `${day}T12:00:00.000Z` : '',
      platform: 'megaventory_invoices',
      status: st,
      orderId: String(d.documentId ?? doc.id),
      orderName: String(d.documentNo ?? d.documentId ?? ''),
      currency: String(d.currency || 'EUR'),
      paymentMethod: String(d.documentType ?? d.documentTypeDescription ?? ''),
      shippingMethod: '',
      customerEmail: String(d.clientName ?? ''),
      lineItems: [],
    });
  }
  return rows;
}

type MegaventoryCreditNoteRow = {
  /** Negative amount (ex-VAT) — as written by the connector. */
  net: number;
  day: string;
  /** DocumentId of the parent document in MV — the key for the netting join. */
  parentDocumentId: string;
};

/** Megaventory credit notes for netting: subtracted only when `parentDocumentId` is a recorded
 * sales document; supplier credit notes (purchase-doc parent) are left out. */
async function readMegaventoryCreditNoteRows(db: Firestore, brandId: string): Promise<MegaventoryCreditNoteRow[]> {
  const snap = await db
    .collection('megaventory_invoices')
    .where('brandId', '==', brandId)
    .where('kind', '==', 'credit_note')
    .get();
  const rows: MegaventoryCreditNoteRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const net = parseNumeric(d.netAmount);
    if (!(net < 0)) continue;
    const st = String(d.status || '');
    if (/(cancel|void|ακυρ|reject)/i.test(st)) continue;
    rows.push({
      net,
      day: typeof d.date === 'string' ? d.date.slice(0, 10) : '',
      parentDocumentId: String(d.parentDocumentId || ''),
    });
  }
  return rows;
}

async function readSoftOneSalesOrderRows(db: Firestore, brandId: string): Promise<OrderRow[]> {
  const snap = await db.collection('softone_sales_documents').where('brandId', '==', brandId).get();
  const rows: OrderRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const net = softOneSalesDocNetAmount(d);
    if (!(net > 0)) continue;
    const createdRaw = String(d.documentDate ?? d['SALDOC.TRNDATE'] ?? '').trim();
    let day = '';
    if (/^\d{4}-\d{2}-\d{2}/.test(createdRaw)) day = createdRaw.slice(0, 10);
    else if (/^\d{8}$/.test(createdRaw)) {
      day = `${createdRaw.slice(0, 4)}-${createdRaw.slice(4, 6)}-${createdRaw.slice(6, 8)}`;
    }
    rows.push({
      totalPrice: net,
      createdAt: day ? `${day}T12:00:00.000Z` : '',
      platform: 'softone_sales_documents',
      status: String(d['SALDOC.STATUS'] ?? d.STATUS ?? ''),
      orderId: String(d['SALDOC.FINDOC'] ?? d.FINDOC ?? doc.id),
      orderName: String(d['SALDOC.SERIAL'] ?? d['SALDOC.FINCODE'] ?? d.FINDOC ?? ''),
      currency: String(d['SALDOC.CURRENCY'] ?? 'EUR'),
      paymentMethod: String(
        d['SALDOC.SOSOURCE'] ?? d['SALDOC.PAYMENT'] ?? d['SALDOC.FPRMS'] ?? d['SALDOC.COMMENTS'] ?? ''
      ),
      shippingMethod: '',
      customerEmail: softOneCustomerText(d),
      lineItems: [],
    });
  }
  return rows;
}

/** Total business revenue from ERP (Megaventory invoices / SoftOne SALDOC); separate from
 * `ecommerce_summary`, which stays strictly for e-shop connectors. */
export async function computeBusinessRevenueSummary(brandId: string): Promise<void> {
  const db = getDb();
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const connPlain = (connDoc.data() || {}) as Record<string, unknown>;
  const erpBackend = resolveErpRevenueBackend(connPlain);

  let rawRows: OrderRow[] = [];
  let creditRows: MegaventoryCreditNoteRow[] = [];
  let source: 'none' | 'megaventory_invoices' | 'softone_sales_documents' = 'none';

  if (erpBackend === 'megaventory_invoices') {
    rawRows = await readMegaventoryInvoiceOrderRows(db, brandId);
    creditRows = await readMegaventoryCreditNoteRows(db, brandId);
    source = 'megaventory_invoices';
  } else if (erpBackend === 'softone_sales_documents') {
    rawRows = await readSoftOneSalesOrderRows(db, brandId);
    source = 'softone_sales_documents';
  }

  // Gross revenue (sales only) — kept for transparency as gross*.
  const grossRevenueByDay: Record<string, number> = {};
  const grossRevenueByMonth: Record<string, number> = {};
  let grossTotalRevenue = 0;
  for (const o of rawRows) {
    grossTotalRevenue += o.totalPrice;
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    if (day !== 'unknown') {
      grossRevenueByDay[day] = (grossRevenueByDay[day] || 0) + o.totalPrice;
    }
    const month = o.createdAt?.slice(0, 7) || 'unknown';
    if (month !== 'unknown') {
      grossRevenueByMonth[month] = (grossRevenueByMonth[month] || 0) + o.totalPrice;
    }
  }

  // Canonical net revenue: totalRevenue/revenueByDay/revenueByMonth subtract credit notes whose
  // parent is a known sales document (orderId = documentId); unlinked ones reported, not subtracted.
  const salesDocumentIds = new Set(rawRows.map((o) => o.orderId));
  const revenueByDay: Record<string, number> = { ...grossRevenueByDay };
  const revenueByMonth: Record<string, number> = { ...grossRevenueByMonth };
  let creditTotal = 0;
  let creditNotesApplied = 0;
  let unlinkedCreditTotal = 0;
  for (const c of creditRows) {
    if (!c.parentDocumentId || !salesDocumentIds.has(c.parentDocumentId)) {
      unlinkedCreditTotal += c.net;
      continue;
    }
    creditTotal += c.net;
    creditNotesApplied += 1;
    const day = c.day || 'unknown';
    if (day !== 'unknown') {
      revenueByDay[day] = (revenueByDay[day] || 0) + c.net;
      const month = day.slice(0, 7);
      revenueByMonth[month] = (revenueByMonth[month] || 0) + c.net;
    }
  }
  const totalRevenue = grossTotalRevenue + creditTotal;

  await db.doc(`business_revenue_summary/${brandId}`).set({
    source,
    // canonical = net-of-returns
    totalRevenue,
    orderCount: rawRows.length,
    revenueByDay,
    revenueByMonth,
    // gross (sales only) — for the "gross -> returns -> net" breakdown
    grossTotalRevenue,
    grossRevenueByDay,
    grossRevenueByMonth,
    creditTotal,
    creditNotesApplied,
    unlinkedCreditTotal,
    syncedAt: FieldValue.serverTimestamp(),
  });
  logger.info(
    `[EcommerceAgg] Business revenue for ${brandId}: source=${source} docs=${rawRows.length} net €${totalRevenue.toFixed(2)} (gross €${grossTotalRevenue.toFixed(2)} − ${creditNotesApplied} credit notes €${(-creditTotal).toFixed(2)}; unlinked €${(-unlinkedCreditTotal).toFixed(2)})`
  );
}

/** Compute and write the e-commerce summary for a brand; call after any connector sync. */
export async function computeEcommerceSummary(brandId: string): Promise<void> {
  const db = getDb();

  const [connDoc, brandDoc, rulesDoc] = await Promise.all([
    db.doc(`connectors/${brandId}`).get(),
    db.doc(`brands/${brandId}`).get(),
    db.doc(`connector_rules/${brandId}`).get(),
  ]);
  const connData = connDoc.data() || {};
  const brandData = brandDoc.data() || {};
  const rulesData = rulesDoc.data() || {};

  const revenueSourceMode: 'eshop_classified' | 'eshop_all' | 'erp' =
    brandData.revenueSourceMode === 'eshop_all' ||
    brandData.revenueSourceMode === 'erp' ||
    brandData.revenueSourceMode === 'eshop_classified'
      ? brandData.revenueSourceMode
      : 'eshop_classified';

  const connPlain = connData as Record<string, unknown>;
  const stockPlatforms = ECOMMERCE_PROVIDERS.filter((p) =>
    Boolean((connPlain[p] as Record<string, unknown> | undefined)?.connected)
  );

  if (stockPlatforms.length === 0) {
    logger.info(`[EcommerceAgg] No connected e-commerce platforms for brand ${brandId}`);
    await computeBusinessRevenueSummary(brandId);
    return;
  }

  const rawOrders: OrderRow[] = (
    await Promise.all(stockPlatforms.map((p) => readPlatformOrders(db, brandId, p)))
  ).flat();
  const revenueSummaryPlatforms = [...stockPlatforms];

  // Rules: prefer connector_rules doc (post-migration), fallback to legacy connectors doc fields
  const rulesSource = Array.isArray(rulesData.rules) && rulesData.rules.length > 0
    ? [rulesData.rules]
    : [connPlain.ecommerceSalesChannelRules, connPlain.salesChannelRules, (connPlain.magento as Record<string, unknown> | undefined)?.salesChannelRules];
  const salesChannelRules = mergeSalesChannelRulesForBrand(rulesSource, revenueSourceMode);

  // Demo cleanup + classification (e-shop orders only)
  const visibleOrders: OrderRow[] = [];
  const revenueOrders: OrderRow[] = [];
  for (const o of rawOrders) {
    const { revenue, isAllDemo } = nonDemoRevenue(o);
    if (isAllDemo) continue;
    const classification = classifyEcommerceOrder(o, salesChannelRules);
    const normalizedOrder = { ...o, totalPrice: revenue, ...classification };
    visibleOrders.push(normalizedOrder);
    if (classification.revenueIncluded) {
      revenueOrders.push(normalizedOrder);
    }
  }

  // --- Aggregation ---
  const totalRevenue = revenueOrders.reduce((s, o) => s + o.totalPrice, 0);
  const orderCount = revenueOrders.length;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  const revenueByDay: Record<string, number> = {};
  for (const o of revenueOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    revenueByDay[day] = (revenueByDay[day] || 0) + o.totalPrice;
  }

  const revenueByMonth: Record<string, number> = {};
  for (const o of revenueOrders) {
    const month = o.createdAt?.slice(0, 7) || 'unknown';
    revenueByMonth[month] = (revenueByMonth[month] || 0) + o.totalPrice;
  }

  const revenueByPlatform: Record<string, { revenue: number; orders: number }> = {};
  for (const p of ECOMMERCE_PROVIDERS) {
    revenueByPlatform[p] = { revenue: 0, orders: 0 };
  }
  for (const o of revenueOrders) {
    if (!revenueByPlatform[o.platform]) {
      revenueByPlatform[o.platform] = { revenue: 0, orders: 0 };
    }
    revenueByPlatform[o.platform].revenue += o.totalPrice;
    revenueByPlatform[o.platform].orders += 1;
  }

  const revenueBySalesChannel: Record<string, number> = {};
  const ordersBySalesChannel: Record<string, number> = {};
  const includedRevenueBySalesChannel: Record<string, number> = {};
  const includedOrdersBySalesChannel: Record<string, number> = {};
  const excludedRevenueByReason: Record<string, number> = {};
  const excludedOrdersByReason: Record<string, number> = {};
  for (const o of visibleOrders) {
    const channel = o.salesChannel || 'direct_eshop';
    revenueBySalesChannel[channel] = (revenueBySalesChannel[channel] || 0) + o.totalPrice;
    ordersBySalesChannel[channel] = (ordersBySalesChannel[channel] || 0) + 1;
    if (o.revenueIncluded) {
      includedRevenueBySalesChannel[channel] = (includedRevenueBySalesChannel[channel] || 0) + o.totalPrice;
      includedOrdersBySalesChannel[channel] = (includedOrdersBySalesChannel[channel] || 0) + 1;
    } else {
      const reason = o.exclusionReason || 'review';
      excludedRevenueByReason[reason] = (excludedRevenueByReason[reason] || 0) + o.totalPrice;
      excludedOrdersByReason[reason] = (excludedOrdersByReason[reason] || 0) + 1;
    }
  }

  // Top products: ignores demo line items entirely + merges Magento parent/child line
  const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
  for (const o of revenueOrders) {
    const demoFiltered = (o.lineItems || []).filter((li) => !isDemoLineItem(li));
    const aggregated = aggregateOrderLinesForTopProducts(o.platform, demoFiltered);
    for (const row of aggregated) {
      const key = row.sku || 'unknown';
      const existing = productMap.get(key) || { name: row.name, revenue: 0, quantity: 0 };
      existing.revenue += row.revenue;
      existing.quantity += row.quantity;
      if (!existing.name || existing.name === 'unknown') existing.name = row.name;
      productMap.set(key, existing);
    }
  }
  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 20)
    .map(([sku, data]) => ({ sku, name: data.name, revenue: data.revenue, quantity: data.quantity }));

  // SKU stats for the Price Benchmarking table: stock from product docs, sold = qty summed
  // across line items (same 90-day window as orders).
  const stockArrays = await Promise.all(
    stockPlatforms.map((p) => readPlatformStockBySku(db, brandId, p))
  );
  const stockBySku = new Map<string, number>();
  for (const m of stockArrays) {
    for (const [sku, qty] of m.entries()) {
      stockBySku.set(sku, (stockBySku.get(sku) || 0) + qty);
    }
  }
  // Windowed sold per SKU (7d / 30d / 90d) + lastSaleAt
  const now = Date.now();
  const MS_DAY = 24 * 60 * 60 * 1000;
  const cut7 = now - 7 * MS_DAY;
  const cut30 = now - 30 * MS_DAY;
  const cut90 = now - 90 * MS_DAY;

  const soldBySku = new Map<string, number>();
  const sold7BySku = new Map<string, number>();
  const sold30BySku = new Map<string, number>();
  const sold90BySku = new Map<string, number>();
  const lastSaleBySku = new Map<string, number>();

  for (const o of revenueOrders) {
    const ts = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
    const inWindow7 = Number.isFinite(ts) && ts >= cut7;
    const inWindow30 = Number.isFinite(ts) && ts >= cut30;
    const inWindow90 = Number.isFinite(ts) && ts >= cut90;

    for (const li of filterMagentoLineItemsForTopProducts(o.platform, o.lineItems)) {
      if (isDemoLineItem(li)) continue;
      if (o.platform === 'magento' && shouldSkipMagentoLineForTopProducts(li)) continue;
      const sku = (li.sku || '').trim();
      if (!sku) continue;
      const qty = li.quantity || 0;
      soldBySku.set(sku, (soldBySku.get(sku) || 0) + qty);
      if (inWindow7) sold7BySku.set(sku, (sold7BySku.get(sku) || 0) + qty);
      if (inWindow30) sold30BySku.set(sku, (sold30BySku.get(sku) || 0) + qty);
      if (inWindow90) sold90BySku.set(sku, (sold90BySku.get(sku) || 0) + qty);
      if (Number.isFinite(ts)) {
        const prev = lastSaleBySku.get(sku) || 0;
        if (ts > prev) lastSaleBySku.set(sku, ts);
      }
    }
  }

  const skuStats: Record<string, {
    stock: number;
    sold: number;
    sold7d: number;
    sold30d: number;
    sold90d: number;
    lastSaleAt: string | null;
  }> = {};
  const allSkus = new Set<string>([
    ...stockBySku.keys(),
    ...soldBySku.keys(),
    ...lastSaleBySku.keys(),
  ]);
  for (const sku of allSkus) {
    const lastTs = lastSaleBySku.get(sku);
    skuStats[sku] = {
      stock: Math.round(stockBySku.get(sku) || 0),
      sold: Math.round(soldBySku.get(sku) || 0),
      sold7d: Math.round(sold7BySku.get(sku) || 0),
      sold30d: Math.round(sold30BySku.get(sku) || 0),
      sold90d: Math.round(sold90BySku.get(sku) || 0),
      lastSaleAt: lastTs ? new Date(lastTs).toISOString() : null,
    };
  }
  // Store as serialized JSON so each subfield is NOT indexed
  // (avoids the Firestore "too many index entries" 40k limit for large catalogs).
  const skuStatsJson = JSON.stringify(skuStats);
  logger.info(
    `[EcommerceAgg] skuStats populated: ${allSkus.size} SKUs for brand ${brandId} (windowed, ${(skuStatsJson.length / 1024).toFixed(1)}KB)`
  );

  // Large catalogs exceed the 1 MiB/doc limit, which would fail the whole ecommerce_summary set;
  // write SKU stats to a separate sku_stats/{brandId}, chunked under chunks/{i} when >900KB.
  await writeSkuStatsChunked(db, brandId, skuStats, allSkus.size);

  // Orders by day (count) for core revenue only.
  const ordersByDay: Record<string, number> = {};
  for (const o of revenueOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    ordersByDay[day] = (ordersByDay[day] || 0) + 1;
  }

  // Marketplace-inclusive order count for commercial CVR / buyer volume KPIs.
  const allOrdersByDay: Record<string, number> = {};
  for (const o of visibleOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    allOrdersByDay[day] = (allOrdersByDay[day] || 0) + 1;
  }

  // Recent orders (last 50, for quick display)
  const recentOrders = visibleOrders
    .filter((o) => !isOmittedFromRecentOrderList(o.status))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 50)
    .map((o) => ({
      orderId: o.orderId,
      orderName: o.orderName,
      platform: o.platform,
      status: o.status,
      total: o.totalPrice,
      currency: o.currency,
      createdAt: o.createdAt,
      paymentMethod: o.paymentMethod || '',
      shippingMethod: o.shippingMethod || '',
      salesChannel: o.salesChannel || 'direct_eshop',
      revenueIncluded: o.revenueIncluded ?? !isCancelledOrderStatus(o.status),
      exclusionReason: o.exclusionReason || 'none',
    }));

  const summary = {
    totalRevenue,
    orderCount,
    aov,
    revenueByDay,
    revenueByMonth,
    revenueByPlatform,
    revenueBySalesChannel,
    ordersBySalesChannel,
    includedRevenueBySalesChannel,
    includedOrdersBySalesChannel,
    excludedRevenueByReason,
    excludedOrdersByReason,
    topProducts,
    ordersByDay,
    allOrdersByDay,
    recentOrders,
    connectedPlatforms: revenueSummaryPlatforms,
    // Metadata only — the heavy skuStatsJson is written to `sku_stats/{brandId}` (see writeSkuStatsChunked).
    skuStatsCount: allSkus.size,
    syncedAt: FieldValue.serverTimestamp(),
  };

  const ref = db.doc(`ecommerce_summary/${brandId}`);
  await ref.set(summary);
  // Clean up old indexed map field & legacy inline JSON (non-fatal if absent).
  try {
    await ref.update({
      skuStats: FieldValue.delete(),
      skuStatsJson: FieldValue.delete(),
    });
  } catch {
    // ignore
  }
  logger.info(
    `[EcommerceAgg] Summary for ${brandId}: ${orderCount} orders, €${totalRevenue.toFixed(2)} revenue, sources=${revenueSummaryPlatforms.join(',')}`
  );
  await computeBusinessRevenueSummary(brandId);
}
