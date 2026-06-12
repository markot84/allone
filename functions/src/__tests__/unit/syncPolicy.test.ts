/**
 * PER-140 — shouldRunPostSyncAggregations gates the heavy post-sync chain in connectorSync
 * (ecommerce summary, stock movement, product intelligence). The contract: a sync that
 * changed data (success, or partial import) aggregates; a pure failure or a queued
 * background job does not. Providers whose result has no `success` field keep today's
 * behavior (treated as success).
 */
import { describe, it, expect } from 'vitest';
import { shouldRunPostSyncAggregations } from '../../syncPolicy';

describe('shouldRunPostSyncAggregations', () => {
  it('runs after a successful sync', () => {
    expect(shouldRunPostSyncAggregations({ success: true, imported: 1234 })).toBe(true);
    expect(shouldRunPostSyncAggregations({ success: true, imported: 0 })).toBe(true);
  });

  it('runs after a PARTIAL sync (failed but data was imported)', () => {
    // e.g. Magento: 30k orders imported, then "incremental page cap reached" → success:false
    expect(shouldRunPostSyncAggregations({ success: false, imported: 30000 })).toBe(true);
  });

  it('skips after a pure failure (nothing imported)', () => {
    expect(shouldRunPostSyncAggregations({ success: false, imported: 0 })).toBe(false);
    expect(shouldRunPostSyncAggregations({ success: false })).toBe(false);
  });

  it('skips queued background jobs regardless of success flag (worker aggregates later)', () => {
    expect(shouldRunPostSyncAggregations({ success: true, queued: true, imported: 0 })).toBe(false);
    expect(shouldRunPostSyncAggregations({ success: true, queued: true, imported: 50 })).toBe(false);
  });

  it('treats results without a success field as success (provider-shape neutrality)', () => {
    expect(shouldRunPostSyncAggregations({})).toBe(true);
    expect(shouldRunPostSyncAggregations({ imported: 0 })).toBe(true);
  });

  it('is defensive about missing results', () => {
    expect(shouldRunPostSyncAggregations(null)).toBe(false);
    expect(shouldRunPostSyncAggregations(undefined)).toBe(false);
  });

  it('ignores non-numeric imported values on failure', () => {
    expect(shouldRunPostSyncAggregations({ success: false, imported: Number.NaN })).toBe(false);
  });
});
