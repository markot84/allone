import type { EcommerceRawOrder } from './ecommerceRawOrders';

export type ScenarioVerdict = 'positive' | 'negative' | 'neutral' | 'insufficient';

export const DEFAULT_LOOKBACK_DAYS = 30;
export const MIN_QTY_WINDOW = 2;
export const MIN_REVENUE_WINDOW = 1;

export interface SkuWindowAgg {
  qty: number;
  revenue: number;
  cost: number;
  priceWeightedSum: number;
  priceQty: number;
}

export interface SkuWindowMetrics {
  qty: number;
  revenue: number;
  margin: number;
  marginPct: number | null;
  avgPrice: number;
  unitCost: number;
}

export function shiftIsoDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function pctChange(current: number, baseline: number): number | null {
  if (baseline <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - baseline) / baseline) * 1000) / 10;
}

function parseNum(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function buildUnitCostBySku(pricingRows: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of pricingRows) {
    const row = raw as Record<string, unknown>;
    const sku = String(row['ΚΩΔΙΚΟΣ'] ?? row['Κωδικός'] ?? row.sku ?? '').trim().toUpperCase();
    if (!sku) continue;
    const totalCost = parseNum(row['ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ'] ?? row['ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ']);
    const primary = parseNum(row['ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ'] ?? row['ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ'] ?? row['ΚΟΣΤΟΣ_ΑΓΟΡΑΣ']);
    const purchase = parseNum(row['ΚΟΣΤΟΣ ΑΓΟΡΑΣ'] ?? row['ΚΟΣΤΟΣ_ΑΓΟΡΑΣ']);
    const unit = totalCost > 0 ? totalCost : primary > 0 ? primary : purchase;
    if (unit > 0) map.set(sku, unit);
  }
  return map;
}

export function buildSkuNameMapFromPricingRows(rows: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const sku = String(row['ΚΩΔΙΚΟΣ'] ?? row['Κωδικός'] ?? row.sku ?? '').trim().toUpperCase();
    if (!sku) continue;
    const name = String(row['ΠΕΡΙΓΡΑΦΗ'] ?? row['Περιγραφή'] ?? row.name ?? '').trim();
    map.set(sku, name || sku);
  }
  return map;
}

function emptyAgg(): SkuWindowAgg {
  return { qty: 0, revenue: 0, cost: 0, priceWeightedSum: 0, priceQty: 0 };
}

function addLine(agg: SkuWindowAgg, price: number, qty: number, unitCost: number): SkuWindowAgg {
  const q = Math.max(0, qty);
  const unit = Math.max(0, price);
  if (q <= 0 || unit <= 0) return agg;
  const rev = unit * q;
  const cost = Math.max(0, unitCost) * q;
  return {
    qty: agg.qty + q,
    revenue: agg.revenue + rev,
    cost: agg.cost + cost,
    priceWeightedSum: agg.priceWeightedSum + unit * q,
    priceQty: agg.priceQty + q,
  };
}

