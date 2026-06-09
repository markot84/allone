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
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { encryptToken, decryptToken } from './tokenCrypto';
import { planProcessing, PROCESSING_ORDER, type ProcessingStage } from './megaventorySyncPlan';
import { buildHistoricalOrIncrementalWindow, buildRollingUtcDayWindow, toYmd } from './syncPolicy';
import {
  cleanupManualImportsForMegaventoryMaster,
  PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE,
  type ManualImportCleanupCounts,
} from './manualDataCleanup';
import {
  normalizeMegaventoryCustomReportRows,
  MEGAVENTORY_NORMALIZED_SOURCE,
  type MegaventoryNormalizationCounts,
} from './megaventoryNormalizer';
import { refreshMegaventoryRfmSegments, type MegaventoryRfmCounts } from './megaventoryRfm';
import { refreshProcurementSignals } from './procurementSignals';
import { refreshStockMovement } from './stockMovementTracker';

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
/**
 * PER-60: soft budget για κάθε sync invocation, αρκετά κάτω από το 1800s timeout
 * του processMegaventorySyncJobs worker (onSchedule hard cap). Όταν εξαντληθεί,
 * σταματάμε με χάρη και επιστρέφουμε needsContinuation ώστε ο scheduler να
 * συνεχίσει σε επόμενο pass — ποτέ hard-kill / orphaned job / μισο-γραμμένα δεδομένα.
 */
const MV_SYNC_SOFT_DEADLINE_MS = 25 * 60 * 1000; // 25min, ~5min margin under the 1800s onSchedule cap
/**
 * PER-60: budget που κρατάμε για τα heavy downstream (gap-fill/RFM/procurement/stock-movement).
 * Αν μετά το ingestion (catalog/docs/stock/suppliers) έχει μείνει λιγότερο από αυτό, αναβάλλουμε
 * το processing σε δικό του fresh pass (productCatalogComplete=true). Μικρά brands το τρέχουν inline.
 */
