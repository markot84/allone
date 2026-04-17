import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(en as Parameters<typeof countries.registerLocale>[0]);

/** Αθροίσεις ανά χώρα για choropleth (ίδια πεδία με geo.byCountry). */
export type CountryAgg = {
  country: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  amount_spent: number;
};

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

export function normalizeGeoName(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}
