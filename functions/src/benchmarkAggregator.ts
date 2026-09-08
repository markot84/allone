import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';

/**
 * Cross-eshop benchmarking.
 *
 * The platform holds the order history of every connected e-shop, which makes one question
 * answerable that no single brand can answer alone: "is this number good?". A brand knows its AOV
 * is 62 EUR; it does not know that the median e-shop in its trade is at 48 EUR. That comparison is
 * the whole product, and it is the reason this file exists.
 *
 * It reads `ecommerce_summary/{brandId}` rather than the raw order collections. Everything the
 * benchmark needs is already aggregated there by `ecommerceAggregator` — one document per brand
 * instead of hundreds of thousands of orders — so a full rebuild across the estate costs a few
 * hundred reads.
 *
 * Two rules govern what comes out, and they are the difference between a benchmark and a leak:
 *
 *   1. A cohort is published only when at least `BENCHMARK_MIN_COHORT_BRANDS` brands are in it.
 *      Below that, a "median" is a photograph of a named competitor.
 *   2. No absolute figure ever crosses a brand boundary. The cohort documents carry ratios, indices
 *      and percentiles only. Revenue enters as a size *band* and is dropped immediately after. A
 *      reader of `benchmark_cohorts/*` cannot recover any single shop's turnover from it.
 *
 * `benchmark_self/{brandId}` is the other half: the brand's own values for the same metrics,
 * computed here with the same code so the marker on the chart and the distribution behind it can
 * never drift apart the way two parallel implementations eventually do.
 */

let _db: Firestore;
function db(): Firestore {
  if (!_db) _db = getFirestore();
  return _db;
}

/** Trade classification. Assigned by a Super Admin — never inferred, because a wrong cohort is a
 *  wrong benchmark stated with full confidence. Brands without one land in `unclassified`, which
 *  benchmarks against the whole estate rather than against nothing. */
export const BENCHMARK_VERTICALS = [
  'fashion',
  'footwear',
  'sports',
  'beauty',
  'health_pharmacy',
  'electronics',
  'home_garden',
  'food_beverage',
  'baby_kids',
  'pets',
  'diy_industrial',
  'books_media',
  'jewellery_watches',
  'automotive',
  'other',
] as const;

export type BenchmarkVertical = (typeof BENCHMARK_VERTICALS)[number];
export type BenchmarkVerticalKey = BenchmarkVertical | 'unclassified';

/** k-anonymity floor. Five is the smallest cohort where a quartile still describes a group rather
 *  than a handful of identifiable shops. */
export const BENCHMARK_MIN_COHORT_BRANDS = 5;

/** A shop with a dozen orders is a test account, and it would drag a percentile more than it
 *  informs it. */
const MIN_ORDERS_TO_QUALIFY = 50;

/** Trailing-12-month revenue bands (EUR). Banding on TTM rather than on lifetime revenue keeps an
 *  old small shop from being compared against a young large one. */
const SIZE_BANDS: { id: BenchmarkSizeBand; maxTtmRevenue: number }[] = [
  { id: 'micro', maxTtmRevenue: 100_000 },
  { id: 'small', maxTtmRevenue: 500_000 },
  { id: 'mid', maxTtmRevenue: 2_000_000 },
  { id: 'large', maxTtmRevenue: Number.POSITIVE_INFINITY },
];

export type BenchmarkSizeBand = 'micro' | 'small' | 'mid' | 'large';

/** The metrics that cross a brand boundary. Every one is a ratio or an index; none is a euro
 *  amount. Adding a metric here means checking that property still holds. */
export const BENCHMARK_METRIC_IDS = [
  'aov',
  'growthYoY',
  'ordersPerCustomer',
  'championsShare',
  'directChannelShare',
] as const;

export type BenchmarkMetricId = (typeof BENCHMARK_METRIC_IDS)[number];

/** `n` travels with every distribution: a p50 over 6 brands and one over 60 are different claims,
 *  and the UI says which it is showing. */
export interface BenchmarkDistribution {
  p25: number;
  p50: number;
  p75: number;
  n: number;
}

