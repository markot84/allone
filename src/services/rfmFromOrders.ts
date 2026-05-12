import type { BehavioralProfile, CategoryAffinity, PredictiveMetrics, RFMSegment } from '../types';
import { getEcommerceOrderNetRevenue, isEcommerceOrderRevenueIncluded, type EcommerceRawOrder } from './ecommerceRawOrders';
import { ecommerceLineAffinityKey } from './ecommerceAffinityKey';
import type { CatalogIndexes, ErpSkuDims } from './catalogAlignment';
import { resolveCatalogLineForOrderLine } from './catalogAlignment';

export type RfmCatalogContext = {
  indexes: CatalogIndexes;
  erpBySku: Map<string, ErpSkuDims>;
};

function itemAffinityKey(item: EcommerceRawOrder['lineItems'][number]): string {
  return ecommerceLineAffinityKey(item);
}

export type RfmFromOrdersResult = {
  segments: RFMSegment[];
  totalCustomers: number;
  /** Παραγγελίες με σταθερό customer key (αποκλ. guests). */
  ordersAttributed: number;
  /** Παραγγελίες χωρίς key (συνήθως guest). */
  guestOrdersSkipped: number;
  canCompute: boolean;
};

export type RfmOrderScopeStats = {
  identifiedCustomers: number;
  allBuyers: number;
  guestOrders: number;
  canComputeIdentified: boolean;
  canComputeAll: boolean;
};

export type SegmentMigrationFlow = {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  count: number;
  percentage: number;
};

export type SegmentMigrationResult = {
  periodDays: number;
  comparedCustomers: number;
  flows: SegmentMigrationFlow[];
  canCompute: boolean;
};

type CustomerAgg = {
  key: string;
  email?: string;
  lastOrder: string;
  firstOrder: string;
  orderCount: number;
  revenue: number;
  orders: EcommerceRawOrder[];
};

type CatalogLineAgg = {
  revenue: number;
  quantity: number;
  orders: Set<string>;
  skus: Set<string>;
  stockOnHand: number;
  qtySold: number;
  categoryPath?: string[];
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
  affinity: Map<string, { revenue: number; quantity: number; orders: Set<string> }>;
  catalogBrand: Map<string, CatalogLineAgg>;
  catalogCategory: Map<string, CatalogLineAgg>;
  catalogSubcategory: Map<string, CatalogLineAgg>;
  catalogSku: Map<string, CatalogLineAgg>;
  catalogLineRev: number;
  catalogMatchedRev: number;
  catalogLineCount: number;
  catalogMatchedLineCount: number;
  customers: NonNullable<RFMSegment['customers']>;
};

type CustomerSegmentAssignment = {
  id: string;
  name: string;
};

const DAY_LABELS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const RFM_LOOKBACK_DAYS = 365;

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

/**
 * Χάρτης R-F-M scores → id που υπάρχει στο SEGMENT_BEHAVIORAL_MAP / segmentCategoryMatrix.
 * Κανόνες βασισμένοι σε κλασικό RFM business interpretation.
 */
function segmentFromRfmScores(r: number, f: number, m: number): { id: string; name: string; rfm_score: string } {
  const label = `${r}-${f}-${m}`;

  if (r >= 4 && f >= 4 && m >= 3) {
    return { id: 'champions', name: 'Champions', rfm_score: label };
  }
  if (f <= 2 && r >= 4 && m >= 2) {
    return { id: 'recent_customers', name: 'Recent Customers', rfm_score: label };
  }
  if (f <= 2 && r >= 4) {
    return { id: 'new_customers', name: 'New Customers', rfm_score: label };
  }
  if (r >= 3 && f >= 3 && m >= 3) {
    return { id: 'loyal', name: 'Loyal Customers', rfm_score: label };
  }
  if (r >= 3 && f >= 2 && f <= 3 && m >= 2) {
    return { id: 'potential', name: 'Potential Loyalists', rfm_score: label };
  }
  if (r <= 2 && f >= 4 && m >= 4) {
    return { id: 'cant_lose_them', name: "Can't Lose Them", rfm_score: label };
  }
  if (r <= 2 && f >= 3 && m >= 3) {
    return { id: 'at_risk', name: 'At Risk', rfm_score: label };
  }
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3) {
    return { id: 'customers_needing_attention', name: 'Customers Needing Attention', rfm_score: label };
  }
  if (r <= 2 && f <= 2 && m <= 2) {
    return { id: 'hibernating', name: 'Hibernating', rfm_score: label };
  }
  if (r === 1) {
    return { id: 'lost', name: 'Lost', rfm_score: label };
  }
  return { id: 'potential', name: 'Potential Loyalists', rfm_score: label };
}

