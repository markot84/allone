/**
 * Epsilon Net — Epsilon Smart e-Shop API connector
 *
 * Τεκμηρίωση: Manual E-shop API (myaccount.epsilonnet.gr + smartUrl από LoginToSubscription).
 * - POST https://myaccount.epsilonnet.gr/api/Account/LoginToSubscription
 * - GET  {url2}api/Eshop/GetItems?RevisionNumber=...
 * - GET  {url2}api/Eshop/GetItemsBalances
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { safeFetch } from './urlValidator';
import { erpWriteBatch, erpNum, sanitizeFirestoreDocId } from './erpConnectorFirestore';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const MYACCOUNT_BASE = 'https://myaccount.epsilonnet.gr';
const EPS_TIMEOUT_MS = 120_000;
const EPS_UA = 'PerformancePlus-EpsilonNetConnector/1.0';

function normalizeSmartUrl(url2: string): string {
  let s = String(url2 || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  if (!s.endsWith('/')) s = `${s}/`;
  // SEC-M9: every smartBase request carries the bearer JWT, so pin the host to EpsilonNet
  // (https only) before trusting the API-supplied url2 — a compromised/MITM upstream can't
  // redirect the token to an attacker host. Reject anything that isn't *.epsilonnet.gr.
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase();
    if (host !== 'epsilonnet.gr' && !host.endsWith('.epsilonnet.gr')) return '';
  } catch {
    return '';
  }
  return s;
}

async function epsilonPostJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EPS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain',
        'User-Agent': EPS_UA,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, raw: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function epsilonGetJson(url: string, bearer: string): Promise<{ ok: boolean; status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EPS_TIMEOUT_MS);
  try {
    // SEC-M9: safeFetch re-validates every redirect hop, so even a *.epsilonnet.gr base
    // can't 30x-bounce the bearer token to an internal/private address.
    const res = await safeFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain',
        Authorization: bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`,
        'User-Agent': EPS_UA,
      },
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, raw: msg };
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export interface EpsilonLoginResult {
  jwt: string;
  jwtRefreshToken: string;
  url2: string;
}

function parseLoginResponse(json: unknown): { ok: true; data: EpsilonLoginResult } | { ok: false; error: string } {
  if (!json || typeof json !== 'object') return { ok: false, error: 'Άκυρη απάντηση login' };
  const o = json as Record<string, unknown>;
  const jwt = String(pick(o, 'jwt', 'Jwt') ?? '');
  const refresh = String(pick(o, 'jwtRefreshToken', 'JwtRefreshToken') ?? '');
  const url2 = String(pick(o, 'url2', 'Url2') ?? '');
  if (!jwt || !url2) {
    const msg = String(o.message || o.Message || o.error || '').slice(0, 200);
    return { ok: false, error: msg || 'Λείπει jwt ή url2 από LoginToSubscription' };
  }
  return { ok: true, data: { jwt, jwtRefreshToken: refresh, url2 } };
}

export async function testEpsilonNetConnection(params: {
  subscriptionKey: string;
  email: string;
  password: string;
}): Promise<{ success: boolean; smartHost?: string; error?: string }> {
  const login = await epsilonPostJson(`${MYACCOUNT_BASE}/api/Account/LoginToSubscription`, {
    subscriptionKey: params.subscriptionKey.trim(),
    email: params.email.trim(),
    password: params.password,
  });
  if (!login.ok) {
    return {
      success: false,
      error: `Login HTTP ${login.status} — ${String(login.raw).slice(0, 160)}`,
    };
  }
  const parsed = parseLoginResponse(login.json);
  if (!parsed.ok) return { success: false, error: parsed.error };
  try {
    const host = new URL(parsed.data.url2).hostname;
    return { success: true, smartHost: host };
  } catch {
    return { success: true, smartHost: parsed.data.url2 };
  }
}

export async function saveEpsilonNetCredentials(
  brandId: string,
  params: { subscriptionKey: string; email: string; password: string }
): Promise<{ success: boolean; smartHost?: string; error?: string }> {
  const test = await testEpsilonNetConnection(params);
  if (!test.success) return { success: false, error: test.error };

  const ref = getDb().doc(`connectors/${brandId}`);
  const prev = ((await ref.get()).data()?.epsilon_net || {}) as Record<string, unknown>;

  await ref.set(
    {
      epsilon_net: {
        ...prev,
        connected: true,
        subscriptionKey: encryptToken(params.subscriptionKey.trim()),
        email: params.email.trim(),
        password: encryptToken(params.password),
        lastItemsMaxRevision: prev.lastItemsMaxRevision ?? 0,
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[EpsilonNet] Connected brand ${brandId}`);
  return { success: true, smartHost: test.smartHost };
}

async function epsilonLogin(
  subscriptionKey: string,
  email: string,
  password: string
): Promise<{ ok: true; data: EpsilonLoginResult } | { ok: false; error: string }> {
  const login = await epsilonPostJson(`${MYACCOUNT_BASE}/api/Account/LoginToSubscription`, {
    subscriptionKey: subscriptionKey.trim(),
    email: email.trim(),
    password,
  });
  if (!login.ok) return { ok: false, error: `Login HTTP ${login.status}` };
  const p = parseLoginResponse(login.json);
  if (!p.ok) return { ok: false, error: p.error };
  return { ok: true, data: p.data };
}

async function epsilonRefreshTokens(
  jwt: string,
  refreshToken: string
): Promise<{ ok: true; jwt: string; refresh: string } | { ok: false; error: string }> {
  const rawJwt = jwt.replace(/^Bearer\s+/i, '');
  const r = await epsilonPostJson(`${MYACCOUNT_BASE}/api/Token/Refresh`, {
    token: rawJwt,
    refreshToken,
  });
  if (!r.ok) return { ok: false, error: `Refresh HTTP ${r.status}` };
  const o = r.json as Record<string, unknown> | null;
  if (!o) return { ok: false, error: 'Άκυρη απάντηση refresh' };
  const newJwt = String(pick(o, 'jwt', 'Jwt') ?? '');
  const ref_NEW = String(pick(o, 'jwtRefreshToken', 'JwtRefreshToken') ?? '');
  if (!newJwt) return { ok: false, error: 'Refresh: λείπει jwt' };
  return { ok: true, jwt: newJwt, refresh: ref_NEW || refreshToken };
}

export interface EpsilonNetSyncResult {
  success: boolean;
  imported: number;
  items?: number;
  balances?: number;
  error?: string;
}

export async function fetchEpsilonNetData(brandId: string): Promise<EpsilonNetSyncResult> {
  const db = getDb();
  const docSnap = await db.doc(`connectors/${brandId}`).get();
  const conn = docSnap.data()?.epsilon_net as Record<string, unknown> | undefined;

  if (!conn?.connected || !conn?.password || !conn?.subscriptionKey) {
    return { success: false, imported: 0, error: 'Epsilon Net not connected' };
  }

  const subKey = decryptToken(conn.subscriptionKey as string);
  const email = String(conn.email || '');
  const password = decryptToken(conn.password as string);
  if (!subKey || !email || !password) {
    return { success: false, imported: 0, error: 'Epsilon Net: λείπουν διαπιστευτήρια' };
  }

  let loginRes = await epsilonLogin(subKey, email, password);
  if (!loginRes.ok) return { success: false, imported: 0, error: loginRes.error };

  let bearerJwt = loginRes.data.jwt.replace(/^Bearer\s+/i, '');
  let refreshTok = loginRes.data.jwtRefreshToken;
  const smartBase = normalizeSmartUrl(loginRes.data.url2);
  if (!smartBase) return { success: false, imported: 0, error: 'Λείπει url2 από login' };

  const fetchWithAuth = async (path: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
    const url = `${smartBase}${path.startsWith('/') ? path.slice(1) : path}`;
    let res = await epsilonGetJson(url, bearerJwt);
    if (res.status === 401 && refreshTok) {
      const ref = await epsilonRefreshTokens(bearerJwt, refreshTok);
      if (ref.ok) {
        bearerJwt = ref.jwt.replace(/^Bearer\s+/i, '');
        refreshTok = ref.refresh;
        res = await epsilonGetJson(url, bearerJwt);
      }
    }
    return { ok: res.ok, status: res.status, json: res.json };
  };

  let totalImported = 0;
  const counts = { items: 0, balances: 0 };
  const errors: string[] = [];

  try {
    const storedMax = Number(conn.lastItemsMaxRevision || 0);
    const itemsMode = storedMax > 0 ? 'incremental' : 'historical';
    let fromRevision = storedMax > 0 ? storedMax + 1 : 0;
    if (!Number.isFinite(fromRevision) || fromRevision < 0) fromRevision = 0;
    const itemsRevisionStart = fromRevision;
    logger.info(`[EpsilonNet] Sync window for ${brandId}: items=${itemsMode}:revision>=${fromRevision} balances=snapshot`);

    const allItems: Record<string, unknown>[] = [];
    let itemsOk = true;
    let safety = 0;
    while (safety < 5000) {
      safety++;
      const path = `api/Eshop/GetItems?RevisionNumber=${fromRevision}`;
      const pack = await fetchWithAuth(path);
      if (!pack.ok) {
        itemsOk = false;
        errors.push(`GetItems HTTP ${pack.status}`);
        break;
      }
      const arr = Array.isArray(pack.json) ? (pack.json as Record<string, unknown>[]) : [];
      if (!arr.length) break;
      let maxRev = fromRevision;
      for (const row of arr) {
        const rn = erpNum(pick(row, 'RevisionNumber', 'revisionNumber'));
        if (rn > maxRev) maxRev = rn;
        allItems.push(row);
      }
      if (arr.length < 100) break;
      fromRevision = maxRev + 1;
    }

    const itemDocs = allItems.map((row, idx) => {
      const code = String(pick(row, 'Code', 'code') ?? idx);
      const id = String(pick(row, 'ID', 'id') ?? code);
      return {
        id: `en_item_${sanitizeFirestoreDocId(id || code)}`,
        data: {
          itemId: id,
          code,
          name: pick(row, 'Name', 'name'),
          scanCode: pick(row, 'ScanCode', 'scanCode'),
          eanCode: pick(row, 'EANCode', 'eanCode'),
          category: pick(row, 'Category', 'category'),
          retailPrice: erpNum(pick(row, 'RetailPrice', 'retailPrice')),
          eshopPrice: erpNum(pick(row, 'EshopPrice', 'eshopPrice')),
          wholesalePrice: erpNum(pick(row, 'WholesalePrice', 'wholesalePrice')),
          revisionNumber: erpNum(pick(row, 'RevisionNumber', 'revisionNumber')),
          raw: row,
          source: 'epsilon_net_eshop_api',
        },
      };
    });
    if (itemDocs.length) await erpWriteBatch(db, 'epsilonnet_eshop_items', brandId, itemDocs);
    counts.items = itemDocs.length;
    totalImported += itemDocs.length;

    const maxRevStored = allItems.reduce((m, row) => {
      const rn = erpNum(pick(row, 'RevisionNumber', 'revisionNumber'));
      return rn > m ? rn : m;
    }, storedMax);

    const balRes = await fetchWithAuth('api/Eshop/GetItemsBalances');
    let balRows: Record<string, unknown>[] = [];
    let balancesOk = true;
    if (!balRes.ok) {
      balancesOk = false;
      errors.push(`GetItemsBalances HTTP ${balRes.status}`);
    } else {
      balRows = Array.isArray(balRes.json) ? (balRes.json as Record<string, unknown>[]) : [];
      const balDocs = balRows.map((row, idx) => {
        const itemId = String(pick(row, 'ItemID', 'itemId') ?? idx);
        return {
          id: `en_bal_${sanitizeFirestoreDocId(itemId)}`,
          data: {
            itemId,
            balance: erpNum(pick(row, 'Balance', 'balance')),
            raw: row,
            source: 'epsilon_net_eshop_api',
          },
        };
      });
      if (balDocs.length) await erpWriteBatch(db, 'epsilonnet_eshop_balances', brandId, balDocs);
      counts.balances = balDocs.length;
      totalImported += balDocs.length;
    }

    const patch: Record<string, unknown> = {
      'epsilon_net.lastSyncAt': FieldValue.serverTimestamp(),
    };
    if (itemsOk) {
      patch['epsilon_net.lastItemsMaxRevision'] = maxRevStored;
      patch['epsilon_net.lastItemsSyncAt'] = FieldValue.serverTimestamp();
    }
    if (balancesOk) {
      patch['epsilon_net.lastBalancesSyncAt'] = FieldValue.serverTimestamp();
    }
    await db.doc(`connectors/${brandId}`).update(patch);

    await db.collection('import_jobs').add({
      brandId,
      type: 'finances',
      source: 'epsilon_net_eshop_api',
      status: errors.length ? 'partial' : 'completed',
      mode: itemsMode,
      itemsMode,
      balancesMode: 'snapshot',
      itemsRevisionStart,
      itemsRevisionEnd: maxRevStored,
      imported: totalImported,
      ...counts,
      failed: errors.length,
      errors: errors.slice(0, 20),
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      imported: totalImported,
      ...counts,
      ...(errors.length ? { error: errors[0] } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[EpsilonNet] fetchEpsilonNetData ${brandId}:`, msg);
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
