import { sumDailyRevenueInPeriod } from '../utils/roiUtils';

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
