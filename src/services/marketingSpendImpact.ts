import { type ScenarioVerdict } from './commercialScenarioMetrics';
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
  /** Attributed conversion value της ίδιας της καμπάνιας (όχι ολόκληρου του store). */
  revenue: number;
  /** Attributed conversions της καμπάνιας. */
  conversions: number;
  /** Attributed ROAS = revenue / spend. */
  roas: number | null;
  /** Εκτιμώμενο καθαρό κέρδος μετά κόστος προϊόντος & ad spend (null χωρίς κόστος SKU). */
  netProfit: number | null;
  verdict: ScenarioVerdict;
}

export interface MarketingSpendImpactSummary {
  detected: number;
  positive: number;
  negative: number;
  neutral: number;
  insufficient: number;
  totalSpend: number;
  /** Άθροισμα attributed revenue όλων των καμπανιών. */
  totalRevenue: number;
  totalConversions: number;
  /** Καθαρό κέρδος μετά κόστος & spend (null χωρίς κόστος SKU). */
  totalNetProfit: number | null;
  /** Blended attributed ROAS. */
  blendedRoas: number | null;
  /** Store-level blended margin rate που χρησιμοποιήθηκε για το netProfit (0-1) ή null. */
  storeMarginRate: number | null;
  lookbackDays: number;
}

const MIN_SPEND = 25;
const TARGET_ROAS = 3;

/** Verdict βάσει attributed ROAS — κατανοητό από marketers: scale / κράτα / κόψε. */
function scoreMarketingVerdict(roas: number | null, hasRevenue: boolean): ScenarioVerdict {
  if (!hasRevenue || roas == null) return 'insufficient';
  if (roas >= TARGET_ROAS) return 'positive';
  if (roas < 1.5) return 'negative';
  return 'neutral';
}

/** Store-level blended margin rate (margin/revenue) για εκτίμηση κόστους στα attributed έσοδα. */
function storeMarginRate(
  orders: EcommerceRawOrder[],
  from: string,
  to: string,
  costBySku: Map<string, number>
): number | null {
  if (costBySku.size === 0) return null;
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
      const unitCost = costBySku.get(sku);
      if (unitCost == null) continue;
      revenue += price * qty;
      cost += unitCost * qty;
    }
  }
  if (revenue <= 0) return null;
  return Math.max(0, Math.min(1, (revenue - cost) / revenue));
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
  const periodCampaigns = filterCampaignsByScheduleDateOverlap(input.campaigns, input.periodFrom, input.periodTo);
  const marginRate = storeMarginRate(input.orders, input.periodFrom, input.periodTo, input.costBySku);

  const rows: MarketingSpendImpactRow[] = [];

  for (const campaign of periodCampaigns) {
    const start = campaign.start_date || input.periodFrom;
    const end = campaign.end_date || input.periodTo;
    const windowFrom = start > input.periodFrom ? start : input.periodFrom;
    const windowTo = end < input.periodTo ? end : input.periodTo;

    // Attributed μετρικές της καμπάνιας μέσα στο παράθυρο (ίδιες με τη σελίδα Campaigns/ROI).
    const scoped = applyCampaignDateRangeToMetrics([campaign], windowFrom, windowTo);
    const metrics = calculateCampaignMetrics(scoped);
    const spend = metrics.totalSpend;
    if (spend < MIN_SPEND) continue;

    const revenue = Math.round(metrics.totalRevenue * 100) / 100;
    const conversions = Math.round(metrics.totalConversions);
    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null;
    const netProfit = marginRate != null ? Math.round((revenue * marginRate - spend) * 100) / 100 : null;
    const verdict = scoreMarketingVerdict(roas, revenue > 0);

    rows.push({
      id: campaign.id || campaign.name,
      title: campaign.name,
      channel: campaign.channel,
      spend: Math.round(spend * 100) / 100,
      revenue,
      conversions,
      roas,
      netProfit,
      verdict,
    });
  }

  rows.sort((a, b) => b.spend - a.spend);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
  const totalNetProfit = marginRate != null ? Math.round((totalRevenue * marginRate - totalSpend) * 100) / 100 : null;

  return {
    rows,
    summary: {
      detected: rows.length,
      positive: rows.filter((r) => r.verdict === 'positive').length,
      negative: rows.filter((r) => r.verdict === 'negative').length,
      neutral: rows.filter((r) => r.verdict === 'neutral').length,
      insufficient: rows.filter((r) => r.verdict === 'insufficient').length,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalConversions,
      totalNetProfit,
      blendedRoas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : null,
      storeMarginRate: marginRate,
      lookbackDays,
    },
  };
}
