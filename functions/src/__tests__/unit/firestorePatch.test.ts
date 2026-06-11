/**
 * PER-60 healthWatch fix — markNightlyJob used to write dotted keys via set(..., {merge:true}),
 * which stores them as LITERAL field names ("jobs.scheduledSyncErp.status") that healthWatch's
 * nested `data.jobs` read can never see. The fix routes through update() with a set() fallback
 * for the doc-doesn't-exist-yet case; nestDottedKeys builds the nested shape that fallback needs.
 */
import { describe, it, expect } from 'vitest';
import { nestDottedKeys } from '../../firestorePatch';

describe('nestDottedKeys', () => {
  it('expands a dotted key into a nested object', () => {
    expect(nestDottedKeys({ 'jobs.scheduledSyncErp.status': 'running' })).toEqual({
      jobs: { scheduledSyncErp: { status: 'running' } },
    });
  });

  it('merges sibling dotted keys under shared parents (the markNightlyJob patch shape)', () => {
    const patch = {
      timezone: 'Europe/Athens',
      'jobs.scheduledSyncErp.status': 'success',
      'jobs.scheduledSyncErp.lastDurationMs': 1234,
      'jobs.scheduledSyncErp.lastMessage': 'Wave "erp" ok.',
      'jobs.scheduledDigest.status': 'running',
    };
    expect(nestDottedKeys(patch)).toEqual({
      timezone: 'Europe/Athens',
      jobs: {
        scheduledSyncErp: { status: 'success', lastDurationMs: 1234, lastMessage: 'Wave "erp" ok.' },
        scheduledDigest: { status: 'running' },
      },
    });
  });

  it('passes through keys without dots unchanged', () => {
    const sentinel = { sentinel: true };
    expect(nestDottedKeys({ updatedAt: sentinel })).toEqual({ updatedAt: sentinel });
  });

  it('does not flatten leaf object values (e.g. FieldValue sentinels stay intact)', () => {
    const sentinel = { _methodName: 'serverTimestamp' };
    const out = nestDottedKeys({ 'jobs.x.updatedAt': sentinel });
    expect((out.jobs as Record<string, Record<string, unknown>>).x.updatedAt).toBe(sentinel);
  });

  it('last write wins when a leaf is set twice', () => {
    expect(nestDottedKeys({ 'a.b': 1, 'a.b.c': 2 })).toEqual({ a: { b: { c: 2 } } });
  });
});
