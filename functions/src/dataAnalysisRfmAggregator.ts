import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { classifyEcommerceOrder, mergeSalesChannelRulesForBrand } from './ecommerceSalesChannel';
import { filterMagentoLineItemsForTopProducts, lineRevenueAndQtyForTopProducts } from './productLineStats';

let db: Firestore;

export function setDb(firestore: Firestore): void {
  db = firestore;
}

// Per-segment customers are persisted here (chunked) instead of being embedded in the RFM aggregate
// doc — embedding ~200×segments×scopes bloated that doc to ~5MB and froze the Data Analysis page on
// read. The customer-list export already reads `segment_customers` as its primary source. Distinct
// `source` from the Megaventory RFM writer so both can coexist for a brand (export dedupes by id).
const SEGMENT_CUSTOMERS_SOURCE = 'data_analysis_rfm';
const SEGMENT_WRITE_BATCH_SIZE = 450;
const SEGMENT_CUSTOMER_CHUNK_SIZE = 500;

function sanitizeFirestoreDocId(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) s = '_';
  s = s.replace(/[/\\]/g, '_');
  if (s === '.' || s === '..') s = '_dot_';
  return s.length > 1500 ? s.slice(0, 1500) : s;
}

/** Remove this writer's prior segment_customers rows for a brand so a re-run leaves no orphans when
 * segment membership changes. Source-scoped, so the Megaventory RFM writer's rows are untouched. */
async function deleteOwnSegmentCustomerRows(firestore: Firestore, brandId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await firestore
      .collection('segment_customers')
      .where('brandId', '==', brandId)
      .where('source', '==', SEGMENT_CUSTOMERS_SOURCE)
      .limit(SEGMENT_WRITE_BATCH_SIZE)
      .get();
    if (snap.empty) break;
    const batch = firestore.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < SEGMENT_WRITE_BATCH_SIZE) break;
  }
  return deleted;
}

type SegmentCustomerRow = { customerId: string; email?: string; recency: number; frequency: number; monetary: number; rfmScore: string };

async function writeSegmentCustomers(
  firestore: Firestore,
  brandId: string,
  segments: Array<{ id: string; name: string; customers?: SegmentCustomerRow[] }>,
): Promise<number> {
  let docs = 0;
  let batch = firestore.batch();
  let ops = 0;
  for (const segment of segments) {
    const customers = segment.customers ?? [];
    for (let i = 0; i < customers.length; i += SEGMENT_CUSTOMER_CHUNK_SIZE) {
      const chunk = customers.slice(i, i + SEGMENT_CUSTOMER_CHUNK_SIZE);
      const docId = sanitizeFirestoreDocId(`${brandId}_${SEGMENT_CUSTOMERS_SOURCE}_${segment.id}_${Math.floor(i / SEGMENT_CUSTOMER_CHUNK_SIZE)}`);
      batch.set(firestore.collection('segment_customers').doc(docId), {
        segmentId: segment.id,
        segmentName: segment.name,
        totalInSegment: customers.length,
        customers: chunk,
        brandId,
        source: SEGMENT_CUSTOMERS_SOURCE,
        updatedAt: FieldValue.serverTimestamp(),
      });
      docs += 1;
      ops += 1;
      if (ops >= SEGMENT_WRITE_BATCH_SIZE) { await batch.commit(); batch = firestore.batch(); ops = 0; }
    }
  }
  if (ops > 0) await batch.commit();
  return docs;
}

type RevenueSourceMode = 'eshop_classified' | 'eshop_all' | 'erp';
type RfmStatus = 'running' | 'ready' | 'failed';
type RfmScopeId = 'identified' | 'all';

type RawLineItem = {
  sku?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
  rowTotal?: number;
  productType?: string;
  itemId?: string | number | null;
  parentItemId?: string | number | null;
};

type NormalizedOrder = {
  orderId: string;
  orderName: string;
  customerKey: string;
  customerEmail?: string;
  customerName?: string;
  createdAt: string;
  total: number;
  status: string;
  paymentMethod: string;
  shippingMethod: string;
  salesChannel: string;
  revenueIncluded: boolean;
  dataAnalysisIncluded: boolean;
  exclusionReason: string;
  lineItems: RawLineItem[];
};

type CatalogDims = {
  sku: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  categoryPath: string[];
  stockOnHand?: number;
  qtySold?: number;
};

type AffinityAgg = {
  revenue: number;
  quantity: number;
  orders: Set<string>;
  skus: Set<string>;
  stockOnHand: number;
  qtySold: number;
  categoryPath?: string[];
};

type CustomerAgg = {
  key: string;
  email?: string;
  name?: string;
  firstOrder: string;
  lastOrder: string;
  orderCount: number;
  revenue: number;
};

type SegmentAgg = {
  id: string;
  name: string;
  count: number;
  revenue: number;
  orders: number;
  sumR: number;
  sumF: number;
  sumM: number;
  firstOrder: string;
  lastOrder: string;
  paymentCounts: Map<string, number>;
  dayCounts: Map<string, number>;
  hourCounts: Map<string, number>;
  category: Map<string, AffinityAgg>;
  brand: Map<string, AffinityAgg>;
  subcategory: Map<string, AffinityAgg>;
  sku: Map<string, AffinityAgg>;
  lineCount: number;
  matchedLineCount: number;
  lineRevenue: number;
  matchedLineRevenue: number;
  customers: Array<{ customerId: string; email?: string; recency: number; frequency: number; monetary: number; rfmScore: string }>;
};

type RfmSegment = {
  id: string;
  name: string;
  rfm_score: string;
  count: number;
  percentage: number;
  revenue_share: number;
  color: string;
  description: string;
  icon: string;
  behavioral?: Record<string, unknown>;
  predictive?: Record<string, unknown>;
  customers?: SegmentAgg['customers'];
};

type ScopeResult = {
  sourcePreference: 'orders' | 'external';
  segments: RfmSegment[];
  totalCustomers: number;
  ordersAttributed: number;
  guestOrdersSkipped: number;
  dataCoverage: {
    sourcePreference: 'orders' | 'external';
    activeSource: 'ecommerce';
    eShopCustomers: number;
    totalCustomers: number;
    otherCustomers: number;
    eShopPenetration: number;
    hasEshopOrders: boolean;
    hasExternalData: boolean;
    policyLabel: 'e-shop orders' | 'e-shop & others';
    marketingPolicy: string;
  };
  canCompute: boolean;
};

type SegmentMigrationFlow = {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  count: number;
  percentage: number;
};

type SegmentMigrationResult = {
  periodDays: number;
  comparedCustomers: number;
  flows: SegmentMigrationFlow[];
  canCompute: boolean;
};

type SegmentPeriodComparisonRow = {
  id: string;
  name: string;
  currentCount: number;
  previousCount: number;
  countDelta: number;
  currentRevenue: number;
  previousRevenue: number;
  revenueDelta: number;
  currentShare: number;
  previousShare: number;
  shareDelta: number;
};

type SegmentPeriodComparisonResult = {
  periodDays: number;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  currentCustomers: number;
  previousCustomers: number;
  rows: SegmentPeriodComparisonRow[];
  canCompute: boolean;
};

