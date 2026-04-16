/**
 * Ίδια λογική με τη σελίδα Campaigns: περιοδικό slice σε dailyMetrics / aggregates
 * ώστε ROI, hooks και exports να μην ξαναϋπολογίζουν με διαφορετικούς κανόνες.
 */
import type { Campaign } from '../types';
import { bucketOverlapFraction, metaUsesLegacyMonthBuckets } from './roiUtils';

function parseCampaignDate(d: string | number | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const str = String(d).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial > 30000 && serial < 60000) {
      const date = new Date((serial - 25569) * 86400 * 1000);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parsePeriodDateRange(period: string | undefined): { start: Date; end: Date } | null {
  if (!period?.trim()) return null;
  const m = period.trim().match(
    /(\d{4}-\d{2}-\d{2})\s*(?:\s+to\s+|[-\u2013\u2014\u2015–—])\s*(\d{4}-\d{2}-\d{2})/i
  );
  if (!m) return null;
  const start = parseCampaignDate(m[1]);
  const end = parseCampaignDate(m[2]);
  if (!start || !end) return null;
  return { start, end };
}

export function getCampaignScheduleBounds(c: Campaign): { start: Date | null; end: Date | null } {
  let start = parseCampaignDate(c.start_date);
  let end = parseCampaignDate(c.end_date);
  if (!start && !end) {
    const pr = parsePeriodDateRange(c.period);
    if (pr) {
      start = pr.start;
      end = pr.end;
    }
  }
  return { start, end };
}

function overlapAggregateScale(c: Campaign, dateFrom: string, dateTo: string): number {
  const filterFromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
  const filterToExcl = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
  const { start, end } = getCampaignScheduleBounds(c);

  if (!start && !end) return 1;

  let campStartMs: number;
  let campEndExcl: number;
  if (start && end) {
    campStartMs = start.getTime();
    campEndExcl = end.getTime() + 86400000;
  } else if (start && !end) {
    campStartMs = start.getTime();
    const tail = Math.max(Date.now(), filterToExcl === Infinity ? Date.now() : filterToExcl);
    campEndExcl = tail;
  } else {
    const e = end!;
    campStartMs = e.getTime();
    campEndExcl = e.getTime() + 86400000;
  }

  const overlapStart = Math.max(campStartMs, filterFromMs);
  const overlapEnd = Math.min(campEndExcl, filterToExcl);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  const campSpanMs = Math.max(86400000, campEndExcl - campStartMs);
  return Math.min(1, overlapMs / campSpanMs);
}

function scaleConversionActions(
  ca: Campaign['conversionActions'] | undefined,
  scale: number
): Campaign['conversionActions'] | undefined {
  if (!ca || (scale >= 0.9999 && scale <= 1.0001)) return ca;
  const out: Record<string, { conversions: number; value: number }> = {};
  for (const [k, v] of Object.entries(ca)) {
    out[k] = {
      conversions: (v.conversions || 0) * scale,
      value: (v.value || 0) * scale,
    };
  }
  return out;
}

/** Φίλτρο ίδιο με Campaigns: επικάλυψη χρονοδιαγράμματος καμπάνιας με [from, to). */
export function filterCampaignsByScheduleDateOverlap(
  campaigns: Campaign[],
  dateFrom: string,
  dateTo: string
): Campaign[] {
  if (!dateFrom && !dateTo) return campaigns;
  const from = dateFrom ? new Date(dateFrom).getTime() : 0;
  const to = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
  return campaigns.filter(c => {
    const { start, end } = getCampaignScheduleBounds(c);
    const campStart = start ? start.getTime() : null;
    const campEnd = end ? end.getTime() : null;
    if (!campStart && !campEnd) return true;
    const overlapStart = campStart ? campStart <= to : campEnd ? campEnd >= from : true;
    const overlapEnd = campEnd ? campEnd >= from : campStart ? campStart <= to : true;
    return overlapStart && overlapEnd;
  });
}

/**
 * Αναλυτικά μετρικά ανά καμπάνια μέσα στην επιλεγμένη ημερομηνιακή περίοδο
 * (ίδιο με `campaignsWithDateMetrics` στη σελίδα Campaigns).
 */
export function applyCampaignDateRangeToMetrics(
  campaigns: Campaign[],
  dateFrom: string,
  dateTo: string
): Campaign[] {
  const useDateFilter = !!(dateFrom || dateTo);
  if (!useDateFilter) return campaigns;

  const fromDate = dateFrom || '0000-00-00';
  const toDate = dateTo || '9999-99-99';

  return campaigns.map(c => {
    if (!c.dailyMetrics || Object.keys(c.dailyMetrics).length === 0) {
      const scale = overlapAggregateScale(c, dateFrom, dateTo);
      if (scale <= 0) {
        return {
          ...c,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          amount_spent: 0,
          conversion_value: 0,
          purchase_conversions: undefined,
          purchase_conversion_value: undefined,
          ctr: 0,
          roas: 0,
          conversionActions: {},
        };
      }
      /**
       * ΠΟΤΕ raw `return c`: με scale≈1 τα parent `purchase_*` είναι συχνά lifetime / όχι η περίοδος → ROAS εκατοντάδες x.
       * Χωρίς ημερήσια σειρά δεν εμπιστευόμαστε doc-level purchase — μόνο κλιμακωμένο `conversion_value` / `conversions`.
       * (Με `dailyMetrics` τα purchase ανά ημέρα κρατούν κανονικά.)
       */
      const impressions = Math.round((c.impressions || 0) * scale);
      const clicks = Math.round((c.clicks || 0) * scale);
      const conversions =
        (typeof c.conversions === 'number' ? c.conversions : parseFloat(String(c.conversions || 0)) || 0) * scale;
      const amount_spent = Math.round((c.amount_spent || 0) * scale * 100) / 100;
      const rawVal = c.conversion_value ?? (c as { conversionValue?: number }).conversionValue;
      const conversion_value =
        Math.round((typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal || 0)) || 0) * scale * 100) / 100;
      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
      const roas = amount_spent > 0 ? Math.round((conversion_value / amount_spent) * 100) / 100 : 0;
      const conversionActions = scaleConversionActions(c.conversionActions, scale);
      return {
        ...c,
        impressions,
        clicks,
        conversions,
        amount_spent,
        conversion_value,
        purchase_conversions: undefined,
        purchase_conversion_value: undefined,
        ctr,
        roas,
        conversionActions,
      };
    }
    const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
    let impressions = 0,
      clicks = 0,
      conversions = 0,
      amount_spent = 0,
      conversion_value = 0;
    let purchase_conversions = 0,
      purchase_conversion_value = 0;
    let purchaseSlicePresent = false;
    const dateConvActions: Record<string, { conversions: number; value: number }> = {};

    for (const [date, m] of Object.entries(c.dailyMetrics)) {
      const frac = bucketOverlapFraction(date, fromDate, toDate, { metaMonthBuckets });
      if (frac <= 0) continue;

      impressions += Math.round((m.impressions || 0) * frac);
      clicks += Math.round((m.clicks || 0) * frac);
      conversions += (m.conversions || 0) * frac;
      amount_spent += (m.amount_spent || 0) * frac;
      conversion_value += (m.conversion_value || 0) * frac;
      const mAny0 = m as Record<string, unknown>;
      if (mAny0.purchase_conversions !== undefined || mAny0.purchase_conversion_value !== undefined) {
        purchaseSlicePresent = true;
      }
      purchase_conversions += Number(mAny0.purchase_conversions ?? 0) * frac;
      purchase_conversion_value += Number(mAny0.purchase_conversion_value ?? 0) * frac;

      const mAny = m as Record<string, any>;
      if (mAny.conversionActions && typeof mAny.conversionActions === 'object') {
        for (const [label, vals] of Object.entries(
          mAny.conversionActions as Record<string, { conversions: number; value: number }>
        )) {
          if (!dateConvActions[label]) dateConvActions[label] = { conversions: 0, value: 0 };
          dateConvActions[label].conversions += (vals.conversions || 0) * frac;
          dateConvActions[label].value += (vals.value || 0) * frac;
        }
      }
    }

    const conversionActions = dateConvActions;

    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
    const roasBase = purchaseSlicePresent ? purchase_conversion_value : conversion_value;
    const roas = amount_spent > 0 ? Math.round((roasBase / amount_spent) * 100) / 100 : 0;
    amount_spent = Math.round(amount_spent * 100) / 100;
    /**
     * Το `...c` φέρνει parent `purchase_*` (συχνά lifetime). Αν τα ημερήσια δεν έχουν purchase columns,
     * πρέπει να τα σβήνουμε αλλιώς το getDisplayConversionValue (Google) ξαναδιαβάζει doc-level purchase.
     */
    const out: Campaign & { purchase_conversions?: number; purchase_conversion_value?: number } = {
      ...c,
      impressions,
      clicks,
      conversions,
      amount_spent,
      conversion_value,
      ctr,
      roas,
      conversionActions,
      purchase_conversions: purchaseSlicePresent ? purchase_conversions : undefined,
      purchase_conversion_value: purchaseSlicePresent
        ? Math.round(purchase_conversion_value * 100) / 100
        : undefined,
    };
    return out;
  });
}
