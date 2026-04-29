import type { Campaign } from '../types';
import { eachDateInclusive } from './marketingCostPeriod';

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
  /**
   * ΜΗΝ προτιμάς `purchase_conversion_value` από το parent campaign doc εδώ: στο ROI/Dashboard τα
   * campaigns περνούν από date-filter σε `dailyMetrics` — το `conversion_value` είναι άθροισμα περιόδου,
   * ενώ το purchase_* στο doc είναι συχνά lifetime ή πλήρες sync → ROAS πλασματικά υψηλό.
   * Η σελίδα Campaigns χρησιμοποιεί ξεχωριστή λογική εμφάνισης (getDisplayConversionValue).
   */
  const v = c.conversion_value || 0;
  if (v > 0) return v;
  if (c.conversionActions) {
    return Object.entries(c.conversionActions as Record<string, { conversions: number; value: number }>)
      .filter(([label]) => !EXCLUDED_ACTION_LABELS.has(label))
      .reduce((sum, [, a]) => sum + (a?.value ?? 0), 0);
  }
  const pv = (c as Campaign & { purchase_conversion_value?: number }).purchase_conversion_value;
  if (typeof pv === 'number' && !Number.isNaN(pv) && pv > 0) return pv;
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
  const pc = (c as Campaign & { purchase_conversions?: number }).purchase_conversions;
  if (typeof pc === 'number' && !Number.isNaN(pc) && pc > 0) return pc;
  return 0;
}

export function sumConversionActions(
  ca: Campaign['conversionActions'] | undefined
): { conv: number; value: number } {
  if (!ca) return { conv: 0, value: 0 };
  return Object.values(ca).reduce(
    (acc, a) => ({
      conv: acc.conv + (a?.conversions ?? 0),
      value: acc.value + (a?.value ?? 0),
    }),
    { conv: 0, value: 0 }
  );
}

export function isGoogleAdsLikeChannel(channel: string | undefined): boolean {
  const ch = (channel || '').trim().toLowerCase();
  return ch === 'google ads' || ch === 'google shopping' || /^google\s*ads\b/.test(ch);
}

/**
 * Ίδια λογική με το summary της σελίδας Campaigns (Purchase/Sales όταν δεν υπάρχει φίλτρο conversion action).
 */
