import type { BehavioralProfile, PredictiveMetrics, RFMSegment } from '../types';
import { getEcommerceOrderNetRevenue, isEcommerceOrderCancelled, type EcommerceRawOrder } from './ecommerceRawOrders';

export type RfmFromOrdersResult = {
  segments: RFMSegment[];
  totalCustomers: number;
  /** Παραγγελίες με σταθερό customer key (αποκλ. guests). */
  ordersAttributed: number;
  /** Παραγγελίες χωρίς key (συνήθως guest). */
  guestOrdersSkipped: number;
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
  customers: NonNullable<RFMSegment['customers']>;
};

const DAY_LABELS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

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

function itemAffinityKey(item: EcommerceRawOrder['lineItems'][number]): string {
  const productType = item.productType?.trim();
  if (productType && productType.toLowerCase() !== 'simple') return productType;
  return item.name?.trim() || item.title?.trim() || item.sku?.trim() || item.productId?.trim() || 'Άλλο';
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
  const category_affinity = categoryRows.map(([name, row]) => ({
    name,
    affinity: Math.round((row.revenue / maxCategoryRevenue) * 100) / 100,
    avg_order: row.quantity > 0 ? Math.round(row.revenue / row.quantity) : Math.round(row.revenue),
  }));
  const diversity = Math.min(1, g.affinity.size / 6);
  const engagement = clamp(avgR * 13 + avgF * 8 + avgM * 4);
  const upsell = clamp(avgM * 16 + revenueShare * 45 + (avgBasket > globalAov ? 15 : 0));
  const crossSell = clamp(35 + diversity * 45 + avgF * 4);
  const priceSensitivity: BehavioralProfile['price_sensitivity'] =
    avgBasket >= globalAov * 1.25 || avgM >= 4 ? 'low' : avgBasket < globalAov * 0.75 || avgM <= 2 ? 'high' : 'medium';

  return {
    preferred_channels: preferredChannels,
    purchase_frequency: frequencyLabel(annualOrdersPerCustomer),
    avg_basket_size: Math.round(avgBasket),
    peak_hours: peakHours,
    peak_days: peakDays,
    payment_method: topKey(g.paymentCounts, '—'),
    device_preference: 'mixed',
    category_affinity,
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

/**
 * RFM + συγκέντρωση segments από raw e-commerce παραγγελίες (εσωτερικό customer id ανά platform).
 * Αγνοεί cancelled & 100% demo, όπως το υπόλοιπο e-commerce.
 */
export function computeRfmSegmentsFromEcommerceOrders(orders: EcommerceRawOrder[]): RfmFromOrdersResult {
  const byKey = new Map<string, CustomerAgg>();
  let guestOrdersSkipped = 0;
  let ordersAttributed = 0;
  const asOf = new Date();
  asOf.setHours(23, 59, 59, 999);

  for (const o of orders) {
    if (!o.customerKey?.trim()) {
      if (!isEcommerceOrderCancelled(o.status) && getEcommerceOrderNetRevenue(o).revenue > 0) {
        guestOrdersSkipped += 1;
      }
      continue;
    }
    const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(o);
    if (isAllDemo) continue;
    if (isEcommerceOrderCancelled(o.status)) continue;
    if (revenue <= 0) continue;

    const day = (o.createdAt || '').slice(0, 10);
    if (!day) continue;

    ordersAttributed += 1;
    const k = o.customerKey.trim();
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
        const key = itemAffinityKey(item);
        const current = g.affinity.get(key) ?? { revenue: 0, quantity: 0, orders: new Set<string>() };
        current.revenue += itemRevenue(item);
        current.quantity += Math.max(1, item.quantity || 1);
        current.orders.add(order.orderId);
        g.affinity.set(key, current);
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
