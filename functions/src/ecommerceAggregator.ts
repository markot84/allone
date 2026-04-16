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

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

interface OrderRow {
  totalPrice: number;
  createdAt: string;
  platform: string;
  status: string;
  orderId: string;
  orderName?: string;
  currency: string;
  lineItems?: Array<{ sku?: string; title?: string; name?: string; quantity?: number; price?: number }>;
}

const ECOMMERCE_PROVIDERS = ['shopify', 'woocommerce', 'opencart', 'magento'] as const;

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

const REVENUE_FIELD: Record<string, string> = {
  shopify: 'totalPrice',
  woocommerce: 'total',
  opencart: 'total',
  magento: 'grandTotal',
};

/**
 * Read orders from a single platform collection for the given brand (last 90 days).
 */
async function readPlatformOrders(
  db: Firestore,
  brandId: string,
  platform: string
): Promise<OrderRow[]> {
  const collection = COLLECTION_MAP[platform];
  if (!collection) return [];

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const snap = await db
    .collection(collection)
    .where('brandId', '==', brandId)
    .get();

  const revenueField = REVENUE_FIELD[platform] || 'totalPrice';
  const rows: OrderRow[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const createdAt = d.createdAt || '';
    if (createdAt && new Date(createdAt) < since) continue;

    const price = typeof d[revenueField] === 'number' ? d[revenueField] : parseFloat(d[revenueField] || '0');

    rows.push({
      totalPrice: price,
      createdAt,
      platform,
      status: d.status || d.financialStatus || d.financial_status || '',
      orderId: d.orderId || d.incrementId || doc.id,
      orderName: d.orderName || d.orderNumber || d.incrementId || '',
      currency: d.currency || 'EUR',
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
  const allOrders: OrderRow[] = [];
  for (const o of rawOrders) {
    const { revenue, isAllDemo } = nonDemoRevenue(o);
    if (isAllDemo) continue;
    allOrders.push({ ...o, totalPrice: revenue });
  }

  // --- Aggregation ---
  const totalRevenue = allOrders.reduce((s, o) => s + o.totalPrice, 0);
  const orderCount = allOrders.length;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  const revenueByDay: Record<string, number> = {};
  for (const o of allOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    revenueByDay[day] = (revenueByDay[day] || 0) + o.totalPrice;
  }

  const revenueByMonth: Record<string, number> = {};
  for (const o of allOrders) {
    const month = o.createdAt?.slice(0, 7) || 'unknown';
    revenueByMonth[month] = (revenueByMonth[month] || 0) + o.totalPrice;
  }

  const revenueByPlatform: Record<string, { revenue: number; orders: number }> = {};
  for (const p of ECOMMERCE_PROVIDERS) {
    revenueByPlatform[p] = { revenue: 0, orders: 0 };
  }
  for (const o of allOrders) {
    if (!revenueByPlatform[o.platform]) {
      revenueByPlatform[o.platform] = { revenue: 0, orders: 0 };
    }
    revenueByPlatform[o.platform].revenue += o.totalPrice;
    revenueByPlatform[o.platform].orders += 1;
  }

  // Top products: αγνοεί εντελώς τα demo line items
  const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
  for (const o of allOrders) {
    for (const li of o.lineItems || []) {
      if (isDemoLineItem(li)) continue;
      const key = li.sku || li.title || li.name || 'unknown';
      const name = li.title || li.name || key;
      const existing = productMap.get(key) || { name, revenue: 0, quantity: 0 };
      existing.revenue += (li.price || 0) * (li.quantity || 1);
      existing.quantity += li.quantity || 1;
      if (!existing.name || existing.name === 'unknown') existing.name = name;
      productMap.set(key, existing);
    }
  }
  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 20)
    .map(([sku, data]) => ({ sku, name: data.name, revenue: data.revenue, quantity: data.quantity }));

  // Orders by day (count)
  const ordersByDay: Record<string, number> = {};
  for (const o of allOrders) {
    const day = o.createdAt?.slice(0, 10) || 'unknown';
    ordersByDay[day] = (ordersByDay[day] || 0) + 1;
  }

  // Recent orders (last 50, for quick display)
  const recentOrders = allOrders
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
    }));

  const summary = {
    totalRevenue,
    orderCount,
    aov,
    revenueByDay,
    revenueByMonth,
    revenueByPlatform,
    topProducts,
    ordersByDay,
    recentOrders,
    connectedPlatforms,
    syncedAt: FieldValue.serverTimestamp(),
  };

  await db.doc(`ecommerce_summary/${brandId}`).set(summary);
  logger.info(
    `[EcommerceAgg] Summary for ${brandId}: ${orderCount} orders, €${totalRevenue.toFixed(2)} revenue, ${connectedPlatforms.length} platforms`
  );
}