const PAGE_SIZE = 1000;
const LOOKBACK_DAYS = 365;
const DAY_LABELS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const SEGMENT_DESCRIPTION: Record<string, string> = {
  champions: 'Υψηλά R/F/M — κορυφαίοι πελάτες',
  loyal: 'Σταθερή αγοραστική αξία',
  potential: 'Μεσαίο προφίλ — χώρος αναβάθμισης',
  at_risk: 'Υψηλό ιστορικό αλλά χαμηλό recency',
  lost: 'Πολύ παλιά τελευταία αγορά',
  hibernating: 'Χαμηλή δραστηριότητα & αξία',
  new_customers: 'Λίγες αγορές, σχετικά πρόσφατα',
  recent_customers: 'Πρόσφατη δραστηριότητα, χαμηλότερο βάθος',
  cant_lose_them: 'Υψηλή αξία — κίνδυνος αδράνειας',
  customers_needing_attention: 'Χρειάζονται ενίσχυση engagement',
};
const SEGMENT_CHANNELS: Record<string, string[]> = {
  champions: ['Email VIP', 'Loyalty', 'App Push'],
  loyal: ['Email', 'Remarketing', 'Social'],
  potential: ['Email', 'Meta Ads', 'Google Shopping'],
  recent_customers: ['Email Welcome', 'Remarketing', 'Meta Ads'],
  new_customers: ['Email Welcome', 'Meta Ads'],
  at_risk: ['Email Win-back', 'SMS', 'Remarketing'],
  cant_lose_them: ['Email VIP', 'Phone', 'Personal Offer'],
  customers_needing_attention: ['Email', 'SMS', 'Remarketing'],
  hibernating: ['Remarketing', 'Display'],
  lost: ['Remarketing', 'Display'],
};

function assertDb(): Firestore {
  if (!db) throw new Error('dataAnalysisRfmAggregator db is not initialized');
  return db;
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asIsoDate(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return ((value as { toDate: () => Date }).toDate()).toISOString();
  }
  const raw = asString(value);
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw;
}

function normalizeSku(value: unknown): string {
  return asString(value).toLowerCase();
}

function arrayLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return asString(item);
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return asString(row.name ?? row.label ?? row.title ?? row.value);
      }
      return '';
    })
    .filter(Boolean);
}

