import type { Campaign } from '../types';

/**
 * Returns the fraction [0,1] of a dailyMetrics bucket that overlaps [fromDate, toDate].
 * Daily keys (YYYY-MM-DD where day != '01'): exactly 0 or 1.
 * Monthly keys (day === '01', used by Meta): proportional overlap so a partial-month
 * date range doesn't include the full month's aggregate.
 */
export function bucketOverlapFraction(date: string, fromDate: string, toDate: string): number {
  if (date.slice(8, 10) === '01') {
    const [year, month] = date.slice(0, 7).split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthEnd = `${date.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`;
    if (date > toDate || monthEnd < fromDate) return 0;
    const overlapStart = date > fromDate ? date : fromDate;
    const overlapEnd = monthEnd < toDate ? monthEnd : toDate;
    const overlapDays = Math.round((new Date(overlapEnd).getTime() - new Date(overlapStart).getTime()) / 86400000) + 1;
    return overlapDays / daysInMonth;
  }
  return date >= fromDate && date <= toDate ? 1 : 0;
}

// Purchase labels trusted for Meta — in priority order.
// omni_purchase is excluded: it's a Meta-modeled superset that inflates counts.
const META_PURCHASE_LABELS = ['Purchase (Pixel)', 'Purchase'];
// omni_purchase kept for reference but no longer used in logic
const _EXCLUDED_ACTION_LABELS = new Set(['omni_purchase']); void _EXCLUDED_ACTION_LABELS;

// Keywords that identify Google Ads purchase/transaction conversion actions
const GADS_PURCHASE_KEYWORDS = ['purchase', 'αγορά', 'αγορα', 'buy', 'order', 'transaction', 'checkout', 'ecommerce'];
// Keywords that identify non-purchase Google Ads conversion actions (store visits, leads, calls, etc.)
const GADS_NON_PURCHASE_KEYWORDS = [
  'store visit', 'store_visit', 'επίσκεψη', 'phone call', 'calls from', 'direction',
  'get direction', 'lead', 'form submit', 'form_submit', 'newsletter', 'download',
  'scroll', 'page view', 'pageview', 'video', 'engagement',
];

type ConvActMap = Record<string, { conversions: number; value: number }>;

/**
 * Classifies Google Ads conversionActions into purchase vs non-purchase,
 * returning proportions for filtering.
 * Note: when date-filtering is active, conversionActions may have monthly totals × days
 * but the FRACTION (purchase/total) remains correct regardless of overcounting.
 */
function classifyGAdsActions(acts: ConvActMap): {
  hasPurchase: boolean;
  hasNonPurchase: boolean;
  purchaseValueFraction: number;
  purchaseConvFraction: number;
} {
  let purchaseValue = 0, totalValue = 0;
  let purchaseConvs = 0, totalConvs = 0;
  let hasPurchase = false, hasNonPurchase = false;

  for (const [label, a] of Object.entries(acts)) {
    const lower = label.toLowerCase();
    const isPurchase = GADS_PURCHASE_KEYWORDS.some(kw => lower.includes(kw));
    const isNonPurchase = !isPurchase && GADS_NON_PURCHASE_KEYWORDS.some(kw => lower.includes(kw));

    const v = a?.value ?? 0;
    const convs = a?.conversions ?? 0;
    totalValue += v;
    totalConvs += convs;

    if (isPurchase) {
      hasPurchase = true;
      purchaseValue += v;
      purchaseConvs += convs;
    } else if (isNonPurchase) {
      hasNonPurchase = true;
    }
  }

  return {
    hasPurchase,
    hasNonPurchase,
    purchaseValueFraction: totalValue > 0 ? purchaseValue / totalValue : 0,
    purchaseConvFraction: totalConvs > 0 ? purchaseConvs / totalConvs : 0,
  };
}

/**
 * Returns the reliable conversion value for a campaign.
 *
 * For Meta: reads only from trusted conversionActions labels ("Purchase (Pixel)" > "Purchase").
 * For Google Ads: filters conversionActions to purchase-type actions only, excluding
 *   store visits, phone calls, leads etc. that are NOT revenue-generating conversions.
 * For other channels: uses c.conversion_value directly.
 */
