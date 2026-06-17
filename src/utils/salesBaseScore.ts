import type { Product, SalesBaseCategorySource, SalesBasePresetId, SalesBaseScope } from '../types';
import { coerceToDate } from './coerceDate';
import { getStockAgeDays } from './productUtils';

/** Effective category per SKU: 'product' uses `product.category`; 'procurement' uses
 *  `procurement_status` then `procurement_category` then `category`. */
export function categoryForSource(
  product: Product,
  source: SalesBaseCategorySource | undefined,
): string {
  if (source === 'procurement') {
    return (
      product.procurement_status?.trim() ||
      product.procurement_category?.trim() ||
      product.category?.trim() ||
      ''
    );
  }
  return product.category?.trim() ?? '';
}

function daysSince(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const d = coerceToDate(iso.trim());
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function hasHistoricalSalesEvidence(product: Product): boolean {
  if (typeof product.qty_sold_lifetime === 'number') return product.qty_sold_lifetime > 0;
  if (typeof product.qty_sold_last_90d === 'number') return product.qty_sold_last_90d > 0;
  if (typeof product.qty_sold_last_30d === 'number') return product.qty_sold_last_30d > 0;
  if (typeof product.qty_sold_period === 'number') return product.qty_sold_period > 0;
  if (typeof product.qty_sold_last_7d === 'number') return product.qty_sold_last_7d > 0;
  if ((product.revenue_period ?? 0) > 0) return true;
  return daysSince(product.last_sale_at) !== null;
}

function hasZeroSalesInWindow(
  qty: number | undefined,
  lastSaleAt: string | undefined,
  days: number,
): boolean {
  if (typeof qty === 'number') return qty === 0;
  const lastDays = daysSince(lastSaleAt);
  if (lastDays === null) return false;
  return lastDays > days;
}

/** Strict "0 sales in last N days": the matching window field (or lifetime=0, or last_sale_at>N)
 *  is authoritative, with no cross-window fallback since imported windows may be stale. */
function hasZeroSalesByAvailableWindows(product: Product, days: 7 | 30 | 90): boolean {
  const life = product.qty_sold_lifetime;
  if (typeof life === 'number' && life === 0) return true;

  const lastSaleAt = product.last_sale_at;

  if (days === 7) {
    if (typeof product.qty_sold_last_7d === 'number') return product.qty_sold_last_7d === 0;
    return hasZeroSalesInWindow(undefined, lastSaleAt, 7);
  }

  if (days === 30) {
    if (typeof product.qty_sold_last_30d === 'number') return product.qty_sold_last_30d === 0;
    return hasZeroSalesInWindow(undefined, lastSaleAt, 30);
  }

  if (typeof product.qty_sold_last_90d === 'number') return product.qty_sold_last_90d === 0;
  return hasZeroSalesInWindow(undefined, lastSaleAt, 90);
}

/** Commercial priority 0–100 for the Sales Optimization scenario (high = needs emphasis);
 *  `qty_sold_period`/`qty_sold_last_30d` read as ~last 30 days, `qty_sold_period=0` with stock boosts priority. */
export function calculateSalesMomentumScore(product: Product): number {
  const stock = product.stock_level ?? 0;
  if (stock <= 0) return 12;

  const q7 = product.qty_sold_last_7d;
  const q30 = product.qty_sold_last_30d ?? product.qty_sold_period;
  const q90 = product.qty_sold_last_90d;
  const life = product.qty_sold_lifetime;
  const rev = product.revenue_period ?? 0;
  const lastDays = daysSince(product.last_sale_at);

  const hasMultiWindow =
    typeof q7 === 'number' ||
    typeof q90 === 'number' ||
    typeof life === 'number' ||
    lastDays !== null;

  if (typeof life === 'number' && life === 0) return 99;

  if (typeof q7 === 'number' && q7 === 0 && typeof q90 === 'number' && q90 > 0) return 96;
  if (typeof q30 === 'number' && q30 === 0 && typeof q90 === 'number' && q90 > 0) return 92;
  if (typeof q30 === 'number' && q30 === 0 && rev > 0) return 90;

  if (lastDays !== null) {
    if (lastDays > 90) return 88;
    if (lastDays > 30) return 76;
    if (lastDays > 7) return 60;
  }

  if (!hasMultiWindow && typeof q30 === 'number' && q30 === 0) {
    const age = getStockAgeDays(product);
    if (age < 0) return 42;
    return age > 90 ? 85 : age > 30 ? 76 : 68;
  }

  if (!hasMultiWindow && (q30 === undefined || q30 === null)) return 42;

  if (typeof q7 === 'number' && q7 >= 8) return 18;
  if (typeof q7 === 'number' && q7 >= 1) return 28;
  if (typeof q30 === 'number' && q30 >= 20) return 22;
  if (typeof q30 === 'number' && q30 > 0) return 32;

  return 40;
}

/** Short label for the preview column. */
export function salesMomentumLabel(product: Product): string {
  const s = calculateSalesMomentumScore(product);
  if (s >= 92) return 'Υψηλή';
  if (s >= 75) return 'Αυξημένη';
  if (s >= 50) return 'Μέτρια';
  if (s >= 30) return 'Χαμηλή';
  return 'Ενεργό';
}

/** Preset grouping for the Sales Optimization modal UI. */
export type SalesBasePresetGroup = 'all' | 'zero_window' | 'other';

export const SALES_BASE_PRESET_OPTIONS: {
  id: SalesBasePresetId;
  label: string;
  hint: string;
  group: SalesBasePresetGroup;
}[] = [
  {
    id: 'all',
    label: 'Όλα τα SKU',
    hint: 'Χωρίς φίλτρο ρυθμού πωλήσεων — εφαρμόζονται μόνο τα φίλτρα μάρκας/κατηγορίας/αναζήτησης.',
    group: 'all',
  },
  // ── Left column: 0 sales within a time window ─────────────────────────
  {
    id: 'zero_last_7d',
    label: '0 πωλήσεις (7 ημέρες)',
    hint: 'Καμία μείωση αποθέματος τις τελευταίες 7 ημ. (από orders connector ή κινητικότητα αποθέματος).',
    group: 'zero_window',
  },
  {
    id: 'zero_last_30d',
    label: '0 πωλήσεις (30 ημέρες)',
    hint: 'Καμία μείωση αποθέματος τις τελευταίες 30 ημ. (από orders connector ή κινητικότητα αποθέματος).',
    group: 'zero_window',
  },
  {
    id: 'zero_last_90d',
    label: '0 πωλήσεις (90 ημέρες)',
    hint: 'Καμία μείωση αποθέματος τις τελευταίες 90 ημ. (από orders connector ή κινητικότητα αποθέματος).',
    group: 'zero_window',
  },
  // ── Right column: No sales & stalled ──────────────────────────────────
  {
    id: 'never_sold',
    label: 'Χωρίς πωλήσεις (lifetime)',
    hint: 'lifetime=0, ή στο catalog ≥30 ημ. χωρίς καμία κίνηση αποθέματος και χωρίς ημ/νία τελευταίας πώλησης.',
    group: 'other',
  },
  {
    id: 'cold_last_sale_30d',
    label: 'Χωρίς πώληση >30 ημέρες',
    hint: 'Η τελευταία καταγεγραμμένη πώληση (last_sale_at) είναι πάνω από 30 ημ. πίσω, με απόθεμα > 0.',
    group: 'other',
  },
  {
    id: 'stalled_7_vs_90',
    label: '«Πάγωμα» πρόσφατα',
    hint: '0 πωλήσεις τις 7 ημ. αλλά υπήρχε κίνηση στις προηγούμενες 90 ημ. (ή lifetime > 0).',
    group: 'other',
  },
];

function productBrandLabel(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  const s = p.supplier?.trim();
  return s ?? '';
}

/** Text filters (brand / category / search) over the catalog. */
export function productMatchesSalesBaseTextFilters(
  product: Product,
  brandFilter: string,
  categoryFilter: string,
  search: string,
  excludedCategories?: string[] | null,
  categorySource?: SalesBaseCategorySource,
): boolean {
  const bf = brandFilter.trim().toLowerCase();
  if (bf && !productBrandLabel(product).toLowerCase().includes(bf)) return false;
  const cf = categoryFilter.trim().toLowerCase();
  const productCategory = categoryForSource(product, categorySource);
  if (cf && !productCategory.toLowerCase().includes(cf)) return false;
  if (excludedCategories && excludedCategories.length > 0) {
    const cat = productCategory.toLowerCase();
    if (excludedCategories.some((ex) => ex.trim().toLowerCase() === cat)) return false;
  }
  const q = search.trim().toLowerCase();
  if (q) {
    const hay = `${product.name ?? ''} ${product.sku ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function productMatchesSalesBasePreset(product: Product, preset: SalesBasePresetId): boolean {
  const stock = product.stock_level ?? 0;
  const q7 = product.qty_sold_last_7d;
  const q90 = product.qty_sold_last_90d;
  const life = product.qty_sold_lifetime;

  switch (preset) {
    case 'all':
      return true;
    case 'never_sold': {
      // Authoritative: import lifetime field
      if (typeof life === 'number') return life === 0;
      // Fallback (no lifetime field): no 90d sale trace, no last-sale date, and in
      // catalog >=30 days so the absence of sales is meaningful (not newly added).
      const q90 = product.qty_sold_last_90d;
      const noRecentSales = typeof q90 === 'number' ? q90 === 0 : false;
      const noLastSale = !product.last_sale_at;
      const ageInCatalog = getStockAgeDays(product);
      const oldEnough = ageInCatalog >= 30;
      return noRecentSales && noLastSale && oldEnough && stock > 0;
    }
    case 'zero_last_7d':
      return hasZeroSalesByAvailableWindows(product, 7) && stock > 0;
    case 'zero_last_30d':
      return hasZeroSalesByAvailableWindows(product, 30) && stock > 0;
    case 'zero_last_90d':
      return hasZeroSalesByAvailableWindows(product, 90) && stock > 0;
    case 'stalled_7_vs_90':
      if (typeof q7 === 'number' && q7 === 0 && typeof q90 === 'number' && q90 > 0) {
        return stock > 0;
      }
      return hasZeroSalesByAvailableWindows(product, 7) && hasHistoricalSalesEvidence(product) && stock > 0;
    case 'cold_last_sale_30d': {
      const d = daysSince(product.last_sale_at);
      return d !== null && d > 30 && stock > 0;
    }
    default:
      return true;
  }
}

/** SKUs participating in the Sales Optimization (sales_base) strategy per the saved scope. */
export function productParticipatesInSalesBase(product: Product, scope: SalesBaseScope | null | undefined): boolean {
  if (!scope) return true;
  if (scope.selectedProductIds && scope.selectedProductIds.length > 0) {
    return scope.selectedProductIds.includes(product.id);
  }
  if (
    !productMatchesSalesBaseTextFilters(
      product,
      scope.brandFilter,
      scope.categoryFilter,
      scope.search,
      scope.excludedCategories ?? null,
      scope.categorySource,
    )
  ) {
    return false;
  }
  return productMatchesSalesBasePreset(product, scope.preset);
}

export function filterProductsBySalesBaseScope(
  products: Product[],
  scope: SalesBaseScope | null | undefined,
): Product[] {
  if (!scope) return products;
  const filtered = products.filter((p) => productParticipatesInSalesBase(p, scope));
  return filtered.length > 0 ? filtered : products;
}
