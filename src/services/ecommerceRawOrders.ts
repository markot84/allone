/**
 * Client-side: πλήρες fetch παραγγελιών από Firestore (όλα τα e-shop connectors) και
 * αθροίσεις ίδιες με το ecommerceAggregator (demo + cancelled) ώστε οι περίοδοι >90d
 * να εμφανίζονται σωστά στο UI (το server summary κρατά rolling ~90 ημέρες).
 */
import { FirestoreService } from './firestore';
import {
  classifyEcommerceOrder,
  isExcludedEcommerceStatus,
  normalizeSalesChannelRules,
  type EcommerceExclusionReason,
  type EcommerceSalesChannel,
  type EcommerceSalesChannelRule,
} from './ecommerceSalesChannel';

export type EcommerceRawLineItem = {
  sku?: string;
  productId?: string;
  /** Shopify line item variant id — optional join hint */
  variantId?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
  /** Magento REST `product_type` */
  productType?: string;
  parentItemId?: string | number | null;
  /** Magento γραμμή μετά εκπτώσεις (store currency) */
  rowTotal?: number;
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
  salesChannel?: EcommerceSalesChannel;
  revenueIncluded?: boolean;
  exclusionReason?: EcommerceExclusionReason;
  /**
   * Stable key για RFM από raw παραγγελίες.
   * Μόνο platform customer id. Email-only guest orders δεν μπαίνουν στο RFM.
   */
  customerKey?: string;
  customerEmailHash?: string;
  customerEmail?: string;
};

export const ECOMMERCE_ORDER_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

export function isEcommerceOrderCancelled(status: string | null | undefined): boolean {
  return isExcludedEcommerceStatus(status);
}

export function isEcommerceOrderRevenueIncluded(order: Pick<EcommerceRawOrder, 'status' | 'revenueIncluded'>): boolean {
  if (order.revenueIncluded === false) return false;
  if (order.revenueIncluded === true) return true;
  return !isEcommerceOrderCancelled(order.status);
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

function parseOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeLineItemFromFirestore(raw: unknown): EcommerceRawLineItem {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowTot =
    parseOptionalNumber(o.rowTotal) ??
    parseOptionalNumber(o.row_total) ??
    parseOptionalNumber(o.base_row_total);
  const rawParent = o.parentItemId ?? o.parent_item_id;
  let parentItemId: string | number | null | undefined;
  if (rawParent === undefined || rawParent === null || rawParent === false) {
    parentItemId = null;
  } else if (typeof rawParent === 'number' && Number.isFinite(rawParent)) {
    parentItemId = rawParent;
  } else if (typeof rawParent === 'string') {
    parentItemId = rawParent;
  } else {
    parentItemId = null;
  }

  return {
    sku: o.sku != null ? String(o.sku) : undefined,
    productId:
      o.productId != null
        ? String(o.productId)
        : o.product_id != null
          ? String(o.product_id)
          : undefined,
    variantId:
      o.variantId != null
        ? String(o.variantId)
        : o.variant_id != null
          ? String(o.variant_id)
          : undefined,
    title: o.title != null ? String(o.title) : undefined,
    name: o.name != null ? String(o.name) : undefined,
    quantity: parseOptionalNumber(o.quantity ?? o.qty_ordered) ?? 0,
    price: parseOptionalNumber(o.price) ?? 0,
    productType:
      o.productType != null
        ? String(o.productType)
        : o.product_type != null
          ? String(o.product_type)
          : undefined,
    parentItemId,
    rowTotal: rowTot,
  };
}

/**
 * Ex-VAT total — αφαιρούμε τον φόρο όταν υπάρχει στο payload (Shopify/Woo/Magento) ώστε το
 * `total` να είναι «καθαρός τζίρος χωρίς ΦΠΑ», συνεπές με το server aggregator και τον λογαριασμό
 * εσόδων του brand. OpenCart δεν εκθέτει tax στο list endpoint → fallback στο gross.
 */
function computeExVatTotal(platform: string, row: Record<string, unknown>): number {
  const num = (v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? '0'));
    return Number.isFinite(n) ? n : 0;
  };
  if (platform === 'shopify') return Math.max(0, num(row.totalPrice) - num(row.totalTax));
  if (platform === 'woocommerce') return Math.max(0, num(row.total) - num(row.totalTax));
  if (platform === 'magento') return Math.max(0, num(row.grandTotal) - num(row.taxAmount));
  return num(row.total);
}

