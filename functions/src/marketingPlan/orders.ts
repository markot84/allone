/**
 * PER-157 — server-side order loader for the marketing_plan_insight CF.
 *
 * Reproduces the client's `fetchDataAnalysisOrders` (src/services/ecommerceRawOrders.ts) for a
 * brand + last-year window, returning `EcommerceRawOrder[]` WITH line items so the ported compute
 * sees the same demand the client does. ERP path (megaventory/softone) is the parity-critical one
 * for e-tennis (megaventory-only); the e-shop path mirrors the client for non-ERP brands.
 *
 * Bounded + heap-safe: per-window windowed query (date range + orderBy desc + cap), with the
 * client's brand+limit+JS-window fallback when the composite index is unavailable. No full-collection
 * stream of the ~645k-invoice collection.
 */
import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore';
import type { EcommerceRawOrder, EcommerceRawLineItem } from './shared';

const ERP_DATA_ANALYSIS_ORDER_LIMIT = 10000;
const DATA_ANALYSIS_ORDER_LIMIT = 5000;

const ECOMMERCE_ORDER_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

export interface OrderWindow {
  key: string;        // preset id
  sinceDate: string;  // YYYY-MM-DD (last-year window start)
  untilDate: string;  // YYYY-MM-DD (last-year window end)
}

