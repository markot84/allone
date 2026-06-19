/** PER-107 / LOGIC-2: the WooCommerce historical backfill never progressed — it had no resume
 * cursor and persisted historyLoadedUntilYear only on full completion, so a store with more than
 * the per-run page cap (30×100) re-fetched the same newest orders forever. These tests pin the fix
 * (Magento pattern): walk historical orders oldest→newest, persist a forward resume cursor EVERY
 * run, and only mark history complete when a run finishes without hitting the cap. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../urlValidator', () => ({ safeFetch: (...args: unknown[]) => safeFetchMock(...args) }));
vi.mock('../../tokenCrypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));

import { parseWooCreatedMs, fetchWooCommerceData, setDb } from '../../woocommerceConnector';
import type { Firestore } from 'firebase-admin/firestore';

// ── parseWooCreatedMs ──────────────────────────────────────────────────────
describe('parseWooCreatedMs', () => {
  it('treats date_created_gmt (no suffix) as UTC', () => {
    expect(parseWooCreatedMs({ date_created_gmt: '2023-05-01T08:00:00' })).toBe(Date.UTC(2023, 4, 1, 8, 0, 0));
  });
  it('honors an explicit Z on date_created_gmt', () => {
    expect(parseWooCreatedMs({ date_created_gmt: '2023-05-01T08:00:00Z' })).toBe(Date.UTC(2023, 4, 1, 8, 0, 0));
  });
  it('falls back to offset-bearing date_created', () => {
    expect(parseWooCreatedMs({ date_created: '2023-05-01T10:00:00+02:00' })).toBe(Date.UTC(2023, 4, 1, 8, 0, 0));
  });
  it('returns NaN when no date is present', () => {
    expect(Number.isNaN(parseWooCreatedMs({}))).toBe(true);
  });
});

// ── fetchWooCommerceData backfill (mocked HTTP + fake Firestore) ────────────
type Patch = Record<string, unknown>;
function makeFakeDb(woocommerce: Record<string, unknown>) {
  const updates: Patch[] = [];
  const db = {
    doc() {
      return {
        get: async () => ({ data: () => ({ woocommerce }) }),
        update: async (patch: Patch) => { updates.push(patch); },
        set: async () => {},
      };
    },
    collection() {
      return { doc: () => ({}), add: async () => {} };
    },
    batch() {
      return { set: () => {}, commit: async () => {} };
    },
  } as unknown as Firestore;
  return { db, updates };
}

function wooRes(items: unknown[], totalPages: number): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-wp-totalpages' ? String(totalPages) : null) },
    json: async () => items,
  } as unknown as Response;
}

const connected = (extra: Record<string, unknown> = {}) => ({
  connected: true,
  consumerKey: 'ck',
  consumerSecret: 'cs',
  storeUrl: 'https://shop.test',
  ...extra,
});

beforeEach(() => safeFetchMock.mockReset());

describe('fetchWooCommerceData historical backfill', () => {
  it('walks oldest→newest and persists a forward resume cursor when the page cap is hit', async () => {
    const BASE = Date.UTC(2021, 0, 1);
    const ordersUrls: string[] = [];
    let lastReturnedMs = 0;
    safeFetchMock.mockImplementation(async (url?: string) => {
      if (String(url).includes('/orders?')) {
        ordersUrls.push(String(url));
        const page = parseInt(new URL(String(url)).searchParams.get('page') || '1', 10);
        const items = Array.from({ length: 100 }, (_, j) => {
          const ms = BASE + ((page - 1) * 100 + j) * 1000;
          lastReturnedMs = Math.max(lastReturnedMs, ms);
          return { id: (page - 1) * 100 + j, date_created_gmt: new Date(ms).toISOString().slice(0, -1), line_items: [] };
        });
        return wooRes(items, 50); // 50 pages available → trips the 30-page cap
      }
      return wooRes([], 1); // products: empty
    });

    const { db, updates } = makeFakeDb(connected());
    setDb(db);
    const res = await fetchWooCommerceData('brandX');

    expect(res.success).toBe(false); // incomplete — backfill continues next run
    expect(ordersUrls.length).toBe(30); // bounded by the cap, did not loop forever

    const first = new URL(ordersUrls[0]);
    expect(first.searchParams.get('order')).toBe('asc'); // oldest-first so the cursor advances
    expect(first.searchParams.get('after')).toBeTruthy();
    expect(first.searchParams.get('modified_after')).toBeNull();
    expect(first.searchParams.get('before')).toBeNull();
    expect(first.searchParams.get('dates_are_gmt')).toBe('true'); // GMT basis matches the UTC cursor/bounds

    // Cursor persisted (Date, 1s BEFORE the newest imported so the exclusive `after` re-reads the
    // boundary second next run instead of skipping a same-second cluster), history NOT yet complete.
    const cursor = updates[0]['woocommerce.ordersHistoryCursor'] as Date;
    expect(cursor).toBeInstanceOf(Date);
    expect(cursor.getTime()).toBe(lastReturnedMs - 1000);
    expect('woocommerce.lastOrdersSyncAt' in updates[0]).toBe(false);
    expect('woocommerce.historyLoadedUntilYear' in updates[0]).toBe(false);
  });

  it('steps the cursor back into the boundary second so a same-second cluster cut by the cap is not skipped', async () => {
    // Every imported order shares ONE second S and 31 pages exist (caps at 30): the cap can cut a
    // same-second cluster, so the persisted cursor must land BEFORE S so the next run's exclusive
    // `after` re-includes second S rather than skipping the un-imported remainder.
    const S = Date.UTC(2022, 5, 15, 12, 0, 0);
    let orderCalls = 0;
    safeFetchMock.mockImplementation(async (url?: string) => {
      if (String(url).includes('/orders?')) {
        orderCalls++;
        return wooRes(
          Array.from({ length: 100 }, (_, j) => ({ id: orderCalls * 100 + j, date_created_gmt: new Date(S).toISOString().slice(0, -1), line_items: [] })),
          31,
        );
      }
      return wooRes([], 1);
    });

    const { db, updates } = makeFakeDb(connected());
    setDb(db);
    await fetchWooCommerceData('brandX');

    const cursor = updates[0]['woocommerce.ordersHistoryCursor'] as Date;
    expect(cursor.getTime()).toBe(S - 1000); // strictly before S → exclusive `after` re-reads second S
  });

  it('resumes from a stored cursor and, on completion, clears it + marks history loaded', async () => {
    const storedCursor = new Date(Date.now() - 100 * 24 * 3600 * 1000); // 100 days ago, inside the 3y window
    const ordersUrls: string[] = [];
    safeFetchMock.mockImplementation(async (url?: string) => {
      if (String(url).includes('/orders?')) {
        ordersUrls.push(String(url));
        return wooRes([{ id: 1, date_created_gmt: '2024-01-01T00:00:00', line_items: [] }], 1); // single page → completes
      }
      return wooRes([], 1);
    });

    const { db, updates } = makeFakeDb(connected({ ordersHistoryCursor: storedCursor }));
    setDb(db);
    await fetchWooCommerceData('brandX');

    // Resumed from the stored cursor, not the 3-year mark.
    expect(new URL(ordersUrls[0]).searchParams.get('after')).toBe(storedCursor.toISOString());

    // Completed → cursor cleared (delete sentinel, not a Date) + history marked loaded.
    expect(updates[0]['woocommerce.ordersHistoryCursor']).not.toBeInstanceOf(Date);
    expect('woocommerce.ordersHistoryCursor' in updates[0]).toBe(true);
    expect('woocommerce.lastOrdersSyncAt' in updates[0]).toBe(true);
    expect(updates[0]['woocommerce.historyLoadedUntilYear']).toBe(new Date().getUTCFullYear() - 3);
  });

  it('incremental mode uses modified_after newest-first and never touches the cursor', async () => {
    const ordersUrls: string[] = [];
    safeFetchMock.mockImplementation(async (url?: string) => {
      if (String(url).includes('/orders?')) {
        ordersUrls.push(String(url));
        return wooRes([{ id: 1, date_created_gmt: '2026-06-01T00:00:00', line_items: [] }], 1);
      }
      return wooRes([], 1);
    });

    const { db, updates } = makeFakeDb(
      connected({ historyLoadedUntilYear: new Date().getUTCFullYear() - 3, lastOrdersSyncAt: new Date(Date.now() - 3600 * 1000) }),
    );
    setDb(db);
    await fetchWooCommerceData('brandX');

    const first = new URL(ordersUrls[0]);
    expect(first.searchParams.get('order')).toBe('desc');
    expect(first.searchParams.get('modified_after')).toBeTruthy();
    expect(first.searchParams.get('after')).toBeNull();
    expect('woocommerce.lastOrdersSyncAt' in updates[0]).toBe(true);
    expect('woocommerce.ordersHistoryCursor' in updates[0]).toBe(false);
    expect('woocommerce.historyLoadedUntilYear' in updates[0]).toBe(false);
  });
});
