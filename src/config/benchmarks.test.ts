/** Benchmark presentation helpers. `quartileOf` is the one that carries a verdict, so it is the one
 *  that must not silently invert for a metric where lower is better. */
import { describe, it, expect } from 'vitest';
import { BENCHMARK_METRICS, describeCohort, quartileOf } from './benchmarks';

const spread = { p25: 40, p50: 50, p75: 60 };

describe('quartileOf', () => {
  it('places a value in the cohort where a reader would place it by eye', () => {
    expect(quartileOf(70, spread, true)).toBe('top');
    expect(quartileOf(60, spread, true)).toBe('top'); // on p75 counts as top
    expect(quartileOf(55, spread, true)).toBe('upper-mid');
    expect(quartileOf(45, spread, true)).toBe('lower-mid');
    expect(quartileOf(30, spread, true)).toBe('bottom');
  });

  it('inverts the verdict where a higher number is worse, instead of colouring it green', () => {
    expect(quartileOf(70, spread, false)).toBe('bottom');
    expect(quartileOf(55, spread, false)).toBe('lower-mid');
    expect(quartileOf(45, spread, false)).toBe('upper-mid');
    expect(quartileOf(30, spread, false)).toBe('top');
  });
});

describe('describeCohort', () => {
  it('names the trade and the size band', () => {
    expect(describeCohort('fashion', 'mid', 14)).toBe('14 e-shops ένδυσης, μεσαίου μεγέθους');
  });

  it('drops the trade when the cohort spans all of them, so the line stays true', () => {
    expect(describeCohort('all', 'small', 31)).toBe('31 e-shops, μικρού μεγέθους');
    expect(describeCohort('all', 'all', 58)).toBe('58 e-shops');
  });
});

describe('metric config', () => {
  it('formats each metric in the unit it is read in', () => {
    const byId = Object.fromEntries(BENCHMARK_METRICS.map((m) => [m.id, m]));
    expect(byId.aov.format(62.5)).toBe('€62,50');
    expect(byId.growthYoY.format(0.184)).toBe('+18,4%');
    expect(byId.growthYoY.format(-0.05)).toBe('-5,0%');
    expect(byId.championsShare.format(0.213)).toBe('21,3%');
    expect(byId.ordersPerCustomer.format(1.8)).toBe('1,80');
  });

  it('states the question and the definition for every metric — a benchmark without a definition is an argument', () => {
    for (const metric of BENCHMARK_METRICS) {
      expect(metric.question.length).toBeGreaterThan(10);
      expect(metric.definition.length).toBeGreaterThan(20);
    }
  });
});
