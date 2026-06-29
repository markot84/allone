/** Combines useProductSource + useProductSignals with the classifier into memoized triage data;
 * uses the same product feed as WeightConfigurator (Firestore import or procurement inventory). */

import { useMemo } from 'react';
import { useProductSource } from './useProductSource';
import { useProductSignals, type ProductSignal } from './useProductSignals';
import type { Product } from '../types';
import {
  classifyAll,
  DEFAULT_THRESHOLDS,
  BUCKET_DEFS,
  BUCKET_ORDER,
  type BucketThresholds,
  type ClassifyResult,
  type BucketId,
} from '../utils/decisionBuckets';

/** Metrics for the user: what is confirmed from sources vs estimated (cost × stock). */
export interface TriageDataQuality {
  skuCount: number;
  /** % of SKUs with a reliable demand window (e-shop connection or stock movement). */
  demandVerifiedPct: number;
  /** SKUs with at least one field from procurement. */
  skusWithProcurement: number;
  /** Sum of € where tied_capital comes from a procurement export. */
  tiedEurFromProcurement: number;
  /** Sum of € where tied_capital was computed as cost × stock. */
  tiedEurComputed: number;
  /** Other positive € (rare). */
  tiedEurOther: number;
  /** SKUs with stock > 0 but zero tied-capital estimate (usually missing cost). */
  skusStockWithoutCost: number;
}

function computeTriageDataQuality(
  products: Product[],
  getSignal: (sku: string) => ProductSignal | undefined
): TriageDataQuality {
  let demandOk = 0;
  let skusWithProcurement = 0;
  let tiedProc = 0;
  let tiedComp = 0;
  let tiedOther = 0;
  let stockNoCost = 0;

  for (const p of products) {
    const sku = (p.sku || p.id || '').trim();
    if (!sku) continue;

    const sig = getSignal(sku);
    const r = sig?.resolved;
    if (sig?.hasWindowSource) demandOk++;
    if (sig?.hasProcurement) skusWithProcurement++;

    const stock = r?.stock ?? p.stock_level ?? 0;
    const cost = r?.cost ?? p.cost_price;
    const tied =
      r?.tied_capital ??
      (typeof cost === 'number' && Number.isFinite(cost) ? cost * stock : 0);
    const src = sig?.provenance?.tied_capital ?? 'none';

    if (stock > 0 && (!Number.isFinite(tied) || tied <= 0)) {
      stockNoCost++;
    }

    if (typeof tied === 'number' && tied > 0) {
      if (src === 'procurement') tiedProc += tied;
      else if (src === 'computed') tiedComp += tied;
      else tiedOther += tied;
    }
  }

  const skuCount = products.length;
  const demandVerifiedPct =
    skuCount > 0 ? Math.min(100, Math.round((100 * demandOk) / skuCount)) : 0;

  return {
    skuCount,
    demandVerifiedPct,
    skusWithProcurement,
    tiedEurFromProcurement: +tiedProc.toFixed(2),
    tiedEurComputed: +tiedComp.toFixed(2),
    tiedEurOther: +tiedOther.toFixed(2),
    skusStockWithoutCost: stockNoCost,
  };
}

export interface UseDecisionBucketsResult extends ClassifyResult {
  isLoading: boolean;
  /** Total products processed (excluding demo). */
  totalProducts: number;
  /** Total tied capital across the whole catalog (€). */
  totalTiedCapital: number;
  /** Data-quality metrics for explicitly surfacing limitations. */
  dataQuality: TriageDataQuality | null;
  /** Buckets ordered by priority: urgent → review → opportunity. */
  bucketOrder: BucketId[];
  defs: typeof BUCKET_DEFS;
}

type UseDecisionBucketsOptions = {
  products?: Product[];
  maxProducts?: number;
};

export function useDecisionBuckets(
  thresholds: BucketThresholds = DEFAULT_THRESHOLDS,
  options: UseDecisionBucketsOptions = {}
): UseDecisionBucketsResult {
  // PER-167: when the caller injects products (e.g. WeightConfigurator's bounded in-stock set), do
  // NOT also fetch the full ~222k catalog here — the unconditional fetch was the page's slow load.
  const productSource = useProductSource({ maxProducts: options.maxProducts, enabled: !options.products });
  const products = options.products ?? productSource.products;
  const productsLoading = options.products ? false : productSource.isLoading;
  const { getSignal, isLoading: signalsLoading } = useProductSignals(products);

  const result = useMemo(() => {
    if (productsLoading || products.length === 0) {
      return {
        assignments: [],
        counts: {
          dead_capital: 0, stockout_risk: 0, hot_seller: 0, margin_bleeder: 0,
          slow_mover: 0, discontinue: 0, replenish_now: 0, new_or_unknown: 0,
        },
        topByBucket: {
          dead_capital: [], stockout_risk: [], hot_seller: [], margin_bleeder: [],
          slow_mover: [], discontinue: [], replenish_now: [], new_or_unknown: [],
        },
        tiedByBucket: {
          dead_capital: 0, stockout_risk: 0, hot_seller: 0, margin_bleeder: 0,
          slow_mover: 0, discontinue: 0, replenish_now: 0, new_or_unknown: 0,
        },
        unclassified: 0,
        totalTiedCapital: 0,
        dataQuality: null,
      } as ClassifyResult & { totalTiedCapital: number; dataQuality: null };
    }
    const r = classifyAll(products, getSignal, thresholds);
    const totalTiedCapital = r.assignments.reduce((s, a) => s + (a.tiedCapital || 0), 0);
    const dataQuality = computeTriageDataQuality(products, getSignal);
    return { ...r, totalTiedCapital, dataQuality };
  }, [products, getSignal, thresholds, productsLoading]);

  return {
    ...result,
    isLoading: productsLoading || signalsLoading,
    totalProducts: products.length,
    bucketOrder: BUCKET_ORDER,
    defs: BUCKET_DEFS,
  };
}
