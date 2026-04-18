import type { Product, SalesBasePresetId, SalesBaseScope } from '../types';
import { coerceToDate } from './coerceDate';

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

/**
 * Εμπορική προτεραιότητα 0–100 για το σενάριο Sales Optimization (υψηλό = χρειάζεται έμφαση).
 *
 * **Δεδομένα**
 * - `qty_sold_period` / `qty_sold_last_30d`: ερμηνεύονται ως ~τελευταίες 30 ημέρες (συνεπές με `getDaysOfStock`).
 * - Προαιρετικά από import/connector: `qty_sold_last_7d`, `qty_sold_last_90d`, `qty_sold_lifetime`, `last_sale_at`.
 * - Μόνο `qty_sold_period = 0` με απόθεμα: ενισχυμένη προτεραιότητα (επανενεργοποίηση· χωρίς lifetime δεν διαχωρίζουμε «ποτέ» από «σταμάτησε»).
 */
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
    const age = product.stock_age_days ?? 0;
    return age > 90 ? 85 : age > 30 ? 76 : 68;
  }

  if (!hasMultiWindow && (q30 === undefined || q30 === null)) return 42;

  if (typeof q7 === 'number' && q7 >= 8) return 18;
  if (typeof q7 === 'number' && q7 >= 1) return 28;
  if (typeof q30 === 'number' && q30 >= 20) return 22;
  if (typeof q30 === 'number' && q30 > 0) return 32;

  return 40;
}

/** Σύντομη ετικέτα για στήλη preview. */
export function salesMomentumLabel(product: Product): string {
  const s = calculateSalesMomentumScore(product);
  if (s >= 92) return 'Υψηλή';
  if (s >= 75) return 'Αυξημένη';
  if (s >= 50) return 'Μέτρια';
  if (s >= 30) return 'Χαμηλή';
  return 'Ενεργό';
}

export const SALES_BASE_PRESET_OPTIONS: {
  id: SalesBasePresetId;
  label: string;
  hint: string;
}[] = [
  { id: 'all', label: 'Όλα τα SKU', hint: 'Χωρίς φίλτρο ρυθμού πωλήσεων — μόνο τα φίλτρα πίνακα από κάτω.' },
  {
    id: 'never_sold',
    label: 'Χωρίς πωλήσεις (lifetime)',
    hint: 'Όταν υπάρχει στήλη lifetime = 0 (αλλιώς δεν εφαρμόζεται αυτόματα).',
  },
  {
    id: 'zero_last_7d',
    label: '0 πωλήσεις (7 ημέρες)',
    hint: 'Στήλη 7ημ. = 0, ή fallback από last sale όταν δεν υπάρχουν 7/30/90 πεδία.',
  },
  {
    id: 'zero_last_30d',
    label: '0 πωλήσεις (~30 ημέρες)',
    hint: 'Qty 30ημ. / Qty_Sold_Period = 0, ή fallback από last sale όταν λείπουν window πεδία.',
  },
  {
    id: 'zero_last_90d',
    label: '0 πωλήσεις (90 ημέρες)',
    hint: 'Στήλη 90ημ. = 0, ή fallback από last sale όταν δεν υπάρχουν 7/30/90 πεδία.',
  },
  {
    id: 'stalled_7_vs_90',
    label: '«Πάγωμα» πρόσφατα',
    hint: '0 στις 7 ημέρες αλλά υπήρχε παλαιότερη κίνηση, με fallback από last sale όταν λείπουν window πεδία.',
  },
  {
    id: 'cold_last_sale_30d',
    label: 'Χωρίς πώληση >30 ημέρες',
    hint: 'Από στήλη τελευταίας πώλης (last sale), με απόθεμα > 0.',
  },
];

function productBrandLabel(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  const s = p.supplier?.trim();
  return s ?? '';
}

/** Φίλτρα κειμένου (μάρκα / κατηγορία / αναζήτηση) πάνω στο catalog. */
export function productMatchesSalesBaseTextFilters(
  product: Product,
  brandFilter: string,
  categoryFilter: string,
  search: string,
): boolean {
  const bf = brandFilter.trim().toLowerCase();
  if (bf && !productBrandLabel(product).toLowerCase().includes(bf)) return false;
  const cf = categoryFilter.trim().toLowerCase();
  if (cf && !(product.category ?? '').toLowerCase().includes(cf)) return false;
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
  const q30 = product.qty_sold_last_30d ?? product.qty_sold_period;
  const q90 = product.qty_sold_last_90d;
  const life = product.qty_sold_lifetime;
  const lastSaleAt = product.last_sale_at;

  switch (preset) {
    case 'all':
      return true;
    case 'never_sold':
      return typeof life === 'number' && life === 0;
    case 'zero_last_7d':
      return hasZeroSalesInWindow(q7, lastSaleAt, 7) && stock > 0;
    case 'zero_last_30d':
      return hasZeroSalesInWindow(q30, lastSaleAt, 30) && stock > 0;
    case 'zero_last_90d':
      return hasZeroSalesInWindow(q90, lastSaleAt, 90) && stock > 0;
    case 'stalled_7_vs_90':
      if (typeof q7 === 'number' && q7 === 0 && typeof q90 === 'number' && q90 > 0) {
        return stock > 0;
      }
      return hasZeroSalesInWindow(q7, lastSaleAt, 7) && hasHistoricalSalesEvidence(product) && stock > 0;
    case 'cold_last_sale_30d': {
      const d = daysSince(product.last_sale_at);
      return d !== null && d > 30 && stock > 0;
    }
    default:
      return true;
  }
}

/** SKU που συμμετέχουν στη στρατηγική Sales Optimization (sales_base) σύμφωνα με το αποθηκευμένο scope. */
export function productParticipatesInSalesBase(product: Product, scope: SalesBaseScope | null | undefined): boolean {
  if (!scope) return true;
  if (scope.selectedProductIds && scope.selectedProductIds.length > 0) {
    return scope.selectedProductIds.includes(product.id);
  }
  if (!productMatchesSalesBaseTextFilters(product, scope.brandFilter, scope.categoryFilter, scope.search)) {
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
