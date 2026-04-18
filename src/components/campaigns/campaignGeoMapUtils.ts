import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import type { Campaign } from '../../types';

countries.registerLocale(en as Parameters<typeof countries.registerLocale>[0]);

/** ISO-3166-1 alpha-2 από κλειδί Firestore (ISO2, όνομα, ή «GR GR»). */
export function resolveCountryToIso2(raw: string): string | undefined {
  const key = (raw || '').trim();
  if (!key || key === 'UNKNOWN' || key === '??') return undefined;
  for (const part of key.split(/\s+/)) {
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
  }
  const m = key.match(/\b([A-Z]{2})\b/i);
  if (m) return m[1].toUpperCase();
  const fromLib = countries.getAlpha2Code(key, 'en');
  return fromLib || undefined;
}

/** Κανάλι για χρωματική στοίβαση στο Mekko (συμβατό με Campaign.channel). */
export type GeoMekkoChannel = 'Google Ads' | 'Meta' | 'Other';
export type GeoChartMetric =
  | 'amount_spent'
  | 'impressions'
  | 'clicks'
  | 'conversions'
  | 'conversion_value';

export type GeoMekkoSegment = { channel: GeoMekkoChannel; value: number };

export type GeoMekkoColumn = {
  id: string;
  label: string;
  subtitle?: string;
  totalValue: number;
  segments: GeoMekkoSegment[];
};

function parseCityGeoKey(raw: string): { country: string; locality: string } {
  const key = raw || 'UNKNOWN';
  const pipe = key.indexOf('|');
  if (pipe <= 0) return { country: '??', locality: key };
  return {
    country: key.slice(0, pipe).trim() || '??',
    locality: key.slice(pipe + 1).trim() || '—',
  };
}

function normalizeCampaignChannel(c: Campaign): GeoMekkoChannel {
  const ch = String(c.channel || '').trim().toLowerCase();
  if (
    ch.includes('meta') ||
    ch.includes('facebook') ||
    ch.includes('instagram') ||
    ch === 'fb' ||
    ch === 'ig'
  ) {
    return 'Meta';
  }
  if (
    ch === 'google ads' ||
    ch === 'googleads' ||
    ch === 'google shopping' ||
    ch === 'shopping' ||
    ch.includes('google') ||
    ch.includes('gads') ||
    ch.includes('shopping') ||
    ch.includes('search') ||
    ch.includes('display') ||
    ch.includes('youtube') ||
    ch.includes('demand gen') ||
    ch.includes('performance max') ||
    ch.includes('pmax')
  ) {
    return 'Google Ads';
  }
  return 'Other';
}

function getMetricValue(
  metrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    conversion_value: number;
    amount_spent: number;
  },
  metric: GeoChartMetric,
): number {
  return metrics[metric] || 0;
}

function formatGeoLabel(raw: string): string {
  const iso = resolveCountryToIso2(raw);
  if (iso) return iso;
  const t = (raw || '').trim();
  return t || '—';
}

/**
 * Στήλες Mekko: πλάτος ανάλογο με συνολικό spend περιοχής, ύψος στοίβας = κατανομή spend ανά κανάλι.
 * (Αθροίζει geo ανά campaign — ίδια λογική πηγής με τον πίνακα Τοποθεσία.)
 */
