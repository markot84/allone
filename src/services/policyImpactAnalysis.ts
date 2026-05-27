import { sumDailyRevenueInPeriod } from '../utils/roiUtils';
import type { CommercialDecisionEvent, CommercialDecisionVerdict } from './commercialDecisionMemory';

export function getEventDateRange(event: CommercialDecisionEvent): { startDate: string; endDate: string } {
  const startDate = event.startDate || event.decisionDate;
  const endDate = event.endDate || startDate;
  return { startDate, endDate };
}

export function eventOverlapsPeriod(
  event: CommercialDecisionEvent,
  periodFrom: string,
  periodTo: string
): boolean {
  const { startDate, endDate } = getEventDateRange(event);
  return startDate <= periodTo && endDate >= periodFrom;
}

export function intersectEventWithPeriod(
  event: CommercialDecisionEvent,
  periodFrom: string,
  periodTo: string
): { startDate: string; endDate: string } | null {
  const { startDate, endDate } = getEventDateRange(event);
  const start = startDate > periodFrom ? startDate : periodFrom;
  const end = endDate < periodTo ? endDate : periodTo;
  if (start > end) return null;
  return { startDate: start, endDate: end };
}
import type { ProductSignal } from '../hooks/useProductSignals';

export type PolicyImpactResult = {
  periodRevenue: number;
  yoyRevenue: number;
  revenueChangePct: number | null;
  periodOrders: number;
  yoyOrders: number;
  ordersChangePct: number | null;
  campaignSpend: number;
  periodRoas: number | null;
  targetHits: { key: string; label: string; hit: boolean; actual: string }[];
};

export type CommercialDecisionImpactResult = PolicyImpactResult & {
  score: number;
  verdict: CommercialDecisionVerdict;
  confidence: 'low' | 'medium' | 'high';
  dataCoverage: {
    hasRevenue: boolean;
    hasOrders: boolean;
    hasSpend: boolean;
    productSignals: number;
    matchedSignals: number;
  };
  productVelocity30d: number;
  stockAtRiskCount: number;
  lowMarginCount: number;
  highlights: string[];
  risks: string[];
};

function shiftIsoDateByYears(ymd: string, years: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function sumOrdersInPeriod(
  ordersByDay: { date: string; orders: number }[],
  fromDate: string,
  toDate: string
): number {
  return ordersByDay
    .filter((r) => r.date >= fromDate && r.date <= toDate)
    .reduce((s, r) => s + (Number(r.orders) || 0), 0);
}

function pctChange(current: number, baseline: number): number | null {
  if (baseline <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - baseline) / baseline) * 1000) / 10;
}

