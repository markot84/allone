import { describe, expect, it } from 'vitest';
import { buildParentLinksPayload } from '../../magentoConnector';

describe('buildParentLinksPayload (PER-307)', () => {
  const run = new Map([['child-1', 'PARENT-A'], ['child-2', 'PARENT-B']]);

  it('full link set overwrites — removed configurables self-clean', () => {
    const existing = { 'child-old': 'PARENT-GONE', 'child-1': 'PARENT-STALE' };
    expect(buildParentLinksPayload(run, existing, true)).toEqual({ 'child-1': 'PARENT-A', 'child-2': 'PARENT-B' });
  });

  it('partial run merges over the existing doc, new wins', () => {
    const existing = { 'child-1': 'PARENT-STALE', 'child-3': 'PARENT-C' };
    expect(buildParentLinksPayload(run, existing, false)).toEqual({
      'child-1': 'PARENT-A',
      'child-2': 'PARENT-B',
      'child-3': 'PARENT-C',
    });
  });

  it('empty partial run writes nothing (no truncation)', () => {
    expect(buildParentLinksPayload(new Map(), { 'child-3': 'PARENT-C' }, false)).toBeNull();
  });

  it('empty full set still overwrites to empty (brand dropped all configurables)', () => {
    expect(buildParentLinksPayload(new Map(), { 'child-3': 'PARENT-C' }, true)).toEqual({});
  });
});
