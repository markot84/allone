/**
 * Cross-eshop benchmarking maths.
 *
 * The k-anonymity floor and the "no absolute figures cross a tenant" rule are the two things in
 * this feature that cause real harm when they break, and neither fails loudly — a suppressed cohort
 * that publishes anyway looks exactly like a working one. So they are asserted first and hardest.
 */
import { describe, it, expect } from 'vitest';
import { __testables, BENCHMARK_MIN_COHORT_BRANDS, benchmarkCohortChain, benchmarkCohortId } from '../../benchmarkAggregator';

const {
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
} = __testables;

/** `count` months of equal revenue ending at `endMonth`. */
function flatMonths(endMonth: string, count: number, perMonth: number): Record<string, number> {
  return monthWindow(endMonth, count).reduce<Record<string, number>>((acc, month) => {
    acc[month] = perMonth;
    return acc;
  }, {});
}

describe('k-anonymity floor', () => {
  it('suppresses a distribution below the floor and publishes at it', () => {
    const below = Array.from({ length: BENCHMARK_MIN_COHORT_BRANDS - 1 }, (_, i) => i + 1);
    expect(distributionOf(below)).toBeNull();

    const atFloor = Array.from({ length: BENCHMARK_MIN_COHORT_BRANDS }, (_, i) => i + 1);
    expect(distributionOf(atFloor)).not.toBeNull();
    expect(distributionOf(atFloor)!.n).toBe(BENCHMARK_MIN_COHORT_BRANDS);
  });

  it('suppresses per metric, not per cohort: a metric only four shops can report is dropped while the rest survive', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      brandId: `b${i}`,
      vertical: 'fashion' as const,
      sizeBand: 'mid' as const,
      // Only the first four brands have a year-on-year figure.
      metrics: i < 4 ? { aov: 40 + i, growthYoY: 0.1 } : { aov: 40 + i },
      seasonality: null,
    }));
    const cohort = aggregateCohort(benchmarkCohortId('fashion', 'mid'), samples);
    expect(cohort.metrics.aov).toBeDefined();
    expect(cohort.metrics.growthYoY).toBeUndefined();
  });

  it('publishes no absolute revenue: the cohort document carries only ratios and indices', () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      brandId: `b${i}`,
      vertical: 'fashion' as const,
      sizeBand: 'mid' as const,
      metrics: { aov: 40 + i, championsShare: 0.1, directChannelShare: 0.8, ordersPerCustomer: 1.4 },
      seasonality: new Array(12).fill(100),
    }));
    const cohort = aggregateCohort(benchmarkCohortId('fashion', 'mid'), samples);
    const serialised = JSON.stringify(cohort);
    expect(serialised).not.toContain('totalRevenue');
    expect(serialised).not.toContain('ttm');
    expect(Object.keys(cohort.metrics).sort()).toEqual(
      ['aov', 'championsShare', 'directChannelShare', 'ordersPerCustomer'].sort()
    );
  });
});

describe('percentiles', () => {
  it('interpolates rather than picking a member, so a value cannot be traced to one shop', () => {
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 0.5)).toBe(25);
    expect(percentile(sorted, 0.25)).toBe(17.5);
    expect(percentile(sorted, 0.75)).toBe(32.5);
  });

  it('orders p25 ≤ p50 ≤ p75 on unsorted input', () => {
    const d = distributionOf([9, 1, 7, 3, 5, 11])!;
    expect(d.p25).toBeLessThanOrEqual(d.p50);
    expect(d.p50).toBeLessThanOrEqual(d.p75);
  });
});

