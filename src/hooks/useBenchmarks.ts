import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import type { BenchmarkCohort, BenchmarkSelf } from '../types';

/**
 * The two halves of a benchmark: this brand's own values, and the cohort they are read against.
 *
 * Both are server-written (`functions/src/benchmarkAggregator.ts`). Nothing is computed here on
 * purpose — if the page derived its own marker from `ecommerce_summary` while the distribution came
 * from the aggregator, the two would drift the first time either formula was touched, and the bug
 * would look like a data problem rather than a code one.
 *
 * `cohortChain` arrives already filtered to published cohorts and ordered most-specific-first, so a
 * brand in a trade too small to publish still gets the widest comparison that survives the
 * k-anonymity floor. The loop below re-checks existence anyway: a cohort can be deleted between two
 * aggregator runs when its membership drops below the floor, and a missing document must read as
 * "no comparison" rather than as a failed page.
 */

export interface BenchmarkData {
  self: BenchmarkSelf | null;
  cohort: BenchmarkCohort | null;
}

async function fetchBenchmarks(brandId: string): Promise<BenchmarkData> {
  const selfSnap = await getDoc(doc(db, 'benchmark_self', brandId));
  if (!selfSnap.exists()) return { self: null, cohort: null };
  const self = selfSnap.data() as BenchmarkSelf;
  if (!self.eligible || !Array.isArray(self.cohortChain) || self.cohortChain.length === 0) {
    return { self, cohort: null };
  }

  for (const cohortId of self.cohortChain) {
    const cohortSnap = await getDoc(doc(db, 'benchmark_cohorts', cohortId));
    if (cohortSnap.exists()) return { self, cohort: cohortSnap.data() as BenchmarkCohort };
  }
  return { self, cohort: null };
}

export function useBenchmarks() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending, error } = useQuery({
    queryKey: ['benchmarks', brandId],
    queryFn: () => (brandId ? fetchBenchmarks(brandId) : Promise.resolve({ self: null, cohort: null })),
    // The aggregator runs once a day, so re-reading on every mount buys nothing.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!brandId,
  });

  return {
    self: data?.self ?? null,
    cohort: data?.cohort ?? null,
    isPending,
    error: error ?? null,
    /** Opted out, or not enough history/volume to be sampled — the page explains which. */
    unavailableReason: data?.self && !data.self.eligible ? data.self.reason ?? 'insufficient_data' : null,
  };
}