function splitCategoryPath(value: unknown): string[] {
  if (Array.isArray(value)) return arrayLabels(value);
  const raw = asString(value);
  if (!raw) return [];
  return raw
    .split(/>|\/|\||,/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function categoryPathFromProduct(row: Record<string, unknown>): string[] {
  const explicitPath = splitCategoryPath(row.categoryPath);
  if (explicitPath.length > 0) return explicitPath;
  const categoryNames = arrayLabels(row.categoryNames);
  if (categoryNames.length > 0) return categoryNames;
  const categories = arrayLabels(row.categories);
  if (categories.length > 0) return categories;
  const category = asString(row.category || row.category_name);
  const subcategory = asString(row.subcategory || row.sub_category);
  return [category, subcategory].filter(Boolean);
}

function normalizeEmail(value: unknown): string {
  return asString(value).toLowerCase();
}

function customerKey(row: Record<string, unknown>): string {
  const hash = asString(row.customerEmailHash);
  if (hash) return `email_hash:${hash}`;
  const email = normalizeEmail(row.customerEmail ?? row.email);
  if (email) return `email:${email}`;
  const id = asString(row.customerId ?? row.customer_id);
  return id ? `magento_customer_${id}` : '';
}

function lineItemsFromRow(row: Record<string, unknown>): RawLineItem[] {
  const raw = row.lineItems;
  if (!Array.isArray(raw)) return [];
  return filterMagentoLineItemsForTopProducts('magento', raw as RawLineItem[])
    .map((item) => ({
      sku: asString(item.sku),
      title: asString(item.title || item.name),
      name: asString(item.name || item.title),
      quantity: asNumber(item.quantity) || 1,
      price: asNumber(item.price),
      rowTotal: asNumber(item.rowTotal),
      productType: asString(item.productType),
      itemId: item.itemId ?? null,
      parentItemId: item.parentItemId ?? null,
    }))
    .filter((item) => item.sku || item.title || item.name);
}

function increment(map: Map<string, number>, key: string, value = 1): void {
  const k = key.trim();
  if (!k) return;
  map.set(k, (map.get(k) || 0) + value);
}

function topKeys(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function topKey(map: Map<string, number>, fallback: string): string {
  return topKeys(map, 1)[0] || fallback;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function lineRevenue(line: RawLineItem): number {
  const computed = lineRevenueAndQtyForTopProducts('magento', line);
  return computed?.revenue ?? Math.max(0, asNumber(line.rowTotal) || asNumber(line.price) * Math.max(1, asNumber(line.quantity) || 1));
}

function orderRevenue(order: NormalizedOrder): number {
  if (order.lineItems.length === 0) return Math.max(0, order.total);
  return Math.max(0, order.lineItems.reduce((sum, line) => sum + lineRevenue(line), 0) || order.total);
}

function assignQuintileScores(values: number[], lowIsHighScore: boolean): number[] {
  const n = values.length;
  const rows = values.map((value, index) => ({ value, index })).sort((a, b) => lowIsHighScore ? a.value - b.value : b.value - a.value);
  const scores = new Array<number>(n).fill(1);
  // Position-based quintile band, but equal values must share a score — otherwise tied customers
  // (e.g. all frequency=1) split across quintiles by array position; a tie carries the first score.
  let prevValue: number | undefined;
  let prevScore = 5;
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const band = Math.min(4, Math.floor((i * 5) / n));
    let score = 5 - band;
    if (prevValue !== undefined && row.value === prevValue) score = prevScore;
    scores[row.index] = score;
    prevValue = row.value;
    prevScore = score;
  }
  return scores;
}

function segmentFromRfmScores(r: number, f: number, m: number): { id: string; name: string; rfm_score: string } {
  const label = `${r}-${f}-${m}`;
  if (r >= 4 && f >= 4 && m >= 3) return { id: 'champions', name: 'Champions', rfm_score: label };
  if (f <= 2 && r >= 4 && m >= 2) return { id: 'recent_customers', name: 'Recent Customers', rfm_score: label };
  if (f <= 2 && r >= 4) return { id: 'new_customers', name: 'New Customers', rfm_score: label };
  if (r >= 3 && f >= 3 && m >= 3) return { id: 'loyal', name: 'Loyal Customers', rfm_score: label };
  if (r >= 3 && f >= 2 && f <= 3 && m >= 2) return { id: 'potential', name: 'Potential Loyalists', rfm_score: label };
  if (r <= 2 && f >= 4 && m >= 4) return { id: 'cant_lose_them', name: "Can't Lose Them", rfm_score: label };
  if (r <= 2 && f >= 3 && m >= 3) return { id: 'at_risk', name: 'At Risk', rfm_score: label };
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3) return { id: 'customers_needing_attention', name: 'Customers Needing Attention', rfm_score: label };
  if (r <= 2 && f <= 2 && m <= 2) return { id: 'hibernating', name: 'Hibernating', rfm_score: label };
  if (r === 1) return { id: 'lost', name: 'Lost', rfm_score: label };
  return { id: 'potential', name: 'Potential Loyalists', rfm_score: label };
}

function hourBucket(createdAt: string): string | null {
  const d = new Date(createdAt);
  if (!Number.isFinite(d.getTime())) return null;
  const start = Math.floor(d.getHours() / 2) * 2;
  return `${String(start).padStart(2, '0')}:00-${String(start + 2).padStart(2, '0')}:00`;
}

function dayLabel(createdAt: string): string | null {
  const d = new Date(createdAt);
  return Number.isFinite(d.getTime()) ? DAY_LABELS[d.getDay()] || null : null;
}

function bumpAffinity(
  map: Map<string, AffinityAgg>,
  key: string,
  revenue: number,
  quantity: number,
  orderId: string,
  sku: string,
  dims?: CatalogDims
): void {
  const normalized = key.trim();
  if (!normalized) return;
  const current = map.get(normalized) ?? {
    revenue: 0,
    quantity: 0,
    orders: new Set<string>(),
    skus: new Set<string>(),
    stockOnHand: 0,
    qtySold: 0,
  };
  current.revenue += revenue;
  current.quantity += quantity;
  current.orders.add(orderId);
  if (sku && !current.skus.has(sku)) {
    current.skus.add(sku);
    if (dims?.stockOnHand != null) current.stockOnHand += dims.stockOnHand;
    if (dims?.qtySold != null) current.qtySold += dims.qtySold;
    if (!current.categoryPath?.length && dims?.categoryPath.length) current.categoryPath = dims.categoryPath;
  }
  map.set(normalized, current);
}

function affinityRows(map: Map<string, AffinityAgg>, segmentRevenue: number, topN: number): Record<string, unknown>[] {
  const rows = [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, topN);
  const maxRevenue = rows[0]?.[1].revenue || 1;
  const denom = Math.max(segmentRevenue, 1e-6);
  return rows.map(([name, row]) => ({
    name,
    affinity: Math.round((row.revenue / maxRevenue) * 100) / 100,
    avg_order: row.quantity > 0 ? Math.round(row.revenue / row.quantity) : Math.round(row.revenue),
    revenue_eur: Math.round(row.revenue * 100) / 100,
    revenue_share_pct: Math.round((row.revenue / denom) * 1000) / 10,
    ...(row.stockOnHand > 0 ? { stock_on_hand: Math.round(row.stockOnHand * 100) / 100 } : {}),
    ...(row.qtySold > 0 ? { qty_sold: Math.round(row.qtySold * 100) / 100 } : {}),
    ...(row.categoryPath?.length ? { category_path: row.categoryPath } : {}),
  }));
}

function lifecycleForSegment(id: string): string {
  if (id === 'champions' || id === 'loyal') return 'loyal';
  if (id === 'new_customers' || id === 'recent_customers' || id === 'potential') return 'new';
  if (id === 'at_risk' || id === 'cant_lose_them' || id === 'customers_needing_attention') return 'declining';
  return 'dormant';
}

function frequencyLabel(annualOrdersPerCustomer: number): string {
  if (annualOrdersPerCustomer >= 180) return 'daily';
  if (annualOrdersPerCustomer >= 26) return 'weekly';
  if (annualOrdersPerCustomer >= 8) return 'monthly';
  if (annualOrdersPerCustomer >= 2) return 'quarterly';
  return 'rare';
}

function behavioralProfile(segment: SegmentAgg, totalRevenue: number, globalAov: number): Record<string, unknown> {
  const avgBasket = segment.orders > 0 ? segment.revenue / segment.orders : 0;
  const daysWindow = Math.max(30, Math.ceil((new Date(segment.lastOrder).getTime() - new Date(segment.firstOrder).getTime()) / 86400000) + 1);
  const annualOrdersPerCustomer = segment.count > 0 ? (segment.orders / segment.count) * (365 / daysWindow) : 0;
  const avgR = segment.count > 0 ? segment.sumR / segment.count : 3;
  const avgF = segment.count > 0 ? segment.sumF / segment.count : 3;
  const avgM = segment.count > 0 ? segment.sumM / segment.count : 3;
  const lifecycle = lifecycleForSegment(segment.id);
  const peakHours = topKeys(segment.hourCounts, 2);
  const peakDays = topKeys(segment.dayCounts, 2);
  const channels = SEGMENT_CHANNELS[segment.id] || ['Email', 'Remarketing'];
  const revenueShare = totalRevenue > 0 ? segment.revenue / totalRevenue : 0;
  const diversity = Math.min(1, segment.category.size / 6);
  const engagement = clamp(avgR * 13 + avgF * 8 + avgM * 4);
  const upsell = clamp(avgM * 16 + revenueShare * 45 + (avgBasket > globalAov ? 15 : 0));
  const crossSell = clamp(35 + diversity * 45 + avgF * 4);
  const priceSensitivity = avgBasket >= globalAov * 1.25 || avgM >= 4 ? 'low' : avgBasket < globalAov * 0.75 || avgM <= 2 ? 'high' : 'medium';
  const bestTime = peakHours[0] || '10:00-12:00';
  return {
    preferred_channels: channels,
    purchase_frequency: frequencyLabel(annualOrdersPerCustomer),
    avg_basket_size: Math.round(avgBasket),
    peak_hours: peakHours,
    peak_days: peakDays,
    payment_method: topKey(segment.paymentCounts, '—'),
    device_preference: 'mixed',
    category_affinity: affinityRows(segment.category, segment.revenue, 6),
    catalog_match: {
      revenue_matched_pct: segment.lineRevenue > 0 ? Math.round((segment.matchedLineRevenue / segment.lineRevenue) * 1000) / 10 : 0,
      lines_matched_pct: segment.lineCount > 0 ? Math.round((segment.matchedLineCount / segment.lineCount) * 1000) / 10 : 0,
      lines_total: segment.lineCount,
      lines_matched: segment.matchedLineCount,
    },
    brand_affinity: affinityRows(segment.brand, segment.revenue, 10),
    category_affinity_catalog: affinityRows(segment.category, segment.revenue, 10),
    subcategory_affinity: affinityRows(segment.subcategory, segment.revenue, 10),
    sku_affinity: affinityRows(segment.sku, segment.revenue, 10),
    upsell_score: Math.round(upsell),
    cross_sell_score: Math.round(crossSell),
    price_sensitivity: priceSensitivity,
    engagement_score: Math.round(engagement),
    persona: lifecycle === 'loyal' ? 'High-Value Buyer' : lifecycle === 'new' ? 'Emerging Buyer' : lifecycle === 'declining' ? 'Retention Candidate' : 'Dormant Buyer',
    lifecycle_stage: lifecycle,
    communication_preferences: channels.map((channel) => ({ channel, frequency: lifecycle === 'loyal' ? 'Εβδομαδιαία' : 'Μηνιαία', best_time: bestTime })),
  };
}

function predictiveMetrics(segment: SegmentAgg, profile: Record<string, unknown>): Record<string, unknown> {
  const avgBasket = Math.max(1, asNumber(profile.avg_basket_size));
  const daysWindow = Math.max(30, Math.ceil((new Date(segment.lastOrder).getTime() - new Date(segment.firstOrder).getTime()) / 86400000) + 1);
  const annualOrdersPerCustomer = segment.count > 0 ? (segment.orders / segment.count) * (365 / daysWindow) : 0;
  const daysToNext = Math.max(1, Math.round(365 / Math.max(1, annualOrdersPerCustomer)));
  const lifecycle = asString(profile.lifecycle_stage);
  const engagementScore = asNumber(profile.engagement_score);
  const churnRisk = Math.round(clamp(100 - engagementScore + (lifecycle === 'declining' ? 15 : 0)));
  const retentionScore = Math.round(clamp(100 - churnRisk));
  const revenuePerDay = segment.revenue / daysWindow;
  return {
    estimated_ltv: Math.round(avgBasket * Math.max(1, annualOrdersPerCustomer) * (retentionScore / 100 + 0.5)),
    ltv_confidence: Math.round(clamp(55 + Math.min(30, segment.orders / Math.max(1, segment.count)) * 5)),
    churn_risk: churnRisk,
    churn_risk_label: churnRisk < 20 ? 'low' : churnRisk < 50 ? 'medium' : churnRisk < 75 ? 'high' : 'critical',
    next_purchase_probability: Math.round(clamp((engagementScore + (100 - Math.min(100, daysToNext)) * 0.4) / 1.4, 5, 99)),
    days_to_next_purchase: daysToNext,
    predicted_next_order_value: Math.round(avgBasket * (asNumber(profile.upsell_score) > 70 ? 1.1 : 1)),
    revenue_forecast_30d: Math.round(revenuePerDay * 30 * (retentionScore / 100)),
    revenue_forecast_90d: Math.round(revenuePerDay * 90 * (retentionScore / 100)),
    demand_trend: lifecycle === 'loyal' || lifecycle === 'new' ? 'growing' : lifecycle === 'declining' ? 'declining' : 'stable',
    retention_score: retentionScore,
  };
}

function catalogDimsForLine(line: RawLineItem, catalog: Map<string, CatalogDims>): CatalogDims | undefined {
  const sku = normalizeSku(line.sku);
  return sku ? catalog.get(sku) : undefined;
}

function fallbackCategory(line: RawLineItem): string {
  return asString(line.title || line.name || line.sku || 'Unknown');
}

function scopeCustomerKey(order: NormalizedOrder, includeGuests: boolean, index: number): string {
  if (order.customerKey) return order.customerKey;
  return includeGuests ? `guest:magento:${order.orderId || order.orderName || `${order.createdAt.slice(0, 10)}:${index}`}` : '';
}

function aggregateIdentifiedCustomersUntil(orders: NormalizedOrder[], asOf: Date): CustomerAgg[] {
  const byCustomer = new Map<string, CustomerAgg>();
  const asOfMs = asOf.getTime();
  for (const order of orders) {
    const createdAtMs = new Date(order.createdAt || '').getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs > asOfMs) continue;
    if (!order.customerKey || !order.dataAnalysisIncluded) continue;
    const revenue = orderRevenue(order);
    if (revenue <= 0) continue;
    const current = byCustomer.get(order.customerKey);
    if (!current) {
      byCustomer.set(order.customerKey, {
        key: order.customerKey,
        ...(order.customerEmail ? { email: order.customerEmail } : {}),
        ...(order.customerName ? { name: order.customerName } : {}),
        firstOrder: order.createdAt,
        lastOrder: order.createdAt,
        orderCount: 1,
        revenue,
      });
      continue;
    }
    current.orderCount += 1;
    current.revenue += revenue;
    if (!current.email && order.customerEmail) current.email = order.customerEmail;
    if (!current.name && order.customerName) current.name = order.customerName;
    if (order.createdAt < current.firstOrder) current.firstOrder = order.createdAt;
    if (order.createdAt > current.lastOrder) current.lastOrder = order.createdAt;
  }
  return [...byCustomer.values()];
}

function segmentAssignments(customers: CustomerAgg[], asOf: Date): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  if (customers.length === 0) return out;
  const recencyDays = customers.map((customer) => Math.max(0, Math.floor((asOf.getTime() - new Date(customer.lastOrder).getTime()) / 86400000)));
  const frequency = customers.map((customer) => customer.orderCount);
  const monetary = customers.map((customer) => customer.revenue);
  const rScores = assignQuintileScores(recencyDays, true);
  const fScores = assignQuintileScores(frequency, false);
  const mScores = assignQuintileScores(monetary, false);
  customers.forEach((customer, index) => {
    const segment = segmentFromRfmScores(rScores[index] ?? 3, fScores[index] ?? 3, mScores[index] ?? 3);
    out.set(customer.key, { id: segment.id, name: segment.name });
  });
  return out;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function aggregateIdentifiedCustomersInWindow(orders: NormalizedOrder[], from: Date, to: Date): CustomerAgg[] {
  const byCustomer = new Map<string, CustomerAgg>();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  for (const order of orders) {
    const key = order.customerKey?.trim();
    if (!key || !order.dataAnalysisIncluded) continue;
    const createdAtMs = new Date(order.createdAt || '').getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < fromMs || createdAtMs > toMs) continue;
    const revenue = orderRevenue(order);
    if (revenue <= 0) continue;
    const current = byCustomer.get(key);
    if (!current) {
      byCustomer.set(key, {
        key,
        lastOrder: order.createdAt,
        firstOrder: order.createdAt,
        orderCount: 1,
        revenue,
      });
      continue;
    }
    current.orderCount += 1;
    current.revenue += revenue;
    if (order.createdAt < current.firstOrder) current.firstOrder = order.createdAt;
    if (order.createdAt > current.lastOrder) current.lastOrder = order.createdAt;
  }
  return [...byCustomer.values()];
}

