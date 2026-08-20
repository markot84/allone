import type { Product } from '../types';

/** Ignore demo/test products (name or SKU contains `demo`, case-insensitive);
 * used before every aggregate (KPIs, RFM, reports, exports). */
export function isDemoProduct(p: Pick<Product, 'name' | 'sku'> | { name?: string; sku?: string }): boolean {
  const needle = 'demo';
  const name = (p?.name || '').toString().toLowerCase();
  const sku = (p?.sku || '').toString().toLowerCase();
  return name.includes(needle) || sku.includes(needle);
}

/** Filter that removes demo products from a list. */
export function excludeDemoProducts<T extends Pick<Product, 'name' | 'sku'>>(items: T[]): T[] {
  return items.filter(p => !isDemoProduct(p));
}

/** PER-293 — per-brand non-merchandise rules; mirrors functions/src/nonMerchandise.ts, keep in sync. */
export type NonMerchandiseRules = { categories?: string[]; nameContains?: string[] };

// Accent- AND case-insensitive so 'ΔΩΡΟΕΠΙΤΑΓΕΣ' matches 'Δωροεπιταγές'.
const fold = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

type NonStockedRow = Pick<Product, 'name' | 'sku'> & { category?: string };

/** Demo ∪ platform non-merchandise (plain lowercase, like the server) ∪ brand rules; stock analytics only. */
export function buildIsNonStocked(rules?: NonMerchandiseRules): (p: NonStockedRow) => boolean {
  const cats = (rules?.categories ?? []).map(fold).filter(Boolean);
  const needles = (rules?.nameContains ?? []).map(fold).filter(Boolean);
  return (p) => {
    if (isDemoProduct(p)) return true;
    const sku = (p?.sku || '').toString().trim().toLowerCase();
    const name = (p?.name || '').toString().trim().toLowerCase();
    if (sku === 'discount' || sku.includes('shipping') || name.includes('shipping πωλήσεων')) return true;
    if (cats.length && cats.includes(fold(p.category))) return true;
    if (needles.length) {
      const foldedName = fold(p.name);
      return needles.some(n => foldedName.includes(n));
    }
    return false;
  };
}

/** Filter that removes demo + non-merchandise products (platform rule + brand additions). */
export function excludeNonStockedProducts<T extends NonStockedRow>(items: T[], rules?: NonMerchandiseRules): T[] {
  const isNonStocked = buildIsNonStocked(rules);
  return items.filter(p => !isNonStocked(p));
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

/** Procurement/spreadsheet cell → `Product.first_available_date`; separates
 * Excel serial from epoch-ms so large numbers are not read as serials. */
export function normalizeSpreadsheetCellToFirstAvailableDate(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;

  const accept = (s: string): string | undefined => {
    const t = s.trim();
    if (!t) return undefined;
    return daysFromDate(t) !== null ? t : undefined;
  };

  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate?: unknown }).toDate === 'function') {
    const d = (raw as { toDate: () => Date }).toDate();
    if (!(d instanceof Date) || isNaN(d.getTime())) return undefined;
    return accept(d.toISOString().slice(0, 10));
  }

  const sec =
    typeof raw === 'object' && raw !== null && typeof (raw as { seconds?: number }).seconds === 'number'
      ? (raw as { seconds: number }).seconds
      : typeof raw === 'object' && raw !== null && typeof (raw as { _seconds?: number })._seconds === 'number'
        ? (raw as { _seconds: number })._seconds
        : undefined;
  if (typeof sec === 'number' && Number.isFinite(sec)) {
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return undefined;
    return accept(d.toISOString().slice(0, 10));
  }

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return undefined;
    return accept(raw.toISOString().slice(0, 10));
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1e11) {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return undefined;
      return accept(d.toISOString().slice(0, 10));
    }
    return accept(String(raw));
  }

  return accept(String(raw));
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

/** Catalog age in days. Returns -1 when no reliable date exists
 * (not the same as "0 days" = imported today). */
export function getStockAgeDays(product: Product): number {
  const stored = product.stock_age_days;
  if (typeof stored === 'number' && stored > 0) return stored;
  const fromDate = product.first_available_date ? daysFromDate(product.first_available_date) : null;
  if (fromDate !== null && fromDate >= 0) return fromDate;
  const created = toDate(product.createdAt);
  if (created && !isNaN(created.getTime())) {
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  }
  return -1;
}

/** Default Target Days of Stock — configurable per business */
export const DEFAULT_TOD = 60;

/** Assumed period length (days) for qty_sold_period */
const SALES_PERIOD_DAYS = 30;

/** PER-300: shelf units — available_stock also counts unreceived orders; mirrors effectiveStock in
 * functions/src/productIntelligenceAggregator.ts, keep in sync. */
export function getEffectiveStockLevel(product: Product): number {
  return product.stock_on_hand ?? product.stock_level ?? 0;
}

/** Days the current stock lasts at sell-through rate; Infinity when qty_sold is 0,
 * 0 when stock_level is 0. */
