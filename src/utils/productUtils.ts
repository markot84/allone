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

/**
 * Κελί procurement / spreadsheet → `Product.first_available_date`.
 * Διαχωρίζει Excel serial από epoch-ms ώστε μεγάλοι αριθμοί να μην ερμηνεύονται ως serial.
 */
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

/** Ηλικία καταλόγου σε ημέρες. Επιστρέφει -1 όταν δεν υπάρχει αξιόπιστη ημερομηνία
 * (όχι το ίδιο με «0 ημ.» = εισαγωγή σήμερα). */
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

export function getEffectiveStockLevel(product: Product): number {
  return product.available_stock ?? product.stock_on_hand ?? product.stock_level ?? 0;
}

/**
 * Calculate how many days the current stock will last based on sell-through rate.
 * Returns Infinity when qty_sold is 0 (no sales = stock lasts forever).
 * Returns 0 when stock_level is 0.
 */
export function getDaysOfStock(product: Product): number {
  const level = getEffectiveStockLevel(product);
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
  const level = getEffectiveStockLevel(product);
  if (level <= 0) return 'low';

  const dos = getDaysOfStock(product);

  if (dos === Infinity) return 'dead';
  if (dos <= tod / 2) return 'low';
  if (dos > tod * 2) return 'excess';
  return 'healthy';
}

/**
 * Για Enterprise procurement: τα KPI (κάρτες) βασίζονται σε αξιολόγηση/ανατροφοδότηση
 * και συμφωνούν με το `priority_tag` που χτίζει το `useProductSource`.
 * Το κλασικό `classifyStockHealth` χρησιμοποιεί μόνο DOS από πωλήσεις· χωρίς qty
 * επιστρέφει ∞ και τα εμφανίζει όλα ως dead — αποσυγχρονίζει τον πίνακα από τις κάρτες.
 */
export function resolveStockHealth(
  product: Product,
  supplierTodMap?: Map<string, number>,
  useProcurementRowModel?: boolean
): StockHealth {
  if (useProcurementRowModel) {
    const tag = product.priority_tag;
    if (tag === 'dead' || tag === 'low' || tag === 'healthy' || tag === 'excess') {
      return tag;
    }
  }
  return classifyStockHealth(product, getProductTod(product, supplierTodMap));
}

/**
 * Ίδια λογική με `stockBucket` στο `productIntelligenceAggregator` (Firebase).
 * Για φίλτρα πίνακα / tag όταν το import δεν φέρει `priority_tag`, ώστε να συμφωνούν με aggregate & server pages.
 */
export function getProductIntelligenceStockBucket(product: Product): StockHealth {
  const stockLevel = getEffectiveStockLevel(product);
  const qtySoldPeriod = product.qty_sold_period ?? 0;
  if (stockLevel <= 0) return 'low';
  if (qtySoldPeriod <= 0) return 'dead';
  const daysOfStock = stockLevel / (qtySoldPeriod / SALES_PERIOD_DAYS);
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

/**
 * YYYY-MM-DD για φίλτρο περιόδου στο Product Intelligence.
 * - imported: Firestore createdAt / import
 * - first_available: στήλη First Available (και Excel serial όπως στο stock age)
 */
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
