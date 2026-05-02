/**
 * Client-side: fetch παραγγελιών από Firestore (όλα τα e-shop connectors) και
 * αθροίσεις ίδιες με το ecommerceAggregator (demo + cancelled) ώστε οι περίοδοι >90d
 * να εμφανίζονται σωστά στο UI (το server summary κρατά rolling ~90 ημέρες).
 */
import { orderBy, where, Timestamp, type QueryConstraint } from 'firebase/firestore';
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

function coerceFirestoreCreatedAtString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (v instanceof Timestamp) {
    const d = v.toDate();
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    try {
      const d = maybe.toDate();
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    } catch {
      return '';
    }
  }
  return '';
}

/** YYYY-MM-DD για φίλτρο εύρους (μετά coerce από Timestamp / Magento string). */
function createdAtDayKeyFromRow(row: Record<string, unknown>): string {
  const s = coerceFirestoreCreatedAtString(row.createdAt ?? row.created_at);
  if (!s) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m?.[1] ?? '';
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
 * Net products revenue ex-VAT — ίδια λογική με το server aggregator (computeOrderExVatRevenue).
 *
 * Magento (multi-store): προτιμά τα `base_*` fields (base store currency, συνήθως EUR).
 *   `baseSubtotal − |baseDiscountAmount|`. Όταν λείπουν τα base_* και το order δεν είναι
 *   σε EUR, επιστρέφει 0 για να μη φουσκώσει το aggregate (re-sync απαιτείται).
 *
 * Shopify/WooCommerce: `total − totalTax`. OpenCart: gross fallback.
 */
function computeExVatTotal(platform: string, row: Record<string, unknown>): number {
  const num = (v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? '0'));
    return Number.isFinite(n) ? n : 0;
  };
  if (platform === 'magento') {
    const baseSubtotal = num(row.baseSubtotal);
    const baseDiscount = Math.abs(num(row.baseDiscountAmount));
    if (baseSubtotal > 0) return Math.max(0, baseSubtotal - baseDiscount);

    const currency = String(row.currency || '').toUpperCase();
    const baseCurrency = String(row.baseCurrencyCode || '').toUpperCase();
    const isEur = !currency || currency === 'EUR' || (baseCurrency && currency === baseCurrency);
    if (!isEur) return 0;

    const subtotal = num(row.subtotal);
    const discount = Math.abs(num(row.discountAmount));
    if (subtotal > 0) return Math.max(0, subtotal - discount);
    return Math.max(0, num(row.grandTotal) - num(row.taxAmount));
  }
  if (platform === 'shopify') return Math.max(0, num(row.totalPrice) - num(row.totalTax));
  if (platform === 'woocommerce') return Math.max(0, num(row.total) - num(row.totalTax));
  return num(row.total);
}

