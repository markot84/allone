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
}

// ─── Internal types ─────────────────────────────────────────────────────────

interface OrderRecord {
  customerId: string;
  customerName: string;
  email?: string;
  revenue: number;
  date: string; // YYYY-MM-DD
  platform: string;
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
    out.push({
      customerId: ck,
      customerName: megaventoryCustomerName(d),
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
    out.push({
      customerId: ck,
      customerName: String(d.customerName ?? d.customer_name ?? email).trim(),
      ...(email.includes('@') ? { email } : {}),
      revenue,
      date: day,
      platform,
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
}

async function resolveOrdersForBrand(db: Firestore, brandId: string): Promise<DataSourceResult> {
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const conn = (connDoc.data() || {}) as Record<string, unknown>;

  const mv = conn.megaventory as Record<string, unknown> | undefined;
  const s1 = conn.softone as Record<string, unknown> | undefined;

  // ERP first
  if (mv?.connected) {
    const orders = await readMegaventoryOrders(db, brandId);
    if (orders.length > 0) {
      logger.info(`[RFM] ${brandId}: ERP source = megaventory_invoices, ${orders.length} invoices`);
      return { orders, dataSource: 'erp', platforms: ['megaventory'], guestOrdersSkipped: 0 };
    }
  }
  if (s1?.connected === true && s1?.syncSalesDocs === true) {
    const orders = await readSoftOneOrders(db, brandId);
    if (orders.length > 0) {
      logger.info(`[RFM] ${brandId}: ERP source = softone_sales_documents, ${orders.length} docs`);
      return { orders, dataSource: 'erp', platforms: ['softone'], guestOrdersSkipped: 0 };
    }
  }

  // E-shop fallback
  const eshopPlatforms = ['shopify', 'woocommerce', 'opencart', 'magento'].filter(
    (p) => Boolean((conn[p] as Record<string, unknown> | undefined)?.connected)
  );

  if (eshopPlatforms.length === 0) {
    return { orders: [], dataSource: 'eshop', platforms: [], guestOrdersSkipped: 0 };
  }

  const results = await Promise.all(eshopPlatforms.map((p) => readEshopPlatformOrders(db, brandId, p)));
  const orders = results.flat();
  logger.info(`[RFM] ${brandId}: E-shop source = ${eshopPlatforms.join(',')}, ${orders.length} orders`);
  return { orders, dataSource: 'eshop', platforms: eshopPlatforms, guestOrdersSkipped: 0 };
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

  const { orders: rawOrders, dataSource, platforms, guestOrdersSkipped } = await resolveOrdersForBrand(db, brandId);
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

  // Build per-customer data + segment aggregates
  const segmentMap = new Map<string, { name: string; count: number; revenue: number; orders: number }>();
  const customerRecords: RFMCustomer[] = [];

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
    `[RFM] ${brandId}: computed segments=${segments.length} customers=${totalCustomers} source=${dataSource}:${platforms.join(',')}`
  );
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
}

async function writeRfmComputedDoc(db: Firestore, brandId: string, input: WriteRfmInput): Promise<void> {
  const {
    dataSource, platforms, totalCustomers, totalOrders,
    ordersAttributed, guestOrdersSkipped, segments, customers,
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
  });

  logger.info(
    `[RFM] ${brandId}: customers persisted — ${totalCustomers} customers across ${chunkPayloads.length} chunk(s) (~${(fullJson.length / 1024).toFixed(1)}KB)`
  );
}