export function getEffectiveConversionValue(c: Campaign): number {
  if (c.channel === 'Meta') {
    if (c.conversionActions) {
      for (const label of META_PURCHASE_LABELS) {
        const a = (c.conversionActions as ConvActMap)[label];
        if (a && a.value > 0) return a.value;
      }
    }
    return 0;
  }

  if (c.conversionActions) {
    const acts = c.conversionActions as ConvActMap;
    const { hasPurchase, hasNonPurchase, purchaseValueFraction } = classifyGAdsActions(acts);
    if (hasPurchase) {
      // Has identifiable purchase actions — use their proportional share of conversion_value
      return (c.conversion_value || 0) * purchaseValueFraction;
    }
    if (hasNonPurchase && !hasPurchase) {
      // Only non-purchase actions (store visits, phone calls, etc.) — not e-commerce revenue
      return 0;
    }
    // Labels not recognized — fall through to raw conversion_value
  }

  const v = c.conversion_value || 0;
  if (v > 0) return v;
  return 0;
}

/**
 * Returns the reliable conversion count for a campaign (mirrors getEffectiveConversionValue logic).
 */
export function getEffectiveConversions(c: Campaign): number {
  if (c.channel === 'Meta') {
    if (c.conversionActions) {
      for (const label of META_PURCHASE_LABELS) {
        const a = (c.conversionActions as ConvActMap)[label];
        if (a && a.conversions > 0) return a.conversions;
      }
    }
    return 0;
  }

  if (c.conversionActions) {
    const acts = c.conversionActions as ConvActMap;
    const { hasPurchase, hasNonPurchase, purchaseConvFraction } = classifyGAdsActions(acts);
    if (hasPurchase) {
      return (c.conversions || 0) * purchaseConvFraction;
    }
    if (hasNonPurchase && !hasPurchase) {
      return 0;
    }
  }

  const v = c.conversions || 0;
  if (v > 0) return v;
  return 0;
}

/**
 * Calculate total revenue: organic revenue + campaign conversion value.
 */
export function calculateTotalRevenue(
  organicRevenue: number,
  campaigns: Campaign[]
): number {
  const campaignsRevenue = campaigns.reduce((sum, c) => sum + getEffectiveConversionValue(c), 0);
  return organicRevenue + campaignsRevenue;
}

/** Extract date from campaign for month grouping */
export function getCampaignDateForMonth(c: Campaign): Date | null {
  const d = c.start_date || c.end_date;
  if (d && d.trim()) {
    const parsed = new Date(d.trim());
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (c.period && c.period.trim()) {
    const rangeMatch = c.period.match(/(\d{4}-\d{2}-\d{2})\s*[-–to]\s*(\d{4}-\d{2}-\d{2})/i);
    if (rangeMatch) return new Date(rangeMatch[1]);
    const monthMatch = c.period.match(/(\w+)\s+(\d{4})/);
    if (monthMatch) {
      const parsed = new Date(`${monthMatch[1]} 1, ${monthMatch[2]}`);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
}

/**
 * Calculate real campaign metrics summary.
 */
export function calculateCampaignMetrics(campaigns: Campaign[]) {
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.amount_spent || 0), 0);
  const totalRevenue = campaigns.reduce((sum, c) => sum + getEffectiveConversionValue(c), 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + getEffectiveConversions(c), 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  return { totalSpend, totalRevenue, totalConversions, roas, cpa, ctr };
}

/**
 * Group campaigns by channel and calculate per-channel metrics.
 */
export function calculateChannelPerformance(campaigns: Campaign[]) {
  const channelStats: Record<string, {
    spent: number; revenue: number; conversions: number;
    impressions: number; clicks: number; count: number;
  }> = {};

  campaigns.forEach(c => {
    const channel = c.channel || 'Other';
    if (!channelStats[channel]) {
      channelStats[channel] = { spent: 0, revenue: 0, conversions: 0, impressions: 0, clicks: 0, count: 0 };
    }
    const s = channelStats[channel];
    s.spent += c.amount_spent || 0;
    s.revenue += getEffectiveConversionValue(c);
    s.conversions += getEffectiveConversions(c);
    s.impressions += c.impressions || 0;
    s.clicks += c.clicks || 0;
    s.count += 1;
  });

  return Object.entries(channelStats)
    .map(([channel, s]) => ({
      channel,
      spent: s.spent,
      revenue: s.revenue,
      roas: s.spent > 0 ? s.revenue / s.spent : 0,
      conversions: s.conversions,
      cpa: s.conversions > 0 ? s.spent / s.conversions : 0,
      ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
      campaignCount: s.count,
    }))
    .sort((a, b) => b.spent - a.spent);
}