export function getDaysOfStock(product: Product): number {
  const level = getEffectiveStockLevel(product);
  if (level <= 0) return 0;
  const qtySold = product.qty_sold_period ?? 0;
  if (qtySold <= 0) return Infinity;
  const dailySales = qtySold / SALES_PERIOD_DAYS;
  return level / dailySales;
}

export type StockHealth = 'healthy' | 'excess' | 'low' | 'dead';

/** Classify stock health via TOD: dead (∞ days), low (≤TOD/2), excess (>TOD×2), else healthy. */
/** Build a supplier→TOD map: each supplier's own tod, else the brand default (config page), else
 * the platform floor. Products whose supplier isn't listed fall back via getProductTod. */
export function buildSupplierTodMap(
  suppliers: { name: string; tod?: number | null }[],
  brandDefaultTod: number = DEFAULT_TOD
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of suppliers) {
    if (!s.name) continue;
    m.set(s.name, s.tod != null && s.tod > 0 ? s.tod : brandDefaultTod);
  }
  return m;
}

/** Default supplier lead time (days) when neither the supplier nor the brand sets one. */
export const DEFAULT_LEAD_TIME_DAYS = 30;
/** Default reorder point as a multiple of lead time — warn 50% before the stock runs out. */
export const DEFAULT_REORDER_MULTIPLIER = 1.5;

/** Reorder point in days of cover: reorder once stock covers less than lead time × multiplier,
 *  so the replenishment lands before the shelf empties. */
export function getReorderPointDays(
  leadTime: number | null | undefined,
  brandDefaultLeadTime: number = DEFAULT_LEAD_TIME_DAYS,
  multiplier: number = DEFAULT_REORDER_MULTIPLIER,
): number {
  const lead = leadTime != null && leadTime > 0 ? leadTime : brandDefaultLeadTime;
  return Math.round(lead * multiplier);
}

/** Resolve TOD for a product: supplier-specific → brand default (config page) → platform floor. */
export function getProductTod(
  product: Product,
  supplierTodMap?: Map<string, number>,
  brandDefaultTod: number = DEFAULT_TOD
): number {
  if (supplierTodMap && product.supplier) {
    const supplierTod = supplierTodMap.get(product.supplier);
    if (supplierTod != null && supplierTod > 0) return supplierTod;
  }
  return brandDefaultTod;
}

export function classifyStockHealth(product: Product, tod: number = DEFAULT_TOD): StockHealth {
  const level = getEffectiveStockLevel(product);
  if (level <= 0) return 'low';

  const dos = getDaysOfStock(product);

  if (dos === Infinity) return 'dead';
  if (dos <= tod / 2) return 'low';
  if (dos > tod * 2) return 'excess';
  return 'healthy';
}

/** Enterprise procurement: aligns with `useProductSource`'s `priority_tag`, since
 * `classifyStockHealth` (DOS-only) tags everything as dead without qty. */
export function resolveStockHealth(
  product: Product,
  supplierTodMap?: Map<string, number>,
  useProcurementRowModel?: boolean,
  brandDefaultTod: number = DEFAULT_TOD
): StockHealth {
  if (useProcurementRowModel) {
    const tag = product.priority_tag;
    if (tag === 'dead' || tag === 'low' || tag === 'healthy' || tag === 'excess') {
      return tag;
    }
  }
  return classifyStockHealth(product, getProductTod(product, supplierTodMap, brandDefaultTod));
}

/** Delivery-note-first products have stock but no cost price yet; true when stock > 0 and
 * cost_price is missing/<=0 — shown as "price_pending" until the ERP invoice syncs. */
export function hasPricePending(product: Product): boolean {
  return getEffectiveStockLevel(product) > 0 && (product.cost_price == null || product.cost_price <= 0);
}

/** Same logic as `stockBucket` in `productIntelligenceAggregator` (Firebase); for
 * filters/tag when `priority_tag` is missing, to match aggregate & server pages. */
export function getProductIntelligenceStockBucket(product: Product): StockHealth {
  const stockLevel = getEffectiveStockLevel(product);
  if (stockLevel <= 0) return 'low';
  if (product.qty_sold_period == null) return 'healthy';
  if (product.qty_sold_period <= 0) return 'dead';
  const daysOfStock = stockLevel / ((product.qty_sold_period as number) / SALES_PERIOD_DAYS);
  if (daysOfStock <= 30) return 'low';
  if (daysOfStock > 120) return 'excess';
  return 'healthy';
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for period filter: imported = Firestore createdAt;
 * first_available = First Available column (Excel serial, as in stock age). */
export function getProductYmdForFilter(product: Product, mode: 'imported' | 'first_available'): string | null {
  if (mode === 'first_available') {
    const raw = product.first_available_date;
    if (!raw || !String(raw).trim()) return null;
    const str = String(raw).trim();
    const n = parseFloat(str);
    let d: Date;
    if (!isNaN(n) && n > 0) {
      d = new Date((n - 25569) * 86400 * 1000);
    } else {
      d = new Date(str);
    }
    if (isNaN(d.getTime())) return null;
    return ymdLocal(d);
  }
  const c = toDate(product.createdAt);
  if (!c || isNaN(c.getTime())) return null;
  return ymdLocal(c);
}
