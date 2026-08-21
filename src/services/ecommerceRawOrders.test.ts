// PER-309: degraded order fetches throw a typed error instead of returning fake-empty/partial data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EcommerceOrdersFetchError, fetchEcommercePlatformOrders } from './ecommerceRawOrders';
import { FirestoreService } from './firestore';

vi.mock('./firestore', () => ({
  FirestoreService: {
    getDocument: vi.fn().mockResolvedValue(null),
    getDocuments: vi.fn(),
    getDocumentsPaginated: vi.fn(),
  },
}));

const paginated = vi.mocked(FirestoreService.getDocumentsPaginated);
const getDocuments = vi.mocked(FirestoreService.getDocuments);

const order = (id: number) => ({
  id: `mag_${id}`,
  incrementId: String(id),
  createdAt: '2025-07-01 10:00:00',
  status: 'complete',
  total: 10,
  lineItems: [{ sku: `SKU-${id}`, price: 10, quantity: 1 }],
});

const page = (items: Record<string, unknown>[], totalCount = items.length) => ({
  items,
  lastDoc: null,
  totalCount,
});

const OPTS = { sinceDate: '2025-06-01', untilDate: '2025-07-31', fetchAll: true } as const;
const transient = { code: 'unavailable' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function run<T>(promise: Promise<T>): Promise<T> {
  // Observe the rejection before advancing timers (avoids unhandled-rejection noise).
  const settled = promise.then(
    (v) => ({ v }),
    (e) => ({ e })
  );
  await vi.runAllTimersAsync();
  const r = await settled;
  if ('e' in r) throw r.e;
  return r.v;
}

describe('fetchEcommercePlatformOrders (PER-309 degraded-fetch semantics)', () => {
  it('transient error then success → orders returned after retry', async () => {
    paginated.mockRejectedValueOnce(transient).mockResolvedValueOnce(page([order(1), order(2)]));
    const result = await run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS));
    expect(result).toHaveLength(2);
    expect(paginated).toHaveBeenCalledTimes(2);
  });

  it('transient exhausted → typed throw, no ranged fallback query', async () => {
    paginated.mockRejectedValue(transient);
    await expect(run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS))).rejects.toBeInstanceOf(
      EcommerceOrdersFetchError
    );
    expect(paginated).toHaveBeenCalledTimes(3);
    expect(getDocuments).not.toHaveBeenCalled();
  });

  it('only failed-precondition falls through to the ranged query', async () => {
    paginated.mockRejectedValueOnce({ code: 'failed-precondition' });
    getDocuments.mockResolvedValueOnce([order(1)]);
    const result = await run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS));
    expect(result).toHaveLength(1);
    expect(getDocuments).toHaveBeenCalledTimes(1);
  });

  it('other non-transient codes throw without touching the ranged path', async () => {
    paginated.mockRejectedValueOnce({ code: 'internal' });
    await expect(run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS))).rejects.toBeInstanceOf(
      EcommerceOrdersFetchError
    );
    expect(getDocuments).not.toHaveBeenCalled();
  });

  it('ranged path transient exhaustion → typed throw, no brandId-only limit fallback', async () => {
    paginated.mockRejectedValueOnce({ code: 'failed-precondition' });
    getDocuments.mockRejectedValue(transient);
    await expect(run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS))).rejects.toBeInstanceOf(
      EcommerceOrdersFetchError
    );
    // 3 retried attempts of the SAME ranged query; the old date-window-less fallback is gone.
    expect(getDocuments).toHaveBeenCalledTimes(3);
    for (const call of getDocuments.mock.calls) {
      expect(call[1]).not.toHaveLength(1); // never the bare [limit(5000)] constraint set
    }
  });

  it('page-2 persistent failure discards page-1 partials', async () => {
    const bigPage = Array.from({ length: 5000 }, (_, i) => order(i));
    paginated
      .mockResolvedValueOnce({ items: bigPage, lastDoc: {} as never, totalCount: 8000 })
      .mockRejectedValue(transient);
    await expect(run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS))).rejects.toBeInstanceOf(
      EcommerceOrdersFetchError
    );
  });

  it('failing platform is identified when another platform succeeds', async () => {
    paginated.mockImplementation(async (collectionName: string) => {
      if (collectionName === 'magento_orders') throw transient;
      return page([order(9)]);
    });
    const err = await run(
      fetchEcommercePlatformOrders('b1', ['magento', 'shopify'], OPTS).then(
        () => null,
        (e) => e
      )
    );
    expect(err).toBeInstanceOf(EcommerceOrdersFetchError);
    expect((err as EcommerceOrdersFetchError).platform).toBe('magento');
  });

  it('genuinely empty window resolves to [] without error', async () => {
    paginated.mockResolvedValue(page([]));
    const result = await run(fetchEcommercePlatformOrders('b1', ['magento'], OPTS));
    expect(result).toEqual([]);
  });
});
