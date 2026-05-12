/**
 * Client-side: fetch παραγγελιών από Firestore (όλα τα e-shop connectors) και
 * αθροίσεις ίδιες με το ecommerceAggregator (demo + cancelled) ώστε οι περίοδοι >90d
 * να εμφανίζονται σωστά στο UI (το server summary κρατά rolling ~90 ημέρες).
 */
import { limit, orderBy, where, Timestamp, type QueryConstraint } from 'firebase/firestore';
import { FirestoreService } from './firestore';
import {
  classifyEcommerceOrder,
  isExcludedEcommerceStatus,
  mergeSalesChannelRulesForBrand,
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
  /** Magento `item_id` — για απόρριψη γονικής γραμμής όταν υπάρχουν child lines */
  itemId?: string | number | null;
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
  /** Magento `payment.method` (κωδικός) — χρήσιμο για chart τρόπου πληρωμής με Viva */
  paymentMethodCode?: string;
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
  /** Numeric Magento `store_id` (όταν sync όλων των store views) για εξαιρέσεις analytics. */
  magentoStoreId?: number;
  /** Hostname του public storefront (Magento)· για κανόνες «domain / eshop». */
  orderStoreDomain?: string;
};

export const ECOMMERCE_ORDER_COLLECTIONS: Record<string, string> = {
  shopify: 'shopify_orders',
  woocommerce: 'woo_orders',
  opencart: 'opencart_orders',
  magento: 'magento_orders',
};

const DATA_ANALYSIS_ORDER_LIMIT = 5000;
const ERP_DATA_ANALYSIS_ORDER_LIMIT = 50000;

export function isEcommerceOrderCancelled(status: string | null | undefined): boolean {
  return isExcludedEcommerceStatus(status);
}

/** Status που αποκρύπτονται από πίνακες παραγγελιών (ενώ τα cancelled παραμένουν ορατά για έλεγχο). */
const ORDER_STATUS_OMITTED_FROM_LISTS = new Set(['viva_klarna_undefined']);

export function isOmittedFromEcommerceOrderLists(status: string | null | undefined): boolean {
  return ORDER_STATUS_OMITTED_FROM_LISTS.has(String(status || '').trim().toLowerCase());
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
    itemId: (() => {
      const v = o.itemId ?? o.item_id;
      if (v == null || v === false) return undefined;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim()) return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
    rowTotal: rowTot,
  };
}

/**
 * Net products revenue ex-VAT — ίδια λογική με server aggregator (computeOrderExVatRevenue).
 *
 * Magento: `baseSubtotal − |baseDiscountAmount|` = items ex-tax σε base currency (EUR), χωρίς μεταφορικά.
 * Fallback: `subtotal − |discountAmount|` μόνο για EUR orders χωρίς base fields.
 *
 * Shopify/WooCommerce: `total − totalTax`. OpenCart: `total − totalTax`.
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
  if (platform === 'opencart') return Math.max(0, num(row.total) - num(row.totalTax));
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
  const hasRealEmail = customerEmail.includes('@');

  /**
   * Dedup priority για RFM (πελάτης = ταυτότητα, όχι αποκλειστικά «registered»):
   * 1. emailHash όταν υπάρχει — κρυπτογραφημένο, σταθερό cross-store, καλύπτει guest+registered ίδιου email.
   * 2. raw email (lower-cased) ως δευτερευόντως όταν δεν υπάρχει hash αλλά υπάρχει @.
   * 3. ${platform}:${customerId} όταν δεν υπάρχει καθόλου email αλλά το store δίνει σταθερό id.
   *
   * Παλαιότερη συνθήκη απαιτούσε hasCustomerId για όλα — αυτό απέκλειε guest checkouts
   * με έγκυρο email (συνηθισμένο σε Magento/B2C), μειώνοντας τεχνητά τους ταυτοποιημένους πελάτες.
   */
  let customerKey = '';
  if (emailHash) {
    customerKey = `email:${emailHash}`;
  } else if (hasRealEmail) {
    customerKey = `email:${customerEmail}`;
  } else if (hasCustomerId) {
    customerKey = `${platform}:${s}`;
  }

  let magentoStoreId: number | undefined;
  if (platform === 'magento') {
    const rawSid = row.magentoStoreId ?? row.store_id;
    const n = Number(rawSid);
    if (Number.isFinite(n) && n > 0) magentoStoreId = n;
  }

  let orderStoreDomain: string | undefined;
  if (platform === 'magento') {
    const od = row.orderStoreDomain ?? row.order_store_domain;
    if (typeof od === 'string' && od.trim()) {
      let h = od.trim().toLowerCase();
      if (/^https?:\/\//i.test(h)) {
        try {
          h = new URL(h).hostname.toLowerCase();
        } catch {
          h = h.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || h;
        }
      }
      if (h.startsWith('www.')) h = h.slice(4);
      orderStoreDomain = h || undefined;
    }
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
    ...(row.paymentMethodCode != null || row.payment_method_code != null
      ? { paymentMethodCode: String(row.paymentMethodCode ?? row.payment_method_code) }
      : {}),
    shippingMethod: String(row.shippingMethod || row.shipping_method || row.shippingDescription || ''),
    salesChannel: row.salesChannel as EcommerceSalesChannel | undefined,
    revenueIncluded: typeof row.revenueIncluded === 'boolean' ? row.revenueIncluded : undefined,
    exclusionReason: row.exclusionReason as EcommerceExclusionReason | undefined,
    ...(customerKey ? { customerKey } : {}),
    ...(emailHash ? { customerEmailHash: emailHash } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(magentoStoreId != null ? { magentoStoreId } : {}),
    ...(orderStoreDomain ? { orderStoreDomain } : {}),
  };
}

