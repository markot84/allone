/**
 * SoftOne (Soft1) Web Services connector
 *
 * Τεκμηρίωση: https://www.softone.gr/ws/ — POST JSON στο `.../s1services`
 * (login → authenticate → getBrowserInfo / getBrowserData).
 *
 * Firestore: `connectors/{brandId}.softone`
 * Συλλογές: softone_customers, softone_items, softone_sales_documents, softone_purchase_documents
 */

import * as admin from 'firebase-admin';
import { safeFetch } from './urlValidator';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { erpWriteBatch, erpIsoDate, erpNum, normalizeHttpBase, sanitizeFirestoreDocId } from './erpConnectorFirestore';
import { buildHistoricalOrIncrementalWindow, toYmd } from './syncPolicy';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const S1_TIMEOUT_MS = 120_000;
const S1_UA = 'PerformancePlus-SoftOneConnector/1.0';

function normalizeServiceUrl(raw: string): string {
  const base = normalizeHttpBase(raw, false);
  if (!base) return '';
  if (/\/s1services$/i.test(base)) return base;
  return `${base}/s1services`;
}

async function softoneCall(serviceUrl: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  raw: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), S1_TIMEOUT_MS);
  try {
    const res = await safeFetch(serviceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': S1_UA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, raw: msg };
  } finally {
    clearTimeout(timer);
  }
}

function softoneError(call: { data: Record<string, unknown> | null; raw: string; status: number; ok?: boolean }, label: string): string | null {
  const body = call.data;
  if (!body) {
    return `${label}: invalid response (${String(call.raw || '').slice(0, 120)})`;
  }
  if (body.success === true) return null;
  const code = body.errorcode ?? body.errorCode ?? body.errCode;
  const msg = String(body.error || body.message || body.errmsg || '').trim();
  if (msg) return `${label}: ${msg.slice(0, 200)}${code != null ? ` (code ${code})` : ''}`;
  if (call.status && call.ok === false) return `${label}: HTTP ${call.status}`;
  return `${label}: SoftOne error${code != null ? ` ${code}` : ''}`;
}