const SEGMENT_DESCRIPTION: Partial<Record<string, string>> = {
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

const SEGMENT_CHANNELS: Partial<Record<string, string[]>> = {
  champions: ['Email VIP', 'Loyalty', 'App Push'],
  loyal: ['Email', 'Remarketing', 'Social'],
  potential: ['Email', 'Meta Ads', 'Google Shopping'],
  recent_customers: ['Email Welcome', 'Remarketing', 'Meta Ads'],
  new_customers: ['Email Welcome', 'Meta Ads', 'Google Ads'],
  at_risk: ['Email Win-back', 'SMS', 'Remarketing'],
  cant_lose_them: ['Email VIP', 'Phone', 'Personal Offer'],
  customers_needing_attention: ['Email', 'SMS', 'Remarketing'],
  hibernating: ['Remarketing', 'Display'],
  lost: ['Remarketing', 'Display', 'Email (Low frequency)'],
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function increment(map: Map<string, number>, key: string, value = 1): void {
  const normalized = key.trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + value);
}

function topKey(map: Map<string, number>, fallback: string): string {
  let best = fallback;
  let bestVal = -1;
  for (const [k, v] of map.entries()) {
    if (v > bestVal) {
      best = k;
      bestVal = v;
    }
  }
  return best;
}

function topKeys(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function hourBucket(createdAt: string): string | null {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const start = Math.floor(h / 2) * 2;
  const end = start + 2;
  return `${String(start).padStart(2, '0')}:00-${String(end).padStart(2, '0')}:00`;
}

function dayLabel(createdAt: string): string | null {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_LABELS[d.getDay()] || null;
}

function itemRevenue(item: EcommerceRawOrder['lineItems'][number]): number {
  return item.rowTotal && item.rowTotal > 0
    ? item.rowTotal
    : (item.price || 0) * Math.max(1, item.quantity || 1);
}

function lifecycleForSegment(id: string): BehavioralProfile['lifecycle_stage'] {
  if (id === 'champions' || id === 'loyal') return 'loyal';
  if (id === 'new_customers' || id === 'recent_customers' || id === 'potential') return 'new';
  if (id === 'at_risk' || id === 'cant_lose_them' || id === 'customers_needing_attention') return 'declining';
  return 'dormant';
}

function frequencyLabel(annualOrdersPerCustomer: number): BehavioralProfile['purchase_frequency'] {
  if (annualOrdersPerCustomer >= 180) return 'daily';
  if (annualOrdersPerCustomer >= 26) return 'weekly';
  if (annualOrdersPerCustomer >= 8) return 'monthly';
  if (annualOrdersPerCustomer >= 2) return 'quarterly';
  return 'rare';
}

function bumpCatalogLine(
  map: Map<string, CatalogLineAgg>,
  key: string,
  revenue: number,
  quantity: number,
  orderId: string,
  sku: string,
  stockOnHand?: number,
  qtySold?: number,
  categoryPath?: string[]
): void {
  const k = key.trim();
  if (!k) return;
  const cur = map.get(k) ?? {
    revenue: 0,
    quantity: 0,
    orders: new Set<string>(),
    skus: new Set<string>(),
    stockOnHand: 0,
    qtySold: 0,
  };
  cur.revenue += revenue;
  cur.quantity += quantity;
  cur.orders.add(orderId);
  const skuKey = sku.trim();
  if (skuKey && !cur.skus.has(skuKey)) {
    cur.skus.add(skuKey);
    if (stockOnHand != null) cur.stockOnHand += stockOnHand;
    if (qtySold != null) cur.qtySold += qtySold;
    if (!cur.categoryPath?.length && categoryPath?.length) cur.categoryPath = categoryPath;
  }
  map.set(k, cur);
}

function catalogMapToAffinity(
  map: Map<string, CatalogLineAgg>,
  segmentRevenue: number,
  topN: number
): CategoryAffinity[] {
  const rows = [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, topN);
  if (rows.length === 0) return [];
  const maxR = rows[0]![1].revenue || 1;
  const seg = Math.max(segmentRevenue, 1e-6);
  return rows.map(([name, row]) => ({
    name,
    affinity: Math.round((row.revenue / maxR) * 100) / 100,
    avg_order: row.quantity > 0 ? Math.round(row.revenue / row.quantity) : Math.round(row.revenue),
    revenue_eur: Math.round(row.revenue * 100) / 100,
    revenue_share_pct: Math.round((row.revenue / seg) * 1000) / 10,
    ...(row.stockOnHand > 0 ? { stock_on_hand: Math.round(row.stockOnHand * 100) / 100 } : {}),
    ...(row.qtySold > 0 ? { qty_sold: Math.round(row.qtySold * 100) / 100 } : {}),
    ...(row.categoryPath?.length ? { category_path: row.categoryPath } : {}),
  }));
}

function buildCommunicationPreferences(channels: string[], peakHours: string[], lifecycle: BehavioralProfile['lifecycle_stage']) {
  const frequency =
    lifecycle === 'loyal' || lifecycle === 'active'
      ? 'Εβδομαδιαία'
      : lifecycle === 'new'
        ? '2 φορές/μήνα'
        : 'Μηνιαία';
  const bestTime = peakHours[0] || '10:00-12:00';
  return channels.map((channel) => ({ channel, frequency, best_time: bestTime }));
}

function buildBehavioralProfile(g: SegmentAgg, totalRevenue: number, globalAov: number): BehavioralProfile {
  const avgBasket = g.orders > 0 ? g.revenue / g.orders : 0;
  const daysWindow = Math.max(30, Math.ceil((new Date(g.lastOrder).getTime() - new Date(g.firstOrder).getTime()) / 86400000) + 1);
  const annualOrdersPerCustomer = g.count > 0 ? (g.orders / g.count) * (365 / daysWindow) : 0;
  const avgR = g.count > 0 ? g.sumR / g.count : 3;
  const avgF = g.count > 0 ? g.sumF / g.count : 3;
  const avgM = g.count > 0 ? g.sumM / g.count : 3;
  const lifecycle = lifecycleForSegment(g.id);
  const peakHours = topKeys(g.hourCounts, 2);
  const peakDays = topKeys(g.dayCounts, 2);
  const preferredChannels = SEGMENT_CHANNELS[g.id] || ['Email', 'Remarketing'];
  const revenueShare = totalRevenue > 0 ? g.revenue / totalRevenue : 0;
  const categoryRows = [...g.affinity.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6);
  const maxCategoryRevenue = categoryRows[0]?.[1].revenue || 1;
  const segmentRevenue = Math.max(g.revenue, 1e-6);
  const category_affinity = categoryRows.map(([name, row]) => ({
    name,
    affinity: Math.round((row.revenue / maxCategoryRevenue) * 100) / 100,
    avg_order: row.quantity > 0 ? Math.round(row.revenue / row.quantity) : Math.round(row.revenue),
    revenue_eur: Math.round(row.revenue * 100) / 100,
    revenue_share_pct: Math.round((row.revenue / segmentRevenue) * 1000) / 10,
  }));
  const diversity = Math.min(1, g.affinity.size / 6);
  const engagement = clamp(avgR * 13 + avgF * 8 + avgM * 4);
  const upsell = clamp(avgM * 16 + revenueShare * 45 + (avgBasket > globalAov ? 15 : 0));
  const crossSell = clamp(35 + diversity * 45 + avgF * 4);
  const priceSensitivity: BehavioralProfile['price_sensitivity'] =
    avgBasket >= globalAov * 1.25 || avgM >= 4 ? 'low' : avgBasket < globalAov * 0.75 || avgM <= 2 ? 'high' : 'medium';

  const catalogExtras: Partial<
    Pick<
      BehavioralProfile,
      | 'catalog_match'
      | 'brand_affinity'
      | 'category_affinity_catalog'
      | 'subcategory_affinity'
      | 'sku_affinity'
    >
  > = {};
  if (g.catalogLineCount > 0) {
    catalogExtras.catalog_match = {
      revenue_matched_pct:
        g.catalogLineRev > 0 ? Math.round((g.catalogMatchedRev / g.catalogLineRev) * 1000) / 10 : 0,
      lines_matched_pct:
        g.catalogLineCount > 0 ? Math.round((g.catalogMatchedLineCount / g.catalogLineCount) * 1000) / 10 : 0,
      lines_total: g.catalogLineCount,
      lines_matched: g.catalogMatchedLineCount,
    };
    catalogExtras.brand_affinity = catalogMapToAffinity(g.catalogBrand, g.revenue, 10);
    catalogExtras.category_affinity_catalog = catalogMapToAffinity(g.catalogCategory, g.revenue, 10);
    catalogExtras.subcategory_affinity = catalogMapToAffinity(g.catalogSubcategory, g.revenue, 10);
    catalogExtras.sku_affinity = catalogMapToAffinity(g.catalogSku, g.revenue, 10);
  }

  return {
    preferred_channels: preferredChannels,
    purchase_frequency: frequencyLabel(annualOrdersPerCustomer),
    avg_basket_size: Math.round(avgBasket),
    peak_hours: peakHours,
    peak_days: peakDays,
    payment_method: topKey(g.paymentCounts, '—'),
    device_preference: 'mixed',
    category_affinity,
    ...catalogExtras,
    upsell_score: Math.round(upsell),
    cross_sell_score: Math.round(crossSell),
    price_sensitivity: priceSensitivity,
    engagement_score: Math.round(engagement),
    persona:
      lifecycle === 'loyal'
        ? 'High-Value Buyer'
        : lifecycle === 'new'
          ? 'Emerging Buyer'
          : lifecycle === 'declining'
            ? 'Retention Candidate'
            : 'Dormant Buyer',
    lifecycle_stage: lifecycle,
    communication_preferences: buildCommunicationPreferences(preferredChannels, peakHours, lifecycle),
  };
}

function buildPredictiveMetrics(g: SegmentAgg, profile: BehavioralProfile): PredictiveMetrics {
  const avgBasket = Math.max(1, profile.avg_basket_size);
  const daysWindow = Math.max(30, Math.ceil((new Date(g.lastOrder).getTime() - new Date(g.firstOrder).getTime()) / 86400000) + 1);
  const annualOrdersPerCustomer = g.count > 0 ? (g.orders / g.count) * (365 / daysWindow) : 0;
  const daysToNext = Math.max(1, Math.round(365 / Math.max(1, annualOrdersPerCustomer)));
  const churnRisk = Math.round(clamp(100 - profile.engagement_score + (profile.lifecycle_stage === 'declining' ? 15 : 0)));
  const churnLabel: PredictiveMetrics['churn_risk_label'] =
    churnRisk < 20 ? 'low' : churnRisk < 50 ? 'medium' : churnRisk < 75 ? 'high' : 'critical';
  const retentionScore = Math.round(clamp(100 - churnRisk));
  const nextPurchaseProbability = Math.round(clamp((profile.engagement_score + (100 - Math.min(100, daysToNext)) * 0.4) / 1.4, 5, 99));
  const revenuePerDay = g.revenue / daysWindow;
  const demandTrend: PredictiveMetrics['demand_trend'] =
    profile.lifecycle_stage === 'loyal' || profile.lifecycle_stage === 'new'
      ? 'growing'
      : profile.lifecycle_stage === 'declining'
        ? 'declining'
        : 'stable';

  return {
    estimated_ltv: Math.round(avgBasket * Math.max(1, annualOrdersPerCustomer) * (retentionScore / 100 + 0.5)),
    ltv_confidence: Math.round(clamp(55 + Math.min(30, g.orders / Math.max(1, g.count)) * 5)),
    churn_risk: churnRisk,
    churn_risk_label: churnLabel,
    next_purchase_probability: nextPurchaseProbability,
    days_to_next_purchase: daysToNext,
    predicted_next_order_value: Math.round(avgBasket * (profile.upsell_score > 70 ? 1.1 : 1)),
    revenue_forecast_30d: Math.round(revenuePerDay * 30 * (retentionScore / 100)),
    revenue_forecast_90d: Math.round(revenuePerDay * 90 * (retentionScore / 100)),
    demand_trend: demandTrend,
    retention_score: retentionScore,
  };
}

function validOrderRevenue(o: EcommerceRawOrder): { revenue: number; valid: boolean } {
  const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
  return {
    revenue,
    valid: !isAllDemo && isEcommerceOrderRevenueIncluded(o) && revenue > 0,
  };
}

function aggregateCustomersUntil(orders: EcommerceRawOrder[], asOf: Date): CustomerAgg[] {
  const byKey = new Map<string, CustomerAgg>();
  const asOfMs = asOf.getTime();

  for (const o of orders) {
    const key = o.customerKey?.trim();
    if (!key) continue;
    const createdAtMs = new Date(o.createdAt || '').getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs > asOfMs) continue;
    const { revenue, valid } = validOrderRevenue(o);
    if (!valid) continue;

    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        key,
        ...(o.customerEmail ? { email: o.customerEmail } : {}),
        lastOrder: o.createdAt,
        firstOrder: o.createdAt,
        orderCount: 1,
        revenue,
        orders: [o],
      });
    } else {
      cur.orderCount += 1;
      cur.revenue += revenue;
      cur.orders.push(o);
      if (!cur.email && o.customerEmail) cur.email = o.customerEmail;
      if (o.createdAt > cur.lastOrder) cur.lastOrder = o.createdAt;
      if (o.createdAt < cur.firstOrder) cur.firstOrder = o.createdAt;
    }
  }

  return [...byKey.values()];
}