function segmentPeriodStats(customers: CustomerAgg[], asOf: Date) {
  const assignments = segmentAssignments(customers, asOf);
  const stats = new Map<string, { id: string; name: string; count: number; revenue: number }>();
  for (const customer of customers) {
    const assignment = assignments.get(customer.key);
    if (!assignment) continue;
    const current = stats.get(assignment.id) ?? {
      id: assignment.id,
      name: assignment.name,
      count: 0,
      revenue: 0,
    };
    current.count += 1;
    current.revenue += customer.revenue;
    stats.set(assignment.id, current);
  }
  return stats;
}

function computeSegmentPeriodComparison(orders: NormalizedOrder[], periodDays: number): SegmentPeriodComparisonResult {
  const validOrderDates = orders
    .filter((order) => order.customerKey && order.dataAnalysisIncluded && orderRevenue(order) > 0)
    .map((order) => new Date(order.createdAt || ''))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  const currentTo = validOrderDates[0];
  if (!currentTo) {
    const empty = dateKey(new Date());
    return {
      periodDays,
      currentFrom: empty,
      currentTo: empty,
      previousFrom: empty,
      previousTo: empty,
      currentCustomers: 0,
      previousCustomers: 0,
      rows: [],
      canCompute: false,
    };
  }

  currentTo.setHours(23, 59, 59, 999);
  const currentFrom = new Date(currentTo);
  currentFrom.setDate(currentFrom.getDate() - periodDays + 1);
  currentFrom.setHours(0, 0, 0, 0);
  const previousTo = new Date(currentFrom);
  previousTo.setDate(previousTo.getDate() - 1);
  previousTo.setHours(23, 59, 59, 999);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - periodDays + 1);
  previousFrom.setHours(0, 0, 0, 0);

  const currentCustomers = aggregateIdentifiedCustomersInWindow(orders, currentFrom, currentTo);
  const previousCustomers = aggregateIdentifiedCustomersInWindow(orders, previousFrom, previousTo);
  const currentStats = segmentPeriodStats(currentCustomers, currentTo);
  const previousStats = segmentPeriodStats(previousCustomers, previousTo);
  const currentTotal = currentCustomers.length;
  const previousTotal = previousCustomers.length;
  const ids = new Set([...currentStats.keys(), ...previousStats.keys()]);
  const rows = [...ids]
    .map((id) => {
      const current = currentStats.get(id);
      const previous = previousStats.get(id);
      const currentCount = current?.count ?? 0;
      const previousCount = previous?.count ?? 0;
      const currentShare = currentTotal > 0 ? Math.round((currentCount / currentTotal) * 1000) / 10 : 0;
      const previousShare = previousTotal > 0 ? Math.round((previousCount / previousTotal) * 1000) / 10 : 0;
      return {
        id,
        name: current?.name ?? previous?.name ?? id,
        currentCount,
        previousCount,
        countDelta: currentCount - previousCount,
        currentRevenue: current?.revenue ?? 0,
        previousRevenue: previous?.revenue ?? 0,
        revenueDelta: (current?.revenue ?? 0) - (previous?.revenue ?? 0),
        currentShare,
        previousShare,
        shareDelta: Math.round((currentShare - previousShare) * 10) / 10,
      };
    })
    .sort((a, b) => Math.abs(b.countDelta) - Math.abs(a.countDelta) || b.currentCount - a.currentCount)
    .slice(0, 8);

  return {
    periodDays,
    currentFrom: dateKey(currentFrom),
    currentTo: dateKey(currentTo),
    previousFrom: dateKey(previousFrom),
    previousTo: dateKey(previousTo),
    currentCustomers: currentTotal,
    previousCustomers: previousTotal,
    rows,
    canCompute: currentTotal > 0 && previousTotal > 0 && rows.length > 0,
  };
}

