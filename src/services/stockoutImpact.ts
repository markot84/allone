import {
  aggregateSkuWindows,
  confidenceLevel,
  insufficientMetrics,
  metricsFromAgg,
  pctChange,
  type ScenarioVerdict,
  type SkuWindowMetrics,
} from './commercialScenarioMetrics';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

export interface StockoutSkuContext {
  daysOfCover?: number;
  availableStock?: number;
  replenishmentQty?: number;
}

export interface StockoutImpactRow {
  sku: string;
  productName: string;
  daysOfCover: number | null;
  availableStock: number | null;
  before: SkuWindowMetrics;
  after: SkuWindowMetrics;
  revenueChangePct: number | null;
  marginChangePct: number | null;
  qtyChangePct: number | null;
  verdict: ScenarioVerdict;
  confidence: 'low' | 'medium' | 'high';
}

export interface StockoutImpactSummary {
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

const MAX_DAYS_OF_COVER = 14;

function scoreStockoutVerdict(revenueChangePct: number | null, qtyChangePct: number | null): ScenarioVerdict {
  if (revenueChangePct != null && revenueChangePct <= -15) return 'negative';
  if (qtyChangePct != null && qtyChangePct <= -20) return 'negative';
  if (revenueChangePct != null && revenueChangePct >= 5) return 'positive';
  return 'neutral';
}

export function analyzeStockoutImpact(input: {
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  lookbackDays?: number;
  costBySku: Map<string, number>;
  stockBySku: Map<string, StockoutSkuContext>;
  skuNames?: Map<string, string>;
}): { rows: StockoutImpactRow[]; summary: StockoutImpactSummary } {
  const skuNames = input.skuNames ?? new Map<string, string>();
  const { beforeBySku, afterBySku } = aggregateSkuWindows(input);
  const rows: StockoutImpactRow[] = [];

  for (const [sku, ctx] of input.stockBySku) {
    const lowCover = typeof ctx.daysOfCover === 'number' && ctx.daysOfCover <= MAX_DAYS_OF_COVER;
    const noStock = typeof ctx.availableStock === 'number' && ctx.availableStock <= 0;
    if (!lowCover && !noStock) continue;

    const beforeAgg = beforeBySku.get(sku);
    const afterAgg = afterBySku.get(sku);
    if (!beforeAgg && !afterAgg) continue;

    const unitCost = input.costBySku.get(sku) ?? 0;
    const before = metricsFromAgg(beforeAgg ?? { qty: 0, revenue: 0, cost: 0, priceWeightedSum: 0, priceQty: 0 }, unitCost);
    const after = metricsFromAgg(afterAgg ?? { qty: 0, revenue: 0, cost: 0, priceWeightedSum: 0, priceQty: 0 }, unitCost);

    const revenueChangePct = pctChange(after.revenue, before.revenue);
    const marginChangePct = pctChange(after.margin, before.margin);
    const qtyChangePct = pctChange(after.qty, before.qty);
    const verdict = insufficientMetrics(before, after)
      ? 'insufficient'
      : scoreStockoutVerdict(revenueChangePct, qtyChangePct);

    rows.push({
      sku,
      productName: skuNames.get(sku) || sku,
      daysOfCover: ctx.daysOfCover ?? null,
      availableStock: ctx.availableStock ?? null,
      before,
      after,
      revenueChangePct,
      marginChangePct,
      qtyChangePct,
      verdict,
      confidence: confidenceLevel(before.qty, after.qty, before.revenue, after.revenue),
    });
  }

  rows.sort((a, b) => (a.revenueChangePct ?? 0) - (b.revenueChangePct ?? 0));

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

export function buildStockContextFromProcurementSignals(
  signals: Record<string, { days_of_cover?: number; available_stock?: number; replenishment_qty?: number }>
): Map<string, StockoutSkuContext> {
  const map = new Map<string, StockoutSkuContext>();
  for (const [sku, signal] of Object.entries(signals)) {
    map.set(sku.toUpperCase(), {
      daysOfCover: signal.days_of_cover,
      availableStock: signal.available_stock,
      replenishmentQty: signal.replenishment_qty,
    });
  }
  return map;
}
