/**
 * Client-side: πλήρες fetch παραγγελιών από Firestore (όλα τα e-shop connectors) και
 * αθροίσεις ίδιες με το ecommerceAggregator (demo + cancelled) ώστε οι περίοδοι >90d
 * να εμφανίζονται σωστά στο UI (το server summary κρατά rolling ~90 ημέρες).
 */
import { FirestoreService } from './firestore';

export type EcommerceRawLineItem = {
  sku?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
};

export type EcommerceRawOrder = {
  orderId: string;
  orderName?: string;
  platform: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  lineItems: EcommerceRawLineItem[];
  paymentMethod?: string;
  shippingMethod?: string;
};

export const ECOMMERCE_ORDER_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

export function isEcommerceOrderCancelled(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'cancelled' || normalized === 'canceled';
}

export function isEcommerceDemoLineItem(lineItem: EcommerceRawLineItem): boolean {
  const needle = `${lineItem.sku || ''} ${lineItem.title || ''} ${lineItem.name || ''}`.toLowerCase();
  return needle.includes('demo');
}

/** Καθαρό revenue + αν η παραγγελία είναι 100% demo */
export function getEcommerceOrderNetRevenue(order: EcommerceRawOrder): { revenue: number; isAllDemo: boolean } {
  if (!order.lineItems.length) return { revenue: order.total, isAllDemo: false };
  let demoTotal = 0;
  let nonDemoCount = 0;
  for (const li of order.lineItems) {
    if (isEcommerceDemoLineItem(li)) {
      demoTotal += (li.price || 0) * (li.quantity || 1);
    } else {
      nonDemoCount += 1;
    }
  }
  return {
    revenue: Math.max(0, order.total - demoTotal),
    isAllDemo: nonDemoCount === 0,
  };
}

function normalizeRawOrder(platform: string, row: Record<string, unknown>): EcommerceRawOrder {
  const totalValue =
    platform === 'shopify'
      ? row.totalPrice
      : platform === 'woocommerce'
        ? row.total
        : platform === 'magento'
          ? row.grandTotal
          : row.total;

  return {
    orderId: String(row.orderId || row.incrementId || row.id || ''),
    orderName: String(row.orderName || row.orderNumber || row.incrementId || row.orderId || ''),
    platform,
    status: String(row.status || row.financialStatus || row.financial_status || ''),
    total: Number(totalValue || 0),
    currency: String(row.currency || 'EUR'),
    createdAt: String(row.createdAt || ''),
    lineItems: Array.isArray(row.lineItems) ? (row.lineItems as EcommerceRawLineItem[]) : [],
    paymentMethod: String(row.paymentMethod || row.payment_method || ''),
    shippingMethod: String(row.shippingMethod || row.shipping_method || row.shippingDescription || ''),
  };
}

export async function fetchAllEcommerceOrders(brandId: string, platforms: string[]): Promise<EcommerceRawOrder[]> {
  const results = await Promise.all(
    platforms.map(async (platform) => {
      const collectionName = ECOMMERCE_ORDER_COLLECTIONS[platform];
      if (!collectionName) return [] as EcommerceRawOrder[];
      const rows = await FirestoreService.getDocuments<Record<string, unknown>>(collectionName, [], brandId);
      return rows.map((row) => normalizeRawOrder(platform, row));
    })
  );
  return results.flat();
}

export type EcommerceRevenueDayAggregate = {
  revenueByDay: Record<string, number>;
  ordersByDay: Record<string, number>;
};

/**
 * Ίδιοι κανόνες με EcommerceDashboard / server aggregator: skip all-demo, skip cancelled for revenue.
 */
export function aggregateRevenueOrdersFromRaw(orders: EcommerceRawOrder[]): EcommerceRevenueDayAggregate {
  const revenueByDay: Record<string, number> = {};
  const ordersByDay: Record<string, number> = {};
  for (const o of orders) {
    const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
    if (isAllDemo) continue;
    if (isEcommerceOrderCancelled(o.status)) continue;
    const day = (o.createdAt || '').slice(0, 10);
    if (!day) continue;
    revenueByDay[day] = (revenueByDay[day] || 0) + revenue;
    ordersByDay[day] = (ordersByDay[day] || 0) + 1;
  }
  return { revenueByDay, ordersByDay };
}

export function sortDailyRevenueRows(revenueByDay: Record<string, number>): { date: string; revenue: number }[] {
  return Object.entries(revenueByDay)
    .filter(([d]) => d !== 'unknown')
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function sortOrdersByDayRows(ordersByDay: Record<string, number>): { date: string; orders: number }[] {
  return Object.entries(ordersByDay)
    .filter(([d]) => d !== 'unknown')
    .map(([date, orders]) => ({ date, orders: Number(orders) || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type PlatformRevenueOne = { platform: string; revenue: number; orders: number };

export function topPlatformInDateRange(
  orders: EcommerceRawOrder[],
  fromDate: string,
  toDate: string
): PlatformRevenueOne | null {
  const m = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    const day = (o.createdAt || '').slice(0, 10);
    if (!day || day < fromDate || day > toDate) continue;
    const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
    if (isAllDemo) continue;
    if (isEcommerceOrderCancelled(o.status)) continue;
    const p = o.platform;
    const ex = m.get(p) || { revenue: 0, orders: 0 };
    ex.revenue += revenue;
    ex.orders += 1;
    m.set(p, ex);
  }
  let best: PlatformRevenueOne | null = null;
  m.forEach((v, platform) => {
    if (v.revenue <= 0) return;
    if (!best || v.revenue > best.revenue) {
      best = { platform, revenue: v.revenue, orders: v.orders };
    }
  });
  return best;
}