function computeSegmentMigration(orders: NormalizedOrder[], periodDays: number): SegmentMigrationResult {
  const validOrderDates = orders
    .filter((order) => order.customerKey && order.dataAnalysisIncluded && orderRevenue(order) > 0)
    .map((order) => new Date(order.createdAt || ''))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  const currentAsOf = validOrderDates[0];
  if (!currentAsOf) return { periodDays, comparedCustomers: 0, flows: [], canCompute: false };

  currentAsOf.setHours(23, 59, 59, 999);
  const previousAsOf = new Date(currentAsOf);
  previousAsOf.setDate(previousAsOf.getDate() - periodDays);
  previousAsOf.setHours(23, 59, 59, 999);

  const previousAssignments = segmentAssignments(aggregateIdentifiedCustomersUntil(orders, previousAsOf), previousAsOf);
  const currentAssignments = segmentAssignments(aggregateIdentifiedCustomersUntil(orders, currentAsOf), currentAsOf);
  if (previousAssignments.size === 0 || currentAssignments.size === 0) {
    return { periodDays, comparedCustomers: 0, flows: [], canCompute: false };
  }

  const flows = new Map<string, SegmentMigrationFlow>();
  let comparedCustomers = 0;
  for (const [customerKey, previous] of previousAssignments.entries()) {
    const current = currentAssignments.get(customerKey);
    if (!current) continue;
    comparedCustomers += 1;
    if (previous.id === current.id) continue;
    const key = `${previous.id}->${current.id}`;
    const existing = flows.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      flows.set(key, {
        from: previous.id,
        fromName: previous.name,
        to: current.id,
        toName: current.name,
        count: 1,
        percentage: 0,
      });
    }
  }

  const out = [...flows.values()]
    .map((flow) => ({
      ...flow,
      percentage: comparedCustomers > 0 ? Math.round((flow.count / comparedCustomers) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    periodDays,
    comparedCustomers,
    flows: out,
    canCompute: comparedCustomers > 0 && out.length > 0,
  };
}

function computeAdaptiveSegmentMigration(orders: NormalizedOrder[]): SegmentMigrationResult {
  const monthly = computeSegmentMigration(orders, 30);
  return monthly.canCompute ? monthly : computeSegmentMigration(orders, 90);
}

function computeAdaptiveSegmentPeriodComparison(orders: NormalizedOrder[]): SegmentPeriodComparisonResult {
  const monthly = computeSegmentPeriodComparison(orders, 30);
  return monthly.canCompute ? monthly : computeSegmentPeriodComparison(orders, 90);
}

function computeScope(orders: NormalizedOrder[], catalog: Map<string, CatalogDims>, includeGuests: boolean): ScopeResult {
  const byCustomer = new Map<string, CustomerAgg>();
  let ordersAttributed = 0;
  let guestOrdersSkipped = 0;
  let identifiedCustomers = 0;

  orders.forEach((order, index) => {
    const revenue = orderRevenue(order);
    if (!order.dataAnalysisIncluded || revenue <= 0) return;
    const key = scopeCustomerKey(order, includeGuests, index);
    if (!order.customerKey) guestOrdersSkipped += 1;
    if (!key) return;
    ordersAttributed += 1;
    const current = byCustomer.get(key);
    if (!current) {
      byCustomer.set(key, {
        key,
        ...(order.customerEmail ? { email: order.customerEmail } : {}),
        ...(order.customerName ? { name: order.customerName } : {}),
        firstOrder: order.createdAt,
        lastOrder: order.createdAt,
        orderCount: 1,
        revenue,
      });
      if (order.customerKey) identifiedCustomers += 1;
    } else {
      current.orderCount += 1;
      current.revenue += revenue;
      if (!current.email && order.customerEmail) current.email = order.customerEmail;
      if (!current.name && order.customerName) current.name = order.customerName;
      if (order.createdAt < current.firstOrder) current.firstOrder = order.createdAt;
      if (order.createdAt > current.lastOrder) current.lastOrder = order.createdAt;
    }
  });

  const customers = [...byCustomer.values()];
  if (customers.length === 0) {
    return {
      sourcePreference: includeGuests ? 'external' : 'orders',
      segments: [],
      totalCustomers: 0,
      ordersAttributed,
      guestOrdersSkipped,
      canCompute: false,
      dataCoverage: {
        sourcePreference: includeGuests ? 'external' : 'orders',
        activeSource: 'ecommerce',
        eShopCustomers: identifiedCustomers,
        totalCustomers: 0,
        otherCustomers: 0,
        eShopPenetration: 0,
        hasEshopOrders: false,
        hasExternalData: includeGuests,
        policyLabel: includeGuests ? 'e-shop & others' : 'e-shop orders',
        marketingPolicy: includeGuests ? 'Χρησιμοποιεί όλες τις έγκυρες παραγγελίες, μαζί με guest checkouts.' : 'Χρησιμοποιεί αγοραστές με σταθερό id ή email.',
      },
    };
  }

  const latestTime = Math.max(...orders.map((order) => new Date(order.createdAt).getTime()).filter(Number.isFinite));
  const asOf = latestTime > 0 ? new Date(latestTime) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const recencyDays = customers.map((customer) => Math.max(0, Math.floor((asOf.getTime() - new Date(customer.lastOrder).getTime()) / 86400000)));
  const frequency = customers.map((customer) => customer.orderCount);
  const monetary = customers.map((customer) => customer.revenue);
  const rScores = assignQuintileScores(recencyDays, true);
  const fScores = assignQuintileScores(frequency, false);
  const mScores = assignQuintileScores(monetary, false);
  const segmentByCustomer = new Map<string, { id: string; name: string; r: number; f: number; m: number; recency: number }>();
  const bySegment = new Map<string, SegmentAgg>();
  const totalRevenue = monetary.reduce((sum, value) => sum + value, 0);

  customers.forEach((customer, index) => {
    const r = rScores[index] ?? 3;
    const f = fScores[index] ?? 3;
    const m = mScores[index] ?? 3;
    const segment = segmentFromRfmScores(r, f, m);
    segmentByCustomer.set(customer.key, { id: segment.id, name: segment.name, r, f, m, recency: recencyDays[index] ?? 0 });
    const group = bySegment.get(segment.id) ?? {
      id: segment.id,
      name: segment.name,
      count: 0,
      revenue: 0,
      orders: 0,
      sumR: 0,
      sumF: 0,
      sumM: 0,
      firstOrder: customer.firstOrder,
      lastOrder: customer.lastOrder,
      paymentCounts: new Map<string, number>(),
      dayCounts: new Map<string, number>(),
      hourCounts: new Map<string, number>(),
      category: new Map<string, AffinityAgg>(),
      brand: new Map<string, AffinityAgg>(),
      subcategory: new Map<string, AffinityAgg>(),
      sku: new Map<string, AffinityAgg>(),
      lineCount: 0,
      matchedLineCount: 0,
      lineRevenue: 0,
      matchedLineRevenue: 0,
      customers: [],
    };
    group.count += 1;
    group.revenue += customer.revenue;
    group.orders += customer.orderCount;
    group.sumR += r;
    group.sumF += f;
    group.sumM += m;
    if (customer.firstOrder < group.firstOrder) group.firstOrder = customer.firstOrder;
    if (customer.lastOrder > group.lastOrder) group.lastOrder = customer.lastOrder;
    if (group.customers.length < 200) {
      group.customers.push({
        customerId: customer.key,
        ...(customer.email ? { email: customer.email } : {}),
        ...(customer.name ? { name: customer.name } : {}),
        recency: recencyDays[index] ?? 0,
        frequency: customer.orderCount,
        monetary: Math.round(customer.revenue * 100) / 100,
        rfmScore: `${r}-${f}-${m}`,
      });
    }
    bySegment.set(segment.id, group);
  });

  orders.forEach((order, index) => {
    if (!order.dataAnalysisIncluded || orderRevenue(order) <= 0) return;
    const key = scopeCustomerKey(order, includeGuests, index);
    const assignment = segmentByCustomer.get(key);
    if (!assignment) return;
    const group = bySegment.get(assignment.id);
    if (!group) return;
    increment(group.paymentCounts, order.paymentMethod || '—');
    const day = dayLabel(order.createdAt);
    const hour = hourBucket(order.createdAt);
    if (day) increment(group.dayCounts, day);
    if (hour) increment(group.hourCounts, hour);
    for (const line of order.lineItems) {
      const revenue = lineRevenue(line);
      const quantity = Math.max(1, asNumber(line.quantity) || 1);
      if (revenue <= 0) continue;
      const dims = catalogDimsForLine(line, catalog);
      const sku = asString(line.sku);
      const category = dims?.category || fallbackCategory(line);
      const brand = dims?.brand || '';
      const subcategory = dims?.subcategory || '';
      const subcategoryFallback = subcategory || category;
      group.lineCount += 1;
      group.lineRevenue += revenue;
      if (dims) {
        group.matchedLineCount += 1;
        group.matchedLineRevenue += revenue;
      }
      bumpAffinity(group.category, category, revenue, quantity, order.orderId, sku, dims);
      if (brand) bumpAffinity(group.brand, brand, revenue, quantity, order.orderId, sku, dims);
      if (subcategoryFallback) {
        bumpAffinity(group.subcategory, subcategoryFallback, revenue, quantity, order.orderId, sku, dims);
      }
      bumpAffinity(group.sku, sku || fallbackCategory(line), revenue, quantity, order.orderId, sku, dims);
    }
  });

  const globalAov = ordersAttributed > 0 ? totalRevenue / ordersAttributed : 0;
  const segments = [...bySegment.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map((group) => {
      const avgR = group.count > 0 ? Math.round((group.sumR / group.count) * 10) / 10 : 0;
      const avgF = group.count > 0 ? Math.round((group.sumF / group.count) * 10) / 10 : 0;
      const avgM = group.count > 0 ? Math.round((group.sumM / group.count) * 10) / 10 : 0;
      const behavioral = behavioralProfile(group, totalRevenue, globalAov);
      return {
        id: group.id,
        name: group.name,
        rfm_score: `${avgR}-${avgF}-${avgM}`,
        count: group.count,
        percentage: Math.round((group.count / customers.length) * 1000) / 10,
        revenue_share: totalRevenue > 0 ? Math.round((group.revenue / totalRevenue) * 1000) / 10 : 0,
        color: '#6B7280',
        description: SEGMENT_DESCRIPTION[group.id] || 'Υπολογισμένο από παραγγελίες e-shop',
        icon: '',
        behavioral,
        predictive: predictiveMetrics(group, behavioral),
        customers: group.customers,
      };
    });

  const totalCustomers = customers.length;
  const otherCustomers = includeGuests ? Math.max(0, totalCustomers - identifiedCustomers) : 0;
  return {
    sourcePreference: includeGuests ? 'external' : 'orders',
    segments,
    totalCustomers,
    ordersAttributed,
    guestOrdersSkipped,
    canCompute: segments.length > 0,
    dataCoverage: {
      sourcePreference: includeGuests ? 'external' : 'orders',
      activeSource: 'ecommerce',
      eShopCustomers: identifiedCustomers,
      totalCustomers,
      otherCustomers,
      eShopPenetration: totalCustomers > 0 ? Math.round((identifiedCustomers / totalCustomers) * 1000) / 10 : 0,
      hasEshopOrders: identifiedCustomers > 0,
      hasExternalData: includeGuests && otherCustomers > 0,
      policyLabel: includeGuests ? 'e-shop & others' : 'e-shop orders',
      marketingPolicy: includeGuests ? 'Χρησιμοποιεί όλες τις έγκυρες παραγγελίες, μαζί με guest checkouts.' : 'Χρησιμοποιεί αγοραστές με σταθερό id ή email.',
    },
  };
}

async function revenueModeAndRules(brandId: string): Promise<{
  mode: RevenueSourceMode;
  hasErpConnector: boolean;
  rules: ReturnType<typeof mergeSalesChannelRulesForBrand>;
}> {
  const firestore = assertDb();
  const [brandSnap, connectorsSnap, rulesSnap] = await Promise.all([
    firestore.doc(`brands/${brandId}`).get(),
    firestore.doc(`connectors/${brandId}`).get(),
    firestore.doc(`connector_rules/${brandId}`).get(),
  ]);
  const brandMode = asString(brandSnap.data()?.revenueSourceMode);
  const mode: RevenueSourceMode = brandMode === 'eshop_all' || brandMode === 'erp' ? brandMode : 'eshop_classified';
  const connectors = connectorsSnap.data() || {};
  const hasConnector = (key: string): boolean => {
    const value = connectors[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const connected = (value as Record<string, unknown>).connected;
    return connected !== false;
  };
  const hasErpConnector =
    hasConnector('megaventory') ||
    hasConnector('softone') ||
    hasConnector('epsilon_net') ||
    hasConnector('epsilonNet') ||
    hasConnector('entersoft');
  // Rules: prefer connector_rules doc (post-migration), fallback to legacy connectors fields
  const rulesData = rulesSnap.data() || {};
  const rulesSource = Array.isArray(rulesData.rules) && rulesData.rules.length > 0
    ? [rulesData.rules]
    : [
        connectors.ecommerceSalesChannelRules,
        connectors.salesChannelRules,
        (connectors.magento as Record<string, unknown> | undefined)?.salesChannelRules,
        (connectors.shopify as Record<string, unknown> | undefined)?.salesChannelRules,
        (connectors.woocommerce as Record<string, unknown> | undefined)?.salesChannelRules,
      ];
  const rules = mergeSalesChannelRulesForBrand(rulesSource, mode);
  return { mode, hasErpConnector, rules };
}

async function computeBrandSyncVersion(brandId: string): Promise<{ version: string; latestSyncAt: string | null }> {
  const firestore = assertDb();
  const dates: number[] = [];
  const push = (value: unknown) => {
    const iso = asIsoDate(value);
    const t = new Date(iso).getTime();
    if (Number.isFinite(t)) dates.push(t);
  };
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      if (normalized === 'lastsyncat' || normalized.endsWith('syncat') || normalized === 'syncedat') push(child);
      collect(child);
    }
  };
  const [connectors, ecommerce, business, importJobs] = await Promise.all([
    firestore.doc(`connectors/${brandId}`).get().catch(() => null),
    firestore.doc(`ecommerce_summary/${brandId}`).get().catch(() => null),
    firestore.doc(`business_revenue_summary/${brandId}`).get().catch(() => null),
    firestore.collection('import_jobs').where('brandId', '==', brandId).orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
  ]);
  if (connectors?.exists) collect(connectors.data());
  if (ecommerce?.exists) push(ecommerce.data()?.syncedAt);
  if (business?.exists) push(business.data()?.syncedAt);
  importJobs?.docs.forEach((doc) => push(doc.data().createdAt));
  const latest = dates.length ? Math.max(...dates) : 0;
  return { version: latest ? String(latest) : 'empty', latestSyncAt: latest ? new Date(latest).toISOString() : null };
}

async function loadCatalog(brandId: string): Promise<Map<string, CatalogDims>> {
  const firestore = assertDb();
  const catalog = new Map<string, CatalogDims>();
  const load = async (collection: string) => {
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = firestore
        .collection(collection)
        .where('brandId', '==', brandId)
        .orderBy(FieldPath.documentId())
        .limit(5000);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      snap.docs.forEach((doc) => {
        const row = doc.data();
        const sku = normalizeSku(row.sku || row.productSku);
        if (!sku || catalog.has(sku)) return;
        const rawPath = categoryPathFromProduct(row);
        const category = asString(row.category || row.category_name || rawPath[0]);
        const pathSubcategory = rawPath.length > 1 ? rawPath[rawPath.length - 1] : '';
        const subcategory = asString(row.subcategory || row.sub_category || pathSubcategory);
        const brand = asString(row.brand || row.manufacturer || row.vendor);
        catalog.set(sku, {
          sku,
          name: asString(row.name || row.title),
          brand,
          category,
          subcategory,
          categoryPath: rawPath.length ? rawPath : [category, subcategory].filter(Boolean),
          stockOnHand: asNumber(row.stock_on_hand ?? row.stockOnHand ?? row.stock_level ?? row.qty),
          qtySold: asNumber(row.qty_sold_period ?? row.qtySoldPeriod ?? row.qty_sold_lifetime),
        });
      });
      if (snap.size < 5000) break;
      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (!cursor) break;
    }
  };
  await load('magento_products');
  await load('products');

  // PER-174: brand's authoritative source is megaventory_products (the same mirror PI reads), not the
  // storefront/gap-fill catalog above — magento `manufacturer` can be blocked/option-id and the
  // products gap-fill only carries brand after a full MV cycle. Overlay brand here so Data Analysis
  // brand-affinity matches PI. Touches brand ONLY (category/subcategory left to the storefront catalog).
  {
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = firestore
        .collection('megaventory_products')
        .where('brandId', '==', brandId)
        .orderBy(FieldPath.documentId())
        .limit(5000)
        .select('sku', 'brand', 'category', 'name');
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      snap.docs.forEach((doc) => {
        const row = doc.data();
        const sku = normalizeSku(row.sku);
        const brand = asString(row.brand);
        if (!sku || !brand) return;
        const existing = catalog.get(sku);
        if (existing) {
          if (!existing.brand) existing.brand = brand;
        } else {
          const category = asString(row.category);
          catalog.set(sku, {
            sku,
            name: asString(row.name),
            brand,
            category,
            subcategory: '',
            categoryPath: category ? [category] : [],
            stockOnHand: 0,
            qtySold: 0,
          });
        }
      });
      if (snap.size < 5000) break;
      cursor = snap.docs[snap.docs.length - 1] ?? null;
      if (!cursor) break;
    }
  }

  return catalog;
}

