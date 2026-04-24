/**
 * Per-brand cutoff ιστορικότητας — π.χ. brand που άλλαξε Magento την 2025-09-01:
 * δεδομένα προ της ημερομηνίας δεν είναι συγκρίσιμα και κρύβονται από όλες τις προβολές
 * (e-commerce orders, GA4 daily metrics, top products, daily charts κ.λπ.).
 *
 * Δεν αγγίζει τίποτα στο Firestore — μόνο read-side clamp.
 */
import type { Brand } from '../types';

/** Επιστρέφει YYYY-MM-DD αν το brand έχει `historyStartDate`, αλλιώς null. */
export function getBrandHistoryStartISO(brand: Pick<Brand, 'historyStartDate'> | null | undefined): string | null {
  const raw = brand?.historyStartDate;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

/** Ως Date (UTC midnight). null αν δεν είναι ορισμένο/έγκυρο. */
export function getBrandHistoryStartDate(brand: Pick<Brand, 'historyStartDate'> | null | undefined): Date | null {
  const iso = getBrandHistoryStartISO(brand);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Clamp ISO `YYYY-MM-DD` (ή κενό) στο `historyStartDate` του brand.
 * Αν το input είναι παλαιότερο, επιστρέφει το cutoff. Αν δεν υπάρχει cutoff ή το input είναι ισχυρότερο, το αφήνει.
 * Αν το input είναι κενό, επιστρέφει το cutoff (αν υπάρχει).
 */
export function clampDateByBrandHistory(
  isoDate: string | null | undefined,
  brand: Pick<Brand, 'historyStartDate'> | null | undefined,
): string | null {
  const cutoff = getBrandHistoryStartISO(brand);
  if (!cutoff) return isoDate ?? null;
  const input = isoDate?.trim();
  if (!input) return cutoff;
  return input < cutoff ? cutoff : input;
}

/**
 * True αν το `dateValue` (Date | ISO | timestamp ms) πέφτει εντός του cutoff (>= historyStartDate).
 * Αν δεν υπάρχει cutoff, πάντα true.
 */
export function passesBrandHistory(
  dateValue: Date | string | number | null | undefined,
  brand: Pick<Brand, 'historyStartDate'> | null | undefined,
): boolean {
  const cutoff = getBrandHistoryStartDate(brand);
  if (!cutoff) return true;
  if (dateValue == null) return false;
  let d: Date | null = null;
  if (dateValue instanceof Date) d = dateValue;
  else if (typeof dateValue === 'number') d = new Date(dateValue);
  else if (typeof dateValue === 'string') {
    const t = dateValue.trim();
    if (!t) return false;
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00.000Z` : t);
    d = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!d) return false;
  return d.getTime() >= cutoff.getTime();
}

/** Φιλτράρει array με access στο date πεδίο μέσω accessor. */
export function filterByBrandHistory<T>(
  items: T[],
  getDate: (item: T) => Date | string | number | null | undefined,
  brand: Pick<Brand, 'historyStartDate'> | null | undefined,
): T[] {
  if (!getBrandHistoryStartISO(brand)) return items;
  return items.filter((it) => passesBrandHistory(getDate(it), brand));
}
