/**
 * useDecisionBuckets — συνδυάζει useProductSource + useProductSignals με τον classifier
 * για να επιστρέψει triage data έτοιμα για UI και AI prompts.
 *
 * Χρησιμοποιείται το ίδιο product feed με το WeightConfigurator (Firestore import ή,
 * σε Enterprise, procurement inventory) — όχι μόνο `products` collection.
 *
 * Έξοδος είναι deterministic memoized — επανυπολογίζεται μόνο όταν αλλάξουν
 * products/signals/thresholds.
 */

import { useMemo } from 'react';
import { useProductSource } from './useProductSource';
import { useProductSignals } from './useProductSignals';
import {
  classifyAll,
  DEFAULT_THRESHOLDS,
  BUCKET_DEFS,
  BUCKET_ORDER,
  type BucketThresholds,
  type ClassifyResult,
  type BucketId,
} from '../utils/decisionBuckets';

export interface UseDecisionBucketsResult extends ClassifyResult {
  isLoading: boolean;
  /** Total products που τρέξαμε (εξαιρώντας demo). */
  totalProducts: number;
  /** Συνολικό tied capital σε όλο το catalog (€). */
  totalTiedCapital: number;
  /** Buckets ταξινομημένα με προτεραιότητα urgent → review → opportunity. */
  bucketOrder: BucketId[];
  defs: typeof BUCKET_DEFS;
}

export function useDecisionBuckets(
  thresholds: BucketThresholds = DEFAULT_THRESHOLDS
): UseDecisionBucketsResult {
  const { products, isLoading: productsLoading } = useProductSource();
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
      } as ClassifyResult & { totalTiedCapital: number };
    }
    const r = classifyAll(products, getSignal, thresholds);
    const totalTiedCapital = r.assignments.reduce((s, a) => s + (a.tiedCapital || 0), 0);
    return { ...r, totalTiedCapital };
  }, [products, getSignal, thresholds, productsLoading]);

  return {
    ...result,
    isLoading: productsLoading || signalsLoading,
    totalProducts: products.length,
    bucketOrder: BUCKET_ORDER,
    defs: BUCKET_DEFS,
  };
}
