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

export type GeoMekkoSegment = { channel: GeoMekkoChannel; spend: number };

export type GeoMekkoColumn = {
  id: string;
  label: string;
  subtitle?: string;
  totalSpend: number;
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
    ch === 'google ads' ||
    ch === 'google shopping' ||
    ch === 'shopping' ||
    ch.startsWith('google ')
  ) {
    return 'Google Ads';
  }
  if (
    ch === 'meta' ||
    ch === 'facebook' ||
    ch === 'instagram' ||
    ch.startsWith('meta ') ||
    ch.startsWith('facebook ') ||
    ch.startsWith('instagram ')
  ) {
    return 'Meta';
  }
  return 'Other';
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
  opts?: { maxColumns?: number },
): GeoMekkoColumn[] {
  const maxColumns = opts?.maxColumns ?? 10;
  type Bucket = {
    label: string;
    subtitle?: string;
    google: number;
    meta: number;
    other: number;
  };
  const acc = new Map<string, Bucket>();

  const addSpend = (id: string, init: Bucket, channel: GeoMekkoChannel, spend: number) => {
    const b = acc.get(id) ?? { ...init };
    if (channel === 'Google Ads') b.google += spend;
    else if (channel === 'Meta') b.meta += spend;
    else b.other += spend;
    acc.set(id, b);
  };

  for (const c of campaigns) {
    const channel = normalizeCampaignChannel(c);
    if (level === 'country') {
      const by = c.geo?.byCountry;
      if (!by) continue;
      for (const [country, m] of Object.entries(by)) {
        const id = country || 'UNKNOWN';
        const spend = m.amount_spent || 0;
        if (spend <= 0) continue;
        const label = formatGeoLabel(id);
        addSpend(id, { label, google: 0, meta: 0, other: 0 }, channel, spend);
      }
    } else {
      const by = c.geo?.byCity;
      if (!by) continue;
      for (const [locKey, m] of Object.entries(by)) {
        const spend = m.amount_spent || 0;
        if (spend <= 0) continue;
        const { country, locality } = parseCityGeoKey(locKey);
        const subtitle = formatGeoLabel(country);
        addSpend(
          locKey,
          { label: locality || '—', subtitle, google: 0, meta: 0, other: 0 },
          channel,
          spend,
        );
      }
    }
  }

  const order: GeoMekkoChannel[] = ['Google Ads', 'Meta', 'Other'];
  const cols: GeoMekkoColumn[] = [];
  for (const [id, b] of acc.entries()) {
    const totalSpend = b.google + b.meta + b.other;
    if (totalSpend <= 0) continue;
    const segments: GeoMekkoSegment[] = order.map((channel) => ({
      channel,
      spend:
        channel === 'Google Ads' ? b.google : channel === 'Meta' ? b.meta : b.other,
    }));
    cols.push({
      id,
      label: b.label,
      subtitle: b.subtitle,
      totalSpend,
      segments,
    });
  }

  cols.sort((a, b) => b.totalSpend - a.totalSpend);

  if (cols.length <= maxColumns) return cols;

  const visibleCount = Math.max(1, maxColumns - 1);
  const head = cols.slice(0, visibleCount);
  const tail = cols.slice(visibleCount);
  const restTotalSpend = tail.reduce((sum, c) => sum + c.totalSpend, 0);
  if (restTotalSpend <= 0) return head;

  const restByChannel = tail.reduce(
    (acc, c) => {
      for (const seg of c.segments) {
        if (seg.channel === 'Google Ads') acc.google += seg.spend;
        else if (seg.channel === 'Meta') acc.meta += seg.spend;
        else acc.other += seg.spend;
      }
      return acc;
    },
    { google: 0, meta: 0, other: 0 },
  );

  head.push({
    id: '__other_geo__',
    label: 'Λοιπά',
    subtitle: `${tail.length} ${level === 'country' ? 'χώρες' : 'τοποθεσίες'}`,
    totalSpend: restTotalSpend,
    segments: [
      { channel: 'Google Ads', spend: restByChannel.google },
      { channel: 'Meta', spend: restByChannel.meta },
      { channel: 'Other', spend: restByChannel.other },
    ],
  });

  return head;
}
