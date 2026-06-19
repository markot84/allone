/** SoftOne (Soft1) Web Services connector: POST JSON to `.../s1services` (login → authenticate → getBrowserInfo / getBrowserData).
 * Firestore `connectors/{brandId}.softone`; collections softone_customers, softone_items, softone_sales_documents, softone_purchase_documents. */

import * as admin from 'firebase-admin';
import { safeFetch } from './urlValidator';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
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
const S1_MAX_ATTEMPTS = 3;
const S1_RETRY_BASE_MS = 800;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Transient HTTP statuses worth retrying (network reset/abort = 0, rate-limit, server-side 5xx). */
export function isRetryableSoftOneStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/** Retry policy for one SoftOne transport attempt: retry network errors (`threw`) and transient
 * statuses with exponential backoff, up to the attempt cap. Pure ⇒ unit-testable. */
export function planSoftOneRetry(args: {
  attempt: number;
  status: number;
  threw: boolean;
  maxAttempts?: number;
}): { retry: boolean; delayMs: number } {
  const max = args.maxAttempts ?? S1_MAX_ATTEMPTS;
  const transient = args.threw || isRetryableSoftOneStatus(args.status);
  const retry = transient && args.attempt < max;
  return { retry, delayMs: retry ? S1_RETRY_BASE_MS * 2 ** (args.attempt - 1) : 0 };
}

function normalizeServiceUrl(raw: string): string {
  const base = normalizeHttpBase(raw, false);
  if (!base) return '';
  if (/\/s1services$/i.test(base)) return base;
  return `${base}/s1services`;
}

/** SoftOne serves Windows-1253 (Greek ANSI); decode the raw bytes as such unless the response
 * explicitly declares UTF-8. Decoding as UTF-8 (fetch default) destroys Greek text into U+FFFD. */
export function decodeSoftOneBody(buf: ArrayBuffer, contentType?: string | null): string {
  const ct = (contentType ?? '').toLowerCase();
  const charset = /charset=[^;]*utf-?8/.test(ct) ? 'utf-8' : 'windows-1253';
  return new TextDecoder(charset).decode(buf);
}