function normalizeRawOrder(platform: string, row: Record<string, unknown>): EcommerceRawOrder {
  const totalValue = computeExVatTotal(platform, row);

  const rawItems = row.lineItems;
  const lineItems: EcommerceRawLineItem[] = Array.isArray(rawItems)
    ? rawItems.map(normalizeLineItemFromFirestore)
    : [];

  const emailHash = String(row.customerEmailHash ?? row.customer_email_hash ?? '').trim().toLowerCase();
  let customerKey = '';
  const rawCustomer =
    row.customerKey ??
    row.customer_key ??
    row.customerId ??
    row.customer_id;
  const s = rawCustomer != null ? String(rawCustomer).trim() : '';
  if (s !== '' && s !== '0' && s !== 'null' && s !== 'undefined') {
    customerKey = `${platform}:${s}`;
  }
  const customerEmail = String(row.customerEmail ?? row.customer_email ?? '').trim().toLowerCase();

  return {
    orderId: String(row.orderId || row.incrementId || row.id || ''),
    orderName: String(row.orderName || row.orderNumber || row.incrementId || row.orderId || ''),
    platform,
    status: String(row.status || row.financialStatus || row.financial_status || ''),
    total: Number(totalValue || 0),
    currency: String(row.currency || 'EUR'),
    createdAt: String(row.createdAt || ''),
    lineItems,
    paymentMethod: String(row.paymentMethod || row.payment_method || ''),
    shippingMethod: String(row.shippingMethod || row.shipping_method || row.shippingDescription || ''),
    salesChannel: row.salesChannel as EcommerceSalesChannel | undefined,
    revenueIncluded: typeof row.revenueIncluded === 'boolean' ? row.revenueIncluded : undefined,
    exclusionReason: row.exclusionReason as EcommerceExclusionReason | undefined,
    ...(customerKey ? { customerKey } : {}),
    ...(emailHash ? { customerEmailHash: emailHash } : {}),
    ...(customerEmail ? { customerEmail } : {}),
  };
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function fetchSalesChannelRules(brandId: string): Promise<EcommerceSalesChannelRule[]> {
  try {
    const connector = await FirestoreService.getDocument<{
      ecommerceSalesChannelRules?: unknown;
      salesChannelRules?: unknown;
      magento?: { salesChannelRules?: unknown };
    }>('connectors', brandId);
    if (!connector) return [];
    return normalizeSalesChannelRules([
      ...arrayOrEmpty(connector.ecommerceSalesChannelRules),
      ...arrayOrEmpty(connector.salesChannelRules),
      ...arrayOrEmpty(connector.magento?.salesChannelRules),
    ]);
  } catch {
    return [];
  }
}

export async function fetchAllEcommerceOrders(brandId: string, platforms: string[]): Promise<EcommerceRawOrder[]> {
  const [rules, results] = await Promise.all([
    fetchSalesChannelRules(brandId),
    Promise.all(
      platforms.map(async (platform) => {
        const collectionName = ECOMMERCE_ORDER_COLLECTIONS[platform];
        if (!collectionName) return [] as EcommerceRawOrder[];
        const rows = await FirestoreService.getDocuments<Record<string, unknown>>(collectionName, [], brandId);
        return rows.map((row) => normalizeRawOrder(platform, row));
      })
    ),
  ]);
  return results.flat().map((order) => ({
    ...order,
    ...classifyEcommerceOrder(order, rules),
  }));
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
    if (!isEcommerceOrderRevenueIncluded(o)) continue;
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
    if (!isEcommerceOrderRevenueIncluded(o)) continue;
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
