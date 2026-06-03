/**
 * Entersoft Business Suite — Web API connector
 *
 * Δημοσιευμένα paths από entersoftsa/eswebapi (`ESWEBAPI_URL`):
 * - POST {base}api/Login/Login  (openSession)
 * - GET/POST {base}api/rpc/PublicQuery/{groupId}/{filterId}
 *
 * Το `Model` στο login περνάει ως credentials (UserID, Password, BranchID, κ.λπ.).
 * Για πλήρη sync απαιτείται Public Query Group/Filter από την εγκατάσταση Entersoft.
 */

import * as admin from 'firebase-admin';
import { safeFetch } from './urlValidator';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { erpWriteBatch, normalizeHttpBase, sanitizeFirestoreDocId } from './erpConnectorFirestore';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const ES_TIMEOUT_MS = 120_000;
const ES_UA = 'PerformancePlus-EntersoftConnector/1.0';

function normalizeWebApiBase(raw: string): string {
  let s = normalizeHttpBase(raw, false);
  if (!s) return '';
  if (!s.endsWith('/')) s = `${s}/`;
  return s;
}

async function esPostJson(url: string, body: unknown, authBearer?: string): Promise<{ ok: boolean; status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ES_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': ES_UA,
    };
    if (authBearer) {
      headers.Authorization = authBearer.startsWith('Bearer ') ? authBearer : `Bearer ${authBearer}`;
    }
    const res = await safeFetch(url, {
      method: 'POST',
      headers,
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

async function esGet(url: string, bearer: string, params?: Record<string, string>): Promise<{ ok: boolean; status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ES_TIMEOUT_MS);
  try {
    let u = url;
    if (params && Object.keys(params).length) {
      const q = new URLSearchParams(params);
      u = `${url}${url.includes('?') ? '&' : '?'}${q.toString()}`;
    }
    const res = await safeFetch(u, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`,
        'User-Agent': ES_UA,
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

function extractToken(model: unknown): string | null {
  if (!model || typeof model !== 'object') return null;
  const m = model as Record<string, unknown>;
  const t = m.WebApiToken ?? m.webApiToken;
  return t != null ? String(t) : null;
}

export interface EntersoftTestResult {
  success: boolean;
  userName?: string;
  error?: string;
}

export async function testEntersoftConnection(params: {
  webApiBaseUrl: string;
  userId: string;
  password: string;
  branchId?: string;
  langId?: string;
  subscriptionId?: string;
  subscriptionPassword?: string;
  bridgeId?: string;
  extraPin?: string;
}): Promise<EntersoftTestResult> {
  const base = normalizeWebApiBase(params.webApiBaseUrl);
  if (!base) return { success: false, error: 'Λείπει το Entersoft Web API URL' };

  const loginBody: Record<string, unknown> = {
    SubscriptionID: params.subscriptionId?.trim() || '',
    SubscriptionPassword: params.subscriptionPassword || '',
    BridgeID: params.bridgeId?.trim() || '',
    ExtraPin: params.extraPin || '',
    Model: {
      UserID: params.userId.trim(),
      Password: params.password,
      BranchID: params.branchId?.trim() || '-',
      LangID: params.langId?.trim() || 'el-GR',
    },
    Claims: null,
    IsExternal: false,
  };

  const res = await esPostJson(`${base}api/Login/Login`, loginBody);
  if (!res.ok) return { success: false, error: `Login HTTP ${res.status} — ${String(res.raw).slice(0, 160)}` };

  const data = res.json as Record<string, unknown> | null;
  const model = data?.Model ?? data?.model;
  const token = extractToken(model);
  if (!token) {
    const messages = data?.Messages ?? data?.messages;
    const msg = Array.isArray(messages) ? String(messages[0] || '') : String(data?.UserMessage || data?.message || '');
    return { success: false, error: msg.slice(0, 220) || 'Άκυρο αποτέλεσμα login (χωρίς WebApiToken)' };
  }

  const name = model && typeof model === 'object' ? String((model as Record<string, unknown>).Name ?? '') : '';
  return { success: true, userName: name || params.userId };
}

export async function saveEntersoftCredentials(
  brandId: string,
  params: {
    webApiBaseUrl: string;
    userId: string;
    password: string;
    branchId?: string;
    langId?: string;
    subscriptionId?: string;
    subscriptionPassword?: string;
    bridgeId?: string;
    extraPin?: string;
    publicQueryGroupId?: string;
    publicQueryFilterId?: string;
    publicQueryMethod?: 'GET' | 'POST';
  }
): Promise<{ success: boolean; error?: string }> {
  const test = await testEntersoftConnection(params);
  if (!test.success) return { success: false, error: test.error };

  const base = normalizeWebApiBase(params.webApiBaseUrl);
  const ref = getDb().doc(`connectors/${brandId}`);
  const prev = ((await ref.get()).data()?.entersoft || {}) as Record<string, unknown>;

  await ref.set(
    {
      entersoft: {
        ...prev,
        connected: true,
        webApiBaseUrl: base,
        userId: params.userId.trim(),
        password: encryptToken(params.password),
        branchId: params.branchId?.trim() || '-',
        langId: params.langId?.trim() || 'el-GR',
        subscriptionId: params.subscriptionId?.trim() || '',
        subscriptionPassword: params.subscriptionPassword ? encryptToken(params.subscriptionPassword) : '',
        bridgeId: params.bridgeId?.trim() || '',
        extraPin: params.extraPin || '',
        publicQueryGroupId: String(params.publicQueryGroupId || '').trim(),
        publicQueryFilterId: String(params.publicQueryFilterId || '').trim(),
        publicQueryMethod: params.publicQueryMethod === 'POST' ? 'POST' : 'GET',
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[Entersoft] Connected brand ${brandId}`);
  return { success: true };
}

function normalizePQRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.rows)) return d.rows as Record<string, unknown>[];
    if (Array.isArray(d.data)) return d.data as Record<string, unknown>[];
    if (typeof d.PQResults === 'string') {
      try {
        const p = JSON.parse(d.PQResults) as unknown;
        if (Array.isArray(p)) return p as Record<string, unknown>[];
      } catch {
        return [];
      }
    }
  }
  return [];
}