function normalizeOrderDoc(doc: QueryDocumentSnapshot, rules: ReturnType<typeof mergeSalesChannelRulesForBrand>): NormalizedOrder {
  const row = doc.data();
  const lineItems = lineItemsFromRow(row);
  const classification = classifyEcommerceOrder({
    orderId: asString(row.orderId || row.incrementId || doc.id),
    orderName: asString(row.orderName || row.incrementId),
    platform: 'magento',
    status: asString(row.status),
    paymentMethod: asString(row.paymentMethod || row.payment_method),
    shippingMethod: asString(row.shippingMethod || row.shipping_description),
    customerEmail: asString(row.customerEmail),
    customerName: asString(row.customerName),
    magentoStoreId: asNumber(row.magentoStoreId || row.storeId),
    orderStoreDomain: asString(row.orderStoreDomain),
  }, rules);
  const total = asNumber(row.totalExVat ?? row.netTotal ?? row.total ?? row.grandTotal);
  return {
    orderId: asString(row.orderId || row.incrementId || doc.id),
    orderName: asString(row.orderName || row.incrementId || doc.id),
    customerKey: customerKey(row),
    ...(asString(row.customerEmail) ? { customerEmail: asString(row.customerEmail) } : {}),
    ...(asString(row.customerName) ? { customerName: asString(row.customerName) } : {}),
    createdAt: asIsoDate(row.createdAt || row.created_at),
    total,
    status: asString(row.status),
    paymentMethod: asString(row.paymentMethod || row.payment_method),
    shippingMethod: asString(row.shippingMethod || row.shipping_description),
    salesChannel: classification.salesChannel,
    revenueIncluded: classification.revenueIncluded,
    dataAnalysisIncluded: classification.dataAnalysisIncluded,
    exclusionReason: classification.exclusionReason,
    lineItems,
  };
}

