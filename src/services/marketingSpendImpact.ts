import { pctChange, shiftIsoDate, type ScenarioVerdict } from './commercialScenarioMetrics';
import { calculateCampaignMetrics } from '../utils/roiUtils';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../utils/campaignDateRangeMetrics';
import type { Campaign } from '../types';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

export interface MarketingSpendImpactRow {
  id: string;
  title: string;
  channel: string;
  spend: number;
  revenue: number;
  margin: number;
  marginPct: number | null;
  roas: number | null;
  spendVsLookbackPct: number | null;
  revenueChangePct: number | null;
  marginChangePct: number | null;
  verdict: ScenarioVerdict;
}

export interface MarketingSpendImpactSummary {
  detected: number;
  positive: number;
  negative: number;
  neutral: number;
  insufficient: number;
  totalSpend: number;
  totalRevenue: number;
  totalMargin: number;
  blendedRoas: number | null;
  lookbackDays: number;
}

const MIN_SPEND = 25;
const TARGET_ROAS = 3;

function scoreMarketingVerdict(roas: number | null, marginChangePct: number | null, revenueChangePct: number | null): ScenarioVerdict {
  if (roas != null && roas >= TARGET_ROAS && (marginChangePct == null || marginChangePct >= -5)) return 'positive';
  if (roas != null && roas < 1.5) return 'negative';
  if (revenueChangePct != null && revenueChangePct < -10 && (roas == null || roas < TARGET_ROAS)) return 'negative';
  if (roas != null && roas >= 2) return 'neutral';
  return 'insufficient';
}

function storeTotalsForRange(
  orders: EcommerceRawOrder[],
  from: string,
  to: string,
  costBySku: Map<string, number>
): { revenue: number; margin: number; marginPct: number | null } {
  let revenue = 0;
  let cost = 0;
  for (const order of orders) {
    const day = (order.createdAt || '').slice(0, 10);
    if (!day || day < from || day > to) continue;
    for (const line of order.lineItems) {
      const sku = String(line.sku || '').trim().toUpperCase();
      const price = Number(line.price) || 0;
      const qty = Number(line.quantity) || 0;
      if (price <= 0 || qty <= 0) continue;
      revenue += price * qty;
      cost += (costBySku.get(sku) ?? 0) * qty;
    }
  }
  const margin = revenue - cost;
  return {
    revenue: Math.round(revenue * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    marginPct: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null,
  };
}

export function analyzeMarketingSpendImpact(input: {
  campaigns: Campaign[];
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  lookbackDays?: number;
  costBySku: Map<string, number>;
  minRoas?: number;
}): { rows: MarketingSpendImpactRow[]; summary: MarketingSpendImpactSummary } {
  const lookbackDays = input.lookbackDays ?? 30;
  const lookbackFrom = shiftIsoDate(input.periodFrom, -lookbackDays);
  const lookbackTo = shiftIsoDate(input.periodFrom, -1);
  const targetRoas = input.minRoas ?? TARGET_ROAS;

  const periodCampaigns = filterCampaignsByScheduleDateOverlap(input.campaigns, input.periodFrom, input.periodTo);
  const lookbackCampaigns = filterCampaignsByScheduleDateOverlap(input.campaigns, lookbackFrom, lookbackTo);

  const periodStore = storeTotalsForRange(input.orders, input.periodFrom, input.periodTo, input.costBySku);
  const lookbackStore = storeTotalsForRange(input.orders, lookbackFrom, lookbackTo, input.costBySku);

  const rows: MarketingSpendImpactRow[] = [];

  for (const campaign of periodCampaigns) {
    const start = campaign.start_date || input.periodFrom;
    const end = campaign.end_date || input.periodTo;
    const windowFrom = start > input.periodFrom ? start : input.periodFrom;
    const windowTo = end < input.periodTo ? end : input.periodTo;

    const scoped = applyCampaignDateRangeToMetrics([campaign], windowFrom, windowTo);
    const metrics = calculateCampaignMetrics(scoped);
    const spend = metrics.totalSpend;
    if (spend < MIN_SPEND) continue;

    const storeWindow = storeTotalsForRange(input.orders, windowFrom, windowTo, input.costBySku);
    const revenue = storeWindow.revenue;
    const margin = storeWindow.margin;
    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null;

    const lookbackMatch = lookbackCampaigns.find((c) => c.id === campaign.id || c.name === campaign.name);
    let spendVsLookbackPct: number | null = null;
    if (lookbackMatch) {
      const lbScoped = applyCampaignDateRangeToMetrics([lookbackMatch], lookbackFrom, lookbackTo);
      const lbSpend = calculateCampaignMetrics(lbScoped).totalSpend;
      spendVsLookbackPct = pctChange(spend, lbSpend);
    }

    const revenueChangePct = pctChange(periodStore.revenue, lookbackStore.revenue);
    const marginChangePct = pctChange(periodStore.margin, lookbackStore.margin);

    const verdict =
      roas != null && roas >= targetRoas && (marginChangePct == null || marginChangePct >= -8)
        ? 'positive'
        : scoreMarketingVerdict(roas, marginChangePct, revenueChangePct);

    rows.push({
      id: campaign.id || campaign.name,
      title: campaign.name,
      channel: campaign.channel,
      spend: Math.round(spend * 100) / 100,
      revenue,
      margin,
      marginPct: storeWindow.marginPct,
      roas,
      spendVsLookbackPct,
      revenueChangePct,
      marginChangePct,
      verdict,
    });
  }

  rows.sort((a, b) => b.spend - a.spend);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);

  return {
    rows,
    summary: {
      detected: rows.length,
      positive: rows.filter((r) => r.verdict === 'positive').length,
      negative: rows.filter((r) => r.verdict === 'negative').length,
      neutral: rows.filter((r) => r.verdict === 'neutral').length,
      insufficient: rows.filter((r) => r.verdict === 'insufficient').length,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalRevenue: periodStore.revenue,
      totalMargin: periodStore.margin,
      blendedRoas: totalSpend > 0 ? Math.round((periodStore.revenue / totalSpend) * 100) / 100 : null,
      lookbackDays,
    },
  };
}
