/**
 * E-commerce Aggregator
 *
 * Reads order collections from all connected e-commerce platforms,
 * computes summary metrics, and writes to ecommerce_summary/{brandId}.
 * Called after each e-commerce connector sync and in scheduledSyncEcommerce (nightly).
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  lineRevenueAndQtyForTopProducts,
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

/**
 * SKU stats writer με αυτόματο chunking για να μην ξεπερνά το Firestore 1 MiB όριο/document.
 *
 * - Αν το serialized JSON < ~900KB → 1 chunk doc + parent metadata.
 * - Αλλιώς σπάει το map σε ομάδες SKUs ώστε κάθε chunk doc να μένει < 900KB.
 * - Παλιότερα chunks που πλέον δεν χρειάζονται διαγράφονται για να μη μένει stale data.
 *
 * Storage layout:
 *   sku_stats/{brandId}                       → { chunkCount, skuStatsCount, updatedAt }
 *   sku_stats/{brandId}/chunks/{idx}          → { skuStatsJson, skuCount }
 */
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
    /** Split αλφαβητικά για να είναι deterministic ανά run. Κάθε chunk όσο πιο κοντά γίνεται στο όριο. */
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

  /** Σβήσε παλιά chunks (αν προηγούμενο run είχε περισσότερα chunks). */
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

/** Demo products (όνομα/SKU περιέχει "demo") εξαιρούνται από κάθε aggregate. */
function isDemoLineItem(li: { sku?: string; title?: string; name?: string }): boolean {
  const needle = 'demo';
  const s = `${li.sku || ''} ${li.title || ''} ${li.name || ''}`.toLowerCase();
  return s.includes(needle);
}