export function getDisplayConversions(c: Campaign, convFilterActive: boolean): number {
  const raw = c.conversions;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const pConv = c.purchase_conversions;
  if (isGoogleAdsLikeChannel(c.channel)) {
    if (typeof pConv === 'number' && !Number.isNaN(pConv)) return pConv;
    if (!Number.isNaN(n)) return n;
    return 0;
  }
  if (isMetaChannel(c.channel)) {
    if (typeof pConv === 'number' && !Number.isNaN(pConv)) return pConv;
    return getEffectiveConversions(c);
  }
  const fromActions = sumConversionActions(c.conversionActions).conv;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

export function getDisplayConversionValue(c: Campaign, convFilterActive: boolean): number {
  const any = c as Campaign & { conversionValue?: number };
  const raw = c.conversion_value ?? any.conversionValue;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const pVal = c.purchase_conversion_value;
  if (isGoogleAdsLikeChannel(c.channel)) {
    if (typeof pVal === 'number' && !Number.isNaN(pVal)) return pVal;
    if (!Number.isNaN(n)) return n;
    return 0;
  }
  if (isMetaChannel(c.channel)) {
    if (typeof pVal === 'number' && !Number.isNaN(pVal)) return pVal;
    return getEffectiveConversionValue(c);
  }
  const fromActions = sumConversionActions(c.conversionActions).value;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

/** Legacy attribution-only revenue helper: organic revenue + campaign conversion value, excluding e-shop cash revenue. */
export function calculateTotalRevenue(
  organicRevenue: number,
  campaigns: Campaign[]
): number {
  const campaignsRevenue = campaigns.reduce((sum, c) => sum + getDisplayConversionValue(c, false), 0);
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

/** Short axis label e.g. `Apr 2026` — full year (όχι 2 ψηφία έτους που μπερδεύονται με ημέρα). */
export function formatMonthKeyShort(ym: string): string {
  const [y, mo] = ym.split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[mo - 1]} ${y}`;
}

function daysInMonthYm(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function dateStrMax(a: string, b: string): string {
  return a >= b ? a : b;
}

function dateStrMin(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Ετικέτα ημέρας για άξονα τάσης (ελληνικό short date). */
export function formatTrendDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  try {
    return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return ymd;
  }
}

/** Συμβατό με `applyCampaignDateRangeToMetrics`: αν κάποιο daily row έχει purchase fields, χρησιμοποιούμε purchase ανά ημέρα. */
function dailyMetricsHasPurchaseSlice(dm: Record<string, unknown>): boolean {
  for (const raw of Object.values(dm)) {
    const m = raw as { purchase_conversions?: unknown; purchase_conversion_value?: unknown };
    if (m.purchase_conversions !== undefined || m.purchase_conversion_value !== undefined) return true;
  }
  return false;
}

function attributedRevenueFromDailyRow(raw: unknown, usePurchaseSlice: boolean): number {
  const m = raw as { conversion_value?: number; purchase_conversion_value?: number };
  if (usePurchaseSlice && m.purchase_conversion_value !== undefined && m.purchase_conversion_value !== null) {
    return Number(m.purchase_conversion_value) || 0;
  }
  return Number(m.conversion_value) || 0;
}

function attributedConversionsFromDailyRow(raw: unknown, usePurchaseSlice: boolean): number {
  const m = raw as { conversions?: number; purchase_conversions?: number };
  if (usePurchaseSlice && m.purchase_conversions !== undefined && m.purchase_conversions !== null) {
    return Number(m.purchase_conversions) || 0;
  }
  return Number(m.conversions) || 0;
}

/**
 * Ημερήσιο conversion value (έσοδα που αναφέρει η πλατφόρμα διαφημίσεων) ανά YYYY-MM-DD μέσα στο [fromDate, toDate].
 * Κανονικές σειρές: μία γραμμή ανά ημέρα. Meta legacy (ένα bucket ανά μήνα): ισοκατανομή στις ημέρες που τέμνουν την περίοδο.
 */
export function getCampaignDailyAttributedValueInPeriod(
  c: Campaign,
  fromDate: string,
  toDate: string
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (day: string, v: number) => {
    if (!v) return;
    out.set(day, (out.get(day) || 0) + v);
  };

  const dm = c.dailyMetrics;
  if (dm && Object.keys(dm).length > 0) {
    const usePurchase = dailyMetricsHasPurchaseSlice(dm as Record<string, unknown>);
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    if (!metaMonthBuckets) {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.length < 10 || dateKey[4] !== '-' || dateKey[7] !== '-') continue;
        if (dateKey < fromDate || dateKey > toDate) continue;
        add(dateKey, attributedRevenueFromDailyRow(raw, usePurchase));
      }
    } else {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.slice(8, 10) !== '01') continue;
        const monthTotal = attributedRevenueFromDailyRow(raw, usePurchase);
        const ym = dateKey.slice(0, 7);
        const [yy, mm] = ym.split('-').map(Number);
        if (!yy || !mm) continue;
        const dim = daysInMonthYm(yy, mm);
        const monthEnd = `${ym}-${String(dim).padStart(2, '0')}`;
        const monthStart = `${ym}-01`;
        const attributedMonth =
          monthTotal * bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets: true });
        if (attributedMonth <= 0) continue;
        const overlapStart = dateStrMax(monthStart, fromDate);
        const overlapEnd = dateStrMin(monthEnd, toDate);
        if (overlapStart > overlapEnd) continue;
        const daysInOverlap = eachDateInclusive(overlapStart, overlapEnd).filter((d) => d.slice(0, 7) === ym);
        const n = daysInOverlap.length;
        if (n <= 0) continue;
        const perDay = attributedMonth / n;
        for (const d of daysInOverlap) {
          add(d, perDay);
        }
      }
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const eff = getDisplayConversionValue(c, false);
    if (dmSum === 0 && eff > 0) {
      const cd = getCampaignDateForMonth(c);
      if (cd) {
        const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
        if (ymd >= fromDate && ymd <= toDate) add(ymd, eff);
      }
    }
    return out;
  }

  const cd = getCampaignDateForMonth(c);
  if (!cd) return out;
  const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
  if (ymd >= fromDate && ymd <= toDate) add(ymd, getDisplayConversionValue(c, false));
  return out;
}

/**
 * Ημερήσια δαπάνη διαφήμισης (`amount_spent`) ανά YYYY-MM-DD μέσα στο [fromDate, toDate].
 * Ίδια δομή κουβακιών με {@link getCampaignDailyAttributedValueInPeriod} για συνεπές ROAS ανά ημέρα.
 */
export function getCampaignDailyAttributedSpendInPeriod(
  c: Campaign,
  fromDate: string,
  toDate: string
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (day: string, v: number) => {
    if (!v) return;
    out.set(day, (out.get(day) || 0) + v);
  };

  const dm = c.dailyMetrics;
  if (dm && Object.keys(dm).length > 0) {
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    if (!metaMonthBuckets) {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.length < 10 || dateKey[4] !== '-' || dateKey[7] !== '-') continue;
        if (dateKey < fromDate || dateKey > toDate) continue;
        const metrics = raw as { amount_spent?: number };
        add(dateKey, Number(metrics.amount_spent) || 0);
      }
    } else {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.slice(8, 10) !== '01') continue;
        const metrics = raw as { amount_spent?: number };
        const monthTotal = Number(metrics.amount_spent) || 0;
        const ym = dateKey.slice(0, 7);
        const [yy, mm] = ym.split('-').map(Number);
        if (!yy || !mm) continue;
        const dim = daysInMonthYm(yy, mm);
        const monthEnd = `${ym}-${String(dim).padStart(2, '0')}`;
        const monthStart = `${ym}-01`;
        const attributedMonth =
          monthTotal * bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets: true });
        if (attributedMonth <= 0) continue;
        const overlapStart = dateStrMax(monthStart, fromDate);
        const overlapEnd = dateStrMin(monthEnd, toDate);
        if (overlapStart > overlapEnd) continue;
        const daysInOverlap = eachDateInclusive(overlapStart, overlapEnd).filter((d) => d.slice(0, 7) === ym);
        const n = daysInOverlap.length;
        if (n <= 0) continue;
        const perDay = attributedMonth / n;
        for (const d of daysInOverlap) {
          add(d, perDay);
        }
      }
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const agg = c.amount_spent || 0;
    if (dmSum === 0 && agg > 0) {
      const cd = getCampaignDateForMonth(c);
      if (cd) {
        const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
        if (ymd >= fromDate && ymd <= toDate) add(ymd, agg);
      }
    }
    return out;
  }

  const cd = getCampaignDateForMonth(c);
  if (!cd) return out;
  const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
  if (ymd >= fromDate && ymd <= toDate) add(ymd, c.amount_spent || 0);
  return out;
}

/**
 * Ημερήσιες μετατροπές (conversions) ανά YYYY-MM-DD μέσα στο [fromDate, toDate].
 * Ίδια κουβάκια με {@link getCampaignDailyAttributedSpendInPeriod} (για AOV / τάση ανά ημέρα).
 */
export function getCampaignDailyAttributedConversionsInPeriod(
  c: Campaign,
  fromDate: string,
  toDate: string
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (day: string, v: number) => {
    if (!v) return;
    out.set(day, (out.get(day) || 0) + v);
  };

  const dm = c.dailyMetrics;
  if (dm && Object.keys(dm).length > 0) {
    const usePurchase = dailyMetricsHasPurchaseSlice(dm as Record<string, unknown>);
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    if (!metaMonthBuckets) {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.length < 10 || dateKey[4] !== '-' || dateKey[7] !== '-') continue;
        if (dateKey < fromDate || dateKey > toDate) continue;
        add(dateKey, attributedConversionsFromDailyRow(raw, usePurchase));
      }
    } else {
      for (const [dateKey, raw] of Object.entries(dm)) {
        if (dateKey.slice(8, 10) !== '01') continue;
        const monthTotal = attributedConversionsFromDailyRow(raw, usePurchase);
        const ym = dateKey.slice(0, 7);
        const [yy, mm] = ym.split('-').map(Number);
        if (!yy || !mm) continue;
        const dim = daysInMonthYm(yy, mm);
        const monthEnd = `${ym}-${String(dim).padStart(2, '0')}`;
        const monthStart = `${ym}-01`;
        const attributedMonth =
          monthTotal * bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets: true });
        if (attributedMonth <= 0) continue;
        const overlapStart = dateStrMax(monthStart, fromDate);
        const overlapEnd = dateStrMin(monthEnd, toDate);
        if (overlapStart > overlapEnd) continue;
        const daysInOverlap = eachDateInclusive(overlapStart, overlapEnd).filter((d) => d.slice(0, 7) === ym);
        const n = daysInOverlap.length;
        if (n <= 0) continue;
        const perDay = attributedMonth / n;
        for (const d of daysInOverlap) {
          add(d, perDay);
        }
      }
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const agg = getDisplayConversions(c, false);
    if (dmSum === 0 && agg > 0) {
      const cd = getCampaignDateForMonth(c);
      if (cd) {
        const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
        if (ymd >= fromDate && ymd <= toDate) add(ymd, agg);
      }
    }
    return out;
  }

  const cd = getCampaignDateForMonth(c);
  if (!cd) return out;
  const ymd = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
  if (ymd >= fromDate && ymd <= toDate) add(ymd, getDisplayConversions(c, false));
  return out;
}

export type RoiTrendDailyRow = {
  date: string;
  label: string;
  organic: number;
  campaigns: number;
  storeRevenue: number;
};

/** Άθροισμα `revenueByDay[day]` για κλειστό [fromDate, toDate]. */
export function sumDailyRevenueInPeriod(
  revenueByDay: Record<string, number> | undefined,
  fromDate: string,
  toDate: string
): number {
  if (!revenueByDay) return 0;
  let s = 0;
  for (const day of eachDateInclusive(fromDate, toDate)) {
    s += Number(revenueByDay[day]) || 0;
  }
  return Math.round(s);
}

/**
 * Ίδια λογική με `buildRoiTrendSeriesDaily` για μία ημέρα (import spread vs GA4).
 */
export function organicRevenueForSingleDay(
  day: string,
  organicByMonth: Map<string, number>,
  ga4OrganicByDay?: Record<string, number>
): number {
  const ym = day.slice(0, 7);
  const monthTotal = organicByMonth.get(ym) || 0;
  const [yy, mm] = ym.split('-').map(Number);
  const dim = daysInMonthYm(yy, mm);
  const importSpread = dim > 0 && monthTotal > 0 ? monthTotal / dim : 0;
  const ga4Day = ga4OrganicByDay ? Number(ga4OrganicByDay[day]) || 0 : 0;
  return Math.round(monthTotal > 0 ? importSpread : ga4Day);
}

/** Για μηνιαίο chart: αν δεν υπάρχει import για YYYY-MM, συμπληρώνει από ημερήσιο GA4 (ανά μήνα). */
export function mergeOrganicByMonthWithGa4(
  organicByMonth: Map<string, number>,
  ga4OrganicByDay: Record<string, number> | undefined
): Map<string, number> {
  const out = new Map(organicByMonth);
  if (!ga4OrganicByDay || Object.keys(ga4OrganicByDay).length === 0) return out;
  const ga4ByMonth = new Map<string, number>();
  for (const [day, rev] of Object.entries(ga4OrganicByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const ym = day.slice(0, 7);
    ga4ByMonth.set(ym, (ga4ByMonth.get(ym) || 0) + (Number(rev) || 0));
  }
  ga4ByMonth.forEach((v, ym) => {
    if ((out.get(ym) || 0) === 0 && v > 0) out.set(ym, Math.round(v));
  });
  return out;
}

/**
 * Όταν λείπει το `organicRevenueByDay` στο Firestore (ή το άθροισμα στην περίοδο είναι ~0), εκτιμούμε
 * ημερήσιο organic από το συνολικό organic των καναλιών GA4 (`trafficSources`, ίδιο με τον πίνακα «Ανάλυση καναλιών»),
 * με ομοιόμορφη κατανομή στο [syncStart–syncEnd] και κλιμάκωση στο τομή με την επιλεγμένη περίοδο.
 */
export function mergeGa4OrganicDailyWithChannelFallback(
  ga4OrganicByDay: Record<string, number> | undefined,
  channelOrganicTotal: number,
  syncDateRange: { start: string; end: string } | undefined,
  periodFrom: string,
  periodTo: string
): Record<string, number> {
  const base: Record<string, number> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(periodTo)) {
    if (ga4OrganicByDay) {
      for (const [k, v] of Object.entries(ga4OrganicByDay)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v > 0) base[k] = v;
      }
    }
    return base;
  }
  if (ga4OrganicByDay) {
    for (const [k, v] of Object.entries(ga4OrganicByDay)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v > 0) base[k] = v;
    }
  }

  const periodDays = eachDateInclusive(periodFrom, periodTo);
  const sumInPeriod = periodDays.reduce((s, d) => s + (base[d] || 0), 0);
  if (sumInPeriod >= 0.5) return base;
  if (channelOrganicTotal <= 0 || !syncDateRange?.start || !syncDateRange?.end) return base;

  const syncStart = syncDateRange.start;
  const syncEnd = syncDateRange.end;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(syncStart) || !/^\d{4}-\d{2}-\d{2}$/.test(syncEnd)) return base;

  const syncDayCount = eachDateInclusive(syncStart, syncEnd).length;
  if (syncDayCount <= 0) return base;

  const overlapFrom = dateStrMax(periodFrom, syncStart);
  const overlapTo = dateStrMin(periodTo, syncEnd);
  if (overlapFrom > overlapTo) return base;

  const overlapArr = eachDateInclusive(overlapFrom, overlapTo);
  const n = overlapArr.length;
  if (n <= 0) return base;

  const scaledTotal = channelOrganicTotal * (n / syncDayCount);
  const perDay = scaledTotal / n;

  for (const d of overlapArr) {
    base[d] = (base[d] || 0) + perDay;
  }
  for (const k of Object.keys(base)) {
    base[k] = Math.round(base[k] * 100) / 100;
  }
  return base;
}

/**
 * Συγχώνευση organic (ισοκατανομή μηνιαίων imports ανά ημέρα), campaigns (ημερήσια metrics), e-shop revenueByDay.
 * Αν για κάποιον μήνα δεν υπάρχει μηνιαίο import (`organicByMonth`), χρησιμοποιείται προαιρετικά
 * `ga4OrganicByDay` (ημερήσιο organic revenue από GA4 ανά default channel group).
 */
export function buildRoiTrendSeriesDaily(
  organicByMonth: Map<string, number>,
  allCampaigns: Campaign[],
  revenueByDay: Record<string, number> | undefined,
  fromDate: string,
  toDate: string,
  includeStore: boolean,
  ga4OrganicByDay?: Record<string, number>
): RoiTrendDailyRow[] {
  const days = eachDateInclusive(fromDate, toDate);
  const organicByDay = new Map<string, number>();
  for (const day of days) {
    organicByDay.set(day, organicRevenueForSingleDay(day, organicByMonth, ga4OrganicByDay));
  }

  const campaignsByDay = new Map<string, number>();
  for (const c of allCampaigns) {
    const m = getCampaignDailyAttributedValueInPeriod(c, fromDate, toDate);
    m.forEach((v, d) => campaignsByDay.set(d, (campaignsByDay.get(d) || 0) + v));
  }

  const storeByDay = new Map<string, number>();
  if (includeStore && revenueByDay) {
    for (const day of days) {
      storeByDay.set(day, Number(revenueByDay[day]) || 0);
    }
  }

  return days.map((day) => ({
    date: day,
    label: formatTrendDayLabel(day),
    organic: Math.round(organicByDay.get(day) || 0),
    campaigns: Math.round(campaignsByDay.get(day) || 0),
    storeRevenue: Math.round(storeByDay.get(day) || 0),
  }));
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

/** Μηνιαία σειρά e-shop από ημερήσιο map (π.χ. από full-history raw orders). */
export function monthlyRevenueFromDailyRecord(revenueByDay: Record<string, number>): { month: string; revenue: number }[] {
  const byMonth: Record<string, number> = {};
  for (const [day, rev] of Object.entries(revenueByDay)) {
    const ym = day.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    byMonth[ym] = (byMonth[ym] || 0) + rev;
  }
  return Object.entries(byMonth)
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Conversion value ανά ημερολογιακό μήνα (για trend charts).
 * Prefers summing `dailyMetrics` by month; otherwise one bucket from campaign-level metrics.
 */
export function getCampaignMonthlyAttributedValue(c: Campaign): Map<string, number> {
  const out = new Map<string, number>();
  const dm = c.dailyMetrics;
  if (dm && Object.keys(dm).length > 0) {
    const usePurchase = dailyMetricsHasPurchaseSlice(dm as Record<string, unknown>);
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    for (const [dateKey, raw] of Object.entries(dm)) {
      const val = attributedRevenueFromDailyRow(raw, usePurchase);
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
    const eff = getDisplayConversionValue(c, false);
    if (dmSum === 0 && eff > 0) {
      out.clear();
      const d = getCampaignDateForMonth(c);
      if (d) out.set(monthKeyFromDate(d), eff);
    }
    return out;
  }
  const d = getCampaignDateForMonth(c);
  if (!d) return out;
  out.set(monthKeyFromDate(d), getDisplayConversionValue(c, false));
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
    const usePurchase = dailyMetricsHasPurchaseSlice(dm as Record<string, unknown>);
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    for (const [dateKey, raw] of Object.entries(dm)) {
      const frac = bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets });
      if (frac <= 0) continue;
      const val = attributedRevenueFromDailyRow(raw, usePurchase) * frac;
      let ym = dateKey.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      out.set(ym, (out.get(ym) || 0) + val);
    }
    const dmSum = [...out.values()].reduce((a, b) => a + b, 0);
    const eff = getDisplayConversionValue(c, false);
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
  out.set(ym, getDisplayConversionValue(c, false));
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
  const totalRevenue = campaigns.reduce((sum, c) => sum + getDisplayConversionValue(c, false), 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + getDisplayConversions(c, false), 0);
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
    s.revenue += getDisplayConversionValue(c, false);
    s.conversions += getDisplayConversions(c, false);
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

/** Κείμενο tooltip (Dashboard + ROI): πώς διαβάζεται το ROI σε multiplier μορφή. */
export const ROI_PERCENT_CALC_TOOLTIP =
  `Υπολογισμός ROI σε multiplier μορφή

Φόρμουλα εμφάνισης: Έσοδα καμπανιών ÷ Ad spend

Ερμηνεία: πόσα € έσοδα αντιστοιχούν σε κάθε €1 spend. Το 1,00x είναι break-even, κάτω από 1,00x είσαι αρνητικά, πάνω από 1,00x θετικά.

Σχέση με το παλιό ROI %: ROI % = (ROI multiplier − 1) × 100. Δηλαδή το παλιό +608,9% αντιστοιχεί σε 7,09x.

Χρησιμοποιούμε multiplier μορφή γιατί διαβάζεται πιο εύκολα στο UI.`;
