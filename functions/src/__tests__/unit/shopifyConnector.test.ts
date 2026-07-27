/** PER-106 / LOGIC-1: Shopify removed offset (`page`) pagination in API 2019-07 — paging by it
 * silently re-fetched the first 250 records forever. These tests pin the cursor (`Link` header
 * `page_info`) pagination: the loop must advance across pages, send page_info-only on cursor
 * pages, resume from a persisted cursor, and persist/clear that cursor correctly. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../urlValidator', () => ({ safeFetch: (...args: unknown[]) => safeFetchMock(...args) }));
// Avoid needing real key material / env: the connector decrypts the stored token before fetching.
vi.mock('../../tokenCrypto', () => ({ decryptToken: () => 'tok', encryptToken: (s: string) => s }));

import { parseLinkHeaderNext, fetchShopifyData, setDb } from '../../shopifyConnector';
import type { Firestore } from 'firebase-admin/firestore';

// ── parseLinkHeaderNext ────────────────────────────────────────────────────
function linkRes(linkHeader: string | null): Pick<Response, 'headers'> {
  return { headers: { get: (h: string) => (h.toLowerCase() === 'link' ? linkHeader : null) } } as unknown as Pick<Response, 'headers'>;
}

describe('parseLinkHeaderNext', () => {
  it('extracts page_info from a rel="next" link', () => {
    const h = '<https://x.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=ABC123>; rel="next"';
    expect(parseLinkHeaderNext(linkRes(h))).toBe('ABC123');
  });

  it('picks the next cursor when both previous and next are present', () => {
    const h =
      '<https://x.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=PREV>; rel="previous", ' +
      '<https://x.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=NEXT>; rel="next"';
    expect(parseLinkHeaderNext(linkRes(h))).toBe('NEXT');
  });

  it('returns null when only a previous link exists (last page)', () => {
    const h = '<https://x.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=PREV>; rel="previous"';
    expect(parseLinkHeaderNext(linkRes(h))).toBeNull();
  });

  it('returns null when there is no Link header', () => {
    expect(parseLinkHeaderNext(linkRes(null))).toBeNull();
  });

  it('returns null for a malformed Link header', () => {
    expect(parseLinkHeaderNext(linkRes('garbage; rel="next"'))).toBeNull();
  });
});

// ── fetchShopifyData pagination (minimal inline fake Firestore) ─────────────
type Patch = Record<string, unknown>;

function makeFakeDb(shopify: Record<string, unknown>) {
  const updates: Patch[] = [];
  const written = { orders: new Set<string>(), products: new Set<string>() };
  const db = {
    doc() {
      return {
        get: async () => ({ data: () => ({ shopify }) }),
        update: async (patch: Patch) => {
          updates.push(patch);
        },
        set: async () => {},
      };
    },
    collection(name: string) {
      return {
        doc: (id: string) => ({ __col: name, __id: id }),
        add: async () => {},
      };
    },
    batch() {
      return {
        set: (ref: { __col: string; __id: string }) => {
          if (ref.__col === 'shopify_orders') written.orders.add(ref.__id);
          if (ref.__col === 'shopify_products') written.products.add(ref.__id);
        },
        commit: async () => {},
      };
    },
  } as unknown as Firestore;
  return { db, updates, written };
}

const BASE = 'https://test.myshopify.com/admin/api/2024-01';
function page(kind: 'orders' | 'products', items: { id: number }[], nextCursor: string | null): Response {
  const link = nextCursor ? `<${BASE}/${kind}.json?limit=250&page_info=${nextCursor}>; rel="next"` : null;
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'link' ? link : null) },
    json: async () => (kind === 'orders' ? { orders: items } : { products: items }),
    text: async () => '',
  } as unknown as Response;
}
function errPage(status = 400): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => 'Invalid page_info',
    json: async () => ({}),
  } as unknown as Response;
}

const connected = (extra: Record<string, unknown> = {}) => ({
  connected: true,
  accessToken: 'enc',
  shopDomain: 'test.myshopify.com',
  ...extra,
});

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe('fetchShopifyData cursor pagination', () => {
  it('follows the Link header across pages instead of re-fetching the first 250', async () => {
    const orderUrls: string[] = [];
    let orderCalls = 0;
    let prodCalls = 0;
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/orders.json')) {
        orderUrls.push(url);
        orderCalls++;
        if (orderCalls === 1) return page('orders', [{ id: 1 }, { id: 2 }], 'PINFO2');
        return page('orders', [{ id: 3 }], null); // last page → no next link
      }
      prodCalls++;
      return page('products', [{ id: 10 }], null);
    });

    const { db, written, updates } = makeFakeDb(connected());
    setDb(db);
    const res = await fetchShopifyData('brandX');

    expect(res.success).toBe(true);
    expect(res.imported).toBe(4); // 3 distinct orders + 1 product
    expect(orderCalls).toBe(2); // advanced to page 2, then stopped (no next link)
    expect(prodCalls).toBe(1);
    expect([...written.orders].sort()).toEqual(['shopify_1', 'shopify_2', 'shopify_3']);

    // First page carries the window filter; the cursor page carries ONLY limit + page_info.
    expect(orderUrls[0]).toContain('created_at_min');
    expect(orderUrls[0]).not.toContain('page_info');
    expect(orderUrls[1]).toContain('page_info=PINFO2');
    expect(orderUrls[1]).not.toContain('created_at_min');
    expect(orderUrls[1]).not.toContain('status=');

    // On clean completion the resume cursor is cleared (delete sentinel, not a string).
    expect('shopify.ordersSyncPageCursor' in updates[0]).toBe(true);
    expect(typeof updates[0]['shopify.ordersSyncPageCursor']).not.toBe('string');
  });

  it('resumes from a stored ordersSyncPageCursor (page_info-only first request)', async () => {
    const orderUrls: string[] = [];
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/orders.json')) {
        orderUrls.push(url);
        return page('orders', [{ id: 7 }], null);
      }
      return page('products', [], null);
    });

    const { db } = makeFakeDb(connected({ ordersSyncPageCursor: 'STORED' }));
    setDb(db);
    await fetchShopifyData('brandX');

    expect(orderUrls[0]).toContain('page_info=STORED');
    expect(orderUrls[0]).not.toContain('created_at_min');
  });

  it('trips the per-run page cap and persists the next cursor for resumption', async () => {
    let orderCalls = 0;
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/orders.json')) {
        orderCalls++;
        return page('orders', [{ id: orderCalls }], `PINFO${orderCalls + 1}`); // always a next link
      }
      return page('products', [], null);
    });

    const { db, updates } = makeFakeDb(connected());
    setDb(db);
    const res = await fetchShopifyData('brandX');

    expect(res.success).toBe(false); // incomplete — backfill continues next run
    expect(orderCalls).toBe(20); // SHOPIFY_PAGE_CAP, not an unbounded loop
    expect(updates[0]['shopify.ordersSyncPageCursor']).toBe('PINFO21'); // string cursor persisted
  });

  it('clears a stale stored cursor that Shopify rejects on first use', async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/orders.json')) return errPage(400);
      return page('products', [], null);
    });

    const { db, updates } = makeFakeDb(connected({ ordersSyncPageCursor: 'STALE' }));
    setDb(db);
    const res = await fetchShopifyData('brandX');

    expect(res.success).toBe(false);
    // Cursor cleared (delete sentinel, not re-persisted as a string) so next run restarts clean.
    expect('shopify.ordersSyncPageCursor' in updates[0]).toBe(true);
    expect(typeof updates[0]['shopify.ordersSyncPageCursor']).not.toBe('string');
  });
});