function normalizeRawOrder(platform: string, row: Record<string, unknown>): EcommerceRawOrder {
  const totalValue = computeExVatTotal(platform, row);

  const rawItems = row.lineItems;
  const lineItems: EcommerceRawLineItem[] = Array.isArray(rawItems)
    ? rawItems.map(normalizeLineItemFromFirestore)
    : [];

  const emailHash = String(row.customerEmailHash ?? row.customer_email_hash ?? '').trim().toLowerCase();
  const customerEmail = String(row.customerEmail ?? row.customer_email ?? '').trim().toLowerCase();

  const rawCustomer =
    row.customerKey ??
    row.customer_key ??
    row.customerId ??
    row.customer_id;
  const s = rawCustomer != null ? String(rawCustomer).trim() : '';
  const hasCustomerId = s !== '' && s !== '0' && s !== 'null' && s !== 'undefined';

  /**
   * Dedup priority for RFM:
   * 1. emailHash/customerEmail only when there is a real platform customer id.
   *    This dedups Magento multi-store registered customers but still excludes guests.
   * 2. ${platform}:${customerId} when email is unavailable.
   */
  let customerKey = '';
  if (hasCustomerId && emailHash) {
    customerKey = `email:${emailHash}`;
  } else if (hasCustomerId && customerEmail && customerEmail.includes('@')) {
    customerKey = `email:${customerEmail}`;
  } else if (hasCustomerId) {
    customerKey = `${platform}:${s}`;
  }

  return {
    orderId: String(row.orderId || row.incrementId || row.id || ''),
    orderName: String(row.orderName || row.orderNumber || row.incrementId || row.orderId || ''),
    platform,
    status: String(row.status || row.financialStatus || row.financial_status || ''),
    total: Number(totalValue || 0),
    currency: String(row.currency || 'EUR'),
    createdAt: coerceFirestoreCreatedAtString(row.createdAt ?? row.created_at),
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

async function fetchBrandRevenueSourceMode(brandId: string): Promise<'eshop_classified' | 'eshop_all' | 'erp'> {
  try {
    const brand = await FirestoreService.getDocument<{ revenueSourceMode?: string }>('brands', brandId);
    const mode = brand?.revenueSourceMode;
    if (mode === 'eshop_all' || mode === 'erp' || mode === 'eshop_classified') return mode;
    return 'eshop_classified';
  } catch {
    return 'eshop_classified';
  }
}

export async function fetchAllEcommerceOrders(
  brandId: string,
  platforms: string[],
  options: {
    sinceDate?: string;
    untilDate?: string;
    cacheFirst?: boolean;
    revenueMode?: 'brand' | 'classified' | 'all';
  } = {}
): Promise<EcommerceRawOrder[]> {
  const [mode, allRules, results] = await Promise.all([
    fetchBrandRevenueSourceMode(brandId),
    fetchSalesChannelRules(brandId),
    Promise.all(
      platforms.map(async (platform) => {
        const collectionName = ECOMMERCE_ORDER_COLLECTIONS[platform];
        if (!collectionName) return [] as EcommerceRawOrder[];
        const constraints: QueryConstraint[] = [];
        if (options.sinceDate) constraints.push(where('createdAt', '>=', options.sinceDate));
        if (options.untilDate) constraints.push(where('createdAt', '<=', `${options.untilDate}T23:59:59.999Z`));
        if (options.sinceDate || options.untilDate) constraints.push(orderBy('createdAt', 'desc'));
        const hasRange = Boolean(options.sinceDate || options.untilDate);
        const rangedLoadOpts = {
          cacheFirst: false,
          forceServer: true,
        } as const;

        const filterRowsByDateWindow = (incoming: Record<string, unknown>[]) =>
          incoming.filter((row) => {
            const day = createdAtDayKeyFromRow(row);
            if (!day) return false;
            if (options.sinceDate && day < options.sinceDate) return false;
            if (options.untilDate && day > options.untilDate) return false;
            return true;
          });

        let rows: Record<string, unknown>[] = [];
        try {
          if (hasRange) {
            rows = await FirestoreService.getDocuments<Record<string, unknown>>(
              collectionName,
              constraints,
              brandId,
              rangedLoadOpts
            );
            // Αν το query επέστρεψε κενό (π.χ. createdAt σε Timestamp έναντι strings, ή index/cache),
            // κάνουμε ανάγνωση όλων των παραγγελιών brand και φιλτάρουμε client-side —
            // ακριβές για μεγάλα catalogs, αλλά σωστό για τις dashboards.
            if (rows.length === 0) {
              const allRows = await FirestoreService.getDocuments<Record<string, unknown>>(
                collectionName,
                [],
                brandId,
                rangedLoadOpts
              );
              rows = filterRowsByDateWindow(allRows);
            }
          } else {
            rows = await FirestoreService.getDocuments<Record<string, unknown>>(collectionName, [], brandId, {
              cacheFirst: options.cacheFirst,
            });
          }
        } catch (error) {
          if (!hasRange) throw error;
          const fallbackRows = await FirestoreService.getDocuments<Record<string, unknown>>(
            collectionName,
            [],
            brandId,
            rangedLoadOpts
          );
          rows = filterRowsByDateWindow(fallbackRows);
        }
        return rows.map((row) => normalizeRawOrder(platform, row));
      })
    ),
  ]);
  const requestedMode = options.revenueMode || 'brand';
  // brand/default: όταν revenueSourceMode = eshop_all, αγνοούμε τα rules.
  // classified: forced core e-shop revenue for views whose copy promises exclusions.
  // all: explicit all e-shop orders.
  const rules =
    requestedMode === 'all' || (requestedMode === 'brand' && mode === 'eshop_all')
      ? []
      : allRules;
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