export interface BenchmarkSeasonalityPoint {
  /** Calendar month, `01`–`12`. */
  month: string;
  /** Median index across the cohort, 100 = that cohort's average month. */
  index: number;
  n: number;
}

interface BrandSample {
  brandId: string;
  vertical: BenchmarkVerticalKey;
  sizeBand: BenchmarkSizeBand;
  metrics: Partial<Record<BenchmarkMetricId, number>>;
  /** 12 indices, January first. 100 = this brand's own average month. */
  seasonality: number[] | null;
}

type SummaryDoc = {
  aov?: number;
  orderCount?: number;
  revenueByMonth?: Record<string, number>;
  revenueBySalesChannel?: Record<string, number>;
  connectedPlatforms?: string[];
};

type RfmSegment = { id?: string; count?: number; orders?: number };

/** AOV is the one metric that looks like money but is safe to share: it is a ratio, it does not
 *  disclose volume, and it is meaningless without the order count that stays behind. */
function readAov(summary: SummaryDoc): number | null {
  const aov = summary.aov;
  return typeof aov === 'number' && Number.isFinite(aov) && aov > 0 ? aov : null;
}

/** Calendar months present in the summary, `YYYY-MM`, oldest first. The aggregator writes an
 *  `unknown` bucket for orders with no usable date; it is not a month. */
function sortedMonths(revenueByMonth: Record<string, number>): string[] {
  return Object.keys(revenueByMonth)
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort();
}

/** The last complete calendar month. The current month is always a partial figure, and comparing a
 *  partial month against a whole one manufactures a decline every time the report is opened. */
function lastCompleteMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; the previous month in 1-based terms
  const d = month === 0 ? { y: year - 1, m: 12 } : { y: year, m: month };
  return `${d.y}-${String(d.m).padStart(2, '0')}`;
}

/** `count` months ending at `endMonth` inclusive, oldest first. */
function monthWindow(endMonth: string, count: number): string[] {
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const zeroBased = endMonthNum - 1 - back;
    const year = endYear + Math.floor(zeroBased / 12);
    const month = ((zeroBased % 12) + 12) % 12;
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
  }
  return months;
}

function sumMonths(revenueByMonth: Record<string, number>, months: string[]): number {
  return months.reduce((sum, month) => sum + (revenueByMonth[month] ?? 0), 0);
}

/** Trailing-twelve-month revenue. Used for banding only, and never written to a cohort document. */
function ttmRevenue(revenueByMonth: Record<string, number>, endMonth: string): number {
  return sumMonths(revenueByMonth, monthWindow(endMonth, 12));
}

function sizeBandFor(ttm: number): BenchmarkSizeBand {
  return (SIZE_BANDS.find((band) => ttm < band.maxTtmRevenue) ?? SIZE_BANDS[SIZE_BANDS.length - 1]).id;
}

/**
 * Year-on-year growth of the last 12 complete months against the 12 before them.
 *
 * Needs 24 months of history and a non-trivial prior year. A shop that opened 14 months ago has no
 * honest YoY number, so it contributes to every other metric and abstains from this one — which is
 * why suppression is per metric, not per brand.
 */
function readGrowthYoY(revenueByMonth: Record<string, number>, endMonth: string): number | null {
  const months = sortedMonths(revenueByMonth);
  if (months.length < 24) return null;
  const recent = sumMonths(revenueByMonth, monthWindow(endMonth, 12));
  const priorEnd = monthWindow(endMonth, 13)[0];
  const prior = sumMonths(revenueByMonth, monthWindow(priorEnd, 12));
  if (prior <= 0) return null;
  return (recent - prior) / prior;
}

/**
 * Seasonality as an index over the last 12 complete months: 100 is this brand's average month, 140
 * is a month that runs 40% hot.
 *
 * Indexing is what makes the curve shareable. The shape of a year — when the trade buys — is the
 * thing brands actually ask about, and once each brand is normalised to its own mean, the cohort
 * median carries no information about anyone's size.
 */