const MV_PROCESSING_RESERVE_MS = 12 * 60 * 1000; // need ~12min of headroom to run the heavy downstream
const MV_INVOICE_BACKFILL_PAGE_SIZE = 100;
/** Manual connectorSync έχει 20' timeout· κρατάμε buffer για Firestore writes / response. */
const MV_INVOICE_BACKFILL_RUNTIME_MS = 18 * 60 * 1000;
const MV_INVOICE_BACKFILL_MAX_PAGES_PER_SYNC = 500;
const MV_INCREMENTAL_DOCUMENT_FALLBACK_MAX_PAGES = 100;
const MV_RECENT_DOCUMENT_LOOKBACK_DAYS = 45;

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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Megaventory date filters expect `dd/MM/yyyy HH:mm:ss`, not ISO/`YYYY-MM-DD`. */
function toMvFilterDateTime(date: Date): string {
  return [
    pad2(date.getUTCDate()),
    pad2(date.getUTCMonth() + 1),
    date.getUTCFullYear(),
  ].join('/') + ` ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
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
export function normalizeMvCustomReportRow(r: Record<string, unknown>): Record<string, unknown> {
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
  // SEC-L13: ColumnName comes from the Megaventory API and is used as a Firestore field key.
  // Sanitize characters Firestore field names can't safely hold, cap the key length and the
  // column count, and never let a column overwrite the reserved keys above — so a crafted
  // report can't corrupt the doc or explode it past the 1 MiB limit.
  const RESERVED = new Set(['mvRowIndex', 'source', 'cells']);
  const MAX_COLUMNS = 200;
  let colCount = 0;
  for (const c of cells) {
    if (colCount >= MAX_COLUMNS) break;
    const name = String((c as { ColumnName?: string }).ColumnName || '')
      .trim()
      .replace(/[~*/[\]().]/g, '_')
      .slice(0, 100);
    if (!name || RESERVED.has(name)) continue;
    flat[name] = (c as { Value?: unknown }).Value;
    colCount++;
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

function positiveNumber(value: unknown): number | null {
  const n = num(value);
  return n > 0 ? n : null;
}

/** Τα MV category names είναι full paths («Root Catalog/e-tennis/Αθλητικά Παπούτσια») — κρατάμε το leaf. */
function leafCategoryName(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

/**
 * Εξάγει το όνομα κατηγορίας από ProductGet row.
 *
 * ΣΗΜΑΝΤΙΚΟ (PER-60, επιβεβαιωμένο live): το ProductGet row κουβαλάει μόνο numeric
 * `ProductCategoryID`. Με `includeReferencedObjects: true` το πραγματικό όνομα έρχεται
 * embedded ως nested object **`mvProductCategory`** (mv prefix!) — ΟΧΙ `ProductCategory`.
 * Το `ProductCategoryName` εκεί είναι full path («Root Catalog/<brand>/<κατηγορία>») οπότε
 * κρατάμε το leaf segment. Σειρά προτίμησης:
 *   1) `mvProductCategory.{ProductCategoryName|ProductCategoryDescription}` (referenced object)
 *   2) flat `ProductCategoryName`
 *   3) flat `ProductCategoryDescription` (last resort — σχεδόν πάντα κενό)
 */
export function extractMvCategory(p: Record<string, unknown>): string {
  const ref = (p.mvProductCategory ?? p.ProductCategory) as Record<string, unknown> | undefined;
  if (ref && typeof ref === 'object') {
    const name = leafCategoryName(ref.ProductCategoryName);
    if (name) return name;
    const desc = leafCategoryName(ref.ProductCategoryDescription);
    if (desc) return desc;
  }

  const flatName = leafCategoryName(p.ProductCategoryName);
  if (flatName) return flatName;

  return leafCategoryName(p.ProductCategoryDescription);
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
    maxPages?: number;
    initialCursor?: number | null;
    maxRuntimeMs?: number;
    /** Extra body fields merged into every page request (π.χ. includeReferencedObjects). */
    extraBody?: Record<string, unknown>;
  }
): Promise<{ rows: any[]; error: string | null; nextCursor: number | null; exhausted: boolean }> {
  const pageSize = opts.pageSize ?? MV_PAGE_SIZE;
  const maxPages = opts.maxPages ?? MV_MAX_PAGES;
  const deadline = opts.maxRuntimeMs ? Date.now() + opts.maxRuntimeMs : null;
  const rows: any[] = [];
  let cursor: number | null = opts.initialCursor ?? null;
  let nextCursor: number | null = cursor;
  let exhausted = false;

  for (let page = 0; page < maxPages; page++) {
    if (deadline && Date.now() >= deadline) {
      break;
    }
    const filters = buildMvFiltersWithCursor(baseFilters, opts.cursorField, cursor);
    const body: Record<string, unknown> = {
      ReturnTopNRecords: pageSize,
      ...(opts.extraBody ?? {}),
    };
    if (filters.length > 0) {
      body.Filters = filters;
    }
    const call = await mvCall(endpoint, apiKey, {
      ...body,
    });
    const err = asMvError(call, opts.label);
    if (err) return { rows, error: err, nextCursor, exhausted: false };

    const batch = (call.body?.[opts.responseArrayKey] as any[]) || [];
    if (!batch.length) {
      exhausted = true;
      break;
    }

    rows.push(...batch);
    const minId = minNumericId(batch, ...opts.idKeys);
    if (minId > 0) nextCursor = minId;
    if (batch.length < pageSize || minId <= 0) {
      exhausted = true;
      break;
    }
    cursor = minId;
    if (deadline && Date.now() >= deadline) {
      break;
    }
  }

  return { rows, error: null, nextCursor, exhausted };
}

/**
 * Megaventory occasionally returns an empty result for `DocumentDate >= ...` even while
 * unfiltered `DocumentGet` returns current documents. For incremental syncs, recover by
 * reading recent pages ordered by id and applying the date window locally.
 */
async function fetchRecentMvDocumentsByLocalDate(
  apiKey: string,
  sinceYmd: string
): Promise<{ rows: any[]; error: string | null }> {
  const rows: any[] = [];
  let cursor: number | null = null;

  for (let page = 0; page < MV_INCREMENTAL_DOCUMENT_FALLBACK_MAX_PAGES; page++) {
    const filters = buildMvFiltersWithCursor([], 'DocumentId', cursor);
    const body: Record<string, unknown> = { ReturnTopNRecords: MV_PAGE_SIZE };
    if (filters.length > 0) body.Filters = filters;

    const call = await mvCall('DocumentGet', apiKey, body);
    const err = asMvError(call, 'DocumentGet (recent fallback)');
    if (err) return { rows, error: err };

    const batch = (call.body?.mvDocuments as any[]) || [];
    if (!batch.length) break;

    let recentInBatch = 0;
    for (const row of batch) {
      const day = isoDate(mvField(row as Record<string, unknown>, 'DocumentDate'));
      if (day && day >= sinceYmd) {
        rows.push(row);
        recentInBatch++;
      }
    }

    const minId = minNumericId(batch, 'DocumentId', 'DocumentID');
    if (minId <= 0 || batch.length < MV_PAGE_SIZE) break;
    cursor = minId;
    if (recentInBatch === 0) break;
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

type MvDocumentTypeInfo = {
  id: string;
  abbreviation: string;
  description: string;
};

function mvField(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (lowerNames.has(key.toLowerCase())) return value;
  }
  return undefined;
}

function mvArrayField(row: Record<string, unknown>, ...names: string[]): unknown[] {
  const raw = mvField(row, ...names);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const boxed = raw as Record<string, unknown>;
    if (Array.isArray(boxed.values)) return boxed.values;
    if (Array.isArray(boxed.$values)) return boxed.$values;
  }
  return [];
}

function mvText(row: Record<string, unknown>, ...names: string[]): string {
  return String(mvField(row, ...names) ?? '').trim();
}

function mvDocumentIdentity(row: Record<string, unknown>, index: number, prefix: string): string {
  const id = mvText(row, 'DocumentId', 'DocumentID');
  if (id) return `id:${id}`;
  const no = mvText(row, 'DocumentNo', 'DocumentSerialNo');
  const day = isoDate(mvField(row, 'DocumentDate'));
  if (no || day) return `doc:${no}:${day}`;
  return `${prefix}:${index}`;
}

function mergeMvDocumentRows(
  primaryRows: Record<string, unknown>[],
  recentRows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];

  const append = (rows: Record<string, unknown>[], prefix: string) => {
    rows.forEach((row, index) => {
      const key = mvDocumentIdentity(row, index, prefix);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    });
  };

  append(primaryRows, 'primary');
  append(recentRows, 'recent');
  return merged;
}

function mvNum(row: Record<string, unknown>, ...names: string[]): number {
  return num(mvField(row, ...names));
}

function mvDocumentLineItems(row: Record<string, unknown>): Record<string, unknown>[] {
  const raw = mvArrayField(row, 'DocumentDetails', 'DocumentRows', 'DocumentLineItems', 'mvDocumentDetails', 'documentDetails');

  return raw
    .slice(0, 250)
    .map((line) => {
      const li = (line || {}) as Record<string, unknown>;
      const quantity = mvNum(li, 'DocumentRowQuantity', 'Quantity');
      const rowTotal = mvNum(li, 'DocumentRowTotalAmount', 'DocumentRowNetAmount', 'DocumentRowTotalNetAmount');
      const unitPrice = mvNum(
        li,
        'DocumentRowUnitPriceWithoutTaxOrDiscount',
        'DocumentRowUnitPriceWithoutTax',
        'DocumentRowUnitPrice',
        'UnitPrice'
      );
      const price = unitPrice > 0 ? unitPrice : quantity > 0 ? rowTotal / quantity : rowTotal;
      return {
        sku: mvText(li, 'DocumentRowProductSKU', 'ProductSKU', 'SKU'),
        productId: mvText(li, 'DocumentRowProductID', 'DocumentRowProductId', 'ProductID', 'ProductId'),
        title: mvText(li, 'DocumentRowProductDescription', 'ProductDescription', 'Description'),
        quantity: quantity || 1,
        price: Math.max(0, price),
        rowTotal: Math.max(0, rowTotal),
      };
    })
    .filter((line) => String(line.sku || line.title || line.productId || '').trim());
}

async function fetchDocumentTypes(apiKey: string): Promise<{ types: MvDocumentTypeInfo[]; error: string | null }> {
  const { rows, error } = await fetchAllMvPages('DocumentTypeGet', apiKey, [], {
    responseArrayKey: 'mvDocumentTypes',
    cursorField: 'DocumentTypeId',
    idKeys: ['DocumentTypeId', 'DocumentTypeID'],
    label: 'DocumentTypeGet',
    pageSize: 500,
  });
  if (error) return { types: [], error };
  return {
    types: rows.map((row) => ({
      id: mvText(row, 'DocumentTypeId', 'DocumentTypeID'),
      abbreviation: mvText(row, 'DocumentTypeAbbreviation', 'DocumentTypeCode', 'Abbreviation'),
      description: mvText(row, 'DocumentTypeDescription', 'DocumentTypeName', 'Description', 'Name'),
    })).filter((type) => type.id || type.abbreviation || type.description),
    error: null,
  };
}

function documentTypeInfo(row: Record<string, unknown>, typesById: Map<string, MvDocumentTypeInfo>): MvDocumentTypeInfo {
  const id = mvText(row, 'DocumentTypeId', 'DocumentTypeID');
  const fromRef = id ? typesById.get(id) : undefined;
  return {
    id,
    abbreviation: mvText(row, 'DocumentTypeAbbreviation', 'DocumentTypeCode', 'DocumentType') || fromRef?.abbreviation || '',
    description: mvText(row, 'DocumentTypeDescription', 'DocumentTypeName') || fromRef?.description || '',
  };
}

function isLikelySalesInvoice(row: Record<string, unknown>, type: MvDocumentTypeInfo): boolean {
  const abbr = type.abbreviation.toUpperCase();
  const desc = type.description.toLocaleLowerCase('el-GR');
  const text = `${abbr} ${desc}`;
  const amount = mvNum(row, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal');
  if (amount <= 0) return false;
  if (/(purchase|supplier|vendor|credit|return|refund|quote|proforma|αγορ|προμηθευ|πιστωτ|επιστροφ)/i.test(text)) {
    return false;
  }
  return (
    ['SI', 'INV', 'SINV', 'SIV', 'RECEIPT', 'SR'].includes(abbr) ||
    /(sales?\s*invoice|invoice|receipt|τιμολ|απόδειξη|αποδειξη|λιανικ|πώλη|πωλη)/i.test(text)
  );
}

function documentTypeBreakdown(rows: Record<string, unknown>[], typesById: Map<string, MvDocumentTypeInfo>) {
  const counts = new Map<string, { typeId: string; abbreviation: string; description: string; count: number; amount: number }>();
  for (const row of rows) {
    const type = documentTypeInfo(row, typesById);
    const key = `${type.id || '-'}|${type.abbreviation || '-'}|${type.description || '-'}`;
    const existing = counts.get(key) ?? { typeId: type.id, abbreviation: type.abbreviation, description: type.description, count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += mvNum(row, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal');
    counts.set(key, existing);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 }));
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
  const mvMatch = s.match(/\/Date\((\-?\d+)(?:[+\-]\d+)?\)\//);
  if (mvMatch) {
    const millis = Number(mvMatch[1]);
    if (Number.isFinite(millis)) {
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
  }
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

/** Καθαρίζει προηγούμενα gap-fill docs πριν ξαναγραφτεί ο κατάλογος από ProductGet. */
async function mergeMegaventoryApiCatalogProducts(
  db: Firestore,
  brandId: string,
  customReportSnapshotRows: Record<string, unknown>[],
): Promise<number> {
  const snap = await db.collection('products').where('brandId', '==', brandId).get();
  const apiCatalogDocs = snap.docs.filter((d) => d.data().source === PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE);
  for (let i = 0; i < apiCatalogDocs.length; i += 500) {
    const batch = db.batch();
    for (const doc of apiCatalogDocs.slice(i, i + 500)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  const reportSkus = new Set<string>();
  for (const row of customReportSnapshotRows) {
    const sku = String(row.SKU_ID ?? '').trim();
    if (sku && sku !== '-') reportSkus.add(sku);
  }
  for (const doc of snap.docs) {
    if (doc.data().source !== MEGAVENTORY_NORMALIZED_SOURCE) continue;
    const sku = String(doc.data().sku ?? '').trim();
    if (sku) reportSkus.add(sku);
  }

  // PER-60: read the full catalog from megaventory_products (persisted across resumable passes)
  // instead of an in-memory ProductGet set — so gap-fill works without holding the whole 87k-SKU
  // catalog in one invocation. Fields are already normalized (incl. extractMvCategory at write time).
  const catalogSnap = await db.collection('megaventory_products').where('brandId', '==', brandId).get();
  const items: { id: string; data: Record<string, unknown> }[] = [];
  const seenSku = new Set<string>();
  for (const doc of catalogSnap.docs) {
    const p = doc.data();
    const sku = String(p.sku ?? '').trim();
    if (!sku || seenSku.has(sku)) continue;
    seenSku.add(sku);
    if (reportSkus.has(sku)) continue;
    const stock = num(p.stockOnHand);
    const sell = num(p.sellingPrice);
    const purchase = num(p.purchasePrice);
    const name = String(p.name ?? '').trim() || sku;
    const cat = String(p.category ?? '').trim();
    items.push({
      id: `mv_api_cat_${brandId}_${sku}`,
      data: {
        id: sku,
        sku,
        name,
        ...(cat ? { category: cat } : {}),
        price: sell,
        cost_price: purchase,
        stock_level: stock,
        stock_capacity: Math.max(stock * 2, stock),
        source: PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE,
      },
    });
  }
  if (!items.length) return 0;
  await writeBatch(db, 'products', brandId, items);
  return items.length;
}

async function inferInvoiceBackfillCursor(db: Firestore, brandId: string): Promise<number | null> {
  const snap = await db.collection('megaventory_invoices').where('brandId', '==', brandId).get();
  let minId = Number.POSITIVE_INFINITY;
  for (const doc of snap.docs) {
    const candidate = positiveNumber(doc.data().documentId);
    if (candidate !== null && candidate < minId) minId = candidate;
  }
  return Number.isFinite(minId) ? minId : null;
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface MegaventorySyncResult {
  success: boolean;
  imported: number;
  /** PER-60: true όταν η fetch δεν ολοκληρώθηκε εντός του soft budget — ο worker κάνει re-enqueue. */
  needsContinuation?: boolean;
  invoices?: number;
  salesOrders?: number;
  purchaseOrders?: number;
  products?: number;
  stock?: number;
  suppliers?: number;
  /** Γραμμές custom saved report (π.χ. stock / κινητικότητα) — συλλογή megaventory_custom_report_rows */
  customReportRows?: number;
  normalized?: MegaventoryNormalizationCounts;
  /** SKU που προστέθηκαν στη συλλογή `products` από πλήρες ProductGet (έλλειψη από custom report). */
  apiCatalogGapFill?: number;
  rfm?: MegaventoryRfmCounts;
  error?: string;
}

interface MegaventorySyncOptions {
  mode?: 'manual' | 'scheduled';
  skipDocuments?: boolean;
}

/**
 * Πλήρες sync (last 90 days). Καλείται από manual button + nightly schedule.
 * Ο user έχει επιλέξει: revenue source = Invoices, Megaventory ως master.
 */
export async function fetchMegaventoryData(
  brandId: string,
  options: MegaventorySyncOptions = {}
): Promise<MegaventorySyncResult> {
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

  const mode = options.mode || 'manual';
  // PER-60: soft deadline ώστε καμία invocation να μην τρέξει μέσα στο hard timeout του worker.
  const syncDeadlineAt = Date.now() + MV_SYNC_SOFT_DEADLINE_MS;
  const remainingBudgetMs = () => Math.max(0, syncDeadlineAt - Date.now());
  const overBudget = () => Date.now() >= syncDeadlineAt;
  let needsContinuation = false;
  // PER-60: when productCatalogComplete is already set, this invocation is the dedicated "processing
  // pass" — skip the ingestion fetches (already persisted) and run only the heavy downstream.
  const catalogAlreadyComplete = conn.productCatalogComplete === true;
  const shouldRefreshDocuments = options.skipDocuments !== true;
  let docsWindow = buildHistoricalOrIncrementalWindow(conn, 'lastDocsSyncAt');
  const invoiceBackfillPending = conn.invoiceDocumentBackfillComplete !== true;
  // Manual sync must refresh reference data quickly. Scheduled ERP runs can continue the historical
  // invoice detail backfill so existing documents gain product line items for Data Analysis.
  const shouldStageInvoiceBackfill = mode === 'scheduled' && invoiceBackfillPending;
  let invoiceBackfillCursor = positiveNumber(conn.invoiceDocumentBackfillCursor);
  if (shouldStageInvoiceBackfill && invoiceBackfillCursor === null && conn.invoiceDocumentBackfillAt) {
    invoiceBackfillCursor = await inferInvoiceBackfillCursor(db, brandId);
  }
  if (shouldStageInvoiceBackfill) {
    docsWindow = {
      mode: 'historical',
      windowStart: new Date(Date.UTC(docsWindow.historyStartYear, 0, 1)),
      windowEnd: new Date(),
      historyStartYear: docsWindow.historyStartYear,
    };
  }
  const sinceStr = toYmd(docsWindow.windowStart);
  const todayStr = toYmd(docsWindow.windowEnd);
  /** Custom report (Performance κ.λπ.) χρειάζεται πλήρες ιστορικό· όχι το 48h overlap των documents. */
  const customReportHistoryYear =
    Number(conn.historyLoadedUntilYear) > 0
      ? Number(conn.historyLoadedUntilYear)
      : docsWindow.historyStartYear;
  const customReportDate1 = toYmd(new Date(Date.UTC(customReportHistoryYear, 0, 1)));
  const customReportDate2 = todayStr;
  const sinceFilterDate = toMvFilterDateTime(docsWindow.windowStart);
  let docsOk = true;
  let referenceOk = true;
  const invoiceBackfillLabel = shouldStageInvoiceBackfill
    ? `staged cursor=${invoiceBackfillCursor ?? 'latest'}`
    : invoiceBackfillPending
      ? 'pending/deferred_for_scheduled_sync'
      : 'complete/incremental';
  logger.info(
    `[Megaventory] Sync window for ${brandId}: mode=${mode} docs=${docsWindow.mode}:${sinceStr}->${todayStr} customReport=${customReportDate1}->${customReportDate2} reference=snapshot invoiceBackfill=${invoiceBackfillLabel}`
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
  let normalizedCounts: MegaventoryNormalizationCounts | null = null;
  let rfmCounts: MegaventoryRfmCounts | null = null;
  let postNormalizeRefresh: Record<string, unknown> | null = null;
  let documentDiagnostics: Record<string, unknown> | null = null;
  let invoiceBackfillProgress: Record<string, unknown> | null = null;
  let rfmSkippedReason = '';
  let customReportRowsSnapshot: Record<string, unknown>[] = [];
  let apiCatalogGapFillCount = 0;
  let productGetExhausted = false;

  try {
    if (!shouldRefreshDocuments || catalogAlreadyComplete) {
      documentDiagnostics = { skipped: true, reason: catalogAlreadyComplete ? 'processing_pass' : 'manual_catalog_refresh' };
      logger.info(`[Megaventory] Documents skipped for ${brandId}: ${catalogAlreadyComplete ? 'processing pass' : 'manual catalog refresh'}`);
    } else {
    // ── Invoices (Documents type=Sales Invoice) → revenue ────────────
    const documentTypesResult = await fetchDocumentTypes(apiKey);
    const documentTypesById = new Map(documentTypesResult.types.map((type) => [type.id, type]));
    const documentFilters = shouldStageInvoiceBackfill
      ? []
      : [{ FieldName: 'DocumentDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceFilterDate }];
    let {
      rows: invRows,
      error: invFetchErr,
      nextCursor: invoiceBackfillNextCursor,
      exhausted: invoiceBackfillExhausted,
    } = await fetchAllMvPages(
      'DocumentGet',
      apiKey,
      documentFilters,
      {
        responseArrayKey: 'mvDocuments',
        cursorField: 'DocumentId',
        idKeys: ['DocumentId', 'DocumentID'],
        label: 'DocumentGet (invoices)',
        pageSize: shouldStageInvoiceBackfill ? MV_INVOICE_BACKFILL_PAGE_SIZE : undefined,
        maxPages: shouldStageInvoiceBackfill ? MV_INVOICE_BACKFILL_MAX_PAGES_PER_SYNC : undefined,
        initialCursor: shouldStageInvoiceBackfill ? invoiceBackfillCursor : undefined,
        maxRuntimeMs: shouldStageInvoiceBackfill ? MV_INVOICE_BACKFILL_RUNTIME_MS : remainingBudgetMs(),
      }
    );
    let documentFallbackUsed = false;
    let recentDocumentRowsMerged = 0;
    if (!shouldStageInvoiceBackfill && !invFetchErr && invRows.length === 0) {
      const fallback = await fetchRecentMvDocumentsByLocalDate(apiKey, sinceStr);
      if (fallback.error) {
        invFetchErr = fallback.error;
      } else if (fallback.rows.length > 0) {
        invRows = fallback.rows;
        invoiceBackfillNextCursor = null;
        invoiceBackfillExhausted = true;
        documentFallbackUsed = true;
        logger.info(
          `[Megaventory] DocumentGet date filter returned 0 rows for ${brandId}; fallback recovered ${fallback.rows.length} recent documents`
        );
      }
    }
    if (!invFetchErr) {
      const rollingRecentWindow = buildRollingUtcDayWindow(MV_RECENT_DOCUMENT_LOOKBACK_DAYS);
      const recent = await fetchRecentMvDocumentsByLocalDate(apiKey, rollingRecentWindow.since);
      if (recent.error) {
        logger.warn(
          `[Megaventory] Recent invoice merge failed for ${brandId}: ${recent.error}`
        );
      } else if (recent.rows.length > 0) {
        const before = invRows.length;
        invRows = mergeMvDocumentRows(
          invRows as Record<string, unknown>[],
          recent.rows as Record<string, unknown>[]
        );
        recentDocumentRowsMerged = Math.max(0, invRows.length - before);
        if (recentDocumentRowsMerged > 0) {
          logger.info(
            `[Megaventory] Recent invoice merge for ${brandId}: +${recentDocumentRowsMerged} documents from ${rollingRecentWindow.since}->${rollingRecentWindow.until}`
          );
        }
      }
    }
    if (invFetchErr) {
      docsOk = false;
      errors.push(invFetchErr);
    } else {
      const rawDocs = invRows as Record<string, unknown>[];
      const docs = rawDocs.filter((d) => isLikelySalesInvoice(d, documentTypeInfo(d, documentTypesById)));
      documentDiagnostics = {
        invoiceBackfillMode: shouldStageInvoiceBackfill ? 'staged' : invoiceBackfillPending ? 'incremental_backfill_pending' : 'incremental',
        invoiceBackfillCursor: invoiceBackfillCursor ?? null,
        invoiceBackfillNextCursor: invoiceBackfillNextCursor ?? null,
        invoiceBackfillExhausted,
        documentTypeError: documentTypesResult.error || '',
        documentTypes: documentTypesResult.types.slice(0, 50),
        rawDocumentRows: rawDocs.length,
        matchedInvoiceRows: docs.length,
        documentFallbackUsed,
        recentDocumentRowsMerged,
        recentDocumentLookbackDays: MV_RECENT_DOCUMENT_LOOKBACK_DAYS,
        documentTypeBreakdown: documentTypeBreakdown(rawDocs, documentTypesById),
      };
      if (rawDocs.length === 0 || docs.length === 0) {
        const sampleCall = await mvCall('DocumentGet', apiKey, { ReturnTopNRecords: 100 });
        const sampleError = asMvError(sampleCall, 'DocumentGet (latest sample)');
        const sampleRows = sampleError ? [] : (((sampleCall.body?.mvDocuments as unknown[]) || []) as Record<string, unknown>[]);
        documentDiagnostics.latestSampleError = sampleError || '';
        documentDiagnostics.latestSampleRows = sampleRows.length;
        documentDiagnostics.latestSampleTypeBreakdown = documentTypeBreakdown(sampleRows, documentTypesById);
      }
      const items = docs.map((d) => ({
        id: `mv_inv_${mvText(d, 'DocumentId', 'DocumentID') || mvText(d, 'DocumentNo', 'DocumentSerialNo') || Math.random().toString(36).slice(2)}`,
        data: {
          documentId: mvText(d, 'DocumentId', 'DocumentID'),
          documentNo: mvText(d, 'DocumentNo', 'DocumentSerialNo'),
          documentReferenceNo: mvText(d, 'DocumentReferenceNo'),
          documentReferenceNo2: mvText(d, 'DocumentReferenceNo2'),
          documentReferenceNo3: mvText(d, 'DocumentReferenceNo3'),
          documentType: documentTypeInfo(d, documentTypesById).abbreviation || documentTypeInfo(d, documentTypesById).description || 'sales_document',
          documentTypeId: documentTypeInfo(d, documentTypesById).id,
          documentTypeDescription: documentTypeInfo(d, documentTypesById).description,
          date: isoDate(mvField(d, 'DocumentDate')),
          status: mvText(d, 'DocumentStatus'),
          totalAmount: mvNum(d, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal'),
          taxAmount: mvNum(d, 'DocumentAmountTotalTax', 'DocumentTotalTaxAmount'),
          netAmount: Math.max(0, mvNum(d, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal') - mvNum(d, 'DocumentAmountTotalTax', 'DocumentTotalTaxAmount')),
          currency: mvText(d, 'DocumentCurrencyCode') || conn.currency || 'EUR',
          clientName: mvText(d, 'DocumentSupplierClientName', 'SupplierClientName', 'ClientName'),
          clientId: mvText(d, 'DocumentSupplierClientId', 'DocumentSupplierClientID', 'SupplierClientId', 'SupplierClientID'),
          lineItems: mvDocumentLineItems(d),
          source: 'megaventory_api',
        },
      }));
      if (items.length) await writeBatch(db, 'megaventory_invoices', brandId, items);
      counts.invoices = items.length;
      totalImported += items.length;
      if (shouldStageInvoiceBackfill) {
        invoiceBackfillProgress = {
          cursor: invoiceBackfillCursor ?? null,
          nextCursor: invoiceBackfillNextCursor ?? null,
          exhausted: invoiceBackfillExhausted,
          rawRows: rawDocs.length,
          matchedRows: docs.length,
          imported: items.length,
          pageSize: MV_INVOICE_BACKFILL_PAGE_SIZE,
          maxPages: MV_INVOICE_BACKFILL_MAX_PAGES_PER_SYNC,
          maxRuntimeMs: MV_INVOICE_BACKFILL_RUNTIME_MS,
        };
      }
      logger.info(`[Megaventory] Invoices: ${items.length}/${rawDocs.length} imported for brand ${brandId}`);
    }

    if (docsOk && shouldStageInvoiceBackfill && invoiceBackfillProgress) {
      // EARLY write (πριν τα αργά gap-fill/RFM που κάνουν το function timeout). Γράφουμε ΕΔΩ:
      //  • αν ΔΕΝ έχει τελειώσει → το νέο cursor (συνεχίζει την επόμενη νύχτα)
      //  • αν τελείωσε (exhausted) → το flag Complete ΩΣΤΕ να μην ξανατρέξει το 3ετές staged backfill.
      // Πριν, το Complete μαρκαριζόταν μόνο στο τελικό patch → το function τερμάτιζε πρώτα και το
      // backfill κολλούσε «μισοτελειωμένο» επ' άπειρον, ξανα-σκανάροντας 3 χρόνια κάθε νύχτα.
      const patch: Record<string, unknown> = {
        'megaventory.lastDocsSyncAt': FieldValue.serverTimestamp(),
        'megaventory.historyLoadedUntilYear': docsWindow.historyStartYear,
        'megaventory.invoiceDocumentBackfillAt': FieldValue.serverTimestamp(),
        'megaventory.invoiceDocumentBackfillLastRunAt': FieldValue.serverTimestamp(),
        'megaventory.invoiceDocumentBackfillRawRowsLastRun': Number(invoiceBackfillProgress.rawRows ?? 0),
        'megaventory.invoiceDocumentBackfillMatchedRowsLastRun': Number(invoiceBackfillProgress.matchedRows ?? 0),
        'megaventory.invoiceDocumentBackfillCount': FieldValue.increment(counts.invoices),
      };
      if (invoiceBackfillProgress.exhausted === true) {
        patch['megaventory.invoiceDocumentBackfillComplete'] = true;
        patch['megaventory.invoiceDocumentBackfillCompletedAt'] = FieldValue.serverTimestamp();
      } else if (invoiceBackfillProgress.nextCursor) {
        patch['megaventory.invoiceDocumentBackfillCursor'] = invoiceBackfillProgress.nextCursor;
      }
      await db.doc(`connectors/${brandId}`).update(patch);

      await db.collection('import_jobs').add({
        brandId,
        type: 'finances',
        source: 'megaventory_api',
        status: errors.length ? 'partial' : 'completed',
        mode: 'invoice_backfill_only',
        docsMode: docsWindow.mode,
        referenceMode: 'skipped_backfill_in_progress',
        customReportMode: 'skipped_backfill_in_progress',
        windowStart: docsWindow.windowStart.toISOString(),
        windowEnd: docsWindow.windowEnd.toISOString(),
        rfmGenerated: false,
        rfmSkippedReason: 'invoice_backfill_in_progress',
        ...(documentDiagnostics ? { documentDiagnostics } : {}),
        invoiceBackfillProgress,
        imported: totalImported,
        ...counts,
        failed: errors.length,
        errors: errors.slice(0, 20),
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info(
        `[Megaventory] Invoice backfill-only run for ${brandId}: raw=${invoiceBackfillProgress.rawRows} matched=${invoiceBackfillProgress.matchedRows} imported=${counts.invoices}`
      );
      return {
        success: true,
        imported: totalImported,
        ...counts,
        ...(errors.length ? { error: errors[0] } : {}),
      };
    }

    // ── Sales Orders (cross-reference) ───────────────────────────────
    const { rows: soRows, error: soFetchErr } = await fetchAllMvPages(
      'SalesOrderGet',
      apiKey,
      [{ FieldName: 'SalesOrderDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceFilterDate }],
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
          totalAmount: num(o.SalesOrderAmountGrandTotal),
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
      [{ FieldName: 'PurchaseOrderDate', SearchOperator: 'GreaterEqualTo', SearchValue: sinceFilterDate }],
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
          totalAmount: num(o.PurchaseOrderAmountGrandTotal),
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
    }

    // ── Products (resumable catalog fetch) ────────────────────────────
    // PER-60: το ProductGet (87k+ SKU) δεν χωράει πάντα σε ένα 30min pass. Το τραβάμε σταδιακά με
    // cursor (productCatalogCursor) γράφοντας idempotent στο megaventory_products. Όταν εξαντληθεί,
    // productCatalogComplete=true και τα downstream (gap-fill κ.λπ.) διαβάζουν τον πλήρη κατάλογο
    // από το Firestore σε επόμενο pass — αντί να τον κρατάμε όλο στη μνήμη.
    let productGetExhausted = true;
    let productCatalogNextCursor: number | null = null;
    if (catalogAlreadyComplete) {
      logger.info(`[Megaventory] catalog already complete for ${brandId} — skipping ProductGet, running downstream`);
    } else {
      const { rows: prRows, error: prFetchErr, exhausted, nextCursor } = await fetchAllMvPages('ProductGet', apiKey, [], {
        responseArrayKey: 'mvProducts',
        cursorField: 'ProductID',
        idKeys: ['ProductID', 'ProductId'],
        label: 'ProductGet',
        // PER-60: referenced objects → κατηγορία· budget + cursor ώστε να μη «φάει» το worker timeout.
        extraBody: { includeReferencedObjects: true },
        maxRuntimeMs: remainingBudgetMs(),
        initialCursor: positiveNumber(conn.productCatalogCursor) ?? undefined,
      });
      if (prFetchErr) {
        referenceOk = false;
        errors.push(prFetchErr);
        productGetExhausted = false;
      } else {
        productGetExhausted = exhausted;
        productCatalogNextCursor = nextCursor;
        const items = (prRows as any[]).map((p) => ({
          id: `mv_p_${p.ProductID || p.ProductId || p.ProductSKU || Math.random().toString(36).slice(2)}`,
          data: {
            productId: String(p.ProductID || p.ProductId || ''),
            sku: p.ProductSKU || '',
            name: p.ProductDescription || '',
            longDescription: p.ProductLongDescription || '',
            category: extractMvCategory(p as Record<string, unknown>),
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
        logger.info(`[Megaventory] Products: ${items.length} imported (cursor pass) for ${brandId}, exhausted=${exhausted}`);
      }
    }

    // ── Stock per location (ingestion — skipped on the processing pass) ──
    if (!catalogAlreadyComplete) {
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
    } // end stock ingestion guard

    // ── Suppliers (ingestion — skipped on the processing pass) ─────
    if (!catalogAlreadyComplete) {
    const { rows: supRows, error: supFetchErr } = await fetchAllMvPages(
      'SupplierClientGet',
      apiKey,
      [],
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
        .filter((s) => ['supplier', 'both'].includes(String(s.SupplierClientType || '').toLowerCase()))
        .map((s) => ({
          id: `mv_sup_${s.SupplierClientId || s.SupplierClientName || Math.random().toString(36).slice(2)}`,
          data: {
            supplierId: String(s.SupplierClientId || ''),
            name: s.SupplierClientName || '',
            email: s.SupplierClientEmail || '',
            phone: s.SupplierClientPhone1 || '',
            country: s.SupplierClientShippingCountry || '',
            type: String(s.SupplierClientType || '').toLowerCase() === 'both' ? 'both' : 'supplier',
            source: 'megaventory_api',
          },
        }));
      if (items.length) await writeBatch(db, 'megaventory_suppliers', brandId, items);
      counts.suppliers = items.length;
      totalImported += items.length;
      logger.info(`[Megaventory] Suppliers: ${items.length} imported for brand ${brandId}`);
    }
    } // end suppliers ingestion guard

    // ── Custom saved report (π.χ. Performance / αποθέματα — CustomReportGetData) ──
    const reportId = String(conn.customReportId || '').trim();
    const reportEnabled = conn.customReportEnabled !== false;
    if (reportId && reportEnabled) {
      try {
        const removed = await deleteMegaventoryCustomReportRows(db, brandId);
        logger.info(`[Megaventory] Custom report purge: removed ${removed} rows for brand ${brandId}`);
        const crRows = await fetchAllCustomReportPages(apiKey, reportId, customReportDate1, customReportDate2);
        customReportRowsSnapshot = crRows;
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
        normalizedCounts = await normalizeMegaventoryCustomReportRows(db, brandId, crRows);
        counts.customReportRows = crItems.length;
        totalImported += crItems.length;
        logger.info(
          `[Megaventory] Custom report ${reportId}: ${crItems.length} rows for brand ${brandId}; normalized=${JSON.stringify(normalizedCounts)}`
        );
      } catch (crErr) {
        const msg = crErr instanceof Error ? crErr.message : String(crErr);
        errors.push(`CustomReport (${reportId}): ${msg}`);
        logger.warnAlert(`[Megaventory] Custom report sync failed brand ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
      }
    }

    // ── Early completion marker ──────────────────────────────────────
    // Τα core δεδομένα (invoices/orders/products/stock/suppliers/custom report) έχουν ήδη γραφτεί.
    // Γράφουμε ΕΔΩ το ορατό `lastSyncAt` ώστε το UI να δείχνει φρέσκο sync ΑΚΟΜΗ κι αν τα επόμενα
    // βαριά/ασταθή βήματα (gap-fill, RFM, procurement refresh) αργήσουν ή «φάνε» το function timeout
    // σε μεγάλα e-shops. Το πλήρες import_jobs record παραμένει στο τέλος (best-effort).
    try {
      await db.doc(`connectors/${brandId}`).update({
        'megaventory.lastSyncAt': FieldValue.serverTimestamp(),
      });
    } catch (markErr) {
      logger.warn(`[Megaventory] early lastSyncAt mark failed for ${brandId}: ${markErr instanceof Error ? markErr.message : String(markErr)}`);
    }

    // PER-60: gap-fill διαγράφει & ξαναγράφει ΟΛΟΚΛΗΡΟ τον api-catalog διαβάζοντας από το
    // megaventory_products (Firestore). Τρέχει ΜΟΝΟ όταν ο κατάλογος είναι ΠΛΗΡΗΣ — αλλιώς θα
    // έκανε purge-then-partial = data loss. Αν δεν είναι (ή ξεμείναμε από budget), ζητάμε continuation.
    const catalogComplete = catalogAlreadyComplete || (referenceOk && productGetExhausted !== false);
    // PER-60: run the heavy downstream (gap-fill/RFM/procurement/stock-movement) only when the catalog
    // is complete AND we are either the dedicated processing pass (catalogAlreadyComplete) or still have
    // a full budget reserve. Otherwise defer it to a fresh pass — large brands can't fit ingestion AND
    // processing in one 30-min invocation. Small brands keep their budget and finish in a single pass.
    const runProcessing = catalogComplete && (catalogAlreadyComplete || remainingBudgetMs() >= MV_PROCESSING_RESERVE_MS);
    // PER-60: within the processing stage, run heavy sub-stages greedily but checkpoint between them
    // (gapfill=0 → rfm=1 → finalize=2). `processingDoneThrough` = index of the next sub-stage still to
    // run this pass; it advances as each completes. A brand whose processing alone exceeds 30min then
    // completes across several passes; a light brand runs all three inline in one pass.
    let processingDoneThrough = runProcessing
      ? PROCESSING_ORDER.indexOf(planProcessing(conn.processingStage as ProcessingStage | null | undefined).run)
      : 0;
    if (!catalogComplete) {
      needsContinuation = true;
      logger.warn(`[Megaventory] catalog fetch incomplete within budget for ${brandId} — deferring to continuation pass`);
    } else if (!runProcessing) {
      needsContinuation = true;
      logger.info(`[Megaventory] catalog complete; deferring heavy downstream to a fresh processing pass for ${brandId} (budget reserve)`);
    } else if (processingDoneThrough === 0 && overBudget()) {
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before gap-fill for ${brandId} — deferring downstream to continuation pass`);
    } else if (processingDoneThrough === 0) {
      // ── Processing sub-stage 0: gap-fill ──
      try {
        apiCatalogGapFillCount = await mergeMegaventoryApiCatalogProducts(
          db,
          brandId,
          customReportRowsSnapshot,
        );
        if (apiCatalogGapFillCount > 0) {
          logger.info(
            `[Megaventory] Product Intelligence gap-fill (catalog): +${apiCatalogGapFillCount} SKUs not in custom report for ${brandId}`
          );
        }
      } catch (gapErr) {
        const msg = gapErr instanceof Error ? gapErr.message : String(gapErr);
        errors.push(`ApiCatalogGapFill: ${msg}`);
        logger.warnAlert(`[Megaventory] API catalog gap-fill failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
      }
      processingDoneThrough = 1; // gap-fill stage done (advance even on error — don't loop on it)
    }

    if (apiCatalogGapFillCount > 0 && !(normalizedCounts && normalizedCounts.products > 0) && overBudget()) {
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before stock-movement refresh for ${brandId} — deferring to continuation pass`);
    } else if (apiCatalogGapFillCount > 0 && !(normalizedCounts && normalizedCounts.products > 0)) {
      try {
        await refreshStockMovement(brandId);
        postNormalizeRefresh = {
          ...(postNormalizeRefresh ?? {}),
          stockMovement: 'refreshed_after_api_catalog_gap_fill',
          apiCatalogGapFill: apiCatalogGapFillCount,
        };
      } catch (mvErr) {
        const msg = mvErr instanceof Error ? mvErr.message : String(mvErr);
        errors.push(`StockMovement(api_catalog): ${msg}`);
        logger.warnAlert(`[Megaventory] Stock movement refresh after gap-fill failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
      }
    }

    // ── Log import_jobs ──────────────────────────────────────────────
    const patch: Record<string, unknown> = {};
    if (referenceOk) {
      patch['megaventory.lastReferenceSyncAt'] = FieldValue.serverTimestamp();
    }
    if (counts.products > 0) {
      patch['megaventory.lastSyncProducts'] = counts.products;
    }
    if (counts.customReportRows > 0) {
      patch['megaventory.lastSyncCustomReportRows'] = counts.customReportRows;
    }
    patch['megaventory.lastProductGetExhausted'] = productGetExhausted !== false;
    if (apiCatalogGapFillCount > 0) {
      patch['megaventory.lastApiCatalogGapFill'] = apiCatalogGapFillCount;
    }
    if (shouldRefreshDocuments && docsOk) {
      patch['megaventory.lastDocsSyncAt'] = FieldValue.serverTimestamp();
      if (docsWindow.mode === 'historical') {
        patch['megaventory.historyLoadedUntilYear'] = docsWindow.historyStartYear;
      }
      if (shouldStageInvoiceBackfill) {
        patch['megaventory.invoiceDocumentBackfillAt'] = FieldValue.serverTimestamp();
        patch['megaventory.invoiceDocumentBackfillLastRunAt'] = FieldValue.serverTimestamp();
        patch['megaventory.invoiceDocumentBackfillRawRowsLastRun'] =
          Number(invoiceBackfillProgress?.rawRows ?? 0);
        patch['megaventory.invoiceDocumentBackfillMatchedRowsLastRun'] =
          Number(invoiceBackfillProgress?.matchedRows ?? 0);
        patch['megaventory.invoiceDocumentBackfillCount'] = FieldValue.increment(counts.invoices);
        if (invoiceBackfillProgress?.nextCursor) {
          patch['megaventory.invoiceDocumentBackfillCursor'] = invoiceBackfillProgress.nextCursor;
        }
        if (invoiceBackfillProgress?.exhausted) {
          patch['megaventory.invoiceDocumentBackfillComplete'] = true;
          patch['megaventory.invoiceDocumentBackfillCompletedAt'] = FieldValue.serverTimestamp();
        }
      }
    }

    const shouldCleanupManualImports =
      docsOk &&
      normalizedCounts !== null &&
      normalizedCounts.products > 0 &&
      ((docsWindow.mode === 'historical' && !conn.manualImportCleanupAt) || !conn.manualSegmentCleanupAt);
    if (shouldCleanupManualImports) {
      try {
        manualCleanupCounts = await cleanupManualImportsForMegaventoryMaster(db, brandId);
        patch['megaventory.manualImportCleanupAt'] = FieldValue.serverTimestamp();
        patch['megaventory.manualSegmentCleanupAt'] = FieldValue.serverTimestamp();
        patch['megaventory.manualImportCleanupCounts'] = manualCleanupCounts;
        patch['megaventory.manualImportCleanupReason'] = 'megaventory_historical_sync_master';
      } catch (cleanupErr) {
        manualCleanupError = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        errors.push(`ManualCleanup: ${manualCleanupError}`);
        patch['megaventory.manualImportCleanupError'] = manualCleanupError.slice(0, 500);
        patch['megaventory.manualImportCleanupErrorAt'] = FieldValue.serverTimestamp();
        logger.error(`[Megaventory] Manual import cleanup failed for ${brandId}:`, { alertKey: ALERT.megaventorySyncFailed, err: manualCleanupError });
      }
    }

    const invoiceBackfillStillInProgress =
      invoiceBackfillPending && (!shouldStageInvoiceBackfill || invoiceBackfillProgress?.exhausted !== true);
    if (!runProcessing) {
      // PER-60: ingestion pass — RFM runs on the dedicated processing pass.
      rfmSkippedReason = 'deferred_to_processing_pass';
    } else if (processingDoneThrough !== 1) {
      // not the RFM sub-stage on this pass (gap-fill deferred earlier, or RFM already done in a prior pass)
    } else if (overBudget()) {
      // PER-60: defer the heavy RFM rebuild rather than running it into the hard timeout.
      needsContinuation = true;
      rfmSkippedReason = 'deferred_over_budget';
      logger.warn(`[Megaventory] over soft deadline before RFM refresh for ${brandId} — deferring to continuation pass`);
    } else {
      // ── Processing sub-stage 1: RFM ──
      if (shouldRefreshDocuments && docsOk && !invoiceBackfillStillInProgress) {
        try {
          rfmCounts = await refreshMegaventoryRfmSegments(db, brandId);
        } catch (rfmErr) {
          const msg = rfmErr instanceof Error ? rfmErr.message : String(rfmErr);
          errors.push(`MegaventoryRFM: ${msg}`);
          logger.warnAlert(`[Megaventory] RFM refresh failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
        }
      } else if (!shouldRefreshDocuments) {
        rfmSkippedReason = 'manual_catalog_refresh';
        logger.info(`[Megaventory] RFM refresh skipped for ${brandId}: manual catalog refresh`);
      } else if (docsOk && invoiceBackfillStillInProgress) {
        rfmSkippedReason = 'invoice_backfill_in_progress';
        logger.info(`[Megaventory] RFM refresh skipped for ${brandId}: invoice backfill still in progress`);
      }
      processingDoneThrough = 2; // RFM stage done (or legitimately skipped) — advance to finalize
    }

    if (!runProcessing || processingDoneThrough !== 2) {
      // not the finalize sub-stage on this pass (earlier sub-stage deferred, or already finalized)
    } else if (overBudget()) {
      // PER-60: defer the heavy procurement/stock-movement refresh rather than running into the hard timeout.
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before procurement/stock-movement refresh for ${brandId} — deferring to continuation pass`);
    } else {
      // ── Processing sub-stage 2: procurement + stock-movement (finalize) ──
      if (normalizedCounts && normalizedCounts.products > 0) {
        try {
          const procurement = await refreshProcurementSignals(brandId);
          await refreshStockMovement(brandId);
          postNormalizeRefresh = {
            procurementSignals: procurement,
            stockMovement: 'refreshed',
            ...(apiCatalogGapFillCount > 0 ? { apiCatalogGapFill: apiCatalogGapFillCount } : {}),
          };
        } catch (refreshErr) {
          const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          errors.push(`MegaventoryPostNormalizeRefresh: ${msg}`);
          logger.warnAlert(`[Megaventory] Post-normalization refresh failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
        }
      }
      processingDoneThrough = 3; // finalize done — whole processing stage complete
    }

    // PER-60: persist resumable catalog state AFTER every heavy phase (catalog/gap-fill/RFM/
    // procurement/stock-movement) has decided whether it needs continuation. Reset when the WHOLE
    // sync finishes (so the next manual sync re-fetches fresh); otherwise keep complete=true / cursor
    // so the next pass resumes the right phase instead of re-fetching the catalog from scratch.
    if (!catalogComplete) {
      // ingestion still fetching the catalog — persist the resume cursor (needsContinuation already set)
      if (productCatalogNextCursor) {
        patch['megaventory.productCatalogCursor'] = productCatalogNextCursor;
        patch['megaventory.productCatalogComplete'] = false;
      }
    } else if (runProcessing && processingDoneThrough >= PROCESSING_ORDER.length) {
      // every processing sub-stage finished → whole sync complete → reset so the next sync re-ingests fresh
      patch['megaventory.productCatalogComplete'] = FieldValue.delete();
      patch['megaventory.productCatalogCursor'] = FieldValue.delete();
      patch['megaventory.processingStage'] = FieldValue.delete();
    } else {
      // catalog complete but processing in progress/deferred → keep complete, checkpoint the next sub-stage
      patch['megaventory.productCatalogComplete'] = true;
      patch['megaventory.productCatalogCursor'] = FieldValue.delete();
      patch['megaventory.processingStage'] = PROCESSING_ORDER[Math.min(processingDoneThrough, PROCESSING_ORDER.length - 1)];
      needsContinuation = true;
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
      ...(reportId && reportEnabled ? { customReportDate1, customReportDate2 } : {}),
      productGetExhausted,
      windowStart: docsWindow.windowStart.toISOString(),
      windowEnd: docsWindow.windowEnd.toISOString(),
      manualImportCleanupRan: manualCleanupCounts != null,
      ...(manualCleanupCounts ? { manualImportCleanupCounts: manualCleanupCounts } : {}),
      ...(manualCleanupError ? { manualImportCleanupError: manualCleanupError } : {}),
      normalized: normalizedCounts != null,
      ...(normalizedCounts ? { normalizedCounts } : {}),
      rfmGenerated: rfmCounts != null,
      ...(rfmSkippedReason ? { rfmSkippedReason } : {}),
      ...(rfmCounts ? { rfmCounts } : {}),
      ...(documentDiagnostics ? { documentDiagnostics } : {}),
      ...(invoiceBackfillProgress ? { invoiceBackfillProgress } : {}),
      ...(postNormalizeRefresh ? { postNormalizeRefresh } : {}),
      ...(apiCatalogGapFillCount > 0 ? { apiCatalogGapFill: apiCatalogGapFillCount } : {}),
      imported: totalImported,
      ...counts,
      failed: errors.length,
      errors: errors.slice(0, 20),
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[Megaventory] Sync complete for brand ${brandId}: ${totalImported} total items (errors=${errors.length})`);
    return {
      success: true,
      ...(needsContinuation ? { needsContinuation: true } : {}),
      imported: totalImported,
      ...counts,
      ...(normalizedCounts ? { normalized: normalizedCounts } : {}),
      ...(apiCatalogGapFillCount > 0 ? { apiCatalogGapFill: apiCatalogGapFillCount } : {}),
      ...(rfmCounts ? { rfm: rfmCounts } : {}),
      ...(errors.length ? { error: errors[0] } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Megaventory] fetchMegaventoryData error for ${brandId}:`, { alertKey: ALERT.megaventorySyncFailed, err: msg });
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