function buildCustomerSegmentAssignments(customers: CustomerAgg[], asOf: Date): Map<string, CustomerSegmentAssignment> {
  const assignments = new Map<string, CustomerSegmentAssignment>();
  if (customers.length === 0) return assignments;

  const recencyDays = customers.map((c) => {
    const last = new Date(c.lastOrder);
    const t = asOf.getTime() - last.getTime();
    return Math.max(0, Math.floor(t / (24 * 60 * 60 * 1000)));
  });
  const frequencies = customers.map((c) => c.orderCount);
  const monetaries = customers.map((c) => c.revenue);
  const rScores = assignQuintileScores(recencyDays, true);
  const fScores = assignQuintileScores(frequencies, false);
  const mScores = assignQuintileScores(monetaries, false);

  customers.forEach((customer, i) => {
    const segment = segmentFromRfmScores(rScores[i] ?? 3, fScores[i] ?? 3, mScores[i] ?? 3);
    assignments.set(customer.key, { id: segment.id, name: segment.name });
  });

  return assignments;
}

export function computeSegmentMigrationFromEcommerceOrders(
  orders: EcommerceRawOrder[],
  periodDays = 30
): SegmentMigrationResult {
  const validOrderDates = orders
    .filter((o) => o.customerKey?.trim())
    .filter((o) => validOrderRevenue(o).valid)
    .map((o) => new Date(o.createdAt || ''))
    .filter((d) => Number.isFinite(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  const currentAsOf = validOrderDates[0];
  if (!currentAsOf) {
    return { periodDays, comparedCustomers: 0, flows: [], canCompute: false };
  }

  currentAsOf.setHours(23, 59, 59, 999);
  const previousAsOf = new Date(currentAsOf);
  previousAsOf.setDate(previousAsOf.getDate() - periodDays);
  previousAsOf.setHours(23, 59, 59, 999);

  const previousAssignments = buildCustomerSegmentAssignments(
    aggregateCustomersUntil(orders, previousAsOf),
    previousAsOf
  );
  const currentAssignments = buildCustomerSegmentAssignments(
    aggregateCustomersUntil(orders, currentAsOf),
    currentAsOf
  );

  if (previousAssignments.size === 0 || currentAssignments.size === 0) {
    return { periodDays, comparedCustomers: 0, flows: [], canCompute: false };
  }

  const flows = new Map<string, SegmentMigrationFlow>();
  let comparedCustomers = 0;
  for (const [customerKey, prev] of previousAssignments.entries()) {
    const current = currentAssignments.get(customerKey);
    if (!current) continue;
    comparedCustomers += 1;
    if (prev.id === current.id) continue;
    const key = `${prev.id}->${current.id}`;
    const existing = flows.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      flows.set(key, {
        from: prev.id,
        fromName: prev.name,
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

/**
 * RFM + συγκέντρωση segments από raw e-commerce παραγγελίες.
 * Αγνοεί cancelled/excluded revenue & 100% demo, όπως το υπόλοιπο e-commerce.
 * Χρησιμοποιεί rolling 12μηνο ώστε historical backfills να μη φουσκώνουν κάθε φορά το ενεργό πελατολόγιο.
 */
export function computeRfmSegmentsFromEcommerceOrders(
  orders: EcommerceRawOrder[],
  catalog: RfmCatalogContext | null | undefined = undefined,
  options: { includeAnonymousGuests?: boolean } = {}
): RfmFromOrdersResult {
  const byKey = new Map<string, CustomerAgg>();
  let guestOrdersSkipped = 0;
  let ordersAttributed = 0;
  const latestOrderTime = orders.reduce((latest, o) => {
    const t = new Date(o.createdAt || '').getTime();
    return Number.isFinite(t) && t > latest ? t : latest;
  }, 0);
  const asOf = latestOrderTime ? new Date(latestOrderTime) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - RFM_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffMs = cutoff.getTime();

  for (const o of orders) {
    const createdAtMs = new Date(o.createdAt || '').getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoffMs || createdAtMs > asOf.getTime()) {
      continue;
    }
    const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
    if (isAllDemo) continue;
    if (!isEcommerceOrderRevenueIncluded(o)) continue;
    if (revenue <= 0) continue;

    const identifiedKey = o.customerKey?.trim();
    if (!identifiedKey && !options.includeAnonymousGuests) {
      guestOrdersSkipped += 1;
      continue;
    }

    const day = (o.createdAt || '').slice(0, 10);
    if (!day) continue;

    ordersAttributed += 1;
    const k = identifiedKey || `guest:${o.platform}:${o.orderId || o.orderName || `${day}:${ordersAttributed}`}`;
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, {
        key: k,
        ...(o.customerEmail ? { email: o.customerEmail } : {}),
        lastOrder: o.createdAt,
        firstOrder: o.createdAt,
        orderCount: 1,
        revenue,
        orders: [o],
      });
    } else {
      cur.orderCount += 1;
      cur.revenue += revenue;
      cur.orders.push(o);
      if (!cur.email && o.customerEmail) cur.email = o.customerEmail;
      if (o.createdAt > cur.lastOrder) cur.lastOrder = o.createdAt;
      if (o.createdAt < cur.firstOrder) cur.firstOrder = o.createdAt;
    }
  }

  const customers = Array.from(byKey.values());
  if (customers.length === 0) {
    return { segments: [], totalCustomers: 0, ordersAttributed, guestOrdersSkipped, canCompute: false };
  }

  const recencyDays = customers.map((c) => {
    const last = new Date(c.lastOrder);
    const t = asOf.getTime() - last.getTime();
    return Math.max(0, Math.floor(t / (24 * 60 * 60 * 1000)));
  });
  const frequencies = customers.map((c) => c.orderCount);
  const monetaries = customers.map((c) => c.revenue);

  const rScores = assignQuintileScores(recencyDays, true);
  const fScores = assignQuintileScores(frequencies, false);
  const mScores = assignQuintileScores(monetaries, false);

  const totalRevenue = monetaries.reduce((a, b) => a + b, 0);
  const n = customers.length;

  const bySegment = new Map<string, SegmentAgg>();

  for (let i = 0; i < n; i++) {
    const r = rScores[i] ?? 3;
    const f = fScores[i] ?? 3;
    const m = mScores[i] ?? 3;
    const { id, name } = segmentFromRfmScores(r, f, m);
    const g =
      bySegment.get(id) ??
      {
        id,
        name,
        count: 0,
        revenue: 0,
        orders: 0,
        sumR: 0,
        sumF: 0,
        sumM: 0,
        firstOrder: customers[i].firstOrder,
        lastOrder: customers[i].lastOrder,
        paymentCounts: new Map<string, number>(),
        dayCounts: new Map<string, number>(),
        hourCounts: new Map<string, number>(),
        affinity: new Map<string, { revenue: number; quantity: number; orders: Set<string> }>(),
        catalogBrand: new Map<string, CatalogLineAgg>(),
        catalogCategory: new Map<string, CatalogLineAgg>(),
        catalogSubcategory: new Map<string, CatalogLineAgg>(),
        catalogSku: new Map<string, CatalogLineAgg>(),
        catalogLineRev: 0,
        catalogMatchedRev: 0,
        catalogLineCount: 0,
        catalogMatchedLineCount: 0,
        customers: [],
      };
    g.count += 1;
    g.revenue += customers[i].revenue;
    g.orders += customers[i].orderCount;
    g.sumR += r;
    g.sumF += f;
    g.sumM += m;
    g.customers.push({
      customerId: customers[i].key,
      ...(customers[i].email ? { email: customers[i].email } : {}),
      recency: recencyDays[i] ?? 0,
      frequency: customers[i].orderCount,
      monetary: Math.round(customers[i].revenue * 100) / 100,
      rfmScore: `${r}-${f}-${m}`,
    });
    if (customers[i].firstOrder < g.firstOrder) g.firstOrder = customers[i].firstOrder;
    if (customers[i].lastOrder > g.lastOrder) g.lastOrder = customers[i].lastOrder;
    for (const order of customers[i].orders) {
      increment(g.paymentCounts, order.paymentMethod || '—');
      const day = dayLabel(order.createdAt);
      const hour = hourBucket(order.createdAt);
      if (day) increment(g.dayCounts, day);
      if (hour) increment(g.hourCounts, hour);
      for (const item of order.lineItems) {
        const lineRev = itemRevenue(item);
        const lineQty = Math.max(1, item.quantity || 1);
        const key = itemAffinityKey(item);
        const current = g.affinity.get(key) ?? { revenue: 0, quantity: 0, orders: new Set<string>() };
        current.revenue += lineRev;
        current.quantity += lineQty;
        current.orders.add(order.orderId);
        g.affinity.set(key, current);

        if (catalog) {
          g.catalogLineRev += lineRev;
          g.catalogLineCount += 1;
          const resolved = resolveCatalogLineForOrderLine(order.platform, item, catalog.indexes, catalog.erpBySku);
          if (resolved.match_source !== 'line_fallback') {
            g.catalogMatchedRev += lineRev;
            g.catalogMatchedLineCount += 1;
          }
          bumpCatalogLine(
            g.catalogBrand,
            resolved.brandLabel,
            lineRev,
            lineQty,
            order.orderId,
            resolved.skuLabel,
            resolved.stockOnHand,
            resolved.qtySold,
            resolved.categoryPath
          );
          bumpCatalogLine(
            g.catalogCategory,
            resolved.categoryLabel,
            lineRev,
            lineQty,
            order.orderId,
            resolved.skuLabel,
            resolved.stockOnHand,
            resolved.qtySold,
            resolved.categoryPath
          );
          if (
            resolved.subcategoryLabel.trim() &&
            resolved.subcategoryLabel.trim().toLowerCase() !== resolved.categoryLabel.trim().toLowerCase()
          ) {
            bumpCatalogLine(
              g.catalogSubcategory,
              resolved.subcategoryLabel,
              lineRev,
              lineQty,
              order.orderId,
              resolved.skuLabel,
              resolved.stockOnHand,
              resolved.qtySold,
              resolved.categoryPath
            );
          }
          bumpCatalogLine(
            g.catalogSku,
            resolved.skuLabel,
            lineRev,
            lineQty,
            order.orderId,
            resolved.skuLabel,
            resolved.stockOnHand,
            resolved.qtySold,
            resolved.categoryPath
          );
        }
      }
    }
    bySegment.set(id, g);
  }

  const globalAov = ordersAttributed > 0 ? totalRevenue / ordersAttributed : 0;
  const segments: RFMSegment[] = Array.from(bySegment.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((g) => {
      const ar = g.count > 0 ? Math.round((g.sumR / g.count) * 10) / 10 : 0;
      const af = g.count > 0 ? Math.round((g.sumF / g.count) * 10) / 10 : 0;
      const am = g.count > 0 ? Math.round((g.sumM / g.count) * 10) / 10 : 0;
      const rfmStr = `${ar}-${af}-${am}`;
      const behavioral = buildBehavioralProfile(g, totalRevenue, globalAov);
      const predictive = buildPredictiveMetrics(g, behavioral);
      return {
        id: g.id,
        name: g.name,
        rfm_score: rfmStr,
        count: g.count,
        percentage: n > 0 ? Math.round((g.count / n) * 1000) / 10 : 0,
        revenue_share: totalRevenue > 0 ? Math.round((g.revenue / totalRevenue) * 1000) / 10 : 0,
        color: '#6B7280',
        description: SEGMENT_DESCRIPTION[g.id] || 'Υπολογισμένο από παραγγελίες e-shop',
        icon: '',
        behavioral,
        predictive,
        customers: g.customers,
      };
    });

  return {
    segments,
    totalCustomers: n,
    ordersAttributed,
    guestOrdersSkipped,
    canCompute: true,
  };
}

export function computeRfmOrderScopeStats(orders: EcommerceRawOrder[]): RfmOrderScopeStats {
  const identified = new Set<string>();
  const all = new Set<string>();
  let guestOrders = 0;
  const latestOrderTime = orders.reduce((latest, o) => {
    const t = new Date(o.createdAt || '').getTime();
    return Number.isFinite(t) && t > latest ? t : latest;
  }, 0);
  const asOf = latestOrderTime ? new Date(latestOrderTime) : new Date();
  asOf.setHours(23, 59, 59, 999);
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - RFM_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffMs = cutoff.getTime();

  for (const o of orders) {
    const createdAtMs = new Date(o.createdAt || '').getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoffMs || createdAtMs > asOf.getTime()) continue;
    const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
    if (isAllDemo || revenue <= 0 || !isEcommerceOrderRevenueIncluded(o)) continue;

    const key = o.customerKey?.trim();
    if (key) {
      identified.add(key);
      all.add(key);
      continue;
    }

    guestOrders += 1;
    const day = (o.createdAt || '').slice(0, 10);
    all.add(`guest:${o.platform}:${o.orderId || o.orderName || `${day}:${guestOrders}`}`);
  }

  return {
    identifiedCustomers: identified.size,
    allBuyers: all.size,
    guestOrders,
    canComputeIdentified: identified.size > 0,
    canComputeAll: all.size > 0,
  };
}