async function softonePing(serviceUrl: string): Promise<{ ok: boolean; error?: string }> {
  const base = serviceUrl.replace(/\/s1services$/i, '');
  const pingUrl = `${base}/s1services?ping`;
  try {
    const res = await safeFetch(pingUrl, { method: 'GET', headers: { 'User-Agent': S1_UA } });
    const text = (await res.text()).slice(0, 300);
    if (/ISAPI is working/i.test(text) || /Ping from Softone/i.test(text)) return { ok: true };
    return { ok: res.ok, error: !res.ok ? `HTTP ${res.status}` : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SoftOneSession {
  clientID: string;
  company: string;
  branch: string;
  module: string;
  refId: string;
}

async function softoneOpenSession(
  serviceUrl: string,
  username: string,
  password: string,
  appId: string,
  company?: string,
  branch?: string,
  module?: string,
  refId?: string
): Promise<{ session?: SoftOneSession; error?: string }> {
  const login1 = await softoneCall(serviceUrl, {
    service: 'login',
    username,
    password,
    appId,
  });
  const e1 = softoneError(login1, 'SoftOne login');
  if (e1) return { error: e1 };

  const data1 = login1.data!;
  const tempClient = String(data1.clientID || '');
  if (!tempClient) return { error: 'SoftOne login: missing clientID' };

  let companyF = company?.trim();
  let branchF = branch?.trim();
  let moduleF = module?.trim();
  let refIdF = refId?.trim();

  if (!companyF || !branchF || moduleF === undefined || moduleF === '' || refIdF === undefined || refIdF === '') {
    const objs = data1.objs as Record<string, unknown>[] | undefined;
    const first = objs?.[0];
    if (!first) {
      return {
        error:
          'SoftOne: Το login επέστρεψε επιλογές company/branch — συμπληρώστε COMPANY, BRANCH, MODULE, REFID στη σύνδεση.',
      };
    }
    companyF = String(first.COMPANY ?? companyF ?? '');
    branchF = String(first.BRANCH ?? branchF ?? '');
    moduleF = String(first.MODULE ?? moduleF ?? '0');
    refIdF = String(first.REFID ?? refIdF ?? '1');
  }

  const auth = await softoneCall(serviceUrl, {
    service: 'authenticate',
    clientID: tempClient,
    COMPANY: companyF,
    BRANCH: branchF,
    MODULE: moduleF,
    REFID: refIdF,
  });
  const e2 = softoneError(auth, 'SoftOne authenticate');
  if (e2) return { error: e2 };
  const clientID = String(auth.data?.clientID || '');
  if (!clientID) return { error: 'SoftOne authenticate: missing clientID' };

  return {
    session: {
      clientID,
      company: companyF,
      branch: branchF,
      module: moduleF,
      refId: refIdF,
    },
  };
}

/** Μεταβλητές από getBrowserInfo για mapping γραμμών getBrowserData */
function columnKeysFromBrowserInfo(info: Record<string, unknown>): string[] {
  const cols = info.columns as Record<string, unknown>[] | undefined;
  if (Array.isArray(cols) && cols.length) {
    return cols.map((c, i) => String(c.dataIndex || c.header || `col_${i}`));
  }
  const fields = info.fields as Record<string, unknown>[] | undefined;
  if (Array.isArray(fields) && fields.length) {
    return fields.map((f, i) => String(f.name || f.fullname || `col_${i}`));
  }
  return [];
}

function mapBrowserRows(keys: string[], rows: unknown[][]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const o: Record<string, unknown> = {};
    row.forEach((cell, i) => {
      o[keys[i] || `col_${i}`] = cell;
    });
    out.push(o);
  }
  return out;
}

async function fetchBrowserAll(
  serviceUrl: string,
  clientID: string,
  appId: string,
  objectName: string,
  list: string,
  filters: string,
  label: string
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const infoCall = await softoneCall(serviceUrl, {
    service: 'getBrowserInfo',
    clientID,
    appId,
    OBJECT: objectName,
    LIST: list,
    FILTERS: filters,
    VERSION: 2,
    LIMIT: 500,
  });
  const errI = softoneError(infoCall, `${label} getBrowserInfo`);
  if (errI) return { rows: [], error: errI };

  const info = infoCall.data!;
  const reqID = String(info.reqID || '');
  if (!reqID) return { rows: [], error: `${label}: missing reqID` };

  const keys = columnKeysFromBrowserInfo(info);
  const total = erpNum(info.totalcount);
  const out: Record<string, unknown>[] = [];

  const initialRows = info.rows as unknown[][] | undefined;
  if (Array.isArray(initialRows) && initialRows.length) {
    out.push(...mapBrowserRows(keys, initialRows));
  }

  let start = out.length;
  while (start < total) {
    const dataCall = await softoneCall(serviceUrl, {
      service: 'getBrowserData',
      clientID,
      appId,
      reqID,
      START: start,
      LIMIT: 500,
    });
    const errD = softoneError(dataCall, `${label} getBrowserData`);
    if (errD) {
      if (out.length) logger.warn(`[SoftOne] ${errD} — partial ${out.length} rows`);
      break;
    }
    const chunk = (dataCall.data?.rows as unknown[][]) || [];
    if (!chunk.length) break;
    out.push(...mapBrowserRows(keys, chunk));
    start += chunk.length;
    if (chunk.length < 500) break;
  }

  return { rows: out };
}

export interface SoftOneTestResult {
  success: boolean;
  company?: string;
  error?: string;
}

export async function testSoftOneConnection(params: {
  serviceUrl: string;
  username: string;
  password: string;
  appId: string;
  company?: string;
  branch?: string;
  module?: string;
  refId?: string;
}): Promise<SoftOneTestResult> {
  const serviceUrl = normalizeServiceUrl(params.serviceUrl);
  if (!serviceUrl) return { success: false, error: 'Λείπει το URL του SoftOne Web Services' };

  const ping = await softonePing(serviceUrl);
  if (!ping.ok && ping.error) {
    logger.warn(`[SoftOne] ping optional fail: ${ping.error}`);
  }

  const session = await softoneOpenSession(
    serviceUrl,
    params.username,
    params.password,
    params.appId,
    params.company,
    params.branch,
    params.module,
    params.refId
  );
  if (session.error) return { success: false, error: session.error };
  return { success: true, company: session.session?.company };
}

export async function saveSoftOneCredentials(
  brandId: string,
  params: {
    serviceUrl: string;
    username: string;
    password: string;
    appId: string;
    company?: string;
    branch?: string;
    module?: string;
    refId?: string;
    syncSalesDocs?: boolean;
    syncPurchaseDocs?: boolean;
  }
): Promise<{ success: boolean; company?: string; error?: string }> {
  const serviceUrl = normalizeServiceUrl(params.serviceUrl);
  if (!serviceUrl) return { success: false, error: 'Λείπει service URL' };

  const test = await testSoftOneConnection({
    serviceUrl,
    username: params.username,
    password: params.password,
    appId: params.appId,
    company: params.company,
    branch: params.branch,
    module: params.module,
    refId: params.refId,
  });
  if (!test.success) return { success: false, error: test.error };

  const session = await softoneOpenSession(
    serviceUrl,
    params.username,
    params.password,
    params.appId,
    params.company,
    params.branch,
    params.module,
    params.refId
  );
  if (session.error || !session.session) return { success: false, error: session.error || 'Session failed' };

  const ref = getDb().doc(`connectors/${brandId}`);
  const prev = ((await ref.get()).data()?.softone || {}) as Record<string, unknown>;

  await ref.set(
    {
      softone: {
        ...prev,
        connected: true,
        serviceUrl,
        username: params.username.trim(),
        password: encryptToken(params.password),
        appId: String(params.appId).trim(),
        company: session.session.company,
        branch: session.session.branch,
        module: session.session.module,
        refId: session.session.refId,
        syncSalesDocs: params.syncSalesDocs === true,
        syncPurchaseDocs: params.syncPurchaseDocs === true,
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[SoftOne] Connected brand ${brandId} company=${session.session.company}`);
  return { success: true, company: session.session.company };
}

export interface SoftOneSyncResult {
  success: boolean;
  imported: number;
  customers?: number;
  items?: number;
  salesDocs?: number;
  purchaseDocs?: number;
  error?: string;
}

export async function fetchSoftOneData(brandId: string): Promise<SoftOneSyncResult> {
  const db = getDb();
  const docSnap = await db.doc(`connectors/${brandId}`).get();
  const conn = docSnap.data()?.softone as Record<string, unknown> | undefined;

  if (!conn?.connected || !conn?.password) {
    return { success: false, imported: 0, error: 'SoftOne not connected' };
  }

  const serviceUrl = normalizeServiceUrl(String(conn.serviceUrl || ''));
  const username = String(conn.username || '');
  const password = decryptToken(conn.password as string);
  const appId = String(conn.appId || '');
  if (!serviceUrl || !username || !password || !appId) {
    return { success: false, imported: 0, error: 'SoftOne: incomplete credentials' };
  }

  const session = await softoneOpenSession(
    serviceUrl,
    username,
    password,
    appId,
    String(conn.company || ''),
    String(conn.branch || ''),
    String(conn.module || ''),
    String(conn.refId || '')
  );
  if (session.error || !session.session) {
    return { success: false, imported: 0, error: session.error };
  }

  const { clientID } = session.session;
  let totalImported = 0;
  const counts = { customers: 0, items: 0, salesDocs: 0, purchaseDocs: 0 };
  const errors: string[] = [];

  const docsWindow = buildHistoricalOrIncrementalWindow(conn, 'lastDocsSyncAt');
  const sinceCompact = toYmd(docsWindow.windowStart).replace(/-/g, '');
  let docsOk = true;
  let referenceOk = true;
  logger.info(
    `[SoftOne] Sync window for ${brandId}: docs=${docsWindow.mode}:${toYmd(docsWindow.windowStart)}->${toYmd(docsWindow.windowEnd)} reference=snapshot`
  );

  try {
    // CUSTOMER
    const cRes = await fetchBrowserAll(serviceUrl, clientID, appId, 'CUSTOMER', '', '', 'CUSTOMER');
    if (cRes.error) {
      referenceOk = false;
      errors.push(cRes.error);
    }
    else {
      const items = cRes.rows.map((r, idx) => ({
        id: `s1_c_${sanitizeFirestoreDocId(String(r['CUSTOMER.CODE'] || r.CODE || r['TRDR.CODE'] || idx))}`,
        data: {
          ...r,
          source: 'softone_api',
        },
      }));
      if (items.length) await erpWriteBatch(db, 'softone_customers', brandId, items);
      counts.customers = items.length;
      totalImported += items.length;
    }

    // ITEM
    const iRes = await fetchBrowserAll(serviceUrl, clientID, appId, 'ITEM', '', '', 'ITEM');
    if (iRes.error) {
      referenceOk = false;
      errors.push(iRes.error);
    }
    else {
      const items = iRes.rows.map((r, idx) => ({
        id: `s1_i_${sanitizeFirestoreDocId(String(r['ITEM.CODE'] || r.CODE || r['MTRL.CODE'] || idx))}`,
        data: {
          ...r,
          source: 'softone_api',
        },
      }));
      if (items.length) await erpWriteBatch(db, 'softone_items', brandId, items);
      counts.items = items.length;
      totalImported += items.length;
    }

    if (conn.syncSalesDocs === true) {
      const f = `SALDOC.TRNDATE>=${sinceCompact}`;
      const sRes = await fetchBrowserAll(serviceUrl, clientID, appId, 'SALDOC', '', f, 'SALDOC');
      if (sRes.error) {
        docsOk = false;
        errors.push(sRes.error);
      }
      else {
        const items = sRes.rows.map((r, idx) => ({
          id: `s1_sd_${sanitizeFirestoreDocId(String(r['SALDOC.FINDOC'] || r.FINDOC || r['SALDOC.SERIES'] || idx) + '_' + idx)}`,
          data: {
            ...r,
            documentDate: erpIsoDate(r['SALDOC.TRNDATE'] ?? r.TRNDATE),
            source: 'softone_api',
          },
        }));
        if (items.length) await erpWriteBatch(db, 'softone_sales_documents', brandId, items);
        counts.salesDocs = items.length;
        totalImported += items.length;
      }
    }

    if (conn.syncPurchaseDocs === true) {
      const f = `PURDOC.TRNDATE>=${sinceCompact}`;
      const pRes = await fetchBrowserAll(serviceUrl, clientID, appId, 'PURDOC', '', f, 'PURDOC');
      if (pRes.error) {
        docsOk = false;
        errors.push(pRes.error);
      }
      else {
        const items = pRes.rows.map((r, idx) => ({
          id: `s1_pd_${sanitizeFirestoreDocId(String(r['PURDOC.FINDOC'] || r.FINDOC || idx) + '_' + idx)}`,
          data: {
            ...r,
            documentDate: erpIsoDate(r['PURDOC.TRNDATE'] ?? r.TRNDATE),
            source: 'softone_api',
          },
        }));
        if (items.length) await erpWriteBatch(db, 'softone_purchase_documents', brandId, items);
        counts.purchaseDocs = items.length;
        totalImported += items.length;
      }
    }

    const patch: Record<string, unknown> = {};
    if (referenceOk) {
      patch['softone.lastReferenceSyncAt'] = FieldValue.serverTimestamp();
    }
    if (docsOk) {
      patch['softone.lastDocsSyncAt'] = FieldValue.serverTimestamp();
      if (docsWindow.mode === 'historical') {
        patch['softone.historyLoadedUntilYear'] = docsWindow.historyStartYear;
      }
    }
    if (Object.keys(patch).length) {
      await db.doc(`connectors/${brandId}`).update(patch);
    }

    await db.collection('import_jobs').add({
      brandId,
      type: 'finances',
      source: 'softone_api',
      status: errors.length ? 'partial' : 'completed',
      mode: docsWindow.mode,
      docsMode: docsWindow.mode,
      referenceMode: 'snapshot',
      windowStart: docsWindow.windowStart.toISOString(),
      windowEnd: docsWindow.windowEnd.toISOString(),
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
    logger.error(`[SoftOne] fetchSoftOneData ${brandId}:`, msg);
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
