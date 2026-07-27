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

export interface MarginCostImpactRow {
  sku: string;
  productName: string;
  signal: 'margin_drop' | 'margin_gain' | 'cost_pressure';
  unitCost: number;
  marginPctBefore: number | null;
  marginPctAfter: number | null;
  marginPctChange: number | null;
  priceChangePct: number | null;
  before: SkuWindowMetrics;
  after: SkuWindowMetrics;
  revenueChangePct: number | null;
  marginChangePct: number | null;
  verdict: ScenarioVerdict;
  confidence: 'low' | 'medium' | 'high';
}

export interface MarginCostImpactSummary {
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

const MIN_MARGIN_PCT_SHIFT = 3;
const PRICE_STABLE_THRESHOLD = 2;

function scoreMarginVerdict(
  marginPctChange: number | null,
  revenueChangePct: number | null,
  marginChangePct: number | null
): ScenarioVerdict {
  if (marginPctChange == null) return 'neutral';
  if (marginPctChange >= MIN_MARGIN_PCT_SHIFT && (revenueChangePct == null || revenueChangePct >= -5)) return 'positive';
  if (marginPctChange <= -MIN_MARGIN_PCT_SHIFT && (revenueChangePct != null && revenueChangePct < 0)) return 'negative';
  if (marginChangePct != null && marginChangePct < -10) return 'negative';
  if (marginChangePct != null && marginChangePct > 10 && (revenueChangePct == null || revenueChangePct >= 0)) return 'positive';
  return 'neutral';
}

export function analyzeMarginCostImpact(input: {
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  lookbackDays?: number;
  costBySku: Map<string, number>;
  skuNames?: Map<string, string>;
}): { rows: MarginCostImpactRow[]; summary: MarginCostImpactSummary } {
  const skuNames = input.skuNames ?? new Map<string, string>();
  const { beforeBySku, afterBySku } = aggregateSkuWindows(input);
  const rows: MarginCostImpactRow[] = [];

  for (const [sku, beforeAgg] of beforeBySku) {
    const afterAgg = afterBySku.get(sku);
    if (!afterAgg) continue;

    const unitCost = input.costBySku.get(sku) ?? 0;
    const before = metricsFromAgg(beforeAgg, unitCost);
    const after = metricsFromAgg(afterAgg, unitCost);

    if (before.marginPct == null || after.marginPct == null) continue;

    const marginPctChange = Math.round((after.marginPct - before.marginPct) * 10) / 10;
    const priceChangePct = pctChange(after.avgPrice, before.avgPrice);

    const isCostPressure =
      priceChangePct != null &&
      Math.abs(priceChangePct) < PRICE_STABLE_THRESHOLD &&
      marginPctChange <= -MIN_MARGIN_PCT_SHIFT;

    if (Math.abs(marginPctChange) < MIN_MARGIN_PCT_SHIFT && !isCostPressure) continue;

    const revenueChangePct = pctChange(after.revenue, before.revenue);
    const marginChangePct = pctChange(after.margin, before.margin);
    const verdict = insufficientMetrics(before, after)
      ? 'insufficient'
      : scoreMarginVerdict(marginPctChange, revenueChangePct, marginChangePct);

    rows.push({
      sku,
      productName: skuNames.get(sku) || sku,
      signal: isCostPressure ? 'cost_pressure' : marginPctChange >= 0 ? 'margin_gain' : 'margin_drop',
      unitCost,
      marginPctBefore: before.marginPct,
      marginPctAfter: after.marginPct,
      marginPctChange,
      priceChangePct,
      before,
      after,
      revenueChangePct,
      marginChangePct,
      verdict,
      confidence: confidenceLevel(before.qty, after.qty, before.revenue, after.revenue),
    });
  }

  rows.sort((a, b) => Math.abs(b.marginPctChange ?? 0) - Math.abs(a.marginPctChange ?? 0));

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