async function softoneCall(serviceUrl: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  raw: string;
}> {
  let last = { ok: false, status: 0, data: null as Record<string, unknown> | null, raw: '' };
  for (let attempt = 1; attempt <= S1_MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), S1_TIMEOUT_MS);
    let threw = false;
    try {
      const res = await safeFetch(serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': S1_UA },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const raw = decodeSoftOneBody(await res.arrayBuffer(), res.headers.get('content-type'));
      let data: Record<string, unknown> | null = null;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      last = { ok: res.ok, status: res.status, data, raw };
    } catch (err) {
      threw = true;
      last = { ok: false, status: 0, data: null, raw: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
    const plan = planSoftOneRetry({ attempt, status: last.status, threw });
    if (!plan.retry) return last;
    logger.warn(`[SoftOne] transient call failure (attempt ${attempt}/${S1_MAX_ATTEMPTS}, status ${last.status}) — retry in ${plan.delayMs}ms`);
    await sleep(plan.delayMs);
  }
  return last;
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

/** SoftOne getBrowserData rows carry a leading hidden ZOOMINFO key cell, so map by `fields` (the full
 * row schema) not `columns` (visible-only — shifts every value by one). A multi-section browser repeats
 * ZOOMINFO, splitting `fields` into one key-group per section. */
export function fieldGroupsFromBrowserInfo(info: Record<string, unknown>): string[][] {
  const fields = info.fields as Record<string, unknown>[] | undefined;
  const nameAt = (f: Record<string, unknown> | undefined, i: number) => String((f && (f.name || f.fullname)) || `col_${i}`);
  if (Array.isArray(fields) && fields.length) {
    // A multi-section browser repeats its leading key column once per section; split on that marker
    // (derived from the schema, not a hardcoded name, so it generalizes across SoftOne tenants).
    const marker = nameAt(fields[0], 0);
    const groups: string[][] = [];
    let cur: string[] = [];
    fields.forEach((f, i) => {
      const name = nameAt(f, i);
      if (i > 0 && name === marker && cur.length) {
        groups.push(cur);
        cur = [name];
      } else {
        cur.push(name);
      }
    });
    if (cur.length) groups.push(cur);
    return groups;
  }
  const cols = info.columns as Record<string, unknown>[] | undefined;
  if (Array.isArray(cols) && cols.length) {
    return [cols.map((c, i) => String(c.dataIndex || c.header || `col_${i}`))];
  }
  return [[]];
}

function mapRow(keys: string[], row: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  row.forEach((cell, i) => {
    o[keys[i] || `col_${i}`] = cell;
  });
  return o;
}

const isBlank = (v: unknown): boolean => v === '' || v === null || v === undefined;

/** Assemble getBrowserData rows into records. One key-group ⇒ straight positional map. Multiple groups ⇒
 * the rows are the sections concatenated (the same items streamed once per section, different columns
 * each). Section boundaries are detected structurally — the leading key cell (column 0) restarts the
 * catalog at each section — so unequal/short/ragged sections stay aligned (we do NOT assume each section
 * is exactly total/k rows). Rows merge per item by that key (then FLD-1, then row order). For columns a
 * later section repeats, first-non-blank wins, so a trailing blank/0 never clobbers an earlier value. */
export function assembleBrowserRows(
  groups: string[][],
  raw: unknown[][],
  _total: number,
  label = 'SoftOne',
): Record<string, unknown>[] {
  const rows = raw.filter((r): r is unknown[] => Array.isArray(r));
  const k = groups.length;
  if (k <= 1 || rows.length === 0) {
    return rows.map((row) => mapRow(groups[0] ?? [], row));
  }
  // Sections restart the catalog: the leading key cell (col 0) returns to the first item's key, and the
  // per-section row counter (col 1, e.g. FLD-1/A·A) returns to its first value. Use the key when present,
  // else the counter — so a blank key still splits correctly.
  const at = (row: unknown[], i: number): string => String(row[i] ?? '').trim();
  const firstKey = at(rows[0], 0);
  const firstCounter = at(rows[0], 1);
  const useKey = !!firstKey;
  if (!useKey && !firstCounter) {
    logger.warn(`[SoftOne] ${label}: multi-section browser with no key or row-counter — sections may misalign`);
  }
  const byKey = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  let section = 0;
  rows.forEach((row, idx) => {
    const restart = idx > 0 && (useKey ? at(row, 0) === firstKey : !!firstCounter && at(row, 1) === firstCounter);
    if (restart) section = Math.min(section + 1, k - 1);
    const keys = groups[section] ?? groups[0];
    const mapped = mapRow(keys, row);
    // Merge by the key column, else the row counter (both identify the item across sections), else order.
    const mergeKey =
      String(mapped[keys[0]] ?? '').trim() || String(mapped[keys[1]] ?? '').trim() || `__ord_${idx}`;
    let rec = byKey.get(mergeKey);
    if (!rec) {
      rec = {};
      byKey.set(mergeKey, rec);
      order.push(mergeKey);
    }
    for (const [kk, vv] of Object.entries(mapped)) {
      if (!(kk in rec)) rec[kk] = vv;
      else if (!isBlank(vv) && isBlank(rec[kk])) rec[kk] = vv; // upgrade blank→value; first non-blank wins
    }
  });
  return order.map((key) => byKey.get(key)!);
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

  const groups = fieldGroupsFromBrowserInfo(info);
  const total = erpNum(info.totalcount);

  const raw: unknown[][] = [];
  const initialRows = info.rows as unknown[][] | undefined;
  if (Array.isArray(initialRows) && initialRows.length) raw.push(...initialRows);

  let start = raw.length;
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
      if (raw.length) logger.warnAlert(`[SoftOne] ${errD} — partial ${raw.length} rows`, { alertKey: ALERT.softoneSyncFailed });
      break;
    }
    const chunk = (dataCall.data?.rows as unknown[][]) || [];
    if (!chunk.length) break;
    raw.push(...chunk);
    start += chunk.length;
    // Don't stop on a short page: a multi-section browser would lose whole projections (stock/VAT).
    // The `start < total` guard and the empty-chunk break above terminate the loop.
  }

  if (total > 0 && raw.length === 0) {
    logger.warnAlert(`[SoftOne] ${label}: 0/${total} rows fetched`, { alertKey: ALERT.softoneSyncFailed });
  } else if (total > 0 && raw.length < total) {
    logger.warn(`[SoftOne] ${label}: fetched ${raw.length}/${total} rows — incomplete`);
  }

  return { rows: assembleBrowserRows(groups, raw, total, label) };
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
          // Normalized stock from the balance projection (blank cell = genuine zero).
          stockQty: erpNum(r['ITEM.MTRL_ITEMTRDATA_QTY1']),
          stockOnOrder: erpNum(r['ITEM.SoOrdered']),
          stockReserved: erpNum(r['ITEM.SoReserved']),
          // Product-model field names so the Product Intelligence aggregator consumes softone_items directly.
          sku: r['ITEM.CODE'],
          name: r['ITEM.NAME'],
          stock_level: erpNum(r['ITEM.MTRL_ITEMTRDATA_QTY1']),
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
    logger.error(`[SoftOne] fetchSoftOneData ${brandId}:`, { alertKey: ALERT.softoneSyncFailed, err: msg });
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
