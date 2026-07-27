/** The product table must keep serving the last-good page docs while a recompute is `running`
 * (provided a prior build left page docs behind), instead of blanking until status flips back to
 * `ready`. A long/orphaned `running` (e.g. a crashed nightly refresh) otherwise empties the table
 * even though the cards still render from the same aggregate. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { canServeAggregateQuery } = __test;

describe('canServeAggregateQuery', () => {
  it('serves when ready (with or without page metadata)', () => {
    expect(canServeAggregateQuery('ready', true)).toBe(true);
    expect(canServeAggregateQuery('ready', false)).toBe(true);
  });

  it('serves while running when a prior build left page docs', () => {
    expect(canServeAggregateQuery('running', true)).toBe(true);
  });

  it('refuses while running with no page docs (first build, nothing to show yet)', () => {
    expect(canServeAggregateQuery('running', false)).toBe(false);
  });

  it('refuses for failed / skipped / missing status', () => {
    expect(canServeAggregateQuery('failed', true)).toBe(false);
    expect(canServeAggregateQuery('skipped', true)).toBe(false);
    expect(canServeAggregateQuery(undefined, true)).toBe(false);
  });
});