export function analyzePolicyImpact(input: {
  startDate: string;
  endDate: string;
  revenueByDay: Record<string, number>;
  ordersByDay: { date: string; orders: number }[];
  campaignSpendInPeriod: number;
  targets?: {
    revenueUpliftPct?: number;
    minMarginPct?: number;
    maxDeadStockCount?: number;
    minRoas?: number;
  };
}): PolicyImpactResult {
  const { startDate, endDate, revenueByDay, ordersByDay, campaignSpendInPeriod, targets } = input;
  const yoyFrom = shiftIsoDateByYears(startDate, -1);
  const yoyTo = shiftIsoDateByYears(endDate, -1);

  const periodRevenue = sumDailyRevenueInPeriod(revenueByDay, startDate, endDate);
  const yoyRevenue = sumDailyRevenueInPeriod(revenueByDay, yoyFrom, yoyTo);
  const periodOrders = sumOrdersInPeriod(ordersByDay, startDate, endDate);
  const yoyOrders = sumOrdersInPeriod(ordersByDay, yoyFrom, yoyTo);
  const revenueChangePct = pctChange(periodRevenue, yoyRevenue);
  const ordersChangePct = pctChange(periodOrders, yoyOrders);
  const periodRoas = campaignSpendInPeriod > 0 ? periodRevenue / campaignSpendInPeriod : null;

  const targetHits: PolicyImpactResult['targetHits'] = [];
  if (targets?.revenueUpliftPct != null) {
    targetHits.push({
      key: 'revenueUpliftPct',
      label: `Αύξηση τζίρου ≥ ${targets.revenueUpliftPct}% (YoY)`,
      hit: revenueChangePct != null && revenueChangePct >= targets.revenueUpliftPct,
      actual: revenueChangePct != null ? `${revenueChangePct}%` : '—',
    });
  }
  if (targets?.minRoas != null) {
    targetHits.push({
      key: 'minRoas',
      label: `ROAS (store/spend) ≥ ${targets.minRoas}x`,
      hit: periodRoas != null && periodRoas >= targets.minRoas,
      actual: periodRoas != null ? `${periodRoas.toFixed(2)}x` : '—',
    });
  }

  return {
    periodRevenue,
    yoyRevenue,
    revenueChangePct,
    periodOrders,
    yoyOrders,
    ordersChangePct,
    campaignSpend: campaignSpendInPeriod,
    periodRoas,
    targetHits,
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToVerdict(score: number, event: CommercialDecisionEvent): CommercialDecisionVerdict {
  if (event.status === 'planned' || event.status === 'active') return 'learning';
  if (score >= 70) return 'winning';
  if (score < 45) return 'losing';
  return 'neutral';
}

function selectScopedSignals(
  event: CommercialDecisionEvent,
  signalsBySku?: Map<string, ProductSignal>
): ProductSignal[] {
  if (!signalsBySku || signalsBySku.size === 0) return [];
  const skus = new Set((event.scope?.skus ?? []).map((s) => s.toUpperCase()));
  if (skus.size === 0) return [];
  return [...signalsBySku.entries()]
    .filter(([sku]) => skus.has(sku.toUpperCase()))
    .map(([, signal]) => signal);
}

export function evaluateCommercialDecisionImpact(input: {
  event: CommercialDecisionEvent;
  revenueByDay: Record<string, number>;
  ordersByDay: { date: string; orders: number }[];
  campaignSpendInPeriod: number;
  signalsBySku?: Map<string, ProductSignal>;
  analysisPeriod?: { startDate: string; endDate: string };
  targets?: {
    revenueUpliftPct?: number;
    minRoas?: number;
  };
}): CommercialDecisionImpactResult {
  const { event, revenueByDay, ordersByDay, campaignSpendInPeriod, signalsBySku, targets, analysisPeriod } = input;
  const base = event.performance
    ? {
        periodRevenue: event.performance.periodRevenue,
        yoyRevenue: event.performance.baselineRevenue,
        revenueChangePct: event.performance.revenueChangePct,
        periodOrders: event.performance.periodOrders,
        yoyOrders: event.performance.baselineOrders,
        ordersChangePct: event.performance.ordersChangePct,
        campaignSpend: event.performance.campaignSpend ?? 0,
        periodRoas: event.performance.periodRoas ?? null,
        targetHits: [],
      }
    : analyzePolicyImpact({
        startDate: analysisPeriod?.startDate ?? event.startDate ?? event.decisionDate,
        endDate: analysisPeriod?.endDate ?? event.endDate ?? event.startDate ?? event.decisionDate,
        revenueByDay,
        ordersByDay,
        campaignSpendInPeriod,
        targets,
      });

  const scopedSignals = selectScopedSignals(event, signalsBySku);
  const productVelocity30d = scopedSignals.reduce((sum, signal) => sum + (signal.resolved.qty30d ?? 0), 0);
  const stockAtRiskCount = scopedSignals.filter(
    (signal) => typeof signal.resolved.days_of_cover === 'number' && signal.resolved.days_of_cover <= 14
  ).length;
  const lowMarginCount = scopedSignals.filter(
    (signal) => typeof signal.resolved.margin_pct === 'number' && signal.resolved.margin_pct < 15
  ).length;

  let score = 50;
  if (base.revenueChangePct != null) score += Math.max(-25, Math.min(25, base.revenueChangePct / 2));
  if (base.ordersChangePct != null) score += Math.max(-15, Math.min(15, base.ordersChangePct / 3));
  if (base.periodRoas != null) score += base.periodRoas >= (targets?.minRoas ?? 3) ? 10 : -10;
  if (productVelocity30d > 0) score += Math.min(10, productVelocity30d / 10);
  if (stockAtRiskCount > 0 && (event.eventType === 'campaign' || event.eventType === 'discount')) score -= 8;
  if (lowMarginCount > 0 && (event.eventType === 'pricing' || event.eventType === 'discount')) score -= 6;
  const normalizedScore = clampScore(score);

  const hasRevenue = base.periodRevenue > 0 || base.yoyRevenue > 0;
  const hasOrders = base.periodOrders > 0 || base.yoyOrders > 0;
  const hasSpend = campaignSpendInPeriod > 0;
  const signalCoverage = scopedSignals.length > 0 ? 1 : 0;
  const coveragePoints = [hasRevenue, hasOrders, hasSpend || event.eventType !== 'campaign', signalCoverage > 0 || !event.scope?.skus?.length].filter(Boolean).length;
  const confidence = coveragePoints >= 4 ? 'high' : coveragePoints >= 2 ? 'medium' : 'low';

  const highlights: string[] = [];
  const risks: string[] = [];
  const isSkuPerformance = !!event.performance;
  if (base.revenueChangePct != null) {
    (base.revenueChangePct >= 0 ? highlights : risks).push(
      `${isSkuPerformance ? 'Τζίρος SKU vs προηγ. περίοδος' : 'Τζίρος YoY'} ${base.revenueChangePct >= 0 ? '+' : ''}${base.revenueChangePct}%`
    );
  }
  if (base.periodRoas != null) {
    (base.periodRoas >= (targets?.minRoas ?? 3) ? highlights : risks).push(`Store ROAS ${base.periodRoas.toFixed(2)}x`);
  }
  if (productVelocity30d > 0) highlights.push(`${Math.round(productVelocity30d)} τεμάχια πωλήθηκαν στα σχετικά SKUs (30ημ.)`);
  if (stockAtRiskCount > 0) risks.push(`${stockAtRiskCount} σχετικά SKU κοντά σε stockout`);
  if (!hasRevenue) risks.push('Δεν υπάρχει κάλυψη store revenue για αυτή την περίοδο');

  return {
    ...base,
    score: normalizedScore,
    verdict: scoreToVerdict(normalizedScore, event),
    confidence,
    dataCoverage: {
      hasRevenue,
      hasOrders,
      hasSpend,
      productSignals: signalsBySku?.size ?? 0,
      matchedSignals: scopedSignals.length,
    },
    productVelocity30d,
    stockAtRiskCount,
    lowMarginCount,
    highlights,
    risks,
  };
}
