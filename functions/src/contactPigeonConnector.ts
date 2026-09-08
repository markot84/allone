/** ContactPigeon (PER-294) — marketing-automation connector.
 * Public API: POST https://ping.contactpigeon.com/bi/api/3/ with a single multipart `payload` JSON field
 * ({ api_key, ci, when, get_action, ... }). Documented READ actions only:
 *   - get_lists            account groups/lists (only account-level, enumerable call)
 *   - profile     (cuem)   one subscriber's full profile by email
 *   - webhistory  (cuem)   one subscriber's browse/event history, paginated (goffset/batch/sort_order)
 *   - billboard   (cuem)   one subscriber's ranking
 * SPIKE SCOPE (PER-294): prove fetch + nightly-safety. We store the encrypted api_key (the connection)
 * but DO NOT persist any fetched data. There is no campaign/KPI endpoint and no contact-enumeration
 * endpoint in CP's documentation — see the Jira comment / internal/pentest/cp-probe.mjs. */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { encryptToken, decryptToken } from './tokenCrypto';

let _db: Firestore | null = null;
export function setDb(db: Firestore) {
  _db = db;
}
function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

// Fixed public host — no user-supplied URL, so no SSRF surface (plain fetch is fine).
const CP_API_URL = 'https://ping.contactpigeon.com/bi/api/3/';
const CP_TIMEOUT_MS = 60_000;
const CP_RETRIES = 3;
// Fixed pool for per-contact reads: CP is a shared external API — a polite client, not a maximal one.
const CP_CONTACT_CONCURRENCY = 5;

const nowTs = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CpResponse {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
  raw: string;
}

/** One CP call. Per-request AbortController timeout + bounded exponential backoff on network/5xx.
 * CP answers HTTP 200 even for logical errors (success:false / raw text), so callers inspect the body. */
