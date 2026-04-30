/**
 * Megaventory ERP Connector
 *
 * Σύνδεση: API key μόνο (https://api.megaventory.com/v2017a/ — JSON POST endpoints).
 * Σχήμα Firestore (κάτω από connectors/{brandId}.megaventory):
 *   { connected, apiKey (encrypted), accountName, currency, connectedAt }
 *
 * Sync: historical backfill first, then incremental docs + snapshot reference data.
 *   - Invoices → megaventory_invoices …
 *   - Sales OR / Purchase / Products / Stock / Suppliers (τυπικά API)
 *   - Προαιρετικό Custom Report → megaventory_custom_report_rows (αρ. σειρών + raw cells ανά report ID)
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { buildHistoricalOrIncrementalWindow, toYmd } from './syncPolicy';
import {
  cleanupManualImportsForMegaventoryMaster,
  type ManualImportCleanupCounts,
} from './manualDataCleanup';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const MV_BASE = 'https://api.megaventory.com/v2017a/json/reply';
const MV_UA = 'PerformancePlus-MegaventoryConnector/1.0';
/** Μεγάλα payloads / αργά δίκτυα — το προηγούμενο 30s έκοβε σε πλήρη ProductGet. */
const MV_TIMEOUT_MS = 120_000;
const MV_PAGE_SIZE = 500;
/** Ασφάλεια: max ~2.5M εγγραφές ανά endpoint ανά sync */
const MV_MAX_PAGES = 5000;

type MvFilter = {
  FieldName: string;
  SearchOperator: string;
  SearchValue: string | number;
  AndOr?: string;
  Group?: string;
};

/** Καθαρισμός BOM/whitespace από copy-paste API keys */
function normalizeApiKey(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim();
}

interface MvCallResult {
  ok: boolean;
  status: number;
  body: any;
  raw: string;
}

/**
 * Generic POST προς Megaventory JSON endpoint.
 * Όλα τα Megaventory v2017a endpoints δέχονται POST με JSON body { APIKEY, ...filters }.
 */
