/**
 * Υπολογίζει τα `custom_label_0..4` του Ads Feed για κάθε προϊόν, βάσει
 * της ενεργής εμπορικής στρατηγικής (active scenario + scopes + overlays).
 *
 * label_0 = κύρια στρατηγική του προϊόντος.
 * label_1..4 = επιπλέον στρατηγικές στις οποίες συμμετέχει το ίδιο SKU
 *              (mixed sub-scenarios, seasonal, triage bucket, sales/price scope).
 *
 * Δεν αγγίζει benchmarks (αυτά έρχονται async). Αν χρειαστούν, επεκτείνεται.
 */
import type { ActiveStrategy } from '../hooks/useActiveStrategy';
import type { Product } from '../types';
import { scenarios } from '../data';
import { productParticipatesInSalesBase } from './salesBaseScore';

export interface StrategyLabelSet {
  custom_label_0: string;
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
  custom_label_4: string;
  /** Όλες οι ετικέτες (δίχως padding), για debugging / preview. */
  all: string[];
}

const EMPTY_LABELS: StrategyLabelSet = {
  custom_label_0: '',
  custom_label_1: '',
  custom_label_2: '',
  custom_label_3: '',
  custom_label_4: '',
  all: [],
};

function scenarioName(id: string | undefined | null): string {
  if (!id) return '';
  return scenarios.find((s) => s.id === id)?.name ?? id;
}

export function getProductStrategyLabels(
  product: Product,
  activeStrategy: ActiveStrategy | null | undefined
): StrategyLabelSet {
  if (!activeStrategy) return EMPTY_LABELS;

  const labels: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    if (labels.includes(trimmed)) return;
    labels.push(trimmed);
  };

  // 1) Κύρια εμπορική πολιτική (ή τα 2 μέλη του Mixed)
  if (activeStrategy.scenarioId === 'mixed' && activeStrategy.mixConfig) {
    push(scenarioName(activeStrategy.mixConfig.scenarioA));
    push(scenarioName(activeStrategy.mixConfig.scenarioB));
  } else {
    push(scenarioName(activeStrategy.scenarioId));
  }

  // 2) Sales Optimization scope (αν το SKU συμμετέχει)
  if (
    activeStrategy.salesBaseScope &&
    productParticipatesInSalesBase(product, activeStrategy.salesBaseScope)
  ) {
    push('Sales Optimization');
  }

  // 3) Price Benchmarking scope — μετράει μόνο ως allowlist (χωρίς benchmarks)
  if (activeStrategy.priceBenchmarkScope) {
    const allow = activeStrategy.priceBenchmarkScope.selectedProductIds;
    if (!allow || allow.length === 0 || allow.includes(product.id)) {
      push('Price Benchmarking');
    }
  }

  // 4) Seasonal Discount overlay (περίοδος εκπτώσεων)
  if (activeStrategy.seasonalDiscount) {
    const sd = activeStrategy.seasonalDiscount;
    const inScope =
      sd.scope === 'all' ||
      (sd.scope === 'categories' &&
        Array.isArray(sd.selectedCategories) &&
        sd.selectedCategories.some(
          (c) => c.toLowerCase() === (product.category || '').toLowerCase()
        )) ||
      (sd.scope === 'products' &&
        Array.isArray(sd.selectedProductIds) &&
        sd.selectedProductIds.includes(product.id));
    if (inScope) {
      push(`Seasonal: ${sd.periodName || 'Discount'}`);
    }
  }

  // 5) Παράλληλη εποχιακή πρόταση
  if (activeStrategy.seasonalProposal) {
    push(`Seasonal: ${activeStrategy.seasonalProposal.periodName}`);
  }

  // 6) Triage bucket (αν το SKU είναι στο snapshot)
  if (activeStrategy.triageOrigin) {
    const t = activeStrategy.triageOrigin;
    const matches =
      (t.skus && product.sku && t.skus.includes(product.sku)) ||
      (t.productIds && t.productIds.includes(product.id));
    if (matches) {
      push(t.label);
    }
  }

  const top5 = labels.slice(0, 5);
  return {
    custom_label_0: top5[0] ?? '',
    custom_label_1: top5[1] ?? '',
    custom_label_2: top5[2] ?? '',
    custom_label_3: top5[3] ?? '',
    custom_label_4: top5[4] ?? '',
    all: labels,
  };
}
