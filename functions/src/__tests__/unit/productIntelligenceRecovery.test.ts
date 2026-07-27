/** The watchdog re-triggers a rebuild for an aggregate stranded by a crashed/timed-out refresh:
 * 'running' older than the rebuild timeout (provably dead) or 'failed', bounded by a cooldown and an
 * attempt cap so a persistently-failing brand can't livelock the worker. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { classifyAggregateRecovery } = __test;
const OPTS = { staleMs: 35 * 60 * 1000, cooldownMs: 35 * 60 * 1000, maxAttempts: 3 };
const NOW = 1_000_000_000_000;
const base = { selfHealAttempts: 0, selfHealAtMs: null, nowMs: NOW };

describe('classifyAggregateRecovery', () => {
  it('leaves a healthy / fresh aggregate alone', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'ready', updatedAtMs: NOW }, OPTS)).toBe('ok');
    expect(classifyAggregateRecovery({ ...base, status: 'skipped', updatedAtMs: NOW }, OPTS)).toBe('ok');
  });

  it('leaves a running rebuild that is still within the timeout window', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'running', updatedAtMs: NOW - 20 * 60 * 1000 }, OPTS)).toBe('ok');
  });

  it('never touches running with an unknown updatedAt (can not prove it is dead)', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'running', updatedAtMs: null }, OPTS)).toBe('ok');
  });

  it('heals a running aggregate older than staleMs (dead writer)', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'running', updatedAtMs: NOW - 40 * 60 * 1000 }, OPTS)).toBe('heal');
  });

  it('heals a failed aggregate (no staleness needed)', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'failed', updatedAtMs: NOW }, OPTS)).toBe('heal');
  });

  it('waits out the cooldown after a recent heal attempt', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'failed', updatedAtMs: NOW, selfHealAtMs: NOW - 10 * 60 * 1000 }, OPTS)).toBe('cooldown');
  });

  it('re-heals once the cooldown has elapsed', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'failed', updatedAtMs: NOW, selfHealAtMs: NOW - 40 * 60 * 1000 }, OPTS)).toBe('heal');
  });

  it('gives up after the attempt cap', () => {
    expect(classifyAggregateRecovery({ ...base, status: 'failed', updatedAtMs: NOW, selfHealAttempts: 3 }, OPTS)).toBe('giveup');
  });
});
