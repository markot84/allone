/**
 * E-commerce Aggregator
 *
 * Reads order collections from all connected e-commerce platforms,
 * computes summary metrics, and writes to ecommerce_summary/{brandId}.
 * Called after each e-commerce connector sync and in scheduledSync.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  lineRevenueAndQtyForTopProducts,
  shouldSkipMagentoLineForTopProducts,
} from './productLineStats';
import {
  classifyEcommerceOrder,
  isExcludedEcommerceStatus,
  normalizeSalesChannelRules,
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

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
    parentItemId?: string | number | null;
    rowTotal?: number;
  }>;
}

export const ECOMMERCE_PROVIDERS = ['shopify', 'woocommerce', 'opencart', 'magento'] as const;

function isCancelledOrderStatus(status: string | null | undefined): boolean {
  return isExcludedEcommerceStatus(status);
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

/**
 * Tax field per platform — αφαιρείται από το gross για ex-VAT revenue στα KPIs.
 * OpenCart δεν εκθέτει total tax στο order list endpoint· χωρίς αυτό μένει incl. VAT (consistency note).
 */
const TAX_FIELD: Record<string, string> = {
  shopify: 'totalTax',
  woocommerce: 'totalTax',
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
 * Για Magento: `subtotal − |discount_amount|`. Το `subtotal` του Magento είναι items ex-tax,
 * άρα δεν περιλαμβάνει μεταφορικά (αυτά πάνε σε ξεχωριστό income account και δεν θα έπρεπε να
 * μπερδεύουν τον τζίρο εμπορεύματος). Αν τα στοιχεία λείπουν, fallback σε `grandTotal − taxAmount`
 * για να μη γυρίσουμε 0 σε ιστορικά documents πριν το backfill.
 *
 * Για Shopify/WooCommerce: `totalPrice − totalTax` (περιλαμβάνει shipping ex-VAT, αλλά αυτές οι
 * πλατφόρμες δεν εκθέτουν αξιόπιστο "subtotal-only" στο order list endpoint· κρατάμε consistency
 * με το προηγούμενο aggregation και το βασικό use-case είναι το Magento e-tennis).
 */
function computeOrderExVatRevenue(platform: string, d: Record<string, unknown>): number {
  if (platform === 'magento') {
    const subtotal = parseNumeric(d.subtotal);
    const discount = Math.abs(parseNumeric(d.discountAmount));
    if (subtotal > 0) {
      return Math.max(0, subtotal - discount);
    }
    // Fallback (παλιά documents χωρίς subtotal/discountAmount).
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
async function readPlatformOrders(
  db: Firestore,
  brandId: string,
  platform: string
): Promise<OrderRow[]> {
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

  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const connData = connDoc.data() || {};

  const connectedPlatforms = ECOMMERCE_PROVIDERS.filter(
    (p) => connData[p]?.connected
  );
  const salesChannelRules = normalizeSalesChannelRules([
    ...arrayOrEmpty(connData.ecommerceSalesChannelRules),
    ...arrayOrEmpty(connData.salesChannelRules),
    ...arrayOrEmpty(connData.magento?.salesChannelRules),
  ]);

  if (connectedPlatforms.length === 0) {
    logger.info(`[EcommerceAgg] No connected e-commerce platforms for brand ${brandId}`);
    return;
  }

  // Read orders from all connected platforms in parallel
  const allOrderArrays = await Promise.all(
    connectedPlatforms.map((p) => readPlatformOrders(db, brandId, p))
  );
  const rawOrders = allOrderArrays.flat();

  // Demo cleanup: αφαίρεσε παραγγελίες που είναι 100% demo items
  // και σκέπασε το totalPrice με καθαρό (non-demo) revenue.
  // Τα cancelled μένουν ορατά στα recent orders, αλλά δεν μπαίνουν στα revenue KPIs.
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

  // Top products: αγνοεί εντελώς τα demo line items
  const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
  for (const o of revenueOrders) {
    for (const li of o.lineItems || []) {
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
    connectedPlatforms.map((p) => readPlatformStockBySku(db, brandId, p))
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

    for (const li of o.lineItems || []) {
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

  // Orders by day (count)
  const ordersByDay: Record<string, number> = {};
  for (const o of revenueOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    ordersByDay[day] = (ordersByDay[day] || 0) + 1;
  }

  // Recent orders (last 50, for quick display)
  const recentOrders = visibleOrders
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
    connectedPlatforms,
    // skuStats serialized — αποφυγή Firestore index limits για μεγάλα catalogs.
    skuStatsJson,
    skuStatsCount: allSkus.size,
    syncedAt: FieldValue.serverTimestamp(),
  };

  const ref = db.doc(`ecommerce_summary/${brandId}`);
  await ref.set(summary);
  // Καθάρισμα παλιού indexed map field (μη fatal αν δεν υπάρχει).
  try {
    await ref.update({ skuStats: FieldValue.delete() });
  } catch {
    // ignore
  }
  logger.info(
    `[EcommerceAgg] Summary for ${brandId}: ${orderCount} orders, €${totalRevenue.toFixed(2)} revenue, ${connectedPlatforms.length} platforms`
  );
}