describe('month arithmetic', () => {
  it('lastCompleteMonth never returns the current month, and wraps the year in January', () => {
    expect(lastCompleteMonth(new Date('2026-03-14T00:00:00Z'))).toBe('2026-02');
    expect(lastCompleteMonth(new Date('2026-01-04T00:00:00Z'))).toBe('2025-12');
  });

  it('monthWindow walks back across a year boundary', () => {
    expect(monthWindow('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthWindow('2026-02', 12)[0]).toBe('2025-03');
  });
});

describe('growth year on year', () => {
  it('abstains below 24 months of history rather than comparing against a partial year', () => {
    expect(readGrowthYoY(flatMonths('2026-02', 18, 1000), '2026-02')).toBeNull();
  });

  it('compares the last 12 complete months against the 12 before them', () => {
    const months = { ...flatMonths('2025-02', 12, 1000), ...flatMonths('2026-02', 12, 1200) };
    expect(readGrowthYoY(months, '2026-02')).toBeCloseTo(0.2, 6);
  });

  it('abstains when the prior year is empty instead of reporting infinite growth', () => {
    const months = { ...flatMonths('2025-02', 12, 0), ...flatMonths('2026-02', 12, 1200) };
    expect(readGrowthYoY(months, '2026-02')).toBeNull();
  });
});

describe('seasonality', () => {
  it('indexes to 100 at the average month and lands each value on its calendar month', () => {
    const months = flatMonths('2026-02', 12, 1000);
    months['2025-12'] = 2000; // a December twice the size of every other month
    const curve = readSeasonality(months, '2026-02')!;
    expect(curve).toHaveLength(12);
    // Mean is 13000/12; December is 2000 → index ≈ 184.6, and it sits at index 11.
    expect(curve[11]).toBeCloseTo((2000 / (13000 / 12)) * 100, 4);
    expect(curve[0]).toBeCloseTo((1000 / (13000 / 12)) * 100, 4);
  });

  it('abstains on a gap, so an unsynced month does not read as a seasonal trough', () => {
    const months = flatMonths('2026-02', 12, 1000);
    delete months['2025-08'];
    expect(readSeasonality(months, '2026-02')).toBeNull();
  });
});

describe('direct channel share', () => {
  it('is direct over direct plus marketplace, ignoring intercompany and review buckets', () => {
    const share = readDirectChannelShare({
      revenueBySalesChannel: {
        direct_eshop: 800,
        marketplace_skroutz: 200,
        intercompany: 5000,
        needs_review: 400,
      },
    });
    expect(share).toBeCloseTo(0.8, 6);
  });

  it('abstains when no channel revenue is recorded', () => {
    expect(readDirectChannelShare({ revenueBySalesChannel: {} })).toBeNull();
    expect(readDirectChannelShare({})).toBeNull();
  });
});

describe('RFM metrics', () => {
  it('reads orders per identified customer and the Champions share', () => {
    const rfm = {
      scopes: {
        identified: {
          segments: [
            { id: 'champions', count: 20, orders: 80 },
            { id: 'lost', count: 80, orders: 100 },
          ],
        },
      },
    };
    const { ordersPerCustomer, championsShare } = readRfmMetrics(rfm);
    expect(ordersPerCustomer).toBeCloseTo(1.8, 6);
    expect(championsShare).toBeCloseTo(0.2, 6);
  });

  it('abstains with no RFM document rather than reporting a zero repeat rate', () => {
    expect(readRfmMetrics(null)).toEqual({ ordersPerCustomer: null, championsShare: null });
  });
});

describe('size bands', () => {
  it('bands on the boundaries the way the thresholds read', () => {
    expect(sizeBandFor(50_000)).toBe('micro');
    expect(sizeBandFor(100_000)).toBe('small');
    expect(sizeBandFor(499_999)).toBe('small');
    expect(sizeBandFor(500_000)).toBe('mid');
    expect(sizeBandFor(2_000_000)).toBe('large');
    expect(sizeBandFor(50_000_000)).toBe('large');
  });
});

describe('buildSample', () => {
  const endMonth = '2026-02';

  it('rejects a shop below the qualifying order count, so a test account cannot move a percentile', () => {
    const summary = { aov: 50, orderCount: 10, revenueByMonth: flatMonths(endMonth, 12, 1000) };
    expect(buildSample('b1', 'fashion', summary, null, endMonth)).toBeNull();
  });

  it('rejects a shop with no trailing-year revenue instead of silently banding it as mid', () => {
    const summary = { aov: 50, orderCount: 500, revenueByMonth: flatMonths('2023-02', 12, 1000) };
    expect(buildSample('b1', 'fashion', summary, null, endMonth)).toBeNull();
  });

  it('keeps a qualifying shop and carries only the metrics it can actually report', () => {
    const summary = {
      aov: 62,
      orderCount: 900,
      revenueByMonth: flatMonths(endMonth, 12, 60_000),
      revenueBySalesChannel: { direct_eshop: 900, marketplace_skroutz: 100 },
    };
    const sample = buildSample('b1', 'fashion', summary, null, endMonth)!;
    expect(sample.sizeBand).toBe('mid'); // 720k TTM
    expect(sample.metrics.aov).toBe(62);
    expect(sample.metrics.directChannelShare).toBeCloseTo(0.9, 6);
    // 12 months of history is not 24, so there is no honest YoY figure.
    expect(sample.metrics.growthYoY).toBeUndefined();
    expect(sample.metrics.ordersPerCustomer).toBeUndefined();
  });
});

describe('cohort keys', () => {
  it('puts a classified shop in four cohorts, widening from its own trade and size', () => {
    const sample = { brandId: 'b1', vertical: 'fashion' as const, sizeBand: 'mid' as const, metrics: {}, seasonality: null };
    expect(cohortKeysFor(sample).sort()).toEqual(['all__all', 'all__mid', 'fashion__all', 'fashion__mid'].sort());
  });

  it('never invents a trade cohort for an unclassified shop', () => {
    const sample = { brandId: 'b1', vertical: 'unclassified' as const, sizeBand: 'micro' as const, metrics: {}, seasonality: null };
    expect(cohortKeysFor(sample)).toEqual(['all__all', 'all__micro']);
    expect(cohortKeysFor(sample).some((key) => key.startsWith('unclassified'))).toBe(false);
  });

  it('offers a fallback chain that widens, and skips the trade steps when there is no trade', () => {
    expect(benchmarkCohortChain('fashion', 'mid')).toEqual(['fashion__mid', 'fashion__all', 'all__mid', 'all__all']);
    expect(benchmarkCohortChain('unclassified', 'mid')).toEqual(['all__mid', 'all__all']);
  });
});
