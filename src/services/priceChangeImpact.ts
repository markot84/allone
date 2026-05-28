import {
  aggregateSkuWindows,
  confidenceLevel,
  metricsFromAgg,
  pctChange,
  type ScenarioVerdict,
  type SkuWindowMetrics,
} from './commercialScenarioMetrics';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

export type PriceChangeVerdict = ScenarioVerdict;

export interface PriceChangeImpactRow {
  sku: string;
  productName: string;
  changeDate: string;
  priceBefore: number;
  priceAfter: number;
  changePct: number;
  direction: 'increase' | 'decrease';
  before: SkuWindowMetrics;
  after: SkuWindowMetrics;
  revenueChangePct: number | null;
  marginChangePct: number | null;
  qtyChangePct: number | null;
  verdict: PriceChangeVerdict;
  confidence: 'low' | 'medium' | 'high';
}

export interface PriceChangeImpactSummary {
  detected: number;
  positive: number;
  negative: number;
  neutral: number;
  insufficient: number;
  totalRevenueBefore: number;
  totalRevenueAfter: number;
  totalMarginBefore: number;
  totalMarginAfter: number;
  lookbackDays: number;
}

const MIN_CHANGE_PCT = 1;
const MIN_SKU_REVENUE = 30;

function scoreVerdict(
  changePct: number,
  revenueBefore: number,
  revenueAfter: number,
  marginBefore: number,
  marginAfter: number,
  qtyBefore: number,
  qtyAfter: number
): PriceChangeVerdict {
  if (qtyBefore < 2 || qtyAfter < 2) return 'insufficient';

  const revUp = revenueAfter > revenueBefore;
  const revDown = revenueAfter < revenueBefore;
  const qtyUp = qtyAfter > qtyBefore;
  const qtyDown = qtyAfter < qtyBefore;
  const marginUp = marginAfter > marginBefore;

  if (changePct > 0) {
    if (revUp && marginUp && !qtyDown) return 'positive';
    if (revDown || qtyDown || marginAfter < marginBefore * 0.9) return 'negative';
    return 'neutral';
  }
  if (changePct < 0) {
    if (revUp && qtyUp && marginUp) return 'positive';
    if (revDown && qtyDown) return 'negative';
    return 'neutral';
  }
  return 'neutral';
}

export function analyzePriceChangeImpact(input: {
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  lookbackDays?: number;
  costBySku: Map<string, number>;
  skuNames?: Map<string, string>;
}): { rows: PriceChangeImpactRow[]; summary: PriceChangeImpactSummary } {
  const skuNames = input.skuNames ?? new Map<string, string>();
  const { beforeBySku, afterBySku } = aggregateSkuWindows(input);
  const rows: PriceChangeImpactRow[] = [];

  for (const [sku, beforeAgg] of beforeBySku) {
    const afterAgg = afterBySku.get(sku);
    if (!afterAgg) continue;

    const unitCost = input.costBySku.get(sku) ?? 0;
    const before = metricsFromAgg(beforeAgg, unitCost);
    const after = metricsFromAgg(afterAgg, unitCost);
    if (before.avgPrice <= 0 || after.avgPrice <= 0) continue;

    const changePct = pctChange(after.avgPrice, before.avgPrice);
    if (changePct == null || Math.abs(changePct) < MIN_CHANGE_PCT) continue;

    // Skip micro-revenue SKUs (noise filter)
    if (Math.max(before.revenue, after.revenue) < MIN_SKU_REVENUE) continue;

    rows.push({
      sku,
      productName: skuNames.get(sku) || sku,
      changeDate: input.periodFrom,
      priceBefore: before.avgPrice,
      priceAfter: after.avgPrice,
      changePct,
      direction: changePct > 0 ? 'increase' : 'decrease',
      before,
      after,
      revenueChangePct: pctChange(after.revenue, before.revenue),
      marginChangePct: pctChange(after.margin, before.margin),
      qtyChangePct: pctChange(after.qty, before.qty),
      verdict: scoreVerdict(changePct, before.revenue, after.revenue, before.margin, after.margin, before.qty, after.qty),
      confidence: confidenceLevel(before.qty, after.qty, before.revenue, after.revenue),
    });
  }

  rows.sort((a, b) => Math.abs(b.after.revenue - b.before.revenue) - Math.abs(a.after.revenue - a.before.revenue));

  return {
    rows,
    summary: {
      detected: rows.length,
      positive: rows.filter((r) => r.verdict === 'positive').length,
      negative: rows.filter((r) => r.verdict === 'negative').length,
      neutral: rows.filter((r) => r.verdict === 'neutral').length,
      insufficient: rows.filter((r) => r.verdict === 'insufficient').length,
      totalRevenueBefore: rows.reduce((s, r) => s + r.before.revenue, 0),
      totalRevenueAfter: rows.reduce((s, r) => s + r.after.revenue, 0),
      totalMarginBefore: rows.reduce((s, r) => s + r.before.margin, 0),
      totalMarginAfter: rows.reduce((s, r) => s + r.after.margin, 0),
      lookbackDays: input.lookbackDays ?? 30,
    },
  };
}

export { buildSkuNameMapFromPricingRows } from './commercialScenarioMetrics';