export function buildGeoMekkoColumns(
  campaigns: Campaign[],
  level: 'country' | 'city',
  opts?: { maxColumns?: number; metric?: GeoChartMetric },
): GeoMekkoColumn[] {
  const maxColumns = opts?.maxColumns ?? 10;
  const metric = opts?.metric ?? 'amount_spent';
  type Bucket = {
    label: string;
    subtitle?: string;
    google: number;
    meta: number;
    other: number;
  };
  const acc = new Map<string, Bucket>();

  const addValue = (id: string, init: Bucket, channel: GeoMekkoChannel, value: number) => {
    const b = acc.get(id) ?? { ...init };
    if (channel === 'Google Ads') b.google += value;
    else if (channel === 'Meta') b.meta += value;
    else b.other += value;
    acc.set(id, b);
  };

  for (const c of campaigns) {
    const channel = normalizeCampaignChannel(c);
    if (level === 'country') {
      const by = c.geo?.byCountry;
      if (!by) continue;
      for (const [country, m] of Object.entries(by)) {
        const id = country || 'UNKNOWN';
        const value = getMetricValue(m, metric);
        if (value <= 0) continue;
        const label = formatGeoLabel(id);
        addValue(id, { label, google: 0, meta: 0, other: 0 }, channel, value);
      }
    } else {
      const by = c.geo?.byCity;
      const hasCity = !!by && Object.keys(by).length > 0;
      if (hasCity) {
        const entries = Object.entries(by);
        const totalSpent = entries.reduce((s, [, m]) => s + (m.amount_spent || 0), 0);
        const totalRawConv = entries.reduce((s, [, m]) => s + (m.conversions || 0), 0);
        const totalRawVal = entries.reduce((s, [, m]) => s + (m.conversion_value || 0), 0);
        const campConv =
          (typeof c.purchase_conversions === 'number' ? c.purchase_conversions : null) ??
          c.conversions ??
          0;
        const campVal =
          (typeof c.purchase_conversion_value === 'number' ? c.purchase_conversion_value : null) ??
          c.conversion_value ??
          0;
        const convSlack = Math.max(0, Number(campConv) - totalRawConv);
        const valSlack = Math.max(0, Number(campVal) - totalRawVal);
        const allocConv = convSlack > 0.01 && totalRawConv < 0.01 && totalSpent > 0;
        const allocVal = valSlack > 0.01 && totalRawVal < 0.01 && totalSpent > 0;

        for (const [locKey, m] of entries) {
          const spend = m.amount_spent || 0;
          const share = totalSpent > 0 ? spend / totalSpent : 0;
          const adjustedMetrics = {
            ...m,
            conversions: (m.conversions || 0) + (allocConv ? convSlack * share : 0),
            conversion_value: (m.conversion_value || 0) + (allocVal ? valSlack * share : 0),
          };
          const value = getMetricValue(adjustedMetrics, metric);
          if (value <= 0) continue;
          const { country, locality } = parseCityGeoKey(locKey);
          const subtitle = formatGeoLabel(country);
          addValue(
            locKey,
            { label: locality || '—', subtitle, google: 0, meta: 0, other: 0 },
            channel,
            value,
          );
        }
        continue;
      }
    }
  }

  const order: GeoMekkoChannel[] = ['Google Ads', 'Meta', 'Other'];
  const cols: GeoMekkoColumn[] = [];
  for (const [id, b] of acc.entries()) {
    const totalValue = b.google + b.meta + b.other;
    if (totalValue <= 0) continue;
    const segments: GeoMekkoSegment[] = order.map((channel) => ({
      channel,
      value:
        channel === 'Google Ads' ? b.google : channel === 'Meta' ? b.meta : b.other,
    }));
    cols.push({
      id,
      label: b.label,
      subtitle: b.subtitle,
      totalValue,
      segments,
    });
  }

  cols.sort((a, b) => b.totalValue - a.totalValue);

  if (cols.length <= maxColumns) return cols;

  const visibleCount = Math.max(1, maxColumns - 1);
  const head = cols.slice(0, visibleCount);
  const tail = cols.slice(visibleCount);
  const restTotalValue = tail.reduce((sum, c) => sum + c.totalValue, 0);
  if (restTotalValue <= 0) return head;

  const restByChannel = tail.reduce(
    (acc, c) => {
      for (const seg of c.segments) {
        if (seg.channel === 'Google Ads') acc.google += seg.value;
        else if (seg.channel === 'Meta') acc.meta += seg.value;
        else acc.other += seg.value;
      }
      return acc;
    },
    { google: 0, meta: 0, other: 0 },
  );

  head.push({
    id: '__other_geo__',
    label: 'Λοιπά',
    subtitle: `${tail.length} ${level === 'country' ? 'χώρες' : 'τοποθεσίες'}`,
    totalValue: restTotalValue,
    segments: [
      { channel: 'Google Ads', value: restByChannel.google },
      { channel: 'Meta', value: restByChannel.meta },
      { channel: 'Other', value: restByChannel.other },
    ],
  });

  return head;
}
