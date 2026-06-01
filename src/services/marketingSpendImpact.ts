import { pctChange, shiftIsoDate, type ScenarioVerdict } from './commercialScenarioMetrics';
import { calculateCampaignMetrics } from '../utils/roiUtils';
import { applyCampaignDateRangeToMetrics } from '../utils/campaignDateRangeMetrics';
import type { Campaign } from '../types';
import type { EcommerceRawOrder } from './ecommerceRawOrders';

/** Τύπος εμπορικής απόφασης που εντοπίστηκε στην καμπάνια (before→after). */
export type MarketingDecisionType = 'launch' | 'paused' | 'scale_up' | 'scale_down' | 'steady';

export interface MarketingSpendImpactRow {
  id: string;
  title: string;
  channel: string;
  decisionType: MarketingDecisionType;
  /** Σύντομη ετικέτα απόφασης, π.χ. "Budget +42%", "Νέα καμπάνια". */
  decisionLabel: string;
  spendBefore: number;
  /** Spend περιόδου (after). */
  spend: number;
  spendChangePct: number | null;
  revenueBefore: number;
  /** Attributed conversion value (after). */
  revenue: number;
  conversionsBefore: number;
  conversions: number;
  roasBefore: number | null;
  /** Attributed ROAS (after). */
  roas: number | null;
  /** Εκτιμώμενο καθαρό κέρδος (after) μετά κόστος προϊόντος & ad spend (null χωρίς κόστος SKU). */
  netProfit: number | null;
  /** Actionable «μάθημα» για το μέλλον. */
  idea: string;
  /** positive=Επιτυχία, negative=Αποτυχία, neutral=Ουδέτερο, insufficient=Λίγα δεδομένα. */
  verdict: ScenarioVerdict;
  confidence: 'low' | 'medium' | 'high';
}

export interface MarketingSpendImpactSummary {
  detected: number;
  positive: number;
  negative: number;
  neutral: number;
  insufficient: number;
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  totalNetProfit: number | null;
  blendedRoas: number | null;
  storeMarginRate: number | null;
  /** Μήκος baseline σε ημέρες (για labels). */
  lookbackDays: number;
}