// ---- numeric/date helpers (verbatim semantics from the client) -------------------------------
function parseOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}
function coerceCreatedAt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    try {
      const d = maybe.toDate();
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    } catch { return ''; }
  }
  return '';
}
function dayOf(v: unknown): string {
  const s = coerceCreatedAt(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m?.[1] ?? '';
}

// ---- line-item normalizer (faithful port of normalizeLineItemFromFirestore) ------------------
export function normalizeLineItem(raw: unknown): EcommerceRawLineItem {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowTotal =
    parseOptionalNumber(o.rowTotal) ?? parseOptionalNumber(o.row_total) ?? parseOptionalNumber(o.base_row_total);
  const rawParent = o.parentItemId ?? o.parent_item_id;
  let parentItemId: string | number | null;
  if (rawParent === undefined || rawParent === null || rawParent === false) parentItemId = null;
  else if (typeof rawParent === 'number' && Number.isFinite(rawParent)) parentItemId = rawParent;
  else if (typeof rawParent === 'string') parentItemId = rawParent;
  else parentItemId = null;
  return {
    sku: o.sku != null ? String(o.sku) : undefined,
    productId: o.productId != null ? String(o.productId) : o.product_id != null ? String(o.product_id) : undefined,
    title: o.title != null ? String(o.title) : undefined,
    name: o.name != null ? String(o.name) : undefined,
    quantity: parseOptionalNumber(o.quantity ?? o.qty_ordered) ?? 0,
    price: parseOptionalNumber(o.price) ?? 0,
    parentItemId,
    rowTotal,
  };
}

// ---- ERP (megaventory) normalizer (faithful port of normalizeMegaventoryInvoiceRawOrder) -----
export function normalizeMegaventoryInvoice(row: Record<string, unknown>): EcommerceRawOrder {
  const net = typeof row.netAmount === 'number' && Number.isFinite(row.netAmount)
    ? row.netAmount : parseFloat(String(row.netAmount ?? '0')) || 0;
  const day = String(row.date ?? '').slice(0, 10);
  return {
    orderId: String(row.documentId ?? ''),
    orderName: String(row.documentNo ?? row.documentId ?? ''),
    platform: 'megaventory_invoices',
    status: String(row.status ?? ''),
    total: Math.max(0, net),
    currency: String(row.currency ?? 'EUR'),
    createdAt: day ? `${day}T12:00:00.000Z` : '',
    lineItems: Array.isArray(row.lineItems)
      ? row.lineItems.map(normalizeLineItem).filter((it) => it.sku || it.title || it.name) : [],
  };
}

// ---- e-shop ex-VAT total + order normalizer (faithful port) ----------------------------------
export function computeExVatTotal(platform: string, row: Record<string, unknown>): number {
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
  if (platform === 'opencart') return Math.max(0, num(row.total) - num(row.totalTax));
  return num(row.total);
}
function normalizeEshopOrder(platform: string, row: Record<string, unknown>): EcommerceRawOrder {
  const rawItems = row.lineItems;
  return {
    orderId: String(row.orderId || row.incrementId || row.id || ''),
    orderName: String(row.orderName || row.orderNumber || row.incrementId || row.orderId || ''),
    platform,
    status: String(row.status || row.financialStatus || row.financial_status || ''),
    total: Number(computeExVatTotal(platform, row) || 0),
    currency: String(row.currency || 'EUR'),
    createdAt: coerceCreatedAt(row.createdAt ?? row.created_at),
    lineItems: Array.isArray(rawItems) ? rawItems.map(normalizeLineItem) : [],
    revenueIncluded: typeof row.revenueIncluded === 'boolean' ? row.revenueIncluded : undefined,
    dataAnalysisIncluded: typeof row.dataAnalysisIncluded === 'boolean' ? row.dataAnalysisIncluded : undefined,
  };
}

// ---- windowed read with the client's fallback ------------------------------------------------
async function windowedRead(
  base: Query<DocumentData>, dateField: string, since: string, until: string, untilSuffix: string, cap: number
): Promise<Record<string, unknown>[]> {
  try {
    const snap = await base
      .where(dateField, '>=', since)
      .where(dateField, '<=', `${until}${untilSuffix}`)
      .orderBy(dateField, 'desc')
      .limit(cap)
      .get();
    if (snap.size > 0) return snap.docs.map((d) => d.data());
  } catch { /* missing composite index → fall back below */ }
  // Fallback: brand+limit, JS-window (mirrors loadCappedBrandRowsWithoutDateComposite).
  const snap = await base.limit(cap).get();
  return snap.docs.map((d) => d.data()).filter((row) => {
    const day = dayOf(row[dateField] ?? row.createdAt ?? row.created_at);
    return day && day >= since && day <= until;
  });
}

function quality(orders: EcommerceRawOrder[]): { total: number; identified: number; withLineItems: number } {
  let identified = 0, withLineItems = 0;
  for (const o of orders) {
    const ck = o.customerKey;
    if (typeof ck === 'string' && ck.trim()) identified += 1;
    if (o.lineItems.length > 0) withLineItems += 1;
  }
  return { total: orders.length, identified, withLineItems };
}

/**
 * Per-window orders for the marketing plan, mirroring fetchDataAnalysisOrders(revenueMode:'all').
 * Returns a map windowKey -> EcommerceRawOrder[] (no classification rules applied under 'all').
 * The selection logic is unchanged from the client; windows are independent → fetched concurrently.
 */
export async function loadMarketingPlanOrdersByWindow(
  db: Firestore, brandId: string, windows: OrderWindow[]
): Promise<Record<string, EcommerceRawOrder[]>> {
  const connSnap = await db.doc(`connectors/${brandId}`).get();
  const conn = (connSnap.data() || {}) as Record<string, any>;
  const erpBackend = conn.megaventory?.connected
    ? 'megaventory_invoices'
    : (conn.softone?.connected === true && conn.softone?.syncSalesDocs === true)
      ? 'softone_sales_documents' : null;
  const platforms = (['shopify', 'woocommerce', 'opencart', 'magento'] as const)
    .filter((p) => conn[p]?.connected === true);

  // E-shop orders for one window — platforms read concurrently (independent collections).
  const loadPlatforms = async (w: OrderWindow): Promise<EcommerceRawOrder[]> => {
    const perPlatform = await Promise.all(platforms.map(async (p) => {
      const base = db.collection(ECOMMERCE_ORDER_COLLECTIONS[p]).where('brandId', '==', brandId);
      const rows = await windowedRead(base, 'createdAt', w.sinceDate, w.untilDate, 'T23:59:59.999Z', DATA_ANALYSIS_ORDER_LIMIT);
      return rows.map((r) => normalizeEshopOrder(p, r));
    }));
    return perPlatform.flat();
  };

  const loadWindow = async (w: OrderWindow): Promise<EcommerceRawOrder[]> => {
    let erp: EcommerceRawOrder[] = [];
    if (erpBackend === 'megaventory_invoices') {
      const base = db.collection('megaventory_invoices').where('brandId', '==', brandId);
      const rows = await windowedRead(base, 'date', w.sinceDate, w.untilDate, '', ERP_DATA_ANALYSIS_ORDER_LIMIT);
      erp = rows.map(normalizeMegaventoryInvoice).filter((o) => o.total > 0);
    }
    // (softone path omitted from v1 — no softone brand needs the marketing plan yet; falls through to e-shop/empty)

    // fetchDataAnalysisOrders branch: ERP first; fall back to / prefer e-shop when ERP detail is weak.
    if (erp.length === 0) return platforms.length > 0 ? loadPlatforms(w) : [];
    const eq = quality(erp);
    const erpWeak = eq.withLineItems === 0 || (eq.total >= 1000 && eq.identified / Math.max(eq.total, 1) < 0.25);
    if (!erpWeak || platforms.length === 0) return erp;
    const po = await loadPlatforms(w);
    const pq = quality(po);
    return (pq.identified > eq.identified || pq.withLineItems > eq.withLineItems)
      ? po.map((o) => ({ ...o, erpBacked: true })) : erp;
  };

  // Windows are independent (each writes a distinct key) → fetch concurrently instead of serially.
  const entries = await Promise.all(windows.map(async (w) => [w.key, await loadWindow(w)] as const));
  return Object.fromEntries(entries);
}