async function mvCall(endpoint: string, apiKey: string, body: Record<string, unknown> = {}): Promise<MvCallResult> {
  const url = `${MV_BASE}/${endpoint}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MV_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': MV_UA, Accept: 'application/json' },
      body: JSON.stringify({ APIKEY: apiKey, ...body }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, body: parsed, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: null, raw: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Megaventory επιστρέφει 200 ακόμα και σε λάθη επιπέδου API· τα γνωρίζουμε από
 * `ResponseStatus.ErrorCode !== "0"`. Επιστρέφουμε ενιαία μορφή σφάλματος.
 */
function asMvError(call: MvCallResult, label: string): string | null {
  if (!call.ok) {
    return `${label}: HTTP ${call.status || 'network'} — ${String(call.raw || '').slice(0, 220)}`;
  }
  const body = call.body;
  if (!body || typeof body !== 'object') {
    return `${label}: invalid response (${String(call.raw || '').slice(0, 160)})`;
  }
  const code = String(body.ResponseStatus?.ErrorCode ?? '0');
  if (code !== '0') {
    const msg = String(body.ResponseStatus?.Message || 'API error').slice(0, 220);
    return `${label}: ${msg} (code ${code})`;
  }
  return null;
}

const CUSTOM_REPORT_LIMIT = 1000;
const CUSTOM_REPORT_COLLECTION = 'megaventory_custom_report_rows';
const CUSTOM_REPORT_MAX_PAGES = 500;

/** Απόσπαση array γραμμών από απάντηση CustomReportGetData (επίσημη μορφή: `Rows[]` με `{ Index, Data[] }`). */
export function extractCustomReportRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;

  if ('Rows' in b && Array.isArray(b.Rows)) {
    const rws = b.Rows as Record<string, unknown>[];
    if (rws.length === 0) return [];
    return rws.map((r) => normalizeMvCustomReportRow(r));
  }

  const pushIfArray = (v: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(v)) return null;
    return v.filter(
      (x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
    );
  };

  const keys = [
    'mvCustomReportData',
    'mvCustomReportRows',
    'CustomReportData',
    'CustomReportRows',
    'mvCustomReportLines',
    'mvCustomReport',
    'data',
    'rows',
    'mvResult',
  ];

  for (const k of keys) {
    const arr = pushIfArray(b[k]);
    if (arr?.length) {
      const row0 = arr[0];
      if ('Data' in row0 || 'data' in row0 || 'cells' in row0) {
        return arr.map((r) =>
          normalizeMvCustomReportRow(r as Record<string, unknown>)
        );
      }
      return arr;
    }
    const inner = b[k];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const ob = inner as Record<string, unknown>;
      const innerKeys = ['data', 'rows', 'mvResult', 'CustomReportLines', 'mvCustomReportData'];
      for (const ik of innerKeys) {
        const ia = pushIfArray(ob[ik]);
        if (ia?.length) return ia;
      }
    }
  }

  const firstArr = Object.values(b).find(
    (x) =>
      Array.isArray(x) &&
      x.length > 0 &&
      x.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
  );
  if (firstArr && Array.isArray(firstArr)) {
    const row0 = (firstArr as Record<string, unknown>[])[0];
    if ('Data' in (row0 || {}) || 'data' in (row0 || {})) {
      return (firstArr as Record<string, unknown>[]).map((r) =>
        normalizeMvCustomReportRow(r as Record<string, unknown>)
      );
    }
    return firstArr as Record<string, unknown>[];
  }

  return [];
}

/** Επίσημη δομή γραμμής: `{ Index?, Data?: [{ ColumnId, ColumnName, Value }] }` */
function normalizeMvCustomReportRow(r: Record<string, unknown>): Record<string, unknown> {
  const dataRaw = r.Data ?? r.data;
  if (!Array.isArray(dataRaw)) {
    return { ...r };
  }
  const cells = dataRaw as Record<string, unknown>[];
  const flat: Record<string, unknown> = {
    mvRowIndex: r.Index ?? r.index ?? null,
    source: 'megaventory_custom_report_row',
    cells,
  };
  for (const c of cells) {
    const name = String((c as { ColumnName?: string }).ColumnName || '').trim();
    if (!name) continue;
    flat[name] = (c as { Value?: unknown }).Value;
  }
  return flat;
}

async function fetchAllCustomReportPages(
  apiKey: string,
  reportId: string,
  date1Iso: string,
  date2Iso: string
): Promise<Record<string, unknown>[]> {
  const ridNum = parseInt(String(reportId).trim(), 10);
  /** API βλ.: CustomReportId (int)· στείλε αριθμό όταν υπάρχει. */
  const customReportId: string | number = Number.isFinite(ridNum) ? ridNum : reportId.trim();

  const baseBody: Record<string, unknown> = {
    CustomReportId: customReportId,
    CustomReportParameters: { Date1: date1Iso, Date2: date2Iso },
  };

  // 1) Χωρίς Page/Limit — το OFFSET/FETCH από pagination σπάει ορισμένα SQL reports (500).
  const callNoPage = await mvCall('CustomReportGetData', apiKey, { ...baseBody });
  const errNoPage = asMvError(callNoPage, 'CustomReportGetData (no Page/Limit)');
  if (!errNoPage) {
    const rows = extractCustomReportRows(callNoPage.body);
    return rows;
  }

  logger.warn(`[Megaventory] CustomReportGetData without pagination: ${errNoPage} — fallback Page/Limit`);

  // 2) Pagination (μικρότερο Limit μερικές φορές μειώνει SQL πίεση)
  const all: Record<string, unknown>[] = [];
  const pageLimit = Math.min(CUSTOM_REPORT_LIMIT, 500);

  for (let page = 1; page <= CUSTOM_REPORT_MAX_PAGES; page++) {
    const call = await mvCall('CustomReportGetData', apiKey, {
      ...baseBody,
      Page: page,
      Limit: pageLimit,
    });

    const err = asMvError(call, `CustomReportGetData (page ${page})`);
    if (err) {
      throw new Error(err);
    }

    const rows = extractCustomReportRows(call.body);
    if (rows.length === 0) {
      break;
    }

    all.push(...rows);
    if (rows.length < pageLimit) break;
  }

  return all;
}

async function deleteMegaventoryCustomReportRows(db: Firestore, brandId: string): Promise<number> {
  let deleted = 0;
  let snap = await db.collection(CUSTOM_REPORT_COLLECTION).where('brandId', '==', brandId).limit(400).get();
  while (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;
    snap = await db.collection(CUSTOM_REPORT_COLLECTION).where('brandId', '==', brandId).limit(400).get();
  }
  return deleted;
}

/** Αλλαγή ID report / enable χωρίς νέο API key (απαιτεί ενεργή σύνδεση). */
export async function updateMegaventoryConnectorSettings(
  brandId: string,
  updates: {
    customReportId?: string | null;
    customReportEnabled?: boolean | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const snap = await db.doc(`connectors/${brandId}`).get();
  if (!snap.exists) return { ok: false, error: 'Δεν υπάρχουν ρυθμίσεις Megaventory.' };

  const data = snap.data() as Record<string, unknown>;
  const mv = data?.megaventory as Record<string, unknown> | undefined;
  if (!mv?.connected || !mv?.apiKey) {
    return { ok: false, error: 'Το Megaventory δεν είναι συνδεδεμένο.' };
  }

  const patch: Record<string, unknown> = {};

  if (updates.customReportId !== undefined) {
    if (updates.customReportId === null || updates.customReportId === '') {
      patch['megaventory.customReportId'] = FieldValue.delete();
    } else {
      patch['megaventory.customReportId'] = String(updates.customReportId).trim();
    }
  }

  if (updates.customReportEnabled !== undefined && updates.customReportEnabled !== null) {
    patch['megaventory.customReportEnabled'] = Boolean(updates.customReportEnabled);
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  await db.doc(`connectors/${brandId}`).update(patch);
  return { ok: true };
}

/**
 * Όλα τα *Get της Megaventory με ReturnTopNRecords επιστρέφουν τα "top N" σε **φθίνουσα** σειρά
 * primary id. Επόμενη σελίδα: ίδια φίλτρα + And LessThan min(id) της προηγούμενης σελίδας.
 */
function buildMvFiltersWithCursor(base: MvFilter[], cursorField: string, cursor: number | null): MvFilter[] {
  if (cursor === null) return [...base];
  const cursorFilter: MvFilter = {
    AndOr: base.length ? 'And' : undefined,
    FieldName: cursorField,
    SearchOperator: 'LessThan',
    SearchValue: cursor,
  };
  return [...base, cursorFilter];
}

function minNumericId(rows: any[], ...keys: string[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    for (const k of keys) {
      const v = num(row?.[k]);
      if (v > 0 && v < m) m = v;
    }
  }
  return Number.isFinite(m) ? m : 0;
}

async function fetchAllMvPages(
  endpoint: string,
  apiKey: string,
  baseFilters: MvFilter[],
  opts: {
    responseArrayKey: string;
    /** FieldName για το LessThan cursor (όπως στην τεκμηρίωση MV) */
    cursorField: string;
    /** Κλειδιά για εύρεση min id στο JSON row */
    idKeys: string[];
    label: string;
    pageSize?: number;
  }
): Promise<{ rows: any[]; error: string | null }> {
  const pageSize = opts.pageSize ?? MV_PAGE_SIZE;
  const rows: any[] = [];
  let cursor: number | null = null;

  for (let page = 0; page < MV_MAX_PAGES; page++) {
    const filters = buildMvFiltersWithCursor(baseFilters, opts.cursorField, cursor);
    const call = await mvCall(endpoint, apiKey, {
      Filters: filters,
      ReturnTopNRecords: pageSize,
    });
    const err = asMvError(call, opts.label);
    if (err) return { rows, error: err };

    const batch = (call.body?.[opts.responseArrayKey] as any[]) || [];
    if (!batch.length) break;

    rows.push(...batch);
    const minId = minNumericId(batch, ...opts.idKeys);
    if (batch.length < pageSize || minId <= 0) break;
    cursor = minId;
  }

  return { rows, error: null };
}

/** Το API επιστρέφει mvProductStockList με nested mvStock· ενοποιούμε σε flat rows όπως περιμένει το writeBatch. */
function normalizeInventoryStockRows(raw: any[]): any[] {
  const out: any[] = [];
  for (const s of raw) {
    const inner = s?.mvStock;
    if (Array.isArray(inner) && inner.length > 0) {
      const pid = s.productID ?? s.ProductId ?? s.ProductID;
      const psku = s.productSKU ?? s.ProductSKU ?? '';
      for (const loc of inner) {
        out.push({
          productID: pid,
          productSKU: psku,
          inventoryLocationID: loc.InventoryLocationID,
          inventoryLocationAbbreviation: loc.SubLocation ?? '',
          inventoryLocationName: '',
          productPhysicalStockQty: loc.StockPhysical ?? loc.StockOnHand,
          productAvailableStockQty: loc.StockOnHand,
        });
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

export interface MegaventoryTestResult {
  success: boolean;
  accountName?: string;
  currency?: string;
  error?: string;
}

/**
 * Επαλήθευση API key — `CurrencyGet` είναι ελαφρύ και δεν απαιτεί ειδικά δικαιώματα.
 * Bonus: δοκιμάζουμε `AccountInformationGet` για να πάρουμε όνομα λογαριασμού.
 */
export async function testMegaventoryConnection(apiKey: string): Promise<MegaventoryTestResult> {
  const key = normalizeApiKey(apiKey);
  if (!key) return { success: false, error: 'Λείπει το API key' };

  const test = await mvCall('CurrencyGet', key);
  const err = asMvError(test, 'Megaventory CurrencyGet');
  if (err) {
    if (test.status === 401 || /unauthor/i.test(err) || /invalid.*key/i.test(err)) {
      return { success: false, error: 'Μη έγκυρο API key. Ελέγξτε στο Megaventory → My Profile → API key.' };
    }
    return { success: false, error: err };
  }

  let accountName = '';
  let currency = '';
  try {
    const acc = await mvCall('AccountInformationGet', key);
    if (!asMvError(acc, 'Megaventory AccountInformationGet')) {
      const a = acc.body?.mvAccount || acc.body?.account || {};
      accountName = String(a.CompanyName || a.AccountName || a.Name || '').trim();
      currency = String(a.DefaultCurrencyCode || a.CurrencyCode || '').trim();
    }
  } catch {
    /* προαιρετικό */
  }

  if (!currency) {
    const currencies: any[] = test.body?.mvCurrencies || [];
    const def = currencies.find((c) => c?.CurrencyIsDefault === true || c?.CurrencyIsDefault === 1) || currencies[0];
    currency = String(def?.CurrencyCode || '').trim();
  }

  logger.info(`[Megaventory] Connection test OK — account="${accountName}" currency=${currency}`);
  return { success: true, accountName, currency };
}

export async function saveMegaventoryCredentials(
  brandId: string,
  apiKey: string,
  options?: { customReportId?: string; customReportEnabled?: boolean }
): Promise<{ success: boolean; accountName?: string; currency?: string; error?: string }> {
  const key = normalizeApiKey(apiKey);
  const test = await testMegaventoryConnection(key);
  if (!test.success) return { success: false, error: test.error };

  const ref = getDb().doc(`connectors/${brandId}`);
  const prevMv = ((await ref.get()).data()?.megaventory || {}) as Record<string, unknown>;

  const megaventory: Record<string, unknown> = {
    ...prevMv,
    connected: true,
    apiKey: encryptToken(key),
    accountName: test.accountName || '',
    currency: test.currency || 'EUR',
    connectedAt: FieldValue.serverTimestamp(),
  };

  if (options?.customReportId !== undefined) {
    const id = String(options.customReportId || '').trim();
    if (id) megaventory.customReportId = id;
    else delete megaventory.customReportId;
  }
  if (options?.customReportEnabled !== undefined) {
    megaventory.customReportEnabled = Boolean(options.customReportEnabled);
  }

  await ref.set({ megaventory }, { merge: true });

  logger.info(`[Megaventory] Connected brand ${brandId} (${test.accountName || 'unnamed'})`);
  return { success: true, accountName: test.accountName, currency: test.currency };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  // Megaventory συνήθως επιστρέφει "YYYY-MM-DDThh:mm:ss"
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * Firestore document IDs δεν επιτρέπουν `/` (διαχωριστικό διαδρομής).
 * SKU π.χ. `N.100.4268-612-S/M` θα έσπαγε το `doc()`.
 */
function sanitizeFirestoreDocId(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) s = '_';
  s = s.replace(/\//g, '_').replace(/\\/g, '_');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '_');
  if (s === '.' || s === '..') s = '_dot_';
  if (s.length > 1500) s = s.slice(0, 1500);
  return s;
}

async function writeBatch(
  db: Firestore,
  collection: string,
  brandId: string,
  items: { id: string; data: Record<string, unknown> }[]
): Promise<void> {
  for (let i = 0; i < items.length; i += 500) {
    const batch = db.batch();
    const chunk = items.slice(i, i + 500);
    for (const it of chunk) {
      const docId = sanitizeFirestoreDocId(it.id);
      batch.set(
        db.collection(collection).doc(docId),
        { ...it.data, brandId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface MegaventorySyncResult {
  success: boolean;
  imported: number;
  invoices?: number;
  salesOrders?: number;
  purchaseOrders?: number;
  products?: number;
  stock?: number;
  suppliers?: number;
  /** Γραμμές custom saved report (π.χ. stock / κινητικότητα) — συλλογή megaventory_custom_report_rows */
  customReportRows?: number;
  error?: string;
}

/**
 * Πλήρες sync (last 90 days). Καλείται από manual button + nightly schedule.
 * Ο user έχει επιλέξει: revenue source = Invoices, Megaventory ως master.
 */
export async function fetchMegaventoryData(brandId: string): Promise<MegaventorySyncResult> {
  const db = getDb();
  const docSnap = await db.doc(`connectors/${brandId}`).get();
  const conn = docSnap.data()?.megaventory as Record<string, unknown> | undefined;

  if (!conn?.connected || !conn?.apiKey) {
    return { success: false, imported: 0, error: 'Megaventory not connected' };
  }

  const apiKey = decryptToken(conn.apiKey as string);
  if (!apiKey) {
    return { success: false, imported: 0, error: 'Megaventory API key unavailable — reconnect required' };
  }

  const docsWindow = buildHistoricalOrIncrementalWindow(conn, 'lastDocsSyncAt');
  const sinceStr = toYmd(docsWindow.windowStart);
  const todayStr = toYmd(docsWindow.windowEnd);
  let docsOk = true;
  let referenceOk = true;
  logger.info(
    `[Megaventory] Sync window for ${brandId}: docs=${docsWindow.mode}:${sinceStr}->${todayStr} reference=snapshot customReport=snapshot`
  );

  let totalImported = 0;
  const counts = {
    invoices: 0,
    salesOrders: 0,
    purchaseOrders: 0,
    products: 0,
    stock: 0,
    suppliers: 0,
    customReportRows: 0,
  };
  const errors: string[] = [];
  let manualCleanupCounts: ManualImportCleanupCounts | null = null;
  let manualCleanupError = '';

  try {
    // ── Invoices (Documents type=Sales Invoice) → revenue ────────────
    const { rows: invRows, error: invFetchErr } = await fetchAllMvPages('DocumentGet', apiKey, [
      { FieldName: 'DocumentTypeAbbreviation', SearchOperator: 'Equals', SearchValue: 'SI' },
      { AndOr: 'And', FieldName: 'DocumentDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceStr },
    ], {
      responseArrayKey: 'mvDocuments',
      cursorField: 'DocumentId',
      idKeys: ['DocumentId', 'DocumentID'],
      label: 'DocumentGet (invoices)',
    });
    if (invFetchErr) {
      docsOk = false;
      errors.push(invFetchErr);
    } else {
      const docs: any[] = invRows;
      const items = docs.map((d) => ({
        id: `mv_inv_${d.DocumentId || d.DocumentNo || d.DocumentSerialNo || Math.random().toString(36).slice(2)}`,
        data: {
          documentId: String(d.DocumentId || ''),
          documentNo: d.DocumentNo || d.DocumentSerialNo || '',
          documentType: d.DocumentTypeAbbreviation || 'SI',
          date: isoDate(d.DocumentDate),
          status: d.DocumentStatus || '',
          totalAmount: num(d.DocumentTotalAmount),
          taxAmount: num(d.DocumentTotalTaxAmount),
          netAmount: Math.max(0, num(d.DocumentTotalAmount) - num(d.DocumentTotalTaxAmount)),
          currency: d.DocumentCurrencyCode || conn.currency || 'EUR',
          clientName: d.DocumentSupplierClientName || '',
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_invoices', brandId, items);
      counts.invoices = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Invoices: ${items.length} imported for brand ${brandId}`);
    }

    // ── Sales Orders (cross-reference) ───────────────────────────────
    const { rows: soRows, error: soFetchErr } = await fetchAllMvPages(
      'SalesOrderGet',
      apiKey,
      [{ FieldName: 'SalesOrderDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceStr }],
      {
        responseArrayKey: 'mvSalesOrders',
        cursorField: 'SalesOrderId',
        idKeys: ['SalesOrderId', 'SalesOrderID'],
        label: 'SalesOrderGet',
      }
    );
    if (soFetchErr) {
      docsOk = false;
      errors.push(soFetchErr);
    } else {
      const orders: any[] = soRows;
      const items = orders.map((o) => ({
        id: `mv_so_${o.SalesOrderId || o.SalesOrderNo || Math.random().toString(36).slice(2)}`,
        data: {
          orderId: String(o.SalesOrderId || ''),
          orderNo: o.SalesOrderNo || '',
          date: isoDate(o.SalesOrderDate),
          status: o.SalesOrderStatus || '',
          clientName: o.SalesOrderClientName || '',
          totalQuantity: num(o.SalesOrderTotalQuantity),
          totalAmount: num(o.SalesOrderTotalAmount),
          currency: o.SalesOrderCurrencyCode || conn.currency || 'EUR',
          lineItems: ((o.SalesOrderDetails || []) as any[]).slice(0, 50).map((li: any) => ({
            sku: li.SalesOrderRowProductSKU || li.ProductSKU || '',
            name: li.SalesOrderRowProductName || li.ProductDescription || '',
            quantity: num(li.SalesOrderRowQuantity),
            totalAmount: num(li.SalesOrderRowTotalAmount),
            unitPrice: num(li.SalesOrderRowUnitPriceWithoutTaxAfterDiscount || li.SalesOrderRowUnitPriceWithoutTax),
          })),
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_sales_orders', brandId, items);
      counts.salesOrders = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Sales orders: ${items.length} imported for brand ${brandId}`);
    }

    // ── Purchase Orders → COGS / supplier spend ──────────────────────
    const { rows: poRows, error: poFetchErr } = await fetchAllMvPages(
      'PurchaseOrderGet',
      apiKey,
      [{ FieldName: 'PurchaseOrderDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceStr }],
      {
        responseArrayKey: 'mvPurchaseOrders',
        cursorField: 'PurchaseOrderId',
        idKeys: ['PurchaseOrderId', 'PurchaseOrderID'],
        label: 'PurchaseOrderGet',
      }
    );
    if (poFetchErr) {
      docsOk = false;
      errors.push(poFetchErr);
    } else {
      const orders: any[] = poRows;
      const items = orders.map((o) => ({
        id: `mv_po_${o.PurchaseOrderId || o.PurchaseOrderNo || Math.random().toString(36).slice(2)}`,
        data: {
          orderId: String(o.PurchaseOrderId || ''),
          orderNo: o.PurchaseOrderNo || '',
          date: isoDate(o.PurchaseOrderDate),
          status: o.PurchaseOrderStatus || '',
          supplierName: o.PurchaseOrderSupplierName || '',
          totalQuantity: num(o.PurchaseOrderTotalQuantity),
          totalAmount: num(o.PurchaseOrderTotalAmount),
          currency: o.PurchaseOrderCurrencyCode || conn.currency || 'EUR',
          lineItems: ((o.PurchaseOrderDetails || []) as any[]).slice(0, 50).map((li: any) => ({
            sku: li.PurchaseOrderRowProductSKU || li.ProductSKU || '',
            name: li.PurchaseOrderRowProductName || li.ProductDescription || '',
            quantity: num(li.PurchaseOrderRowQuantity),
            totalAmount: num(li.PurchaseOrderRowTotalAmount),
            unitPrice: num(li.PurchaseOrderRowUnitPriceWithoutTaxAfterDiscount || li.PurchaseOrderRowUnitPriceWithoutTax),
          })),
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_purchase_orders', brandId, items);
      counts.purchaseOrders = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Purchase orders: ${items.length} imported for brand ${brandId}`);
    }

    // ── Products ─────────────────────────────────────────────────────
    const { rows: prRows, error: prFetchErr } = await fetchAllMvPages('ProductGet', apiKey, [], {
      responseArrayKey: 'mvProducts',
      cursorField: 'ProductID',
      idKeys: ['ProductID', 'ProductId'],
      label: 'ProductGet',
    });
    if (prFetchErr) {
      referenceOk = false;
      errors.push(prFetchErr);
    } else {
      const products: any[] = prRows;
      const items = products.map((p) => ({
        id: `mv_p_${p.ProductID || p.ProductId || p.ProductSKU || Math.random().toString(36).slice(2)}`,
        data: {
          productId: String(p.ProductID || p.ProductId || ''),
          sku: p.ProductSKU || '',
          name: p.ProductDescription || '',
          longDescription: p.ProductLongDescription || '',
          category: p.ProductCategoryDescription || '',
          unitOfMeasurement: p.ProductUnitOfMeasurement || '',
          sellingPrice: num(p.ProductSellingPrice),
          purchasePrice: num(p.ProductPurchasePrice),
          stockOnHand: num(p.ProductStockOnHandTotal),
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_products', brandId, items);
      counts.products = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Products: ${items.length} imported for brand ${brandId}`);
    }

    // ── Stock per location ───────────────────────────────────────────
    let stRowsRaw: any[] = [];
    let stFetchErr: string | null = null;
    ({ rows: stRowsRaw, error: stFetchErr } = await fetchAllMvPages('InventoryLocationStockGet', apiKey, [], {
      responseArrayKey: 'mvProductStockList',
      cursorField: 'productid',
      idKeys: ['productID', 'ProductId', 'ProductID'],
      label: 'InventoryLocationStockGet',
    }));
    if (!stFetchErr && !stRowsRaw.length) {
      ({ rows: stRowsRaw, error: stFetchErr } = await fetchAllMvPages('InventoryLocationStockGet', apiKey, [], {
        responseArrayKey: 'mvInventoryLocationStocks',
        cursorField: 'productid',
        idKeys: ['productID', 'ProductId', 'ProductID'],
        label: 'InventoryLocationStockGet',
      }));
    }
    if (stFetchErr) {
      referenceOk = false;
      errors.push(stFetchErr);
    } else {
      let stocks: any[] = normalizeInventoryStockRows(stRowsRaw);
      const items = stocks.map((s, idx) => ({
        id: `mv_stk_${s.productID || s.ProductId || s.productSKU || idx}_${s.inventoryLocationID || s.InventoryLocationId || 'main'}`,
        data: {
          productId: String(s.productID || s.ProductId || ''),
          sku: s.productSKU || s.ProductSKU || '',
          locationId: String(s.inventoryLocationID || s.InventoryLocationId || ''),
          locationName: s.inventoryLocationAbbreviation || s.InventoryLocationName || '',
          physicalStock: num(s.productPhysicalStockQty || s.ProductPhysicalStockQty),
          availableStock: num(s.productAvailableStockQty || s.ProductAvailableStockQty),
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_stock', brandId, items);
      counts.stock = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Stock rows: ${items.length} imported for brand ${brandId}`);
    }

    // ── Suppliers (από SupplierClient — type 2=supplier, 3=both) ─────
    const { rows: supRows, error: supFetchErr } = await fetchAllMvPages(
      'SupplierClientGet',
      apiKey,
      [{ FieldName: 'SupplierClientType', SearchOperator: 'GreaterEqualTo', SearchValue: '2' }],
      {
        responseArrayKey: 'mvSupplierClients',
        cursorField: 'SupplierClientID',
        idKeys: ['SupplierClientID', 'SupplierClientId'],
        label: 'SupplierClientGet',
      }
    );
    if (supFetchErr) {
      referenceOk = false;
      errors.push(supFetchErr);
    } else {
      const list: any[] = supRows;
      const items = list
        .filter((s) => Number(s.SupplierClientType) >= 2)
        .map((s) => ({
          id: `mv_sup_${s.SupplierClientId || s.SupplierClientName || Math.random().toString(36).slice(2)}`,
          data: {
            supplierId: String(s.SupplierClientId || ''),
            name: s.SupplierClientName || '',
            email: s.SupplierClientEmail || '',
            phone: s.SupplierClientPhone1 || '',
            country: s.SupplierClientShippingCountry || '',
            type: Number(s.SupplierClientType) === 3 ? 'both' : 'supplier',
            source: 'megaventory_api',
          },
        }));
      if (items.length) await writeBatch(db, 'megaventory_suppliers', brandId, items);
      counts.suppliers = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Suppliers: ${items.length} imported for brand ${brandId}`);
    }

    // ── Custom saved report (π.χ. Performance / αποθέματα — CustomReportGetData) ──
    const reportId = String(conn.customReportId || '').trim();
    const reportEnabled = conn.customReportEnabled !== false;
    if (reportId && reportEnabled) {
      try {
        const removed = await deleteMegaventoryCustomReportRows(db, brandId);
        logger.info(`[Megaventory] Custom report purge: removed ${removed} rows for brand ${brandId}`);
        const crRows = await fetchAllCustomReportPages(apiKey, reportId, sinceStr, todayStr);
        const rid = sanitizeFirestoreDocId(reportId);
        const bid = sanitizeFirestoreDocId(brandId);
        const crItems = crRows.map((row, idx) => ({
          id: `mv_cr_${bid}_${rid}_${idx}`,
          data: {
            reportId,
            rowIndex: idx,
            row,
            source: 'megaventory_custom_report',
            fetchedAt: FieldValue.serverTimestamp(),
          },
        }));
        if (crItems.length) {
          await writeBatch(db, CUSTOM_REPORT_COLLECTION, brandId, crItems);
        }
        counts.customReportRows = crItems.length;
        totalImported += crItems.length;
        logger.info(`[Megaventory] Custom report ${reportId}: ${crItems.length} rows for brand ${brandId}`);
      } catch (crErr) {
        const msg = crErr instanceof Error ? crErr.message : String(crErr);
        errors.push(`CustomReport (${reportId}): ${msg}`);
        logger.warn(`[Megaventory] Custom report sync failed brand ${brandId}: ${msg}`);
      }
    }

    // ── Log import_jobs ──────────────────────────────────────────────
    const patch: Record<string, unknown> = {};
    if (referenceOk) {
      patch['megaventory.lastReferenceSyncAt'] = FieldValue.serverTimestamp();
    }
    if (docsOk) {
      patch['megaventory.lastDocsSyncAt'] = FieldValue.serverTimestamp();
      if (docsWindow.mode === 'historical') {
        patch['megaventory.historyLoadedUntilYear'] = docsWindow.historyStartYear;
      }
    }

    const shouldCleanupManualImports =
      docsWindow.mode === 'historical' &&
      docsOk &&
      !conn.manualImportCleanupAt;
    if (shouldCleanupManualImports) {
      try {
        manualCleanupCounts = await cleanupManualImportsForMegaventoryMaster(db, brandId);
        patch['megaventory.manualImportCleanupAt'] = FieldValue.serverTimestamp();
        patch['megaventory.manualImportCleanupCounts'] = manualCleanupCounts;
        patch['megaventory.manualImportCleanupReason'] = 'megaventory_historical_sync_master';
      } catch (cleanupErr) {
        manualCleanupError = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        errors.push(`ManualCleanup: ${manualCleanupError}`);
        patch['megaventory.manualImportCleanupError'] = manualCleanupError.slice(0, 500);
        patch['megaventory.manualImportCleanupErrorAt'] = FieldValue.serverTimestamp();
        logger.error(`[Megaventory] Manual import cleanup failed for ${brandId}:`, manualCleanupError);
      }
    }

    if (Object.keys(patch).length) {
      await db.doc(`connectors/${brandId}`).update(patch);
    }

    await db.collection('import_jobs').add({
      brandId,
      type: 'finances',
      source: 'megaventory_api',
      status: errors.length ? 'partial' : 'completed',
      mode: docsWindow.mode,
      docsMode: docsWindow.mode,
      referenceMode: 'snapshot',
      customReportMode: reportId && reportEnabled ? 'snapshot' : 'disabled',
      windowStart: docsWindow.windowStart.toISOString(),
      windowEnd: docsWindow.windowEnd.toISOString(),
      manualImportCleanupRan: manualCleanupCounts != null,
      ...(manualCleanupCounts ? { manualImportCleanupCounts: manualCleanupCounts } : {}),
      ...(manualCleanupError ? { manualImportCleanupError: manualCleanupError } : {}),
      imported: totalImported,
      ...counts,
      failed: errors.length,
      errors: errors.slice(0, 20),
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[Megaventory] Sync complete for brand ${brandId}: ${totalImported} total items (errors=${errors.length})`);
    return {
      success: true,
      imported: totalImported,
      ...counts,
      ...(errors.length ? { error: errors[0] } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Megaventory] fetchMegaventoryData error for ${brandId}:`, msg);
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