async function loadMagentoOrders(brandId: string, sinceDate: string, rules: ReturnType<typeof mergeSalesChannelRulesForBrand>): Promise<{
  orders: NormalizedOrder[];
  pages: number;
}> {
  const firestore = assertDb();
  const orders: NormalizedOrder[] = [];
  let pages = 0;
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = firestore
      .collection('magento_orders')
      .where('brandId', '==', brandId)
      .where('createdAt', '>=', sinceDate)
      .orderBy('createdAt', 'desc')
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    pages += 1;
    snap.docs.forEach((doc) => {
      const order = normalizeOrderDoc(doc, rules);
      if (order.createdAt) orders.push(order);
    });
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return { orders, pages };
}

export async function computeDataAnalysisRfmDiagnostic(brandId: string): Promise<Record<string, unknown>> {
  const firestore = assertDb();
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  since.setHours(0, 0, 0, 0);
  const { mode, rules } = await revenueModeAndRules(brandId);
  const { orders, pages } = await loadMagentoOrders(brandId, since.toISOString().slice(0, 10), rules);
  const uniqueIdentified = new Set<string>();
  let revenueIncludedRows = 0;
  let guestRows = 0;
  let rowsWithLineItems = 0;
  let excludedIntercompanyRows = 0;
  let excludedOtherRows = 0;
  let dataAnalysisExcludedRows = 0;
  for (const order of orders) {
    if (order.lineItems.length > 0) rowsWithLineItems += 1;
    if (order.customerKey) uniqueIdentified.add(order.customerKey);
    else guestRows += 1;
    if (order.revenueIncluded) revenueIncludedRows += 1;
    else if (order.exclusionReason === 'intercompany') excludedIntercompanyRows += 1;
    else excludedOtherRows += 1;
    if (!order.dataAnalysisIncluded) dataAnalysisExcludedRows += 1;
  }
  const payload = {
    brandId,
    status: 'ready',
    mode,
    source: 'magento_orders',
    lookbackDays: LOOKBACK_DAYS,
    pages,
    totalRows: orders.length,
    revenueIncludedRows,
    uniqueIdentifiedBuyers: uniqueIdentified.size,
    guestRows,
    rowsWithLineItems,
    excludedIntercompanyRows,
    excludedOtherRows,
    dataAnalysisExcludedRows,
    computedAt: FieldValue.serverTimestamp(),
  };
  await firestore.doc(`data_analysis_diagnostics/${brandId}`).set(payload, { merge: true });
  return { ...payload, computedAt: new Date().toISOString() };
}

