/**
 * PER-139 — magentoFetch bounded retries. One transient 30s timeout on page 108/300 must not
 * abort the whole nightly sync (observed live twice on 12-06-2026). Contract: retry ONLY on
 * timeout/network errors, HTTP 5xx and 429; never on other 4xx (the catalog-401 degraded
 * path depends on auth errors surfacing immediately); max 2 retries, then the error/response
 * propagates as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../urlValidator', () => ({ safeFetch: (...args: unknown[]) => safeFetchMock(...args) }));

import { __test } from '../../magentoConnector';

const { magentoFetch, isRetryableMagentoStatus, magentoRetryDelayMs } = __test;

function res(status: number): Response {
  return { status, text: () => Promise.resolve(''), ok: status >= 200 && status < 300 } as unknown as Response;
}

beforeEach(() => {
  safeFetchMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  // Drain the retry sleeps deterministically.
  await vi.runAllTimersAsync();
  return p;
}

describe('isRetryableMagentoStatus', () => {
  it('retries 5xx and 429 only', () => {
    expect(isRetryableMagentoStatus(500)).toBe(true);
    expect(isRetryableMagentoStatus(503)).toBe(true);
    expect(isRetryableMagentoStatus(429)).toBe(true);
    expect(isRetryableMagentoStatus(401)).toBe(false);
    expect(isRetryableMagentoStatus(403)).toBe(false);
    expect(isRetryableMagentoStatus(404)).toBe(false);
    expect(isRetryableMagentoStatus(200)).toBe(false);
  });
});

describe('magentoRetryDelayMs', () => {
  it('applies ±25% jitter around the 2s/8s base ladder', () => {
    expect(magentoRetryDelayMs(0, () => 0)).toBe(1500);
    expect(magentoRetryDelayMs(0, () => 1)).toBe(2500);
    expect(magentoRetryDelayMs(1, () => 0.5)).toBe(8000);
    // attempts beyond the ladder clamp to the last step
    expect(magentoRetryDelayMs(5, () => 0.5)).toBe(8000);
  });
});

describe('magentoFetch retry behavior', () => {
  it('returns immediately on success without retrying', async () => {
    safeFetchMock.mockResolvedValueOnce(res(200));
    const r = await magentoFetch('https://shop.example/rest/V1/orders');
    expect(r.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient timeout and succeeds on the second attempt', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    safeFetchMock.mockRejectedValueOnce(abortErr).mockResolvedValueOnce(res(200));
    const p = magentoFetch('https://shop.example/rest/V1/orders');
    const r = await runWithTimers(p);
    expect(r.status).toBe(200);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 503 then returns the final response after exhaustion', async () => {
    safeFetchMock.mockResolvedValue(res(503));
    const p = magentoFetch('https://shop.example/rest/V1/orders');
    const r = await runWithTimers(p);
    expect(r.status).toBe(503); // last attempt's response propagates (callers handle !ok)
    expect(safeFetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does NOT retry auth/client errors — catalog-401 degraded path depends on it', async () => {
    safeFetchMock.mockResolvedValue(res(401));
    const r = await magentoFetch('https://shop.example/rest/V1/products');
    expect(r.status).toBe(401);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry non-transient throws (e.g. safeFetch SSRF block)', async () => {
    safeFetchMock.mockRejectedValue(new Error('Blocked non-public address'));
    await expect(magentoFetch('https://169.254.169.254/')).rejects.toThrow('Blocked non-public address');
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the timeout error after exhausting retries on persistent timeouts', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    safeFetchMock.mockRejectedValue(abortErr);
    const p = magentoFetch('https://shop.example/rest/V1/orders');
    p.catch(() => undefined); // attach early; assertion follows after timers drain
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/Magento request timeout/);
    expect(safeFetchMock).toHaveBeenCalledTimes(3);
  });
});
