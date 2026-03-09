import type { Campaign } from '../types';

/**
 * Calculate total revenue: organic revenue + campaign conversion value.
 */
export function calculateTotalRevenue(
  organicRevenue: number,
  campaigns: Campaign[]
): number {
  const campaignsRevenue = campaigns.reduce((sum, c) => sum + (c.conversion_value || 0), 0);
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
  const totalRevenue = campaigns.reduce((sum, c) => sum + (c.conversion_value || 0), 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
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
    s.revenue += c.conversion_value || 0;
    s.conversions += c.conversions || 0;
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