async function cpCall(payload: Record<string, unknown>, retries = CP_RETRIES): Promise<CpResponse> {
  for (let attempt = 0; ; attempt++) {
    const body = new FormData();
    body.set('payload', JSON.stringify({ ci: '', when: nowTs(), ...payload }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CP_TIMEOUT_MS);
    try {
      const res = await fetch(CP_API_URL, { method: 'POST', body, signal: ctrl.signal });
      const raw = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      if (res.status >= 500 && attempt < retries) {
        clearTimeout(timer);
        await sleep(300 * 2 ** attempt);
        continue;
      }
      return { ok: res.ok, status: res.status, json, raw };
    } catch (err) {
      if (attempt < retries) {
        clearTimeout(timer);
        await sleep(300 * 2 ** attempt);
        continue;
      }
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
      return { ok: false, status: 0, json: null, raw: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

const cpArray = (r: CpResponse): Record<string, unknown>[] =>
  Array.isArray(r.json?.data) ? (r.json!.data as Record<string, unknown>[]) : [];

// ---- Documented read endpoints (each takes an api_key already resolved) --------------------------

export const cpGetLists = (apiKey: string) => cpCall({ api_key: apiKey, get_action: 'get_lists' });
export const cpGetProfile = (apiKey: string, email: string) =>
  cpCall({ api_key: apiKey, cuem: email, get_action: 'profile' });
export const cpGetBillboard = (
  apiKey: string,
  email: string,
  opts: { full?: boolean; time_period?: '' | 'week' | 'month' | 'year'; region?: string; source_contains?: string } = {}
) =>
  cpCall({
    api_key: apiKey,
    cuem: email,
    get_action: 'billboard',
    // full-mode returns the whole subscriber ranking; default returns the contact + nearest neighbours.
    ...(opts.full ? { btype: 'full' } : {}),
    filter: { time_period: opts.time_period ?? '', region: opts.region ?? '', source_contains: opts.source_contains ?? '' },
  });
export const cpGetWebHistory = (
  apiKey: string,
  email: string,
  opts: { goffset?: number; batch?: number; sort_order?: 'ASC' | 'DESC'; url_contains?: string } = {}
) =>
  cpCall({
    api_key: apiKey,
    cuem: email,
    get_action: 'webhistory',
    goffset: opts.goffset ?? 0,
    batch: opts.batch ?? 100,
    sort_order: opts.sort_order ?? 'DESC',
    url_contains: opts.url_contains ?? '',
    filter: [],
  });

/** Bounded-concurrency map that never accumulates results: caller folds each into a running summary
 * and we drop it. Peak heap is O(concurrency), not O(N) — this is what keeps a nightly per-contact
 * fetch flat-memory (no OOM) regardless of contact count. */
async function streamPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const runNext = async (): Promise<void> => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
}

// ---- Connection lifecycle ------------------------------------------------------------------------

export async function testContactPigeonConnection(apiKey: string): Promise<{ success: boolean; lists?: number; error?: string }> {
  const r = await cpGetLists(apiKey.trim());
  if (r.json?.success === true) return { success: true, lists: cpArray(r).length };
  return { success: false, error: `CP get_lists απέτυχε — HTTP ${r.status} ${String(r.raw).slice(0, 160)}` };
}

export async function saveContactPigeonCredentials(
  brandId: string,
  params: { apiKey: string }
): Promise<{ success: boolean; lists?: number; error?: string }> {
  const test = await testContactPigeonConnection(params.apiKey);
  if (!test.success) return { success: false, error: test.error };

  const ref = getDb().doc(`connectors/${brandId}`);
  const prev = ((await ref.get()).data()?.contact_pigeon || {}) as Record<string, unknown>;
  await ref.set(
    {
      contact_pigeon: {
        ...prev,
        connected: true,
        apiKey: encryptToken(params.apiKey.trim()),
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
  logger.info(`[ContactPigeon] Connected brand ${brandId} (${test.lists} lists)`);
  return { success: true, lists: test.lists };
}

export interface ContactPigeonSyncResult {
  success: boolean;
  imported: number;
  lists?: number;
  contactsProbed?: number;
  events?: number;
  error?: string;
}

/** Nightly/manual fetch. SPIKE: consumes the documented reads and returns counts — persists NOTHING.
 * get_lists is the only account-level (enumerable) call; per-contact reads run only for an optional
 * `sampleEmails` array on the connection doc, to demonstrate + timing-prove the per-contact path. */
export async function fetchContactPigeonData(brandId: string): Promise<ContactPigeonSyncResult> {
  const db = getDb();
  const conn = (await db.doc(`connectors/${brandId}`).get()).data()?.contact_pigeon as
    | Record<string, unknown>
    | undefined;
  if (!conn?.connected || !conn?.apiKey) {
    return { success: false, imported: 0, error: 'ContactPigeon not connected' };
  }
  const apiKey = decryptToken(conn.apiKey as string);
  if (!apiKey) return { success: false, imported: 0, error: 'ContactPigeon: λείπει api_key' };

  try {
    const listsRes = await cpGetLists(apiKey);
    if (listsRes.json?.success !== true) {
      return { success: false, imported: 0, error: `get_lists HTTP ${listsRes.status} ${String(listsRes.raw).slice(0, 120)}` };
    }
    const lists = cpArray(listsRes).length;

    // Per-contact demonstration path (opt-in via a seed list; CP has no contact-enumeration endpoint).
    const sampleEmails = Array.isArray(conn.sampleEmails) ? (conn.sampleEmails as string[]).filter(Boolean) : [];
    let contactsProbed = 0;
    let events = 0;
    if (sampleEmails.length) {
      await streamPool(sampleEmails, CP_CONTACT_CONCURRENCY, async (email) => {
        // Exercise all three per-contact read endpoints: profile, webhistory, billboard.
        const [profile, web] = await Promise.all([
          cpGetProfile(apiKey, email),
          cpGetWebHistory(apiKey, email, { batch: 100 }),
          cpGetBillboard(apiKey, email),
        ]);
        if (profile.json?.success === true) contactsProbed++;
        events += Number(web.json?.total_count ?? 0);
      });
    }

    logger.info(`[ContactPigeon] fetch ${brandId}: lists=${lists} contactsProbed=${contactsProbed} events=${events} (no persistence — spike)`);
    return { success: true, imported: lists, lists, contactsProbed, events };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[ContactPigeon] fetchContactPigeonData ${brandId}:`, { alertKey: ALERT.contactPigeonSyncFailed, err: msg });
    return { success: false, imported: 0, error: msg };
  }
}
