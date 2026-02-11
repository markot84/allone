import type { Product } from '../types';

/** Days from date string (Excel serial or ISO) to today */
function daysFromDate(val: string): number | null {
  if (!val || !String(val).trim()) return null;
  const str = String(val).trim();
  const n = parseFloat(str);
  let date: Date;
  if (!isNaN(n) && n > 0) {
    date = new Date((n - 25569) * 86400 * 1000); // Excel serial → JS Date
  } else {
    date = new Date(str);
  }
  if (isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/** Date from Firestore Timestamp or ISO string */
function toDate(val: Product['createdAt']): Date | null {
  if (!val) return null;
  if (typeof val === 'object' && 'toDate' in val && typeof val.toDate === 'function') {
    return val.toDate();
  }
  if (val instanceof Date) return val;
  if (typeof val === 'string') return new Date(val);
  return null;
}

/** Resolve stock age: stock_age_days → first_available_date → createdAt (import date) */
export function getStockAgeDays(product: Product): number {
  const stored = product.stock_age_days ?? 0;
  if (stored > 0) return stored;
  const fromDate = product.first_available_date ? daysFromDate(product.first_available_date) : null;
  if (fromDate !== null && fromDate >= 0) return fromDate;
  // Fallback: μέρες από ημερομηνία import (createdAt)
  const created = toDate(product.createdAt);
  if (created && !isNaN(created.getTime())) {
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  }
  return 0;
}