export function metricsFromAgg(agg: SkuWindowAgg, unitCost: number): SkuWindowMetrics {
  const margin = agg.revenue - agg.cost;
  return {
    qty: Math.round(agg.qty),
    revenue: Math.round(agg.revenue * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    marginPct: agg.revenue > 0 ? Math.round((margin / agg.revenue) * 1000) / 10 : null,
    avgPrice: agg.priceQty > 0 ? Math.round((agg.priceWeightedSum / agg.priceQty) * 100) / 100 : 0,
    unitCost,
  };
}

export function aggregateSkuWindows(input: {
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  lookbackDays?: number;
  costBySku: Map<string, number>;
}): { beforeBySku: Map<string, SkuWindowAgg>; afterBySku: Map<string, SkuWindowAgg> } {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const baselineFrom = shiftIsoDate(input.periodFrom, -lookbackDays);
  const baselineTo = shiftIsoDate(input.periodFrom, -1);
  const beforeBySku = new Map<string, SkuWindowAgg>();
  const afterBySku = new Map<string, SkuWindowAgg>();

  for (const order of input.orders) {
    const day = (order.createdAt || '').slice(0, 10);
    if (!day || day < baselineFrom || day > input.periodTo) continue;
    const inBefore = day >= baselineFrom && day <= baselineTo;
    const inAfter = day >= input.periodFrom && day <= input.periodTo;
    if (!inBefore && !inAfter) continue;

    for (const line of order.lineItems) {
      const sku = String(line.sku || '').trim().toUpperCase();
      if (!sku) continue;
      const price = Number(line.price) || 0;
      const qty = Number(line.quantity) || 0;
      if (price <= 0 || qty <= 0) continue;
      const unitCost = input.costBySku.get(sku) ?? 0;

      if (inBefore) {
        const agg = beforeBySku.get(sku) ?? emptyAgg();
        beforeBySku.set(sku, addLine(agg, price, qty, unitCost));
      }
      if (inAfter) {
        const agg = afterBySku.get(sku) ?? emptyAgg();
        afterBySku.set(sku, addLine(agg, price, qty, unitCost));
      }
    }
  }

  return { beforeBySku, afterBySku };
}

/**
 * Async/chunked εκδοχή του aggregateSkuWindows: επεξεργάζεται τις παραγγελίες σε batches και
 * παραχωρεί τον έλεγχο στο main thread (yieldFn) ανάμεσα στα chunks, ώστε σε high-volume brands
 * ο υπολογισμός να μην «παγώνει» το UI («page not responding»).
 */
export async function aggregateSkuWindowsChunked(
  input: {
    orders: EcommerceRawOrder[];
    periodFrom: string;
    periodTo: string;
    lookbackDays?: number;
    costBySku: Map<string, number>;
  },
  opts?: { chunkSize?: number; yieldFn?: () => Promise<void> }
): Promise<{ beforeBySku: Map<string, SkuWindowAgg>; afterBySku: Map<string, SkuWindowAgg> }> {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const baselineFrom = shiftIsoDate(input.periodFrom, -lookbackDays);
  const baselineTo = shiftIsoDate(input.periodFrom, -1);
  const beforeBySku = new Map<string, SkuWindowAgg>();
  const afterBySku = new Map<string, SkuWindowAgg>();

  const chunkSize = Math.max(500, opts?.chunkSize ?? 3000);
  const yieldFn = opts?.yieldFn;
  const orders = input.orders;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const day = (order.createdAt || '').slice(0, 10);
    if (day && day >= baselineFrom && day <= input.periodTo) {
      const inBefore = day >= baselineFrom && day <= baselineTo;
      const inAfter = day >= input.periodFrom && day <= input.periodTo;
      if (inBefore || inAfter) {
        for (const line of order.lineItems) {
          const sku = String(line.sku || '').trim().toUpperCase();
          if (!sku) continue;
          const price = Number(line.price) || 0;
          const qty = Number(line.quantity) || 0;
          if (price <= 0 || qty <= 0) continue;
          const unitCost = input.costBySku.get(sku) ?? 0;
          if (inBefore) beforeBySku.set(sku, addLine(beforeBySku.get(sku) ?? emptyAgg(), price, qty, unitCost));
          if (inAfter) afterBySku.set(sku, addLine(afterBySku.get(sku) ?? emptyAgg(), price, qty, unitCost));
        }
      }
    }
    if (yieldFn && (i + 1) % chunkSize === 0) await yieldFn();
  }

  return { beforeBySku, afterBySku };
}

export function confidenceLevel(qtyBefore: number, qtyAfter: number, revenueBefore: number, revenueAfter: number): 'low' | 'medium' | 'high' {
  const score =
    (qtyBefore >= 10 ? 2 : qtyBefore >= MIN_QTY_WINDOW ? 1 : 0) +
    (qtyAfter >= 10 ? 2 : qtyAfter >= MIN_QTY_WINDOW ? 1 : 0) +
    (revenueBefore >= 50 ? 1 : 0) +
    (revenueAfter >= 50 ? 1 : 0);
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export function insufficientMetrics(before: SkuWindowMetrics, after: SkuWindowMetrics): boolean {
  return (
    before.qty < MIN_QTY_WINDOW ||
    after.qty < MIN_QTY_WINDOW ||
    (before.revenue < MIN_REVENUE_WINDOW && after.revenue < MIN_REVENUE_WINDOW)
  );
}