function readSeasonality(revenueByMonth: Record<string, number>, endMonth: string): number[] | null {
  const window = monthWindow(endMonth, 12);
  const values = window.map((month) => revenueByMonth[month] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  // A gap in the window means a shop that was closed or unsynced for a month; its "0" would read as
  // a seasonal trough for the whole trade.
  if (values.some((value) => value <= 0)) return null;
  const mean = total / 12;
  const byCalendarMonth = new Array<number>(12).fill(0);
  window.forEach((month, index) => {
    byCalendarMonth[Number(month.slice(5, 7)) - 1] = (values[index] / mean) * 100;
  });
  return byCalendarMonth;
}

/** Share of revenue taken through the shop's own storefront rather than a marketplace. Answers
 *  "how dependent is the trade on Skroutz?", which is asked constantly and guessed at. */
function readDirectChannelShare(summary: SummaryDoc): number | null {
  const byChannel = summary.revenueBySalesChannel;
  if (!byChannel) return null;
  const direct = byChannel.direct_eshop ?? 0;
  const marketplace = Object.entries(byChannel)
    .filter(([channel]) => channel.startsWith('marketplace'))
    .reduce((sum, [, revenue]) => sum + revenue, 0);
  const total = direct + marketplace;
  if (total <= 0) return null;
  return direct / total;
}

/**
 * Orders per identified customer, and the share of customers RFM calls Champions.
 *
 * Both come from the identified scope: guest checkouts have no stable identity, so counting them
 * would understate repeat buying for whichever shop has the most of them and make the cohort
 * incomparable.
 */
function readRfmMetrics(rfm: Record<string, unknown> | null): { ordersPerCustomer: number | null; championsShare: number | null } {
  const scopes = rfm?.scopes as { identified?: { segments?: RfmSegment[]; totalCustomers?: number } } | undefined;
  const segments = scopes?.identified?.segments;
  if (!Array.isArray(segments) || segments.length === 0) return { ordersPerCustomer: null, championsShare: null };

  let customers = 0;
  let orders = 0;
  let champions = 0;
  for (const segment of segments) {
    const count = typeof segment.count === 'number' ? segment.count : 0;
    customers += count;
    orders += typeof segment.orders === 'number' ? segment.orders : 0;
    if (segment.id === 'champions') champions += count;
  }
  if (customers <= 0) return { ordersPerCustomer: null, championsShare: null };
  return {
    ordersPerCustomer: orders > 0 ? orders / customers : null,
    championsShare: champions / customers,
  };
}

/** Linear-interpolated percentile over a sorted ascending list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distributionOf(values: number[]): BenchmarkDistribution | null {
  if (values.length < BENCHMARK_MIN_COHORT_BRANDS) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25: round(percentile(sorted, 0.25)),
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    n: sorted.length,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Cohort key. Kept flat (`vertical__band`) so it is a legal Firestore document id and so the
 *  client can build the fallback chain without a lookup table. */
export function benchmarkCohortId(vertical: BenchmarkVerticalKey | 'all', sizeBand: BenchmarkSizeBand | 'all'): string {
  return `${vertical}__${sizeBand}`;
}

/**
 * The cohorts a brand may be shown, most specific first.
 *
 * A brand in a trade too small to publish should still get a comparison, so the chain widens rather
 * than stopping: its own trade and size, then its trade at any size, then its size across trades,
 * then the whole estate. The client walks this list and takes the first cohort that exists.
 */
export function benchmarkCohortChain(vertical: BenchmarkVerticalKey, sizeBand: BenchmarkSizeBand): string[] {
  const chain = [
    benchmarkCohortId(vertical, sizeBand),
    benchmarkCohortId(vertical, 'all'),
    benchmarkCohortId('all', sizeBand),
    benchmarkCohortId('all', 'all'),
  ];
  // `unclassified` is not a trade, so its two trade-scoped keys are meaningless.
  return vertical === 'unclassified' ? chain.slice(2) : [...new Set(chain)];
}

function buildSample(
  brandId: string,
  vertical: BenchmarkVerticalKey,
  summary: SummaryDoc,
  rfm: Record<string, unknown> | null,
  endMonth: string
): BrandSample | null {
  const orderCount = summary.orderCount ?? 0;
  if (orderCount < MIN_ORDERS_TO_QUALIFY) return null;
  const revenueByMonth = summary.revenueByMonth ?? {};
  const ttm = ttmRevenue(revenueByMonth, endMonth);
  // No trailing-year revenue means the connector is stale or the shop has stopped; either way it
  // cannot be size-banded, and an unbanded shop in the `mid` band is a silent error.
  if (ttm <= 0) return null;

  const { ordersPerCustomer, championsShare } = readRfmMetrics(rfm);
  const metrics: Partial<Record<BenchmarkMetricId, number>> = {};
  const aov = readAov(summary);
  if (aov !== null) metrics.aov = aov;
  const growthYoY = readGrowthYoY(revenueByMonth, endMonth);
  if (growthYoY !== null) metrics.growthYoY = growthYoY;
  if (ordersPerCustomer !== null) metrics.ordersPerCustomer = ordersPerCustomer;
  if (championsShare !== null) metrics.championsShare = championsShare;
  const directChannelShare = readDirectChannelShare(summary);
  if (directChannelShare !== null) metrics.directChannelShare = directChannelShare;

  return {
    brandId,
    vertical,
    sizeBand: sizeBandFor(ttm),
    metrics,
    seasonality: readSeasonality(revenueByMonth, endMonth),
  };
}

function cohortKeysFor(sample: BrandSample): string[] {
  const keys = [
    benchmarkCohortId('all', 'all'),
    benchmarkCohortId('all', sample.sizeBand),
  ];
  if (sample.vertical !== 'unclassified') {
    keys.push(benchmarkCohortId(sample.vertical, 'all'), benchmarkCohortId(sample.vertical, sample.sizeBand));
  }
  return keys;
}

function aggregateCohort(cohortId: string, samples: BrandSample[]) {
  const [vertical, sizeBand] = cohortId.split('__');
  const metrics: Partial<Record<BenchmarkMetricId, BenchmarkDistribution>> = {};
  for (const metricId of BENCHMARK_METRIC_IDS) {
    const values = samples
      .map((sample) => sample.metrics[metricId])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const distribution = distributionOf(values);
    if (distribution) metrics[metricId] = distribution;
  }

  const withSeasonality = samples.filter((sample) => sample.seasonality !== null);
  let seasonality: BenchmarkSeasonalityPoint[] | null = null;
  if (withSeasonality.length >= BENCHMARK_MIN_COHORT_BRANDS) {
    seasonality = Array.from({ length: 12 }, (_, monthIndex) => {
      const values = withSeasonality
        .map((sample) => sample.seasonality![monthIndex])
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      return {
        month: String(monthIndex + 1).padStart(2, '0'),
        index: round(percentile(values, 0.5)),
        n: values.length,
      };
    });
  }

  return {
    cohortId,
    vertical,
    sizeBand,
    brandCount: samples.length,
    metrics,
    seasonality,
    minCohortBrands: BENCHMARK_MIN_COHORT_BRANDS,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Rebuild every cohort and every brand's own sample.
 *
 * Cohorts that have dropped below the k floor since the last run are deleted rather than left in
 * place: a stale document would keep serving a distribution for a group that is no longer large
 * enough to have one, which is exactly the disclosure the floor exists to prevent.
 */
export async function computeBenchmarkCohorts(): Promise<{ brands: number; samples: number; cohorts: number }> {
  const firestore = db();
  const endMonth = lastCompleteMonth(new Date());
  const brandsSnap = await firestore.collection('brands').get();

  const samples: BrandSample[] = [];
  const optedOut: string[] = [];

  for (const brandDoc of brandsSnap.docs) {
    const brand = brandDoc.data() as { vertical?: string; benchmarkOptOut?: boolean };
    if (brand.benchmarkOptOut === true) {
      optedOut.push(brandDoc.id);
      continue;
    }
    try {
      const [summarySnap, rfmSnap] = await Promise.all([
        firestore.doc(`ecommerce_summary/${brandDoc.id}`).get(),
        firestore.doc(`data_analysis_rfm/${brandDoc.id}`).get().catch(() => null),
      ]);
      if (!summarySnap.exists) continue;
      const vertical = (BENCHMARK_VERTICALS as readonly string[]).includes(brand.vertical ?? '')
        ? (brand.vertical as BenchmarkVertical)
        : 'unclassified';
      const sample = buildSample(
        brandDoc.id,
        vertical,
        summarySnap.data() as SummaryDoc,
        rfmSnap?.exists ? (rfmSnap.data() as Record<string, unknown>) : null,
        endMonth
      );
      if (sample) samples.push(sample);
    } catch (err) {
      logger.warnAlert(`[Benchmarks] sample failed for brand ${brandDoc.id}:`, { alertKey: ALERT.benchmarkAggregateFailed, err });
    }
  }

  const byCohort = new Map<string, BrandSample[]>();
  for (const sample of samples) {
    for (const key of cohortKeysFor(sample)) {
      const bucket = byCohort.get(key) ?? [];
      bucket.push(sample);
      byCohort.set(key, bucket);
    }
  }

  const published = new Set<string>();
  for (const [cohortId, cohortSamples] of byCohort) {
    if (cohortSamples.length < BENCHMARK_MIN_COHORT_BRANDS) continue;
    const doc = aggregateCohort(cohortId, cohortSamples);
    // A cohort with every metric suppressed carries nothing; publishing it would only make the UI
    // report "no data" from a document that exists.
    if (Object.keys(doc.metrics).length === 0 && !doc.seasonality) continue;
    await firestore.doc(`benchmark_cohorts/${cohortId}`).set(doc);
    published.add(cohortId);
  }

  const existingSnap = await firestore.collection('benchmark_cohorts').get();
  for (const doc of existingSnap.docs) {
    if (!published.has(doc.id)) await doc.ref.delete();
  }

  // Each brand's own values, brand-scoped. Written from the same samples the distributions came
  // from, so a marker can never sit against a distribution computed a different way.
  for (const sample of samples) {
    await firestore.doc(`benchmark_self/${sample.brandId}`).set({
      brandId: sample.brandId,
      vertical: sample.vertical,
      sizeBand: sample.sizeBand,
      metrics: sample.metrics,
      seasonality: sample.seasonality,
      cohortChain: benchmarkCohortChain(sample.vertical, sample.sizeBand).filter((id) => published.has(id)),
      eligible: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // A brand that stops qualifying (opted out, connector removed, volume collapsed) must stop
  // showing yesterday's comparison. `eligible: false` lets the page explain itself instead of
  // rendering a stale marker.
  const sampled = new Set(samples.map((sample) => sample.brandId));
  for (const brandId of [...brandsSnap.docs.map((d) => d.id)]) {
    if (sampled.has(brandId)) continue;
    const selfRef = firestore.doc(`benchmark_self/${brandId}`);
    const selfSnap = await selfRef.get();
    if (!selfSnap.exists) continue;
    await selfRef.set(
      {
        eligible: false,
        reason: optedOut.includes(brandId) ? 'opted_out' : 'insufficient_data',
        metrics: {},
        seasonality: null,
        cohortChain: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  logger.info(
    `[Benchmarks] ${samples.length}/${brandsSnap.size} brands sampled, ${published.size} cohorts published (k=${BENCHMARK_MIN_COHORT_BRANDS}, opted out ${optedOut.length})`
  );
  return { brands: brandsSnap.size, samples: samples.length, cohorts: published.size };
}

/** Exported for the unit tests, which exercise the maths without a Firestore. */
export const __testables = {
  buildSample,
  aggregateCohort,
  distributionOf,
  percentile,
  readGrowthYoY,
  readSeasonality,
  readDirectChannelShare,
  readRfmMetrics,
  sizeBandFor,
  lastCompleteMonth,
  monthWindow,
  cohortKeysFor,
};