async function fetchSalesChannelRulesForOrders(
  brandId: string,
  revenueSourceMode: 'eshop_classified' | 'eshop_all' | 'erp'
): Promise<EcommerceSalesChannelRule[]> {
  try {
    const connector = await FirestoreService.getDocument<Record<string, unknown>>('connectors', brandId);
    if (!connector) {
      return mergeSalesChannelRulesForBrand([], revenueSourceMode);
    }
    return mergeSalesChannelRulesForBrand(
      [
        connector.ecommerceSalesChannelRules,
        connector.salesChannelRules,
        (connector.magento as { salesChannelRules?: unknown } | undefined)?.salesChannelRules,
      ],
      revenueSourceMode
    );
  } catch {
    return mergeSalesChannelRulesForBrand([], revenueSourceMode);
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

/** ERP τιμολόγια: το «Closed» κ.λπ. δεν πρέπει να περνάει ως excluded status του e-shop. */
function sanitizeErpStatusForClassification(raw: string): string {
  const st = String(raw || '').toLowerCase();
  if (st.includes('cancel') || st.includes('void') || st.includes('ακυρ') || st.includes('reject')) {
    return 'cancelled';
  }
  return 'completed';
}

function softOneCustomerTextFromRow(row: Record<string, unknown>): string {
  const keys = ['CUSTOMER.NAME', 'TRDR.NAME', 'SALDOC.TRDRNAME', 'TRDRNAME', 'CUSTOMER.CODE', 'TRDR.CODE'];
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function normalizeCustomerLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('el-GR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isGenericRetailCustomerName(value: unknown): boolean {
  const label = normalizeCustomerLabel(value);
  return (
    label === 'πελατης λιανικης' ||
    label === 'πελατης λιανικη' ||
    label === 'λιανικη' ||
    label === 'retail customer' ||
    label === 'cash customer' ||
    label === 'walk in customer'
  );
}

/** Σταθερό κλειδί πελάτη για RFM από Megaventory τιμολόγια (ίδια λογική με server megaventoryRfm). */
function megaventoryInvoiceCustomerKey(row: Record<string, unknown>): string {
  const name = String(row.clientName ?? '').trim();
  if (isGenericRetailCustomerName(name)) return '';
  const id = String(row.clientId ?? '').trim();
  if (id) return `mv_customer_${id}`;
  if (name) return `mv_customer_${name.toLocaleUpperCase('el-GR')}`;
  return '';
}

function softOneCustomerKeyFromRow(row: Record<string, unknown>): string {
  const name = softOneCustomerTextFromRow(row);
  if (isGenericRetailCustomerName(name)) return '';
  const trdr = row['SALDOC.TRDR'] ?? row.TRDR ?? row['TRDR.TRDR'];
  const trdrStr = trdr != null ? String(trdr).trim() : '';
  if (trdrStr && trdrStr !== '0') return `s1_customer_trdr:${trdrStr}`;
  const code = row['TRDR.CODE'] ?? row['CUSTOMER.CODE'];
  const codeStr = code != null ? String(code).trim() : '';
  if (codeStr) return `s1_customer_code:${codeStr}`;
  if (name) return `s1_customer_${name.toLocaleUpperCase('el-GR')}`;
  return '';
}

function softOneDocDay(row: Record<string, unknown>): string {
  const raw = String(row.documentDate ?? row['SALDOC.TRNDATE'] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return '';
}

function softOneRowNet(row: Record<string, unknown>): number {
  const n = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const x = parseFloat(String(v ?? '0'));
    return Number.isFinite(x) ? x : 0;
  };
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
    const v = n(row[k]);
    if (v !== 0) return Math.abs(v);
  }
  const gross = n(row['SALDOC.TOTALAMOUNT'] ?? row['TOTALAMOUNT'] ?? row['SALDOC.TOTAL'] ?? row['TOTAL']);
  const vat = n(row['SALDOC.VATAMOUNT'] ?? row['VATAMOUNT']);
  if (gross > 0 && vat >= 0) return Math.max(0, gross - vat);
  return Math.abs(n(row['SALDOC.TOTALNET']));
}

function normalizeMegaventoryInvoiceRawOrder(row: Record<string, unknown>): EcommerceRawOrder {
  const net =
    typeof row.netAmount === 'number' && Number.isFinite(row.netAmount)
      ? row.netAmount
      : parseFloat(String(row.netAmount ?? '0')) || 0;
  const day = String(row.date ?? '').slice(0, 10);
  const ck = megaventoryInvoiceCustomerKey(row);
  return {
    orderId: String(row.documentId ?? ''),
    orderName: String(row.documentNo ?? row.documentId ?? ''),
    platform: 'megaventory_invoices',
    status: String(row.status ?? ''),
    total: Math.max(0, net),
    currency: String(row.currency ?? 'EUR'),
    createdAt: day ? `${day}T12:00:00.000Z` : '',
    lineItems: Array.isArray(row.lineItems)
      ? row.lineItems.map(normalizeLineItemFromFirestore).filter((item) => item.sku || item.title || item.name)
      : [],
    paymentMethod: String(row.documentType ?? row.documentTypeDescription ?? ''),
    shippingMethod: '',
    customerEmail: String(row.clientName ?? ''),
    ...(ck ? { customerKey: ck } : {}),
  };
}

function normalizeSoftOneSalesRawOrder(row: Record<string, unknown>): EcommerceRawOrder {
  const net = softOneRowNet(row);
  const day = softOneDocDay(row);
  const ck = softOneCustomerKeyFromRow(row);
  return {
    orderId: String(row['SALDOC.FINDOC'] ?? ''),
    orderName: String(row['SALDOC.SERIAL'] ?? row['SALDOC.FINCODE'] ?? row['SALDOC.FINDOC'] ?? ''),
    platform: 'softone_sales_documents',
    status: String(row['SALDOC.STATUS'] ?? row.STATUS ?? ''),
    total: Math.max(0, net),
    currency: String(row['SALDOC.CURRENCY'] ?? 'EUR'),
    createdAt: day ? `${day}T12:00:00.000Z` : '',
    lineItems: [],
    paymentMethod: String(
      row['SALDOC.SOSOURCE'] ?? row['SALDOC.PAYMENT'] ?? row['SALDOC.FPRMS'] ?? row['SALDOC.COMMENTS'] ?? ''
    ),
    shippingMethod: '',
    customerEmail: softOneCustomerTextFromRow(row),
    ...(ck ? { customerKey: ck } : {}),
  };
}

/**
 * Παραγγελίες από ERP connectors (Megaventory τιμολόγια / SoftOne SALDOC), φιλτραρισμένες κατά ημερομηνία.
 */
async function loadAndClassifyErpConnectorOrders(
  brandId: string,
  mode: 'eshop_classified' | 'eshop_all' | 'erp',
  options: {
    sinceDate?: string;
    untilDate?: string;
    cacheFirst?: boolean;
    revenueMode?: 'brand' | 'classified' | 'all';
  } = {}
): Promise<EcommerceRawOrder[]> {
  const conn = await FirestoreService.getDocument<Record<string, unknown>>('connectors', brandId);
  const mv = conn?.megaventory as Record<string, unknown> | undefined;
  const s1 = conn?.softone as Record<string, unknown> | undefined;
  const backend = mv?.connected
    ? ('megaventory_invoices' as const)
    : s1?.connected === true && s1?.syncSalesDocs === true
      ? ('softone_sales_documents' as const)
      : null;

  if (!backend) return [];

  const rangedLoadOpts =
    options.cacheFirst === true
      ? ({ cacheFirst: true } as const)
      : ({ cacheFirst: false, forceServer: true } as const);
  const coll = backend === 'megaventory_invoices' ? 'megaventory_invoices' : 'softone_sales_documents';
  const dateField = backend === 'megaventory_invoices' ? 'date' : 'documentDate';
  const queryLimit = backend === 'megaventory_invoices' ? ERP_DATA_ANALYSIS_ORDER_LIMIT : DATA_ANALYSIS_ORDER_LIMIT;
  const constraints: QueryConstraint[] = [];
  if (options.sinceDate) constraints.push(where(dateField, '>=', options.sinceDate));
  if (options.untilDate) constraints.push(where(dateField, '<=', options.untilDate));
  if (options.sinceDate || options.untilDate) constraints.push(orderBy(dateField, 'desc'));
  constraints.push(limit(queryLimit));
  const allRulesPromise = fetchSalesChannelRulesForOrders(brandId, mode);
  let rows: Record<string, unknown>[];
  const loadRecentWithoutBrandComposite = () =>
    FirestoreService.getDocuments<Record<string, unknown>>(
      coll,
      [orderBy(dateField, 'desc'), limit(queryLimit)],
      null,
      { forceServer: true }
    );
  try {
    rows = await FirestoreService.getDocuments<Record<string, unknown>>(coll, constraints, brandId, rangedLoadOpts);
    if (options.cacheFirst === true && rows.length === 0) {
      rows = await FirestoreService.getDocuments<Record<string, unknown>>(coll, constraints, brandId, { forceServer: true });
    }
    if (rows.length === 0 && (options.sinceDate || options.untilDate)) {
      rows = await loadRecentWithoutBrandComposite();
    }
  } catch {
    rows = await loadRecentWithoutBrandComposite();
  }
  const allRules = await allRulesPromise;

  const filtered = rows.filter((row) => {
    if (String(row.brandId ?? '') !== brandId) return false;
    const day =
      backend === 'megaventory_invoices'
        ? String(row.date ?? '').slice(0, 10)
        : softOneDocDay(row);
    if (!day && (options.sinceDate || options.untilDate)) return false;
    if (!day) return true;
    if (options.sinceDate && day < options.sinceDate) return false;
    if (options.untilDate && day > options.untilDate) return false;
    return true;
  });

  const orders =
    backend === 'megaventory_invoices'
      ? filtered.map(normalizeMegaventoryInvoiceRawOrder).filter((o) => o.total > 0)
      : filtered.map(normalizeSoftOneSalesRawOrder).filter((o) => o.total > 0);

  const requestedMode = options.revenueMode || 'brand';
  const rules = requestedMode === 'all' ? [] : allRules;

  return orders.map((order) => ({
    ...order,
    ...classifyEcommerceOrder(
      {
        orderId: order.orderId,
        orderName: order.orderName,
        platform: order.platform,
        status: sanitizeErpStatusForClassification(order.status),
        paymentMethod: order.paymentMethod,
        shippingMethod: order.shippingMethod,
        customerEmail: order.customerEmail,
      },
      rules
    ),
  }));
}

async function fetchEcommercePlatformOrdersOnly(
  brandId: string,
  platforms: string[],
  mode: 'eshop_classified' | 'eshop_all' | 'erp',
  options: {
    sinceDate?: string;
    untilDate?: string;
    cacheFirst?: boolean;
    revenueMode?: 'brand' | 'classified' | 'all';
  } = {}
): Promise<EcommerceRawOrder[]> {
  const [allRules, results] = await Promise.all([
    fetchSalesChannelRulesForOrders(brandId, mode),
    Promise.all(
      platforms.map(async (platform) => {
        const collectionName = ECOMMERCE_ORDER_COLLECTIONS[platform];
        if (!collectionName) return [] as EcommerceRawOrder[];
        const constraints: QueryConstraint[] = [];
        if (options.sinceDate) constraints.push(where('createdAt', '>=', options.sinceDate));
        if (options.untilDate) constraints.push(where('createdAt', '<=', `${options.untilDate}T23:59:59.999Z`));
        if (options.sinceDate || options.untilDate) constraints.push(orderBy('createdAt', 'desc'));
        constraints.push(limit(DATA_ANALYSIS_ORDER_LIMIT));
        const hasRange = Boolean(options.sinceDate || options.untilDate);
        /** `cacheFirst: true` (RFM / dashboard) → γρήγορη επανεπίσκεψη· αλλιώς server για «φρέσκα» δεδομένα μετά sync. */
        const rangedLoadOpts =
          options.cacheFirst === true
            ? ({ cacheFirst: true } as const)
            : ({ cacheFirst: false, forceServer: true } as const);

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
            /**
             * Παλιά λογική: `rows.length === 0` → διάβασμα **όλης** της συλλογής + client-side φίλτρο.
             * Αυτό έκανε το UI να «κολλάει» 4–5 λεπτά και με «Τελευταίες 30 ημέρες», επειδή ο χρόνος
             * ήταν ευθύγραμος με τις συνολικές παραγγελίες του brand, όχι με το επιλεγμένο εύρος.
             * Αν υπήρχαν πραγματικά μηδενικά αποτελέσματα, το φόρεμα ήταν ανηθικώς δαπανηρό.
             *
             * Retry μία φορά με `forceServer`: αν το cache επέστρεψε ψευδο-κενό ή χρειάζεται επικύρωση
             * από server για τα ίδια constraints — χωρίς φόρτωση ολόκληρης συλλογής.
             * Αν υπάρχει πραγματικό σφάλμα τύπος/index, πέφτουμε στο catch (ολόκληρη συλλογή) — σπάνιο.
             */
            if (rows.length === 0) {
              rows = await FirestoreService.getDocuments<Record<string, unknown>>(
                collectionName,
                constraints,
                brandId,
                { forceServer: true }
              );
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
            [limit(DATA_ANALYSIS_ORDER_LIMIT)],
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
  // `all` = χωρίς κανόνες (όλες οι παραγγελίες ως included). Αλλιώς: merge legacy Magento store + κανάλια.
  const rules = requestedMode === 'all' ? [] : allRules;
  return results.flat().map((order) => ({
    ...order,
    ...classifyEcommerceOrder(order, rules),
  }));
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
  const mode = await fetchBrandRevenueSourceMode(brandId);
  if (mode === 'erp') {
    const erp = await loadAndClassifyErpConnectorOrders(brandId, mode, options);
    if (erp.length > 0) return erp;
  }
  return fetchEcommercePlatformOrdersOnly(brandId, platforms, mode, options);
}

/**
 * Data Analysis (RFM / behavioral / predictive): παραγγελίες από ERP connectors πρώτα·
 * αν δεν υπάρχουν τιμολόγια / SALDOC στο εύρος, fallback στα e-shop connectors.
 */
export async function fetchDataAnalysisOrders(
  brandId: string,
  platforms: string[],
  options: {
    sinceDate?: string;
    untilDate?: string;
    cacheFirst?: boolean;
    revenueMode?: 'brand' | 'classified' | 'all';
  } = {}
): Promise<EcommerceRawOrder[]> {
  const mode = await fetchBrandRevenueSourceMode(brandId);
  const erp = await loadAndClassifyErpConnectorOrders(brandId, mode, options);
  if (erp.length > 0) return erp;
  return fetchEcommercePlatformOrdersOnly(brandId, platforms, mode, options);
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