export interface EntersoftSyncResult {
  success: boolean;
  imported: number;
  publicQueryRows?: number;
  error?: string;
}

export async function fetchEntersoftData(brandId: string): Promise<EntersoftSyncResult> {
  const db = getDb();
  const docSnap = await db.doc(`connectors/${brandId}`).get();
  const conn = docSnap.data()?.entersoft as Record<string, unknown> | undefined;

  if (!conn?.connected || !conn?.password) {
    return { success: false, imported: 0, error: 'Entersoft not connected' };
  }

  const base = normalizeWebApiBase(String(conn.webApiBaseUrl || ''));
  const userId = String(conn.userId || '');
  const password = decryptToken(conn.password as string);
  if (!base || !userId || !password) {
    return { success: false, imported: 0, error: 'Entersoft: incomplete credentials' };
  }

  const subPass = conn.subscriptionPassword ? decryptToken(conn.subscriptionPassword as string) : '';

  const loginBody: Record<string, unknown> = {
    SubscriptionID: String(conn.subscriptionId || ''),
    SubscriptionPassword: subPass,
    BridgeID: String(conn.bridgeId || ''),
    ExtraPin: String(conn.extraPin || ''),
    Model: {
      UserID: userId,
      Password: password,
      BranchID: String(conn.branchId || '-'),
      LangID: String(conn.langId || 'el-GR'),
    },
    Claims: null,
    IsExternal: false,
  };

  const login = await esPostJson(`${base}api/Login/Login`, loginBody);
  if (!login.ok) return { success: false, imported: 0, error: `Login HTTP ${login.status}` };
  const model = (login.json as Record<string, unknown> | null)?.Model ?? (login.json as Record<string, unknown> | null)?.model;
  const token = extractToken(model);
  if (!token) {
    return { success: false, imported: 0, error: 'Entersoft login: χωρίς WebApiToken' };
  }

  const group = String(conn.publicQueryGroupId || '').trim();
  const filter = String(conn.publicQueryFilterId || '').trim();
  const method = conn.publicQueryMethod === 'POST' ? 'POST' : 'GET';

  let totalImported = 0;
  const counts = { publicQueryRows: 0 };
  const mode = 'snapshot';

  try {
    if (group && filter) {
      const path = `api/rpc/PublicQuery/${encodeURIComponent(group)}/${encodeURIComponent(filter)}`;
      const url = `${base}${path}`;
      let pqJson: unknown;
      if (method === 'GET') {
        const g = await esGet(url, token, {});
        if (!g.ok) {
          await db.collection('import_jobs').add({
            brandId,
            type: 'finances',
            source: 'entersoft_web_api',
            status: 'failed',
            mode,
            publicQueryMode: mode,
            imported: 0,
            errors: [`PublicQuery HTTP ${g.status}: ${String(g.raw).slice(0, 200)}`],
            createdAt: FieldValue.serverTimestamp(),
          });
          return { success: false, imported: 0, error: `PublicQuery HTTP ${g.status}` };
        }
        pqJson = g.json;
      } else {
        const p = await esPostJson(url, {}, token);
        if (!p.ok) {
          await db.collection('import_jobs').add({
            brandId,
            type: 'finances',
            source: 'entersoft_web_api',
            status: 'failed',
            mode,
            publicQueryMode: mode,
            imported: 0,
            errors: [`PublicQuery POST HTTP ${p.status}`],
            createdAt: FieldValue.serverTimestamp(),
          });
          return { success: false, imported: 0, error: `PublicQuery POST HTTP ${p.status}` };
        }
        pqJson = p.json;
      }

      const rows = normalizePQRows(pqJson);
      const docs = rows.map((row, idx) => ({
        id: `es_pq_${sanitizeFirestoreDocId(brandId)}_${sanitizeFirestoreDocId(group)}_${sanitizeFirestoreDocId(filter)}_${idx}`,
        data: {
          groupId: group,
          filterId: filter,
          rowIndex: idx,
          row,
          source: 'entersoft_web_api',
        },
      }));
      if (docs.length) await erpWriteBatch(db, 'entersoft_public_query_rows', brandId, docs);
      counts.publicQueryRows = docs.length;
      totalImported += docs.length;
    }

    await db.doc(`connectors/${brandId}`).update({
      'entersoft.lastSyncAt': FieldValue.serverTimestamp(),
      'entersoft.lastPublicQuerySyncAt': FieldValue.serverTimestamp(),
    });

    await db.collection('import_jobs').add({
      brandId,
      type: 'finances',
      source: 'entersoft_web_api',
      status: 'completed',
      mode,
      publicQueryMode: mode,
      imported: totalImported,
      ...counts,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, imported: totalImported, ...counts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Entersoft] fetchEntersoftData ${brandId}:`, msg);
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