export async function refreshDataAnalysisRfmAggregate(brandId: string): Promise<Record<string, unknown>> {
  const firestore = assertDb();
  const ref = firestore.doc(`data_analysis_rfm/${brandId}`);
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  since.setHours(0, 0, 0, 0);
  await ref.set({
    brandId,
    status: 'running' satisfies RfmStatus,
    source: 'magento_orders',
    updatedAt: FieldValue.serverTimestamp(),
    startedAt: FieldValue.serverTimestamp(),
    lookbackDays: LOOKBACK_DAYS,
  }, { merge: true });

  try {
    const [{ mode, hasErpConnector, rules }, syncVersion, catalog] = await Promise.all([
      revenueModeAndRules(brandId),
      computeBrandSyncVersion(brandId),
      loadCatalog(brandId),
    ]);
    const { orders, pages } = await loadMagentoOrders(brandId, since.toISOString().slice(0, 10), rules);
    const identified = computeScope(orders, catalog, false);
    const all = computeScope(orders, catalog, true);
    // Persist per-segment customers out-of-doc (chunked) so the aggregate stays small enough to read
    // without freezing the Data Analysis page; the customer-list export reads segment_customers.
    // Identified scope = real (email-bearing) customers — the meaningful set for the lists.
    await deleteOwnSegmentCustomerRows(firestore, brandId);
    await writeSegmentCustomers(firestore, brandId, identified.segments);
    const segmentMigration = computeAdaptiveSegmentMigration(orders);
    const segmentPeriodComparison = computeAdaptiveSegmentPeriodComparison(orders);
    const isErpBacked = mode === 'erp' || hasErpConnector;
    const sourceLabel = isErpBacked ? 'ERP' : 'E-shop orders';
    // Drop the per-segment customers from the doc (they now live in segment_customers) — keeps the
    // aggregate small; everything else the page reads (counts, behavioral, charts) stays.
    const stripCustomers = (scope: typeof identified) => ({
      ...scope,
      segments: scope.segments.map((seg) => {
        const copy: Record<string, unknown> = { ...seg };
        delete copy.customers;
        return copy;
      }),
    });
    const payload = {
      brandId,
      status: 'ready' satisfies RfmStatus,
      source: 'magento_orders',
      sourceLabel,
      dataSource: 'ecommerce',
      dataOrigin: isErpBacked ? 'erp_orders' : 'ecommerce_orders',
      syncVersion: syncVersion.version,
      latestSyncAt: syncVersion.latestSyncAt,
      lookbackDays: LOOKBACK_DAYS,
      pages,
      processedOrders: orders.length,
      catalogSkus: catalog.size,
      segmentMigration,
      segmentPeriodComparison,
      scopes: { identified: stripCustomers(identified), all: stripCustomers(all) },
      computedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    };
    await ref.set(payload, { merge: true });
    await computeDataAnalysisRfmDiagnostic(brandId);
    return {
      success: true,
      brandId,
      processedOrders: orders.length,
      identifiedCustomers: identified.totalCustomers,
      allCustomers: all.totalCustomers,
      syncVersion: syncVersion.version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[dataAnalysisRfm] failed brand=${brandId}: ${message}`, { alertKey: ALERT.dataAnalysisRfmFailed });
    await ref.set({
      brandId,
      status: 'failed' satisfies RfmStatus,
      updatedAt: FieldValue.serverTimestamp(),
      error: message,
    }, { merge: true });
    throw error;
  }
}