const MIN_SPEND = 25;
const TARGET_ROAS = 3;
const WEAK_ROAS = 1.5;
const SPEND_CHANGE_THRESHOLD = 15; // % μεταβολή budget για να θεωρηθεί scale up/down

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDaySpan(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 30;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function fmtRoas(r: number | null): string {
  return r != null ? `${r}x` : '—';
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

type WindowMetrics = { spend: number; revenue: number; conversions: number; roas: number | null };

function windowMetrics(campaign: Campaign, from: string, to: string): WindowMetrics {
  const scoped = applyCampaignDateRangeToMetrics([campaign], from, to);
  const m = calculateCampaignMetrics(scoped);
  const spend = round2(m.totalSpend);
  const revenue = round2(m.totalRevenue);
  return {
    spend,
    revenue,
    conversions: Math.round(m.totalConversions),
    roas: spend > 0 ? round2(revenue / spend) : null,
  };
}

function classifyDecision(spendBefore: number, spendAfter: number, changePct: number | null): MarketingDecisionType {
  const beforeActive = spendBefore >= MIN_SPEND;
  const afterActive = spendAfter >= MIN_SPEND;
  if (!beforeActive && afterActive) return 'launch';
  if (beforeActive && !afterActive) return 'paused';
  if (changePct != null && changePct >= SPEND_CHANGE_THRESHOLD) return 'scale_up';
  if (changePct != null && changePct <= -SPEND_CHANGE_THRESHOLD) return 'scale_down';
  return 'steady';
}

function decisionLabel(type: MarketingDecisionType, changePct: number | null): string {
  switch (type) {
    case 'launch':
      return 'Νέα καμπάνια';
    case 'paused':
      return 'Διακοπή';
    case 'scale_up':
      return `Budget +${Math.round(changePct ?? 0)}%`;
    case 'scale_down':
      return `Budget −${Math.abs(Math.round(changePct ?? 0))}%`;
    default:
      return 'Σταθερό budget';
  }
}

function scoreDecision(
  type: MarketingDecisionType,
  before: WindowMetrics,
  after: WindowMetrics
): ScenarioVerdict {
  const rb = before.roas;
  const ra = after.roas;
  switch (type) {
    case 'scale_up': {
      if (ra == null || after.revenue <= 0) return 'insufficient';
      const held = rb == null || ra >= rb * 0.85;
      if (held && ra >= 2) return 'positive';
      if ((rb != null && ra < rb * 0.6) || ra < WEAK_ROAS) return 'negative';
      return 'neutral';
    }
    case 'scale_down': {
      const revHeld = before.revenue <= 0 ? after.revenue > 0 : after.revenue >= before.revenue * 0.9;
      const roasUp = rb != null && ra != null && ra > rb;
      if (revHeld || roasUp) return 'positive';
      if (before.revenue > 0 && after.revenue < before.revenue * 0.6) return 'negative';
      return 'neutral';
    }
    case 'launch': {
      if (ra == null) return 'insufficient';
      if (ra >= TARGET_ROAS) return 'positive';
      if (ra < WEAK_ROAS) return 'negative';
      return 'neutral';
    }
    case 'paused': {
      if (rb == null) return 'insufficient';
      if (rb >= TARGET_ROAS) return 'negative';
      if (rb < WEAK_ROAS) return 'positive';
      return 'neutral';
    }
    default: {
      if (ra == null) return 'insufficient';
      if (ra >= TARGET_ROAS) return 'positive';
      if (ra < WEAK_ROAS) return 'negative';
      return 'neutral';
    }
  }
}

function buildIdea(
  type: MarketingDecisionType,
  verdict: ScenarioVerdict,
  before: WindowMetrics,
  after: WindowMetrics,
  changePct: number | null
): string {
  const d = Math.abs(Math.round(changePct ?? 0));
  const rb = fmtRoas(before.roas);
  const ra = fmtRoas(after.roas);
  switch (type) {
    case 'scale_up':
      if (verdict === 'positive') return `Αύξηση budget +${d}% με σταθερό ROAS (${rb}→${ra}). Υπάρχει περιθώριο για περαιτέρω κλιμάκωση.`;
      if (verdict === 'negative') return `Αύξησες budget +${d}% αλλά το ROAS έπεσε (${rb}→${ra}). Βάλε ανώτατο όριο ή βελτιστοποίησε targeting/creative.`;
      return `Αύξηση budget +${d}% με οριακή μεταβολή απόδοσης (${rb}→${ra}). Παρακολούθησε πριν κλιμακώσεις άλλο.`;
    case 'scale_down':
      if (verdict === 'positive') return `Μείωση budget −${d}% χωρίς απώλεια αξίας (ROAS ${rb}→${ra}). Διοχέτευσε το budget σε winners.`;
      if (verdict === 'negative') return `Μείωσες budget −${d}% και ο αποδιδόμενος τζίρος έπεσε (${after.revenue < before.revenue ? 'αισθητά' : ''}). Ίσως έκοψες winner — εξέτασε επαναφορά.`;
      return `Μείωση budget −${d}% με μικρή επίδραση (ROAS ${rb}→${ra}).`;
    case 'launch':
      if (verdict === 'positive') return `Νέα καμπάνια με ROAS ${ra} — απέδωσε. Σκέψου σταδιακή αύξηση budget.`;
      if (verdict === 'negative') return `Νέα καμπάνια με χαμηλό ROAS ${ra}. Διόρθωσε targeting/προσφορά ή σταμάτησέ την.`;
      return `Νέα καμπάνια με μέτριο ROAS ${ra}. Δώσε χρόνο/βελτιστοποίηση πριν κρίνεις.`;
    case 'paused':
      if (verdict === 'negative') return `Σταμάτησες καμπάνια που απέδιδε ${rb} ROAS. Εξέτασε επανεκκίνηση.`;
      if (verdict === 'positive') return `Σωστά σταμάτησες αδύναμη καμπάνια (${rb} ROAS).`;
      return `Σταμάτησες καμπάνια με μέτρια απόδοση (${rb} ROAS).`;
    default:
      if (verdict === 'positive') return `Σταθερό budget με ισχυρό ROAS ${ra}. Σκέψου ελεγχόμενη αύξηση.`;
      if (verdict === 'negative') return `Σταθερό budget αλλά αδύναμο ROAS ${ra}. Επανεξέτασε targeting ή μείωσε.`;
      return `Σταθερό budget, μέτρια απόδοση (ROAS ${ra}).`;
  }
}

function confidenceFor(spendBefore: number, spendAfter: number): 'low' | 'medium' | 'high' {
  const vol = Math.max(spendBefore, spendAfter);
  if (vol >= 500) return 'high';
  if (vol >= 150) return 'medium';
  return 'low';
}

/**
 * Εντοπίζει εμπορικές αποφάσεις marketing (αλλαγές budget / νέες / διακοπές) συγκρίνοντας την
 * επιλεγμένη περίοδο με το προηγούμενο ισόποσο διάστημα, και τις κρίνει Επιτυχία/Ουδέτερο/Αποτυχία
 * με actionable «ιδέα» για μελλοντικά πλάνα.
 */
export function analyzeMarketingDecisions(input: {
  campaigns: Campaign[];
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  /** Baseline window· default = προηγούμενο ισόποσο διάστημα πριν την περίοδο. */
  baselineFrom?: string;
  baselineTo?: string;
  costBySku: Map<string, number>;
}): { rows: MarketingSpendImpactRow[]; summary: MarketingSpendImpactSummary } {
  const len = isoDaySpan(input.periodFrom, input.periodTo);
  const baselineTo = input.baselineTo ?? shiftIsoDate(input.periodFrom, -1);
  const baselineFrom = input.baselineFrom ?? shiftIsoDate(baselineTo, -(len - 1));

  const marginRate = storeMarginRate(input.orders, input.periodFrom, input.periodTo, input.costBySku);
  const rows: MarketingSpendImpactRow[] = [];

  for (const campaign of input.campaigns) {
    const before = windowMetrics(campaign, baselineFrom, baselineTo);
    const after = windowMetrics(campaign, input.periodFrom, input.periodTo);

    // Καμμία ουσιαστική δραστηριότητα σε κανένα παράθυρο → αγνόησε.
    if (before.spend < MIN_SPEND && after.spend < MIN_SPEND) continue;

    const changePct = pctChange(after.spend, before.spend);
    const type = classifyDecision(before.spend, after.spend, changePct);
    const verdict = scoreDecision(type, before, after);
    const idea = buildIdea(type, verdict, before, after, changePct);
    const netProfit = marginRate != null ? round2(after.revenue * marginRate - after.spend) : null;

    rows.push({
      id: campaign.id || campaign.name,
      title: campaign.name,
      channel: campaign.channel,
      decisionType: type,
      decisionLabel: decisionLabel(type, changePct),
      spendBefore: before.spend,
      spend: after.spend,
      spendChangePct: type === 'launch' || type === 'paused' ? null : changePct,
      revenueBefore: before.revenue,
      revenue: after.revenue,
      conversionsBefore: before.conversions,
      conversions: after.conversions,
      roasBefore: before.roas,
      roas: after.roas,
      netProfit,
      idea,
      verdict,
      confidence: confidenceFor(before.spend, after.spend),
    });
  }

  // Ταξινόμηση: πρώτα οι σαφείς αποφάσεις (Επιτυχία/Αποτυχία), μετά κατά spend.
  const verdictRank: Record<ScenarioVerdict, number> = { positive: 0, negative: 0, neutral: 1, insufficient: 2 };
  rows.sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict] || b.spend - a.spend);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
  const totalNetProfit = marginRate != null ? round2(totalRevenue * marginRate - totalSpend) : null;

  return {
    rows,
    summary: {
      detected: rows.length,
      positive: rows.filter((r) => r.verdict === 'positive').length,
      negative: rows.filter((r) => r.verdict === 'negative').length,
      neutral: rows.filter((r) => r.verdict === 'neutral').length,
      insufficient: rows.filter((r) => r.verdict === 'insufficient').length,
      totalSpend: round2(totalSpend),
      totalRevenue: round2(totalRevenue),
      totalConversions,
      totalNetProfit,
      blendedRoas: totalSpend > 0 ? round2(totalRevenue / totalSpend) : null,
      storeMarginRate: marginRate,
      lookbackDays: len,
    },
  };
}
