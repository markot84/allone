import type { Product, ProfitMaxScope, SalesBaseCategorySource, SalesBasePresetId, SalesBaseScope } from '../types';
import { coerceToDate } from './coerceDate';
import { getDaysOfStock, getProductTod, getStockAgeDays } from './productUtils';

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

/** Hot-first 0–100 score for positive presets (PER-302): monotone in 30d velocity + recency bonus — the cold-first momentum scale is branch-ordered, so 100−x is not a valid inversion. */
export function calculateSalesHeatScore(product: Product): number {
  if ((product.stock_level ?? 0) <= 0) return 12;
  // max() not ??: raw q-windows are zero-defaulted for SKUs the e-shop enrichment misses.
  const q30 = Math.max(product.qty_sold_last_30d ?? 0, product.qty_sold_period ?? 0);
  const d = daysSince(product.last_sale_at);
  let s = 20 + Math.min(50, q30 * 2.5);
  if ((product.qty_sold_last_7d ?? 0) > 0 || (d !== null && d <= 7)) s += 30;
  else if (d !== null && d <= 30) s += 15;
  return Math.min(100, s);
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

/** Preset grouping for the Sales Optimization modal UI (PER-302: positive = left column). */
export type SalesBasePresetGroup = 'all' | 'positive' | 'zero_window' | 'other';

export const SALES_BASE_PRESET_OPTIONS: {
  id: SalesBasePresetId;
  label: string;
  hint: string;
  group: SalesBasePresetGroup;
  /** Hidden from the picker unless it is the saved preset (saved strategies keep matching). */
  retired?: boolean;
}[] = [
  {
    id: 'all',
    label: 'Όλα τα SKU',
    hint: 'Χωρίς φίλτρο ρυθμού πωλήσεων — εφαρμόζονται μόνο τα φίλτρα μάρκας/κατηγορίας/αναζήτησης.',
    group: 'all',
  },
  // ── Left column: positive sales scenarios (PER-302) ───────────────────
  {
    id: 'sold_last_30d',
    label: 'Πωλήσεις (30 ημέρες)',
    hint: 'Τουλάχιστον μία πώληση τις τελευταίες 30 ημ. (ενδέχεται να μην έχει πωλήσεις τις τελευταίες 7 ημ.).',
    group: 'positive',
  },
  {
    id: 'sold_last_90d',
    label: 'Πωλήσεις (90 ημέρες)',
    hint: 'Τουλάχιστον μία πώληση τις τελευταίες 90 ημ. (ή τελευταία πώληση εντός 90 ημ.).',
    group: 'positive',
  },
  {
    id: 'sold_lifetime',
    label: 'Με πωλήσεις (lifetime)',
    hint: 'Έχει καταγεγραμμένη πώληση οποιαδήποτε στιγμή, με απόθεμα > 0.',
    group: 'positive',
  },
  {
    id: 'fast_low_cover',
    label: 'Ταχυκίνητα — κίνδυνος εξάντλησης',
    hint: 'Πουλάει και το τρέχον απόθεμα καλύπτει λίγες ημέρες — προτεραιότητα σε προβολή/αναπλήρωση.',
    group: 'positive',
  },
  // ── Right column: negative scenarios (0 sales / stalled) ──────────────
  {
    id: 'zero_last_7d',
    label: '0 πωλήσεις (7 ημέρες)',
    hint: 'Καμία μείωση αποθέματος τις τελευταίες 7 ημ. (από orders connector ή κινητικότητα αποθέματος).',
    group: 'zero_window',
    retired: true,
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
    retired: true,
  },
  {
    id: 'stalled_7_vs_90',
    label: '«Πάγωμα» πρόσφατα',
    hint: '0 πωλήσεις τις 7 ημ. αλλά υπήρχε κίνηση στις προηγούμενες 90 ημ. (ή lifetime > 0).',
    group: 'other',
  },
];

/** Positive presets rank hot sellers first (momentum scale is cold-first — see compositeScore). */
export function isPositiveSalesPreset(preset: SalesBasePresetId | undefined | null): boolean {
  return SALES_BASE_PRESET_OPTIONS.some((o) => o.id === preset && o.group === 'positive');
}

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
    // Positive presets (PER-302) read qty_sold_period/last_sale_at — raw q-windows are zero-defaulted for SKUs the e-shop enrichment misses (e.g. in-store sales).
    case 'sold_last_30d': {
      const q30 = product.qty_sold_last_30d;
      return Math.max(q30 ?? 0, product.qty_sold_period ?? 0) > 0 && stock > 0;
    }
    case 'sold_last_90d': {
      const d = daysSince(product.last_sale_at);
      return (
        ((q90 ?? 0) > 0 || (product.qty_sold_period ?? 0) > 0 || (d !== null && d <= 90)) &&
        stock > 0
      );
    }
    case 'sold_lifetime':
      return hasHistoricalSalesEvidence(product) && stock > 0;
    case 'fast_low_cover': {
      // classifyStockHealth 'low' semantics (≤ TOD/2, default TOD); dos > 0 excludes the zero-stock sentinel. ponytail: per-supplier TOD map not threaded here.
      const dos = getDaysOfStock(product);
      return (product.qty_sold_period ?? 0) > 0 && stock > 0 && dos > 0 && dos <= getProductTod(product) / 2;
    }
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

/** Exact-match scope predicate; '' = dimension off. */
export function productInProfitMaxScope(p: Product, scope?: ProfitMaxScope | null): boolean {
  if (!scope) return true;
  return (
    (!scope.brandFilter || (p.brand || '') === scope.brandFilter) &&
    (!scope.subcategoryFilter || (p.subcategory || '') === scope.subcategoryFilter) &&
    (!scope.productTypeFilter || (p.product_type || '') === scope.productTypeFilter)
  );
}

export function filterProductsByProfitMaxScope(products: Product[], scope?: ProfitMaxScope | null): Product[] {
  if (!scope || (!scope.brandFilter && !scope.subcategoryFilter && !scope.productTypeFilter)) return products;
  return products.filter((p) => productInProfitMaxScope(p, scope));
}

export function filterProductsBySalesBaseScope(
  products: Product[],
  scope: SalesBaseScope | null | undefined,
): Product[] {
  if (!scope) return products;
  const filtered = products.filter((p) => productParticipatesInSalesBase(p, scope));
  return filtered.length > 0 ? filtered : products;
}
