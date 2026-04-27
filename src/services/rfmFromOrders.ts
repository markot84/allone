import type { RFMSegment } from '../types';
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
  lastOrder: string;
  firstOrder: string;
  orderCount: number;
  revenue: number;
};

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
      byKey.set(k, { lastOrder: o.createdAt, firstOrder: o.createdAt, orderCount: 1, revenue });
    } else {
      cur.orderCount += 1;
      cur.revenue += revenue;
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

  const bySegment = new Map<
    string,
    { id: string; name: string; count: number; revenue: number; sumR: number; sumF: number; sumM: number }
  >();

  for (let i = 0; i < n; i++) {
    const r = rScores[i] ?? 3;
    const f = fScores[i] ?? 3;
    const m = mScores[i] ?? 3;
    const { id, name } = segmentFromRfmScores(r, f, m);
    const g =
      bySegment.get(id) ?? { id, name, count: 0, revenue: 0, sumR: 0, sumF: 0, sumM: 0 };
    g.count += 1;
    g.revenue += customers[i].revenue;
    g.sumR += r;
    g.sumF += f;
    g.sumM += m;
    bySegment.set(id, g);
  }

  const segments: RFMSegment[] = Array.from(bySegment.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((g) => {
      const ar = g.count > 0 ? Math.round((g.sumR / g.count) * 10) / 10 : 0;
      const af = g.count > 0 ? Math.round((g.sumF / g.count) * 10) / 10 : 0;
      const am = g.count > 0 ? Math.round((g.sumM / g.count) * 10) / 10 : 0;
      const rfmStr = `${ar}-${af}-${am}`;
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
