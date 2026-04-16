import type { Product } from '../types';

/**
 * Καμπάνιες demo/τεστ: αν το όνομα ή το SKU περιέχει `demo` (case-insensitive), αγνόησέ τα.
 * Χρησιμοποιείται κεντρικά πριν από κάθε aggregate (KPIs, RFM, reports, exports).
 */
export function isDemoProduct(p: Pick<Product, 'name' | 'sku'> | { name?: string; sku?: string }): boolean {
  const needle = 'demo';
  const name = (p?.name || '').toString().toLowerCase();
  const sku = (p?.sku || '').toString().toLowerCase();
  return name.includes(needle) || sku.includes(needle);
}

/** Φίλτρο που αφαιρεί τα demo προϊόντα από λίστα. */
export function excludeDemoProducts<T extends Pick<Product, 'name' | 'sku'>>(items: T[]): T[] {
  return items.filter(p => !isDemoProduct(p));
}

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

/** Default Target Days of Stock — configurable per business */
export const DEFAULT_TOD = 60;

/** Assumed period length (days) for qty_sold_period */
const SALES_PERIOD_DAYS = 30;

/**
 * Calculate how many days the current stock will last based on sell-through rate.
 * Returns Infinity when qty_sold is 0 (no sales = stock lasts forever).
 * Returns 0 when stock_level is 0.
 */
export function getDaysOfStock(product: Product): number {
  const level = product.stock_level ?? 0;
  if (level <= 0) return 0;
  const qtySold = product.qty_sold_period ?? 0;
  if (qtySold <= 0) return Infinity;
  const dailySales = qtySold / SALES_PERIOD_DAYS;
  return level / dailySales;
}

export type StockHealth = 'healthy' | 'excess' | 'low' | 'dead';

/**
 * Classify a product's stock health using TOD (Target Days of Stock).
 *
 * 1. Dead:    zero sales AND has stock (days_of_stock = Infinity)
 * 2. Low:     days_of_stock ≤ TOD / 2
 * 3. Excess:  days_of_stock > TOD × 2
 * 4. Healthy: TOD/2 < days_of_stock ≤ TOD × 2
 */
/** Resolve TOD for a product: supplier-specific if available, else default */
export function getProductTod(product: Product, supplierTodMap?: Map<string, number>): number {
  if (supplierTodMap && product.supplier) {
    const supplierTod = supplierTodMap.get(product.supplier);
    if (supplierTod != null && supplierTod > 0) return supplierTod;
  }
  return DEFAULT_TOD;
}

export function classifyStockHealth(product: Product, tod: number = DEFAULT_TOD): StockHealth {
  const level = product.stock_level ?? 0;
  if (level <= 0) return 'low';

  const dos = getDaysOfStock(product);

  if (dos === Infinity) return 'dead';
  if (dos <= tod / 2) return 'low';
  if (dos > tod * 2) return 'excess';
  return 'healthy';
}
