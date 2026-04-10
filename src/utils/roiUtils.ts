import type { Campaign } from '../types';

export type BucketOverlapOptions = {
  /**
   * Legacy Meta imports stored one row per month (key `YYYY-MM-01` = entire month). Spread overlap by calendar days.
   * When `dailyMetrics` includes any day other than the 1st, pass false — each key is a real calendar day.
   */
  metaMonthBuckets?: boolean;
};

/** True if Meta campaign uses legacy monthly-only keys (every key is YYYY-MM-01). */
export function metaUsesLegacyMonthBuckets(c: {
  channel?: string;
  dailyMetrics?: Record<string, unknown>;
}): boolean {
  if ((c.channel || '').toLowerCase() !== 'meta') return false;
  const dm = c.dailyMetrics;
  if (!dm || Object.keys(dm).length === 0) return false;
  return !Object.keys(dm).some(k => k.slice(8, 10) !== '01');
}

/**
 * Returns the fraction [0,1] of a dailyMetrics bucket that overlaps [fromDate, toDate].
 */
export function bucketOverlapFraction(
  date: string,
  fromDate: string,
  toDate: string,
  options?: BucketOverlapOptions
): number {
  if (options?.metaMonthBuckets && date.slice(8, 10) === '01') {
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
export const META_PURCHASE_LABEL_ORDER = ['Purchase (Pixel)', 'Purchase'] as const;
const EXCLUDED_ACTION_LABELS = new Set(['omni_purchase']);

export function isMetaChannel(channel: string | undefined): boolean {
  return (channel || '').trim().toLowerCase() === 'meta';
}

/**
 * Single Meta "purchase" row for display and filters: first trusted label with any data.
 * Keeps conversions and value from the same action row.
 */
export function getMetaPrimaryPurchaseFromActions(
  ca: Record<string, { conversions?: number; value?: number }> | undefined
): { conversions: number; value: number } | null {
  if (!ca) return null;
  for (const label of META_PURCHASE_LABEL_ORDER) {
    const a = ca[label];
    if (!a) continue;
    const conv = a.conversions ?? 0;
    const val = a.value ?? 0;
    if (conv > 0 || val > 0) return { conversions: conv, value: val };
  }
  return null;
}

/**
 * Returns the reliable conversion value for a campaign.
 *
 * For Meta: reads only from trusted conversionActions labels ("Purchase (Pixel)" > "Purchase")
 * to avoid stale Firestore documents that stored omni_purchase as the primary metric.
 * For all other channels: uses c.conversion_value directly, falling back to conversionActions sum.
 */
export function getEffectiveConversionValue(c: Campaign): number {
  if (isMetaChannel(c.channel)) {
    const row = getMetaPrimaryPurchaseFromActions(
      c.conversionActions as Record<string, { conversions?: number; value?: number }> | undefined
    );
    return row?.value ?? 0;
  }
  const v = c.conversion_value || 0;
  if (v > 0) return v;
  if (c.conversionActions) {
    return Object.entries(c.conversionActions as Record<string, { conversions: number; value: number }>)
      .filter(([label]) => !EXCLUDED_ACTION_LABELS.has(label))
      .reduce((sum, [, a]) => sum + (a?.value ?? 0), 0);
  }
  return 0;
}

/**
 * Returns the reliable conversion count for a campaign (same logic as getEffectiveConversionValue).
 */
export function getEffectiveConversions(c: Campaign): number {
  if (isMetaChannel(c.channel)) {
    const row = getMetaPrimaryPurchaseFromActions(
      c.conversionActions as Record<string, { conversions?: number; value?: number }> | undefined
    );
    return row?.conversions ?? 0;
  }
  const v = c.conversions || 0;
  if (v > 0) return v;
  if (c.conversionActions) {
    return Object.entries(c.conversionActions as Record<string, { conversions: number; value: number }>)
      .filter(([label]) => !EXCLUDED_ACTION_LABELS.has(label))
      .reduce((sum, [, a]) => sum + (a?.conversions ?? 0), 0);
  }
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

/** Stable calendar month key `YYYY-MM` from a Date (local). */
export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Normalize organic `period` (ISO date, YYYY-MM, or "Month YYYY") to `YYYY-MM`.
 */
export function normalizeOrganicPeriodToYm(period: string | undefined): string | null {
  if (!period?.trim()) return null;
  const p = period.trim();
  if (/^\d{4}-\d{2}/.test(p)) return p.slice(0, 7);
  const d = new Date(p);
  if (!isNaN(d.getTime())) return monthKeyFromDate(d);
  const m = p.match(/(\w+)\s+(\d{4})/);
  if (m) {
    const parsed = new Date(`${m[1]} 1, ${m[2]}`);
    return isNaN(parsed.getTime()) ? null : monthKeyFromDate(parsed);
  }
  return null;
}

/** Short axis label e.g. `Apr 23` — uses English month abbreviations (stable, not locale `Sept` vs `Sep`). */
export function formatMonthKeyShort(ym: string): string {
  const [y, mo] = ym.split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[mo - 1]} ${String(y).slice(-2)}`;
}

/** Inclusive list of YYYY-MM from fromYm through toYm. */
export function eachCalendarMonthInclusive(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return out;
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Per-calendar-month attributed conversion value for trend charts.
 * Prefers summing `dailyMetrics` by month; otherwise one bucket from campaign-level metrics.
 */
export function getCampaignMonthlyAttributedValue(c: Campaign): Map<string, number> {
  const out = new Map<string, number>();
  const dm = c.dailyMetrics;
  if (dm && Object.keys(dm).length > 0) {
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    for (const [dateKey, raw] of Object.entries(dm)) {
      const metrics = raw as { conversion_value?: number };
      const val = Number(metrics.conversion_value) || 0;
      let ym: string;
      if (metaMonthBuckets && dateKey.slice(8, 10) === '01') {
        ym = dateKey.slice(0, 7);
      } else if (dateKey.length >= 7) {
        ym = dateKey.slice(0, 7);
      } else continue;
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      out.set(ym, (out.get(ym) || 0) + val);
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const eff = getEffectiveConversionValue(c);
    if (dmSum === 0 && eff > 0) {
      out.clear();
      const d = getCampaignDateForMonth(c);
      if (d) out.set(monthKeyFromDate(d), eff);
    }
    return out;
  }
  const d = getCampaignDateForMonth(c);
  if (!d) return out;
  out.set(monthKeyFromDate(d), getEffectiveConversionValue(c));
  return out;
}

/**
 * Like {@link getCampaignMonthlyAttributedValue}, but only counts `dailyMetrics` days overlapping
 * `[fromDate, toDate]` (with Meta month-bucket overlap). For dashboard charts scoped to the period selector.
 */
export function getCampaignMonthlyAttributedValueInPeriod(
  c: Campaign,
  fromDate: string,
  toDate: string
): Map<string, number> {
  const out = new Map<string, number>();
  const dm = c.dailyMetrics;
  const fromYm = fromDate.slice(0, 7);
  const toYm = toDate.slice(0, 7);
  if (dm && Object.keys(dm).length > 0) {
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    for (const [dateKey, raw] of Object.entries(dm)) {
      const frac = bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets });
      if (frac <= 0) continue;
      const metrics = raw as { conversion_value?: number };
      const val = (Number(metrics.conversion_value) || 0) * frac;
      let ym = dateKey.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      out.set(ym, (out.get(ym) || 0) + val);
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const eff = getEffectiveConversionValue(c);
    if (dmSum === 0 && eff > 0) {
      const d = getCampaignDateForMonth(c);
      if (d) {
        const ym = monthKeyFromDate(d);
        if (ym >= fromYm && ym <= toYm) out.set(ym, eff);
      }
    }
    return out;
  }
  const d = getCampaignDateForMonth(c);
  if (!d) return out;
  const ym = monthKeyFromDate(d);
  if (ym < fromYm || ym > toYm) return out;
  out.set(ym, getEffectiveConversionValue(c));
  return out;
}

export type RoiTrendRow = {
  month: string;
  monthSort: string;
  organic: number;
  campaigns: number;
  storeRevenue: number;
};

/**
 * Merge organic, campaign (per-month from dailyMetrics), and e-shop revenue on `YYYY-MM`,
 * fill every month in [fromYm, toYm], sort chronologically.
 */
export type BuildRoiTrendOptions = {
  /** When set, campaign revenue per month respects the date range (dashboard period selector). */
  periodClip?: { fromDate: string; toDate: string };
};

export function buildRoiTrendSeries(
  organicByMonth: Map<string, number>,
  allCampaigns: Campaign[],
  monthlyStore: { month: string; revenue: number }[],
  fromYm: string,
  toYm: string,
  includeStore: boolean,
  options?: BuildRoiTrendOptions
): RoiTrendRow[] {
  const byMonth = new Map<string, { organic: number; campaigns: number; storeRevenue: number }>();
  const clip = options?.periodClip;

  organicByMonth.forEach((val, ym) => {
    if (ym < fromYm || ym > toYm) return;
    byMonth.set(ym, { organic: val, campaigns: 0, storeRevenue: 0 });
  });

  const campaignMonths = (c: Campaign) =>
    clip
      ? getCampaignMonthlyAttributedValueInPeriod(c, clip.fromDate, clip.toDate)
      : getCampaignMonthlyAttributedValue(c);

  for (const c of allCampaigns) {
    for (const [ym, v] of campaignMonths(c)) {
      if (ym < fromYm || ym > toYm) continue;
      const ex = byMonth.get(ym) || { organic: 0, campaigns: 0, storeRevenue: 0 };
      byMonth.set(ym, { ...ex, campaigns: ex.campaigns + v });
    }
  }

  if (includeStore && monthlyStore.length > 0) {
    for (const mr of monthlyStore) {
      const ym = mr.month.slice(0, 7);
      if (ym < fromYm || ym > toYm) continue;
      const ex = byMonth.get(ym) || { organic: 0, campaigns: 0, storeRevenue: 0 };
      byMonth.set(ym, { ...ex, storeRevenue: mr.revenue });
    }
  }

  const months = eachCalendarMonthInclusive(fromYm, toYm);
  for (const ym of months) {
    if (!byMonth.has(ym)) {
      byMonth.set(ym, { organic: 0, campaigns: 0, storeRevenue: 0 });
    }
  }

  return months.map((ym) => {
    const d = byMonth.get(ym)!;
    return {
      month: formatMonthKeyShort(ym),
      monthSort: ym,
      organic: Math.round(d.organic),
      campaigns: Math.round(d.campaigns),
      storeRevenue: Math.round(d.storeRevenue),
    };
  });
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

/** Κείμενο tooltip (Dashboard + ROI): πώς υπολογίζεται το ROI % — όχι ο ROAS ως ×. */
export const ROI_PERCENT_CALC_TOOLTIP =
  `Υπολογισμός ROI % (απόδοση έναντι ad spend)

Φόρμουλα: (Attributed έσοδα καμπανιών − Ad spend) ÷ Ad spend × 100

Ερμηνεία: πόσο ποσοστό «κέρδους» (έσοδα μείον διαφήμιση) παίρνεις πάνω σε κάθε € spend — όχι πόσα € έσοδα ανά €1 spend.

Σχέση με ROAS: ROAS = έσοδα ÷ spend. Άρα ROI % = (ROAS − 1) × 100 (ίδια έσοδα & spend). Το −1 αντιστοιχεί στο «αφαίρεση» του κόστους: έσοδα/spend − spend/spend.

Ο ROAS εμφανίζεται ξεχωριστά ως πολλαπλάσιο (×).`;
