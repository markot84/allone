import { describe, it, expect, vi } from 'vitest';
import { withFirestoreRetry, isTransientFirestoreError } from './firestore';

const unavailable = Object.assign(new Error('client is offline'), { code: 'unavailable' });
const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });

describe('withFirestoreRetry', () => {
  it('retries transient errors and succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValueOnce('ok');
    const p = withFirestoreRetry(fn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('rethrows non-transient errors immediately', async () => {
    const fn = vi.fn().mockRejectedValue(denied);
    await expect(withFirestoreRetry(fn)).rejects.toBe(denied);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt cap', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(unavailable);
    const p = withFirestoreRetry(fn, 3).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toBe(unavailable);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('classifies the timeout wrapper message as transient', () => {
    expect(isTransientFirestoreError(new Error('Firestore timeout 15000ms (users/x)'))).toBe(true);
    expect(isTransientFirestoreError(denied)).toBe(false);
  });
});
