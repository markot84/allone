/** Per-brand history cutoff: data before `historyStartDate` is hidden from all
 * views (orders, GA4 metrics, etc.). Read-side clamp only, no Firestore writes. */
import type { Brand } from '../types';

/** Returns YYYY-MM-DD if the brand has `historyStartDate`, else null. */
export function getBrandHistoryStartISO(brand: Pick<Brand, 'historyStartDate'> | null | undefined): string | null {
  const raw = brand?.historyStartDate;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

/** As a Date (UTC midnight). null if unset/invalid. */
export function getBrandHistoryStartDate(brand: Pick<Brand, 'historyStartDate'> | null | undefined): Date | null {
  const iso = getBrandHistoryStartISO(brand);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Clamp ISO `YYYY-MM-DD` (or empty) to the brand's `historyStartDate`:
 * older input or empty → cutoff; no cutoff or later input → unchanged. */
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

/** True if `dateValue` (Date | ISO | timestamp ms) is >= historyStartDate;
 * always true when there is no cutoff. */
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

/** Filters an array, accessing the date field via an accessor. */
export function filterByBrandHistory<T>(
  items: T[],
  getDate: (item: T) => Date | string | number | null | undefined,
  brand: Pick<Brand, 'historyStartDate'> | null | undefined,
): T[] {
  if (!getBrandHistoryStartISO(brand)) return items;
  return items.filter((it) => passesBrandHistory(getDate(it), brand));
}