/** Καθαρό revenue μιας παραγγελίας μετά την αφαίρεση των demo line items. */
function nonDemoRevenue(o: OrderRow): { revenue: number; isAllDemo: boolean } {
  const items = o.lineItems || [];
  if (items.length === 0) {
    // Fallback: δεν ξέρουμε lineItems → κράτα την παραγγελία
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

/**
 * Reads product collections από κάθε platform και επιστρέφει map SKU → stock.
 * Χρησιμοποιείται για τον πίνακα Price Benchmarking (στήλη «Στοκ»).
 */
export async function readPlatformStockBySku(
  db: Firestore,
  brandId: string,
  platform: string
): Promise<Map<string, number>> {
  const coll = PRODUCT_COLLECTION_MAP[platform];
  const out = new Map<string, number>();
  if (!coll) return out;

  const snap = await db.collection(coll).where('brandId', '==', brandId).get();
  for (const doc of snap.docs) {
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

/**
 * Net products revenue ex-VAT (όπως καταγράφεται στα λογιστικά «Total Income χωρίς ΦΠΑ»).
 *
 * **Magento (multi-store aware):** `baseSubtotal − |baseDiscountAmount|` = items ex-tax σε base
 * currency (EUR), χωρίς μεταφορικά. Magento REST API subtotal = items ex-tax always.
 * Fallback αν λείπουν base_*: `subtotal − |discountAmount|` (EUR orders only).
 * Non-EUR orders χωρίς base_* → 0 (αναμένεται re-sync).
 *
 * **Shopify/WooCommerce:** `totalPrice − totalTax`.
 */
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

/**
 * Read orders from a single platform collection for the given brand (full history in Firestore).
 */
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

/**
 * Τα ERP τιμολόγια έχουν status π.χ. «Closed» που στο e-shop θα εξαιρούνταν· για τους κανόνες
 * καναλιών χρησιμοποιούμε ουδέτερο status και αφήνουμε τα patterns να αποφασίζουν.
 */
function sanitizeStatusForErpClassification(raw: string): string {
  const st = String(raw || '').toLowerCase();
  if (st.includes('cancel') || st.includes('void') || st.includes('ακυρ') || st.includes('reject')) {
    return 'cancelled';
  }
  return 'completed';
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

/**
 * Compute and write the e-commerce summary for a brand.
 * Call after any e-commerce connector sync.
 */
export async function computeEcommerceSummary(brandId: string): Promise<void> {
  const db = getDb();

  const [connDoc, brandDoc] = await Promise.all([
    db.doc(`connectors/${brandId}`).get(),
    db.doc(`brands/${brandId}`).get(),
  ]);
  const connData = connDoc.data() || {};
  const brandData = brandDoc.data() || {};

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
  const erpBackend =
    revenueSourceMode === 'erp' ? resolveErpRevenueBackend(connPlain) : null;

  let rawOrders: OrderRow[] = [];
  let revenueSummaryPlatforms: string[] = [];

  if (revenueSourceMode === 'erp' && erpBackend) {
    rawOrders =
      erpBackend === 'megaventory_invoices'
        ? await readMegaventoryInvoiceOrderRows(db, brandId)
        : await readSoftOneSalesOrderRows(db, brandId);
    revenueSummaryPlatforms = [erpBackend];
    logger.info(`[EcommerceAgg] ERP revenue for ${brandId}: backend=${erpBackend} rows=${rawOrders.length}`);
  } else {
    if (revenueSourceMode === 'erp' && !erpBackend) {
      logger.warn(
        `[EcommerceAgg] revenueSourceMode=erp χωρίς Megaventory ή SoftOne SALDOC — fallback σε e-shop aggregation για ${brandId}`
      );
    }
    if (stockPlatforms.length === 0) {
      logger.info(`[EcommerceAgg] No connected e-commerce platforms for brand ${brandId}`);
      return;
    }
    rawOrders = (
      await Promise.all(
        stockPlatforms.map((p) => readPlatformOrders(db, brandId, p))
      )
    ).flat();
    revenueSummaryPlatforms = [...stockPlatforms];
  }

  const salesChannelRules = mergeSalesChannelRulesForBrand(
    [
      connPlain.ecommerceSalesChannelRules,
      connPlain.salesChannelRules,
      (connPlain.magento as Record<string, unknown> | undefined)?.salesChannelRules,
    ],
    revenueSourceMode
  );

  // Demo cleanup + classification (ERP: ίδιοι κανόνες όπως eshop, με mapping πεδίων + safe status)
  const visibleOrders: OrderRow[] = [];
  const revenueOrders: OrderRow[] = [];
  for (const o of rawOrders) {
    const { revenue, isAllDemo } = nonDemoRevenue(o);
    if (isAllDemo) continue;
    const orderForClassify: OrderRow =
      erpBackend === 'megaventory_invoices' || erpBackend === 'softone_sales_documents'
        ? { ...o, status: sanitizeStatusForErpClassification(o.status) }
        : o;
    const classification = classifyEcommerceOrder(orderForClassify, salesChannelRules);
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

  // Top products: αγνοεί εντελώς τα demo line items
  const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
  for (const o of revenueOrders) {
    const lines = filterMagentoLineItemsForTopProducts(o.platform, o.lineItems);
    for (const li of lines) {
      if (isDemoLineItem(li)) continue;
      const contrib = lineRevenueAndQtyForTopProducts(o.platform, li);
      if (!contrib) continue;
      const key = li.sku || li.title || li.name || 'unknown';
      const name = li.title || li.name || key;
      const existing = productMap.get(key) || { name, revenue: 0, quantity: 0 };
      existing.revenue += contrib.revenue;
      existing.quantity += contrib.quantity;
      if (!existing.name || existing.name === 'unknown') existing.name = name;
      productMap.set(key, existing);
    }
  }
  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 20)
    .map(([sku, data]) => ({ sku, name: data.name, revenue: data.revenue, quantity: data.quantity }));

  // SKU stats (stock + sold) — τροφοδοτεί τον πίνακα Price Benchmarking.
  // Stock: από τα product docs κάθε platform.
  // Sold:  sum qty από όλα τα line items (ίδιο 90-day window με τα orders).
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
  // Αποθήκευση ως serialized JSON για να ΜΗΝ indexed κάθε subfield
  // (απέφυγε Firestore "too many index entries" όριο των 40k για μεγάλα catalogs).
  const skuStatsJson = JSON.stringify(skuStats);
  logger.info(
    `[EcommerceAgg] skuStats populated: ${allSkus.size} SKUs for brand ${brandId} (windowed, ${(skuStatsJson.length / 1024).toFixed(1)}KB)`
  );

  /**
   * Το skuStatsJson για brands με >10K SKUs (e-tennis, safeblock) ξεπερνά το Firestore όριο
   * των 1 MiB ανά document. Αν παραμείνει στο `ecommerce_summary` doc → ολόκληρο το set fails
   * → χάνεται κάθε ενημέρωση revenueByDay/orderCount → Dashboard δείχνει €0.
   *
   * Λύση: γράφεται σε ξεχωριστό `sku_stats/{brandId}` (όπως ήδη το `stock_movement`). Αν είναι
   * > 900KB, σπάει σε chunks σε subcollection `sku_stats/{brandId}/chunks/{i}`.
   */
  await writeSkuStatsChunked(db, brandId, skuStats, allSkus.size);

  // Orders by day (count)
  const ordersByDay: Record<string, number> = {};
  for (const o of revenueOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    ordersByDay[day] = (ordersByDay[day] || 0) + 1;
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
    recentOrders,
    connectedPlatforms: revenueSummaryPlatforms,
    // Μόνο metadata — το βαρύ skuStatsJson γράφεται σε `sku_stats/{brandId}` (βλ. writeSkuStatsChunked).
    skuStatsCount: allSkus.size,
    syncedAt: FieldValue.serverTimestamp(),
  };

  const ref = db.doc(`ecommerce_summary/${brandId}`);
  await ref.set(summary);
  // Καθάρισμα παλιού indexed map field & legacy inline JSON (μη fatal αν δεν υπάρχουν).
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
}
