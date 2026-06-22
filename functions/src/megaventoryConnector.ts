/** Megaventory ERP Connector — API-key auth (v2017a JSON POST); state under connectors/{brandId}.megaventory.
 * Sync: historical backfill, then incremental docs + snapshot reference data (invoices/orders/products/stock/suppliers + optional Custom Report). */

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
/** Large payloads / slow networks — the previous 30s cut off on a full ProductGet. */
const MV_TIMEOUT_MS = 120_000;
const MV_PAGE_SIZE = 500;
/** Safety cap: max ~2.5M records per endpoint per sync */
const MV_MAX_PAGES = 5000;
/** Soft budget per sync invocation; when exhausted, stop and return needsContinuation so the scheduler resumes. */
const MV_SYNC_SOFT_DEADLINE_MS = 25 * 60 * 1000; // 25min, ~5min margin under the 1800s onSchedule cap
/** Reserve for the heavy downstream (gap-fill/RFM/procurement/stock-movement); below it, defer to a fresh pass. */
const MV_PROCESSING_RESERVE_MS = 12 * 60 * 1000; // need ~12min of headroom to run the heavy downstream
/** SupplierClientGet is slow (~12min) and non-resumable — START it only with this much budget left, else defer. */
const MV_SUPPLIERS_RESERVE_MS = 13 * 60 * 1000;
/** Min budget to START a processing sub-stage: overBudget() can't stop a monolithic module mid-run, so defer below reserve. */
const MV_STAGE_RESERVE_MS: Record<string, number> = {
  rfm: 15 * 60 * 1000,
  procurement: 10 * 60 * 1000,
  stockmovement: 22 * 60 * 1000,
};
/** Deleted-products walk (ProductGet showOnlyDeleted): first cycle imports the whole backlog (~133k), later cycles diff.
 * Don't START a chunk without this budget; the cursor keeps it resumable. */
const MV_DELETED_SCAN_RESERVE_MS = 8 * 60 * 1000;
const MV_DELETED_SCAN_PAGE_SIZE = 1000;
const MV_INVOICE_BACKFILL_PAGE_SIZE = 100;
/** Manual connectorSync has a 20min timeout; keep a buffer for Firestore writes / response. */
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

/** Strip BOM/whitespace from copy-pasted API keys */
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

/** Generic POST to a Megaventory JSON endpoint (v2017a accepts POST with body { APIKEY, ...filters }). */
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

/** Megaventory returns 200 even for API-level errors; detect via `ResponseStatus.ErrorCode !== "0"`. */
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

/** Extract the row array from a CustomReportGetData response (official shape: `Rows[]` with `{ Index, Data[] }`). */
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

/** Official row shape: `{ Index?, Data?: [{ ColumnId, ColumnName, Value }] }` */
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
  // ColumnName becomes a Firestore field key: sanitize unsafe chars, cap key length / column count,
  // never overwrite reserved keys — a crafted report can't corrupt/explode the doc.
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
  /** API expects CustomReportId (int); send a number when available. */
  const customReportId: string | number = Number.isFinite(ridNum) ? ridNum : reportId.trim();

  const baseBody: Record<string, unknown> = {
    CustomReportId: customReportId,
    CustomReportParameters: { Date1: date1Iso, Date2: date2Iso },
  };

  // 1) Without Page/Limit — the OFFSET/FETCH from pagination breaks some SQL reports (500).
  const callNoPage = await mvCall('CustomReportGetData', apiKey, { ...baseBody });
  const errNoPage = asMvError(callNoPage, 'CustomReportGetData (no Page/Limit)');
  if (!errNoPage) {
    const rows = extractCustomReportRows(callNoPage.body);
    return rows;
  }

  logger.warn(`[Megaventory] CustomReportGetData without pagination: ${errNoPage} — fallback Page/Limit`);

  // 2) Pagination (a smaller Limit sometimes reduces SQL pressure)
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

/** Change report ID / enable without a new API key (requires an active connection). */
export async function updateMegaventoryConnectorSettings(
  brandId: string,
  updates: {
    customReportId?: string | null;
    customReportEnabled?: boolean | null;
    stockLocations?: string[] | null;
  }
): Promise<{ ok: boolean; error?: string; stockLocationsChanged?: boolean }> {
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

  // Warehouse filter for stock roll-ups. Report whether it actually changed so the caller triggers a
  // full stock recompute only when needed (an unchanged save must not re-run the heavy sync).
  let stockLocationsChanged = false;
  if (updates.stockLocations !== undefined) {
    const prev = normalizeStockLocations(mv.stockLocations).sort();
    const next = updates.stockLocations === null ? [] : normalizeStockLocations(updates.stockLocations).sort();
    if (next.join('|') !== prev.join('|')) {
      patch['megaventory.stockLocations'] = next.length ? next : FieldValue.delete();
      stockLocationsChanged = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, stockLocationsChanged: false };
  }

  await db.doc(`connectors/${brandId}`).update(patch);
  return { ok: true, stockLocationsChanged };
}

/** *Get endpoints with ReturnTopNRecords return top N descending by primary id; next page = same filters + And LessThan min(id) of the previous page. */
function buildMvFiltersWithCursor(
  base: MvFilter[],
  cursorField: string,
  cursor: number | null,
  direction: 'asc' | 'desc' = 'desc'
): MvFilter[] {
  if (cursor === null) return [...base];
  const cursorFilter: MvFilter = {
    AndOr: base.length ? 'And' : undefined,
    FieldName: cursorField,
    // Cursor direction must match endpoint ordering: ProductGet/DocumentGet DESC (LessThan),
    // InventoryLocationStockGet ASC — a LessThan walk there silently stops after 500.
    SearchOperator: direction === 'asc' ? 'GreaterThan' : 'LessThan',
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

function maxNumericId(rows: any[], ...keys: string[]): number {
  let m = 0;
  for (const row of rows) {
    for (const k of keys) {
      const v = num(row?.[k]);
      if (v > m) m = v;
    }
  }
  return m;
}

function positiveNumber(value: unknown): number | null {
  const n = num(value);
  return n > 0 ? n : null;
}

/** MV category names are full paths (e.g. "Root Catalog/<brand>/<category>") — keep the leaf. */
function leafCategoryName(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

/** Category from a ProductGet row: with `includeReferencedObjects: true` the name nests under `mvProductCategory` as a full path → keep leaf;
 * else fall back to flat `ProductCategoryName`/`ProductCategoryDescription`. */
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
    /** FieldName for the LessThan cursor (as in the MV docs) */
    cursorField: string;
    /** Keys for finding the min id in the JSON row */
    idKeys: string[];
    label: string;
    pageSize?: number;
    maxPages?: number;
    initialCursor?: number | null;
    maxRuntimeMs?: number;
    /** Extra body fields merged into every page request (e.g. includeReferencedObjects). */
    extraBody?: Record<string, unknown>;
    /** Match endpoint ordering: 'desc' (default — ProductGet/DocumentGet) or 'asc' (InventoryLocationStockGet); wrong direction silently truncates to the first page. */
    cursorDirection?: 'asc' | 'desc';
  }
): Promise<{ rows: any[]; error: string | null; nextCursor: number | null; exhausted: boolean }> {
  const pageSize = opts.pageSize ?? MV_PAGE_SIZE;
  const maxPages = opts.maxPages ?? MV_MAX_PAGES;
  // undefined ⇒ unbudgeted; a number (incl. 0) ⇒ a real deadline, so 0 budget fetches nothing and defers.
  const deadline = opts.maxRuntimeMs == null ? null : Date.now() + Math.max(0, opts.maxRuntimeMs);
  const rows: any[] = [];
  let cursor: number | null = opts.initialCursor ?? null;
  let nextCursor: number | null = cursor;
  let exhausted = false;

  for (let page = 0; page < maxPages; page++) {
    if (deadline && Date.now() >= deadline) {
      break;
    }
    const direction = opts.cursorDirection ?? 'desc';
    const filters = buildMvFiltersWithCursor(baseFilters, opts.cursorField, cursor, direction);
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
    const edgeId = direction === 'asc'
      ? maxNumericId(batch, ...opts.idKeys)
      : minNumericId(batch, ...opts.idKeys);
    if (edgeId > 0) nextCursor = edgeId;
    if (batch.length < pageSize || edgeId <= 0) {
      exhausted = true;
      break;
    }
    cursor = edgeId;
    if (deadline && Date.now() >= deadline) {
      break;
    }
  }

  return { rows, error: null, nextCursor, exhausted };
}

/** Megaventory sometimes returns empty for `DocumentDate >= ...` while unfiltered `DocumentGet` has rows;
 * recover by reading recent id-ordered pages and applying the date window locally. */
async function fetchRecentMvDocumentsByLocalDate(
  apiKey: string,
  sinceYmd: string,
  opts: { maxRuntimeMs?: number | null; initialCursor?: number | null; maxPages?: number } = {}
): Promise<{ rows: any[]; error: string | null; nextCursor: number | null; exhausted: boolean }> {
  const rows: any[] = [];
  let cursor: number | null = opts.initialCursor ?? null;
  // Budget the fallback (unbudgeted it walked ~50k docs and ate the worker budget); maxRuntimeMs stops at
  // the soft deadline and returns nextCursor to resume; 0 budget fetches nothing and defers.
  const deadline = opts.maxRuntimeMs == null ? null : Date.now() + Math.max(0, opts.maxRuntimeMs);
  const maxPages = opts.maxPages && opts.maxPages > 0 ? opts.maxPages : MV_INCREMENTAL_DOCUMENT_FALLBACK_MAX_PAGES;
  let exhausted = false;

  for (let page = 0; page < maxPages; page++) {
    if (deadline && Date.now() >= deadline) {
      // ran out of budget mid-walk — nextCursor holds the resume point, not exhausted yet
      return { rows, error: null, nextCursor: cursor, exhausted: false };
    }
    const filters = buildMvFiltersWithCursor([], 'DocumentId', cursor);
    const body: Record<string, unknown> = { ReturnTopNRecords: MV_PAGE_SIZE };
    if (filters.length > 0) body.Filters = filters;

    const call = await mvCall('DocumentGet', apiKey, body);
    const err = asMvError(call, 'DocumentGet (recent fallback)');
    if (err) return { rows, error: err, nextCursor: cursor, exhausted: false };

    const batch = (call.body?.mvDocuments as any[]) || [];
    if (!batch.length) { exhausted = true; break; }

    let recentInBatch = 0;
    for (const row of batch) {
      const day = isoDate(mvField(row as Record<string, unknown>, 'DocumentDate'));
      if (day && day >= sinceYmd) {
        rows.push(row);
        recentInBatch++;
      }
    }

    const minId = minNumericId(batch, 'DocumentId', 'DocumentID');
    if (minId <= 0 || batch.length < MV_PAGE_SIZE) { exhausted = true; break; }
    cursor = minId;
    // walked past the since-window → no more recent docs further back
    if (recentInBatch === 0) { exhausted = true; break; }
  }

  return { rows, error: null, nextCursor: cursor, exhausted };
}

/** The API returns mvProductStockList with nested mvStock; flatten into the rows writeBatch expects. */
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

/** Brand warehouse filter for per-product stock roll-ups. Returns null when no filter is configured
 * (empty/absent megaventory.stockLocations) so the all-warehouses path is an exact no-op. Matches on
 * InventoryLocationID (stable). Raw per-location megaventory_stock rows are never filtered. */
function includedStockLocationIds(conn: Record<string, unknown> | undefined): Set<string> | null {
  const ids = normalizeStockLocations(conn?.stockLocations);
  return ids.length ? new Set(ids) : null;
}

/** Dedupe + trim a stockLocations list (InventoryLocationID strings); drops blanks. */
export function normalizeStockLocations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const v of value) {
    const id = String(v ?? '').trim();
    if (id) seen.add(id);
  }
  return Array.from(seen);
}

/** Roll per-location stock rows up to per-product {available, physical} totals, honoring a warehouse
 * filter (null = all warehouses). A product whose locations are ALL excluded still gets a {0,0} entry,
 * so the merge-write that consumes this map ZEROES it instead of leaving a stale all-location total. */
export function rollUpStockTotalsByProduct(
  stocks: any[],
  locationFilter: Set<string> | null
): Map<string, { available: number; physical: number }> {
  const totals = new Map<string, { available: number; physical: number }>();
  for (const s of stocks) {
    const pid = String(s.productID || s.ProductId || '');
    if (!pid) continue;
    const locId = String(s.inventoryLocationID || s.InventoryLocationId || '');
    const cur = totals.get(pid) ?? { available: 0, physical: 0 };
    if (!locationFilter || locationFilter.has(locId)) {
      cur.available += num(s.productAvailableStockQty || s.ProductAvailableStockQty);
      cur.physical += num(s.productPhysicalStockQty || s.ProductPhysicalStockQty);
    }
    totals.set(pid, cur);
  }
  return totals;
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

export function isLikelySalesInvoice(row: Record<string, unknown>, type: MvDocumentTypeInfo): boolean {
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

/** Credit notes / returns: positive amount + a credit type. Aggregator decides revenue vs cost via `parentDocumentId`
 * (nets revenue only if parent is a sales doc). */
export function isLikelyCreditDocument(row: Record<string, unknown>, type: MvDocumentTypeInfo): boolean {
  const amount = mvNum(row, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal');
  if (amount <= 0) return false;
  return isLikelyCreditDocumentType(type);
}

/** Type-level credit check (no per-row amount) — used to pre-select credit DocumentTypeIds for the backfill. */
function isLikelyCreditDocumentType(type: MvDocumentTypeInfo): boolean {
  const text = `${type.abbreviation.toUpperCase()} ${type.description.toLocaleLowerCase('el-GR')}`;
  if (/(quote|proforma|προσφορ|προτιμολ)/i.test(text)) return false;
  return /(credit|return|refund|πιστωτ|επιστροφ)/i.test(text);
}

/** Type-level inbound-receipt check: supplier deliveries/purchases that bring stock IN — their earliest
 * date per SKU is the real first-available (stock-age) anchor. Used to pre-select DocumentTypeIds for the
 * receipt backfill. Excludes returns/credits, quotes, and inter-branch transfers (not a supplier receipt). */
export function isLikelyInboundReceiptDocumentType(type: MvDocumentTypeInfo): boolean {
  const text = `${type.abbreviation.toUpperCase()} ${type.description.toLocaleLowerCase('el-GR')}`;
  if (/(credit|return|refund|πιστωτ|επιστροφ|_cr\b|quote|proforma|προσφορ|προτιμολ|ενδοδιακ|intercompany|transfer)/i.test(text)) {
    return false;
  }
  return (
    (/προμηθευτ/i.test(text) && /(αποστολ|αγορ)/i.test(text)) ||
    /παραλαβ/i.test(text) ||
    /(goods\s*receipt|inbound|(supplier|purchase)\s*(invoice|delivery|receipt))/i.test(text)
  );
}

/** Map a raw MV credit document → Firestore credit_note row (negate amounts since MV stores positive magnitudes; keep `parentDocumentId` for netting).
 * Shared by live sync and backfill so they never drift. */
function mapMvCreditDocument(
  d: Record<string, unknown>,
  documentTypesById: Map<string, MvDocumentTypeInfo>,
  fallbackCurrency: string,
): { id: string; data: Record<string, unknown> } {
  const gross = mvNum(d, 'DocumentAmountGrandTotal', 'DocumentTotalAmount', 'DocumentAmountTotal', 'DocumentTotal');
  const tax = mvNum(d, 'DocumentAmountTotalTax', 'DocumentTotalTaxAmount');
  const info = documentTypeInfo(d, documentTypesById);
  return {
    id: `mv_inv_${mvText(d, 'DocumentId', 'DocumentID') || mvText(d, 'DocumentNo', 'DocumentSerialNo') || Math.random().toString(36).slice(2)}`,
    data: {
      documentId: mvText(d, 'DocumentId', 'DocumentID'),
      documentNo: mvText(d, 'DocumentNo', 'DocumentSerialNo'),
      documentType: info.abbreviation || info.description || 'credit_document',
      documentTypeId: info.id,
      documentTypeDescription: info.description,
      date: isoDate(mvField(d, 'DocumentDate')),
      status: mvText(d, 'DocumentStatus'),
      totalAmount: -gross,
      taxAmount: tax,
      netAmount: -Math.max(0, gross - tax),
      currency: mvText(d, 'DocumentCurrencyCode') || fallbackCurrency || 'EUR',
      clientName: mvText(d, 'DocumentSupplierClientName', 'SupplierClientName', 'ClientName'),
      clientId: mvText(d, 'DocumentSupplierClientId', 'DocumentSupplierClientID', 'SupplierClientId', 'SupplierClientID'),
      parentDocumentId: mvText(d, 'DocumentParentDocId', 'DocumentParentDocID', 'DocumentParentDocumentId'),
      lineItems: mvDocumentLineItems(d),
      source: 'megaventory_api',
      kind: 'credit_note',
    },
  };
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

/** Verify the API key via lightweight `CurrencyGet`; also try `AccountInformationGet` for the account name. */
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
    /* optional */
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
  options?: { customReportId?: string; customReportEnabled?: boolean; stockLocations?: string[] }
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
  if (options?.stockLocations !== undefined) {
    const ids = normalizeStockLocations(options.stockLocations);
    if (ids.length) megaventory.stockLocations = ids;
    else delete megaventory.stockLocations;
  }

  await ref.set({ megaventory }, { merge: true });

  logger.info(`[Megaventory] Connected brand ${brandId} (${test.accountName || 'unnamed'})`);
  return { success: true, accountName: test.accountName, currency: test.currency };
}

/** Authoritative warehouse list from Megaventory (InventoryLocationGet) — id + human name for the
 * stock-filter settings UI. Queried on demand (no prior sync needed); the stock rows only carry the
 * location ID, so the names must come from this endpoint. */
export async function listMegaventoryLocations(
  brandId: string
): Promise<{ ok: boolean; locations: { id: string; name: string }[]; error?: string }> {
  const conn = (await getDb().doc(`connectors/${brandId}`).get()).data()?.megaventory as Record<string, unknown> | undefined;
  if (!conn?.connected || !conn?.apiKey) {
    return { ok: false, locations: [], error: 'Το Megaventory δεν είναι συνδεδεμένο.' };
  }
  const apiKey = decryptToken(conn.apiKey as string);
  if (!apiKey) return { ok: false, locations: [], error: 'Μη διαθέσιμο API key — απαιτείται επανασύνδεση.' };

  const call = await mvCall('InventoryLocationGet', apiKey, {});
  const err = asMvError(call, 'InventoryLocationGet');
  if (err) return { ok: false, locations: [], error: err };

  const rows = mvArrayField(call.body as Record<string, unknown>, 'mvInventoryLocations', 'InventoryLocations') as Record<string, unknown>[];
  const seen = new Set<string>();
  const locations: { id: string; name: string }[] = [];
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    // Skip deleted / in-transit pseudo-locations — never valid stock-filter options.
    if (mvField(row, 'InventoryLocationIsDeleted') === true || mvField(row, 'InventoryLocationIsTransit') === true) continue;
    const id = String(mvField(row, 'InventoryLocationID', 'InventoryLocationId') ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const abbr = String(mvField(row, 'InventoryLocationAbbreviation') ?? '').trim();
    const name = String(mvField(row, 'InventoryLocationName') ?? '').trim();
    locations.push({ id, name: abbr || name || id });
  }
  locations.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, locations };
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
  // Megaventory usually returns "YYYY-MM-DDThh:mm:ss"
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Firestore doc IDs disallow `/`; a SKU like `N.100.4268-612-S/M` would break `doc()`. */
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

/** Clears previous gap-fill docs before the catalog is rewritten from ProductGet. */
async function mergeMegaventoryApiCatalogProducts(
  db: Firestore,
  brandId: string,
  customReportSnapshotRows: Record<string, unknown>[],
): Promise<number> {
  // Projection (source/sku only) — otherwise ~221k whole docs load into the worker's memory.
  const snap = await db.collection('products').where('brandId', '==', brandId).select('source', 'sku').get();
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

  // Read the full catalog from megaventory_products (persisted, already normalized) instead of an
  // in-memory ProductGet set — gap-fill works without holding the whole 87k-SKU catalog in one invocation.
  const catalogSnap = await db.collection('megaventory_products').where('brandId', '==', brandId).get();
  const items: { id: string; data: Record<string, unknown> }[] = [];
  const seenSku = new Set<string>();
  const deletedSkus = new Set<string>();
  for (const doc of catalogSnap.docs) {
    const p = doc.data();
    const sku = String(p.sku ?? '').trim();
    if (!sku || seenSku.has(sku)) continue;
    seenSku.add(sku);
    // mvDeletedAt → doc stays (history/attribution) but gets discontinued_at + ZERO stock so dashboards
    // distinguish "delisted in ERP" from "sold out". Reversible: an unmarked source doc rebuilds it clean.
    const isDeleted = Boolean(p.mvDeletedAt);
    if (isDeleted) deletedSkus.add(sku);
    if (reportSkus.has(sku)) continue;
    const stock = isDeleted ? 0 : num(p.stockOnHand);
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
        stock_capacity: isDeleted ? 0 : Math.max(stock * 2, stock),
        source: PRESERVED_MEGAVENTORY_API_CATALOG_SOURCE,
        ...(isDeleted ? { discontinued_at: p.mvDeletedAt } : {}),
      },
    });
  }
  // Report-covered (normalized-source) docs aren't rebuilt by gap-fill — patch deleted ones and heal
  // reappeared ones so the marker can't go stale.
  const normalizedPatches: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  for (const doc of snap.docs) {
    if (doc.data().source !== MEGAVENTORY_NORMALIZED_SOURCE) continue;
    const sku = String(doc.data().sku ?? '').trim();
    if (!sku) continue;
    const isDeleted = deletedSkus.has(sku);
    const wasMarked = Boolean(doc.data().discontinued_at);
    if (isDeleted && !wasMarked) {
      normalizedPatches.push({ ref: doc.ref, data: { discontinued_at: FieldValue.serverTimestamp(), stock_level: 0, stock_capacity: 0 } });
    } else if (!isDeleted && wasMarked) {
      normalizedPatches.push({ ref: doc.ref, data: { discontinued_at: FieldValue.delete() } });
    }
  }
  for (let i = 0; i < normalizedPatches.length; i += 400) {
    const batch = db.batch();
    for (const p of normalizedPatches.slice(i, i + 400)) batch.set(p.ref, p.data, { merge: true });
    await batch.commit();
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
  /** True when the fetch did not finish within the soft budget — the worker re-enqueues. */
  needsContinuation?: boolean;
  invoices?: number;
  salesOrders?: number;
  purchaseOrders?: number;
  products?: number;
  stock?: number;
  suppliers?: number;
  /** Custom saved report rows (e.g. stock / movement) — collection megaventory_custom_report_rows */
  customReportRows?: number;
  normalized?: MegaventoryNormalizationCounts;
  /** SKUs added to the `products` collection from a full ProductGet (missing from the custom report). */
  apiCatalogGapFill?: number;
  rfm?: MegaventoryRfmCounts;
  /** Deleted-products reconcile — imported (new tombstones), marked (existing → deleted), unmarked (reappeared). */
  deletedImported?: number;
  deletedMarked?: number;
  deletedUnmarked?: number;
  error?: string;
}

interface MegaventorySyncOptions {
  mode?: 'manual' | 'scheduled';
  skipDocuments?: boolean;
}

/** ONE-TIME historical credit-note backfill (TEMPORARY; delete after prod is backfilled). Brand-agnostic, idempotent (merge-by-doc-id);
 * walks only credit DocumentTypeIds for brands whose invoice backfill is done. */
export async function backfillMegaventoryCreditNotes(
  brandId: string,
  opts?: { maxRuntimeMs?: number; maxPagesPerType?: number },
): Promise<{
  success: boolean;
  error?: string;
  creditTypesScanned: number;
  creditsWritten: number;
  perType: Record<string, number>;
  complete: boolean;
  durationMs: number;
}> {
  const start = Date.now();
  const db = getDb();
  const base = { creditTypesScanned: 0, creditsWritten: 0, perType: {} as Record<string, number>, complete: false, durationMs: 0 };
  const snap = await db.doc(`connectors/${brandId}`).get();
  const conn = snap.data()?.megaventory as Record<string, unknown> | undefined;
  if (!conn?.connected || !conn?.apiKey) {
    return { success: false, error: 'Megaventory not connected', ...base, durationMs: Date.now() - start };
  }
  const apiKey = decryptToken(conn.apiKey as string);
  if (!apiKey) {
    return { success: false, error: 'Megaventory apiKey unavailable — reconnect required', ...base, durationMs: Date.now() - start };
  }
  const fallbackCurrency = String(conn.currency || 'EUR');

  const { types, error: typeErr } = await fetchDocumentTypes(apiKey);
  if (typeErr) return { success: false, error: typeErr, ...base, durationMs: Date.now() - start };
  const documentTypesById = new Map(types.map((t) => [t.id, t]));
  const creditTypes = types.filter((t) => t.id && isLikelyCreditDocumentType(t));

  const deadline = opts?.maxRuntimeMs ? Date.now() + opts.maxRuntimeMs : null;
  const perType: Record<string, number> = {};
  const errors: string[] = [];
  let creditsWritten = 0;
  let complete = true;

  for (const ct of creditTypes) {
    if (deadline && Date.now() >= deadline) { complete = false; break; }
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : undefined;
    const { rows, error, exhausted } = await fetchAllMvPages(
      'DocumentGet',
      apiKey,
      [{ FieldName: 'DocumentTypeId', SearchOperator: 'Equals', SearchValue: ct.id }],
      {
        responseArrayKey: 'mvDocuments',
        cursorField: 'DocumentId',
        idKeys: ['DocumentId', 'DocumentID'],
        label: `DocumentGet credit type ${ct.id}`,
        pageSize: MV_INVOICE_BACKFILL_PAGE_SIZE,
        maxPages: opts?.maxPagesPerType ?? 300,
        maxRuntimeMs: remaining,
      },
    );
    if (error) { errors.push(error); complete = false; continue; }
    if (!exhausted) complete = false;
    const credits = (rows as Record<string, unknown>[]).filter((d) =>
      isLikelyCreditDocument(d, documentTypeInfo(d, documentTypesById))
    );
    const items = credits.map((d) => mapMvCreditDocument(d, documentTypesById, fallbackCurrency));
    if (items.length) await writeBatch(db, 'megaventory_invoices', brandId, items);
    perType[ct.id] = (perType[ct.id] || 0) + items.length;
    creditsWritten += items.length;
  }

  logger.info(
    `[Megaventory] Credit backfill for ${brandId}: ${creditsWritten} credit notes across ${creditTypes.length} credit types (complete=${complete}${errors.length ? `, errors=${errors.length}` : ''})`
  );
  return {
    success: errors.length === 0,
    ...(errors.length ? { error: errors[0] } : {}),
    creditTypesScanned: creditTypes.length,
    creditsWritten,
    perType,
    complete,
    durationMs: Date.now() - start,
  };
}

/** Earliest receipt date per SKU from inbound documents. ISO YYYY-MM-DD strings compare lexicographically,
 * so the minimum is the earliest. Mutates `into`. Exported for unit tests. */
export function mergeEarliestReceiptDates(
  into: Map<string, string>,
  docs: Array<{ date: string; lineItems: Array<Record<string, unknown>> }>
): void {
  for (const d of docs) {
    const date = (d.date || '').slice(0, 10);
    if (!date) continue;
    for (const li of d.lineItems || []) {
      const sku = String((li.sku as unknown) ?? '').trim();
      if (!sku) continue;
      const cur = into.get(sku);
      if (!cur || date < cur) into.set(sku, date);
    }
  }
}

const RECEIPTS_CHUNK_BYTES = 900_000;

/** Read the chunked receipt-date map (sku → earliest YYYY-MM-DD) for merge across backfill passes. */
async function readReceiptDatesChunked(db: Firestore, brandId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const snap = await db.doc(`megaventory_receipts/${brandId}`).collection('chunks').get();
  for (const d of snap.docs) {
    const json = (d.data() as { receiptDatesJson?: string }).receiptDatesJson;
    if (!json) continue;
    try { Object.assign(out, JSON.parse(json)); } catch { /* skip bad chunk */ }
  }
  return out;
}

/** Persist sku → earliest receipt date under megaventory_receipts/{brandId}/chunks (parent holds metadata). */
async function writeReceiptDatesChunked(db: Firestore, brandId: string, datesBySku: Record<string, string>): Promise<number> {
  const skus = Object.keys(datesBySku).sort();
  const chunks: string[] = [];
  let bucket: Record<string, string> = {};
  let bytes = 2;
  for (const sku of skus) {
    const eb = JSON.stringify({ [sku]: datesBySku[sku] }).length - 2;
    if (bytes + eb > RECEIPTS_CHUNK_BYTES && Object.keys(bucket).length) { chunks.push(JSON.stringify(bucket)); bucket = {}; bytes = 2; }
    bucket[sku] = datesBySku[sku];
    bytes += eb + 1;
  }
  if (Object.keys(bucket).length) chunks.push(JSON.stringify(bucket));
  const parent = db.doc(`megaventory_receipts/${brandId}`);
  const chunksCol = parent.collection('chunks');
  const existing = await chunksCol.get();
  const batch = db.batch();
  existing.docs.forEach((d) => batch.delete(d.ref));
  chunks.forEach((json, i) => batch.set(chunksCol.doc(String(i)), { receiptDatesJson: json }));
  batch.set(parent, { brandId, chunkCount: chunks.length, skuCount: skus.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return skus.length;
}

/** Historical receipt-date backfill: walk only inbound supplier DocumentTypeIds, derive earliest receipt
 * date per SKU (the real stock-age anchor), and merge into megaventory_receipts. Idempotent (min-merge);
 * resumable (re-run picks up remaining types). Mirrors backfillMegaventoryCreditNotes. */
export async function backfillMegaventoryReceiptDates(
  brandId: string,
  opts?: { maxRuntimeMs?: number; maxPagesPerType?: number },
): Promise<{ success: boolean; error?: string; receiptTypesScanned: number; skuCount: number; complete: boolean; durationMs: number }> {
  const start = Date.now();
  const db = getDb();
  const base = { receiptTypesScanned: 0, skuCount: 0, complete: false, durationMs: 0 };
  const conn = (await db.doc(`connectors/${brandId}`).get()).data()?.megaventory as Record<string, unknown> | undefined;
  if (!conn?.connected || !conn?.apiKey) return { success: false, error: 'Megaventory not connected', ...base, durationMs: Date.now() - start };
  const apiKey = decryptToken(conn.apiKey as string);
  if (!apiKey) return { success: false, error: 'Megaventory apiKey unavailable — reconnect required', ...base, durationMs: Date.now() - start };

  const { types, error: typeErr } = await fetchDocumentTypes(apiKey);
  if (typeErr) return { success: false, error: typeErr, ...base, durationMs: Date.now() - start };
  const receiptTypes = types.filter((t) => t.id && isLikelyInboundReceiptDocumentType(t));

  const deadline = opts?.maxRuntimeMs ? Date.now() + opts.maxRuntimeMs : null;
  const datesBySku = new Map<string, string>(Object.entries(await readReceiptDatesChunked(db, brandId)));
  // Per-type resume state persisted on the connector: each pass continues where the last left off and
  // skips already-exhausted types, so the walk completes across multiple budget-limited invocations.
  const progress = { ...((conn.receiptBackfillProgress as Record<string, { cursor?: number | null; done?: boolean }>) ?? {}) };
  const errors: string[] = [];
  for (const rt of receiptTypes) {
    if (progress[rt.id]?.done) continue;
    if (deadline && Date.now() >= deadline) break;
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : undefined;
    const { rows, error, nextCursor, exhausted } = await fetchAllMvPages(
      'DocumentGet',
      apiKey,
      [{ FieldName: 'DocumentTypeId', SearchOperator: 'Equals', SearchValue: rt.id }],
      {
        responseArrayKey: 'mvDocuments',
        cursorField: 'DocumentId',
        idKeys: ['DocumentId', 'DocumentID'],
        label: `DocumentGet receipt type ${rt.id}`,
        pageSize: MV_INVOICE_BACKFILL_PAGE_SIZE,
        maxPages: opts?.maxPagesPerType ?? 300,
        maxRuntimeMs: remaining,
        initialCursor: progress[rt.id]?.cursor ?? null,
      },
    );
    const docs = (rows as Record<string, unknown>[]).map((d) => ({ date: isoDate(mvField(d, 'DocumentDate')), lineItems: mvDocumentLineItems(d) }));
    mergeEarliestReceiptDates(datesBySku, docs);
    if (error) { errors.push(error); progress[rt.id] = { cursor: nextCursor, done: false }; continue; }
    progress[rt.id] = { cursor: exhausted ? null : nextCursor, done: exhausted };
  }
  const complete = errors.length === 0 && receiptTypes.every((rt) => progress[rt.id]?.done === true);
  const skuCount = await writeReceiptDatesChunked(db, brandId, Object.fromEntries(datesBySku));
  await db.doc(`connectors/${brandId}`).set(
    { megaventory: { receiptBackfillComplete: complete, receiptBackfillAt: FieldValue.serverTimestamp(), receiptBackfillSkuCount: skuCount, receiptBackfillProgress: progress } },
    { merge: true }
  );
  logger.info(`[Megaventory] Receipt-date backfill for ${brandId}: ${skuCount} SKUs across ${receiptTypes.length} inbound types (complete=${complete}${errors.length ? `, errors=${errors.length}` : ''})`);
  return { success: errors.length === 0, ...(errors.length ? { error: errors[0] } : {}), receiptTypesScanned: receiptTypes.length, skuCount, complete, durationMs: Date.now() - start };
}

/** Full sync (last 90 days) from the manual button + nightly schedule; revenue source = Invoices, Megaventory as master. */
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
  // Soft deadline so no invocation runs into the worker's hard timeout.
  const syncDeadlineAt = Date.now() + MV_SYNC_SOFT_DEADLINE_MS;
  const remainingBudgetMs = () => Math.max(0, syncDeadlineAt - Date.now());
  const overBudget = () => Date.now() >= syncDeadlineAt;
  let needsContinuation = false;
  // `ingestionComplete` = every ingestion phase persisted → this is the dedicated processing pass.
  // `productCatalogComplete` is narrower (gates only the ProductGet skip) so a slow ancillary can still resume.
  const ingestionAlreadyComplete = conn.ingestionComplete === true;
  const catalogAlreadyComplete = ingestionAlreadyComplete || conn.productCatalogComplete === true;
  // Per-cycle done flags for the non-resumable ancillary fetches, so they don't re-run while the catalog spans multiple passes.
  const ordersIngestComplete = ingestionAlreadyComplete || conn.ordersIngestComplete === true;
  const stockIngestComplete = ingestionAlreadyComplete || conn.stockIngestComplete === true;
  const suppliersIngestComplete = ingestionAlreadyComplete || conn.suppliersIngestComplete === true;
  // Deleted-products reconcile (tombstone, never delete): walk ProductGet showOnlyDeleted, mark/unmark `mvDeletedAt`
  // so removed ERP products stop polluting stock/movement/procurement but stay analyzable.
  const deletedScanComplete = ingestionAlreadyComplete || conn.deletedScanComplete === true;
  const deletedScanCursor = positiveNumber(conn.deletedScanCursor);
  const shouldRefreshDocuments = options.skipDocuments !== true;
  let docsWindow = buildHistoricalOrIncrementalWindow(conn, 'lastDocsSyncAt');
  const invoiceBackfillPending = conn.invoiceDocumentBackfillComplete !== true;
  // Manual sync refreshes reference data quickly; scheduled runs continue the historical invoice detail
  // backfill so existing documents gain product line items for Data Analysis.
  const shouldStageInvoiceBackfill = mode === 'scheduled' && invoiceBackfillPending;
  // Manual/incremental invoice ingestion is resumable: budget the date-filter-empty fallback and checkpoint
  // manualInvoiceCursor + manualInvoiceComplete so it resumes instead of re-fetching.
  const manualInvoiceCursor = positiveNumber(conn.manualInvoiceCursor);
  const manualInvoiceAlreadyComplete = conn.manualInvoiceComplete === true;
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
  /** The custom report (Performance etc.) needs the full history; not the documents' 48h overlap. */
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
    creditNotes: 0,
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
  // invoiceIngestComplete gates products (manual path) so the catalog gets a clean budget once invoices finish;
  // staged backfill and skipDocuments runs have no invoices to wait on (true here).
  let invoiceIngestComplete = shouldStageInvoiceBackfill || !shouldRefreshDocuments || manualInvoiceAlreadyComplete;
  let manualInvoiceResumeCursor: number | null = null;
  let manualInvoiceJustCompleted = false;
  let rfmSkippedReason = '';
  let customReportRowsSnapshot: Record<string, unknown>[] = [];
  let apiCatalogGapFillCount = 0;
  let productGetExhausted = false;
  // Did each ancillary phase finish (fetch+write) on THIS pass — feeds the ingestionComplete gate.
  let ordersDoneThisPass = false;
  let stockDoneThisPass = false;
  let suppliersDoneThisPass = false;
  let deletedScanDoneThisPass = false;
  let deletedScanResult: Record<string, unknown> | null = null;

  try {
    const skipDocumentsThisPass =
      !shouldRefreshDocuments ||
      ingestionAlreadyComplete ||
      // Manual invoices already exhausted earlier this ingestion cycle — don't re-fetch every pass
      (!shouldStageInvoiceBackfill && manualInvoiceAlreadyComplete);
    if (skipDocumentsThisPass) {
      const skipReason = ingestionAlreadyComplete
        ? 'processing_pass'
        : manualInvoiceAlreadyComplete
          ? 'manual_invoices_complete'
          : 'manual_catalog_refresh';
      documentDiagnostics = { skipped: true, reason: skipReason };
      logger.info(`[Megaventory] Documents skipped for ${brandId}: ${skipReason}`);
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
        // Resume the manual/incremental invoice walk from its checkpoint (same DocumentId cursor space)
        initialCursor: shouldStageInvoiceBackfill ? invoiceBackfillCursor : (manualInvoiceCursor ?? undefined),
        maxRuntimeMs: shouldStageInvoiceBackfill ? MV_INVOICE_BACKFILL_RUNTIME_MS : remainingBudgetMs(),
      }
    );
    let documentFallbackUsed = false;
    let recentDocumentRowsMerged = 0;
    if (!shouldStageInvoiceBackfill && !invFetchErr && invRows.length === 0) {
      // Budget the fallback + resume from the manual cursor so it can't run into the hard wall.
      const fallback = await fetchRecentMvDocumentsByLocalDate(apiKey, sinceStr, {
        maxRuntimeMs: remainingBudgetMs(),
        initialCursor: manualInvoiceCursor,
      });
      if (fallback.error) {
        invFetchErr = fallback.error;
      } else if (fallback.rows.length > 0 || !fallback.exhausted) {
        invRows = fallback.rows;
        invoiceBackfillNextCursor = fallback.nextCursor;
        invoiceBackfillExhausted = fallback.exhausted;
        documentFallbackUsed = true;
        logger.info(
          `[Megaventory] DocumentGet date filter returned 0 rows for ${brandId}; fallback recovered ${fallback.rows.length} recent documents (exhausted=${fallback.exhausted})`
        );
      } else {
        // fallback found nothing and walked to the end → invoices genuinely exhausted for this window
        invoiceBackfillExhausted = true;
      }
    }
    if (!shouldStageInvoiceBackfill && !invFetchErr) {
      // Translate the manual invoice walk outcome into resume/complete signals for products + state.
      if (invoiceBackfillExhausted) {
        invoiceIngestComplete = true;
        manualInvoiceJustCompleted = true;
      } else {
        manualInvoiceResumeCursor = positiveNumber(invoiceBackfillNextCursor);
        needsContinuation = true;
        logger.warn(
          `[Megaventory] manual invoice ingestion for ${brandId} over budget — deferring (cursor=${manualInvoiceResumeCursor ?? 'latest'})`
        );
      }
    }
    if (!invFetchErr) {
      const rollingRecentWindow = buildRollingUtcDayWindow(MV_RECENT_DOCUMENT_LOOKBACK_DAYS);
      // Budget the rolling-window merge too (best-effort freshness pull). When the pass already
      // ran over budget — e.g. invoices were just deferred — remainingBudgetMs()≈0 makes this a no-op.
      const recent = await fetchRecentMvDocumentsByLocalDate(apiKey, rollingRecentWindow.since, {
        maxRuntimeMs: remainingBudgetMs(),
      });
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
      // Credits flow from the SAME DocumentGet stream (incremental & backfill) — they used to be
      // silently dropped, leaving ERP revenue gross (returns invisible).
      const creditDocs = rawDocs.filter((d) => isLikelyCreditDocument(d, documentTypeInfo(d, documentTypesById)));
      // Inbound supplier-receipt docs from the SAME stream → real stock-age dates, so onboarding needs
      // no separate backfill (the invoice-backfill walk also covers full history here).
      const receiptDocs = rawDocs.filter((d) => isLikelyInboundReceiptDocumentType(documentTypeInfo(d, documentTypesById)));
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
          // Explicit kind so the aggregator distinguishes sales from credits.
          // Old docs without kind = sales (back-compat).
          kind: 'sales_invoice',
        },
      }));
      // Credits → same collection, negated amounts (MV stores positive magnitudes), kind: 'credit_note',
      // + parentDocumentId for the aggregator's netting join.
      const creditItems = creditDocs.map((d) =>
        mapMvCreditDocument(d, documentTypesById, String(conn.currency || 'EUR'))
      );
      const allDocItems = [...items, ...creditItems];
      if (allDocItems.length) await writeBatch(db, 'megaventory_invoices', brandId, allDocItems);
      counts.invoices = items.length;
      counts.creditNotes = creditItems.length;
      totalImported += allDocItems.length;
      // Merge earliest supplier-receipt date per SKU into megaventory_receipts (min-merge, idempotent).
      if (receiptDocs.length) {
        const receiptDatesBySku = new Map<string, string>(Object.entries(await readReceiptDatesChunked(db, brandId)));
        mergeEarliestReceiptDates(
          receiptDatesBySku,
          receiptDocs.map((d) => ({ date: isoDate(mvField(d, 'DocumentDate')), lineItems: mvDocumentLineItems(d) }))
        );
        await writeReceiptDatesChunked(db, brandId, Object.fromEntries(receiptDatesBySku));
      }
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
      logger.info(`[Megaventory] Invoices: ${items.length} + ${creditItems.length} credit notes /${rawDocs.length} raw docs imported for brand ${brandId}`);
    }

    if (docsOk && shouldStageInvoiceBackfill && invoiceBackfillProgress) {
      // EARLY write (before the slow gap-fill/RFM time out the function): not-done → new cursor; done (exhausted) →
      // Complete flag so the 3-year staged backfill doesn't re-scan every night.
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
    } // end invoice ingestion (documents refresh block)

    // ── Sales & Purchase Orders (ingestion — own per-cycle done flag + budget guard) ──
    // Outside the documents-else so they still run once invoices are complete; deferred (not truncated) when over the soft deadline.
    if (!ingestionAlreadyComplete && !ordersIngestComplete && invoiceIngestComplete) {
    if (overBudget()) {
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before SalesOrder/PurchaseOrder fetch for ${brandId} — deferring orders to continuation pass`);
    } else {
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
      ordersDoneThisPass = true;
    } // end orders over-budget guard
    } // end orders ingestion guard

    // ── Products (resumable catalog fetch) ────────────────────────────
    // ProductGet (87k+ SKUs) may span passes via productCatalogCursor (idempotent to megaventory_products); when exhausted, downstream reads the full catalog from Firestore.
    let productGetExhausted = true;
    let productCatalogNextCursor: number | null = null;
    if (catalogAlreadyComplete) {
      logger.info(`[Megaventory] catalog already complete for ${brandId} — skipping ProductGet, running downstream`);
    } else if (!invoiceIngestComplete) {
      // Invoices haven't finished this cycle — give them remaining passes first so the catalog
      // isn't started with a near-zero budget (which ran ProductGet into the wall).
      productGetExhausted = false;
      needsContinuation = true;
      logger.info(`[Megaventory] ProductGet deferred for ${brandId} — manual invoice ingestion not yet complete`);
    } else if (overBudget()) {
      // No budget left for the catalog this pass — defer rather than fetch unbounded (maxRuntimeMs≈0
      // would otherwise disable the deadline inside fetchAllMvPages).
      productGetExhausted = false;
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before ProductGet for ${brandId} — deferring catalog to continuation pass`);
    } else {
      const { rows: prRows, error: prFetchErr, exhausted, nextCursor } = await fetchAllMvPages('ProductGet', apiKey, [], {
        responseArrayKey: 'mvProducts',
        cursorField: 'ProductID',
        idKeys: ['ProductID', 'ProductId'],
        label: 'ProductGet',
        // Referenced objects → category; budget + cursor so it doesn't eat the worker timeout.
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
            // NO stockOnHand here — ProductGet carries no stock fields (ProductStockOnHandTotal doesn't exist);
            // mapping it would write 0 and clobber the real totals the stock walk merges in below.
            source: 'megaventory_api',
          },
        }));
        if (items.length) await writeBatch(db, 'megaventory_products', brandId, items);
        counts.products = items.length;
        totalImported += items.length;
        logger.info(`[Megaventory] Products: ${items.length} imported (cursor pass) for ${brandId}, exhausted=${exhausted}`);
        // Checkpoint catalog progress NOW (not only at pass-end): if a later stage (stock walk /
        // deleted reconcile) is killed at the hard cap, a resumed pass skips the full ProductGet
        // re-walk and gives the heavy downstream the whole budget. Idempotent with the pass-end write.
        await db.doc(`connectors/${brandId}`).update(
          exhausted
            ? { 'megaventory.productCatalogComplete': true, 'megaventory.productCatalogCursor': FieldValue.delete() }
            : { 'megaventory.productCatalogCursor': productCatalogNextCursor ?? FieldValue.delete() }
        );
      }
    }

    // ── Stock per location (ingestion — own done flag + budget guard) ──
    if (!ingestionAlreadyComplete && !stockIngestComplete && invoiceIngestComplete) {
    if (overBudget()) {
      needsContinuation = true;
      logger.warn(`[Megaventory] over soft deadline before InventoryLocationStockGet for ${brandId} — deferring stock to continuation pass`);
    } else {
    let stRowsRaw: any[] = [];
    let stFetchErr: string | null = null;
    let stExhausted = false;
    // This endpoint returns rows in ASCENDING productID order (probe-verified) — the cursor
    // must walk upward (GreaterThan/max), or the walk silently stops after the first 500 products.
    ({ rows: stRowsRaw, error: stFetchErr, exhausted: stExhausted } = await fetchAllMvPages('InventoryLocationStockGet', apiKey, [], {
      responseArrayKey: 'mvProductStockList',
      cursorField: 'productid',
      idKeys: ['productID', 'ProductId', 'ProductID'],
      label: 'InventoryLocationStockGet',
      cursorDirection: 'asc',
      maxRuntimeMs: remainingBudgetMs(),
    }));
    if (!stFetchErr && !stRowsRaw.length) {
      ({ rows: stRowsRaw, error: stFetchErr, exhausted: stExhausted } = await fetchAllMvPages('InventoryLocationStockGet', apiKey, [], {
        responseArrayKey: 'mvInventoryLocationStocks',
        cursorField: 'productid',
        idKeys: ['productID', 'ProductId', 'ProductID'],
        label: 'InventoryLocationStockGet',
        cursorDirection: 'asc',
        maxRuntimeMs: remainingBudgetMs(),
      }));
    }
    if (stFetchErr) {
      referenceOk = false;
      errors.push(stFetchErr);
    } else if (!stExhausted) {
      // Budget truncated the walk mid-way: a partial row set would produce WRONG per-product totals
      // (and a half-rewritten megaventory_stock) — defer and re-walk with a fresh budget next pass.
      needsContinuation = true;
      logger.warn(`[Megaventory] InventoryLocationStockGet truncated by budget for ${brandId} (${stRowsRaw.length} rows) — deferring stock to continuation pass`);
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

      // Per-product stock totals → megaventory_products mirrors. ProductGet has NO stock fields, so this walk is the ONLY
      // source for stockOnHand (copied to products.stock_level by gap-fill): available when positive, else physical.
      // Per-product totals honor the brand's warehouse filter (megaventory.stockLocations); null = all
      // warehouses. rollUpStockTotalsByProduct still emits a {0,0} entry for products absent from the
      // filtered warehouse(s) so the merge-write ZEROES them instead of leaving a stale all-location
      // total. Raw megaventory_stock rows above keep every location — the filter only narrows the
      // per-product roll-up. (Warehouse names for the settings UI come from listMegaventoryLocations.)
      const locationFilter = includedStockLocationIds(conn);
      const totals = rollUpStockTotalsByProduct(stocks, locationFilter);
      // merge-write: rows for productIds without a mirror create sku-less stubs that gap-fill
      // skips (deleted products return zero stock rows, so stubs stay a rare edge, not pollution)
      const totalItems = Array.from(totals.entries()).map(([pid, t]) => ({
        id: `mv_p_${pid}`,
        data: {
          productId: pid,
          stockOnHand: t.available > 0 ? t.available : t.physical,
          availableStockTotal: t.available,
          physicalStockTotal: t.physical,
        },
      }));
      if (totalItems.length) await writeBatch(db, 'megaventory_products', brandId, totalItems);
      stockDoneThisPass = true;
      logger.info(`[Megaventory] Stock rows: ${items.length} imported for brand ${brandId}; totals merged onto ${totalItems.length} product mirrors`);
    }
    } // end stock over-budget guard
    } // end stock ingestion guard

    // ── Suppliers (ingestion — own done flag + reserve guard; SupplierClientGet is the slow one) ─────
    if (!ingestionAlreadyComplete && !suppliersIngestComplete && invoiceIngestComplete) {
    if (remainingBudgetMs() < MV_SUPPLIERS_RESERVE_MS) {
      needsContinuation = true;
      logger.warn(`[Megaventory] insufficient budget reserve before SupplierClientGet for ${brandId} — deferring suppliers to continuation pass`);
    } else {
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
      suppliersDoneThisPass = true;
      logger.info(`[Megaventory] Suppliers: ${items.length} imported for brand ${brandId}`);
    }
    } // end suppliers reserve guard
    } // end suppliers ingestion guard

    // ── Deleted products (import + tombstone reconcile) ──────────────
    // MV drops deleted products from normal sync; import the FULL backlog (~133k first cycle, later diff), mark `mvDeletedAt`, zero stock, unmark reappeared. Cursor-resumable.
    if (!ingestionAlreadyComplete && !deletedScanComplete && invoiceIngestComplete) {
    if (remainingBudgetMs() < MV_DELETED_SCAN_RESERVE_MS) {
      needsContinuation = true;
      logger.warn(`[Megaventory] insufficient budget reserve before deleted-products scan for ${brandId} — deferring to continuation pass`);
    } else {
      const { rows: delRows, error: delFetchErr, exhausted: delExhausted, nextCursor: delNextCursor } = await fetchAllMvPages('ProductGet', apiKey, [], {
        responseArrayKey: 'mvProducts',
        cursorField: 'ProductID',
        idKeys: ['ProductID', 'ProductId'],
        label: 'ProductGet (deleted scan)',
        pageSize: MV_DELETED_SCAN_PAGE_SIZE,
        extraBody: { showDeleted: 'showOnlyDeleted', includeReferencedObjects: true },
        maxRuntimeMs: remainingBudgetMs(),
        initialCursor: deletedScanCursor ?? undefined,
      });
      if (delFetchErr) {
        referenceOk = false;
        errors.push(delFetchErr);
      } else {
        // Current mirror state (projected): which productIds exist, which are already tombstoned.
        const mirror = await db.collection('megaventory_products')
          .where('brandId', '==', brandId)
          .select('productId', 'mvDeletedAt')
          .get();
        const existingIds = new Set<string>();
        const markedIds = new Set<string>();
        for (const doc of mirror.docs) {
          const pid = String(doc.data().productId ?? '').trim();
          if (!pid) continue;
          existingIds.add(pid);
          if (doc.data().mvDeletedAt) markedIds.add(pid);
        }

        const toImport: { id: string; data: Record<string, unknown> }[] = [];
        const newlyMarkedPids: string[] = [];
        const walkedPids = new Set<string>();
        for (const p of delRows as any[]) {
          const pid = String(p.ProductID || p.ProductId || '').trim();
          if (!pid) continue;
          walkedPids.add(pid);
          if (!existingIds.has(pid)) {
            // never synced (deleted before we existed) → import full record, tombstoned, zero stock
            toImport.push({
              id: `mv_p_${pid}`,
              data: {
                productId: pid,
                sku: p.ProductSKU || '',
                name: p.ProductDescription || '',
                longDescription: p.ProductLongDescription || '',
                category: extractMvCategory(p as Record<string, unknown>),
                unitOfMeasurement: p.ProductUnitOfMeasurement || '',
                sellingPrice: num(p.ProductSellingPrice),
                purchasePrice: num(p.ProductPurchasePrice),
                stockOnHand: 0,
                source: 'megaventory_api',
                mvDeletedAt: FieldValue.serverTimestamp(),
              },
            });
          } else if (!markedIds.has(pid)) {
            // known product deleted since our last cycle → tombstone it
            newlyMarkedPids.push(pid);
          }
        }

        if (toImport.length) await writeBatch(db, 'megaventory_products', brandId, toImport);

        for (let i = 0; i < newlyMarkedPids.length; i += 400) {
          const batch = db.batch();
          for (const pid of newlyMarkedPids.slice(i, i + 400)) {
            batch.set(
              db.collection('megaventory_products').doc(sanitizeFirestoreDocId(`mv_p_${pid}`)),
              { mvDeletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          await batch.commit();
        }

        // Zero stock rows of newly tombstoned products (preserve forensics in stockAtDeletion).
        let zeroedStockRows = 0;
        if (newlyMarkedPids.length) {
          const markedSet = new Set(newlyMarkedPids);
          const stockSnap = await db.collection('megaventory_stock')
            .where('brandId', '==', brandId)
            .select('productId', 'physicalStock', 'availableStock')
            .get();
          const updates = stockSnap.docs.filter((d) => markedSet.has(String(d.data().productId ?? '')));
          for (let i = 0; i < updates.length; i += 400) {
            const batch = db.batch();
            for (const doc of updates.slice(i, i + 400)) {
              batch.set(doc.ref, {
                stockAtDeletion: num(doc.data().physicalStock),
                physicalStock: 0,
                availableStock: 0,
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
            }
            await batch.commit();
            zeroedStockRows += Math.min(400, updates.length - i);
          }
        }

        // Reverse direction (undelete support): only when this pass saw the FULL deleted set
        // (started from scratch AND exhausted) — a partial walk must not unmark out-of-window ids.
        let unmarked = 0;
        if (delExhausted && deletedScanCursor === null) {
          const toUnmark = [...markedIds].filter((pid) => !walkedPids.has(pid));
          for (let i = 0; i < toUnmark.length; i += 400) {
            const batch = db.batch();
            for (const pid of toUnmark.slice(i, i + 400)) {
              batch.set(
                db.collection('megaventory_products').doc(sanitizeFirestoreDocId(`mv_p_${pid}`)),
                { mvDeletedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
                { merge: true }
              );
            }
            await batch.commit();
            unmarked += Math.min(400, toUnmark.length - i);
          }
        }

        deletedScanResult = {
          imported: toImport.length,
          marked: newlyMarkedPids.length,
          unmarked,
          zeroedStockRows,
          exhausted: delExhausted,
          nextCursor: delNextCursor,
        };
        if (delExhausted) {
          deletedScanDoneThisPass = true;
        } else {
          needsContinuation = true;
        }
        totalImported += toImport.length;
        logger.info(
          `[Megaventory] Deleted scan for ${brandId}: imported=${toImport.length} marked=${newlyMarkedPids.length} unmarked=${unmarked} stockRowsZeroed=${zeroedStockRows} exhausted=${delExhausted}`
        );
      }
    } // end deleted-scan reserve guard
    } // end deleted-scan ingestion guard

    // ── Custom saved report (e.g. Performance / stock — CustomReportGetData) ──
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
    // Core data is written; mark visible `lastSyncAt` HERE so the UI shows a fresh sync even if the heavy steps (gap-fill/RFM/procurement) run long or time out.
    try {
      await db.doc(`connectors/${brandId}`).update({
        'megaventory.lastSyncAt': FieldValue.serverTimestamp(),
      });
    } catch (markErr) {
      logger.warn(`[Megaventory] early lastSyncAt mark failed for ${brandId}: ${markErr instanceof Error ? markErr.message : String(markErr)}`);
    }

    // Gap-fill purges & rewrites the ENTIRE api-catalog from megaventory_products; runs ONLY when the catalog is COMPLETE
    // (else purge-then-partial = data loss) — otherwise request continuation. "Done" = exhausted this pass or complete from a prior.
    const productCatalogDone = catalogAlreadyComplete || (referenceOk && productGetExhausted !== false);
    const ordersDone = ordersIngestComplete || ordersDoneThisPass;
    const stockDone = stockIngestComplete || stockDoneThisPass;
    const suppliersDone = suppliersIngestComplete || suppliersDoneThisPass;
    const deletedScanDone = deletedScanComplete || deletedScanDoneThisPass;
    // Ingestion complete only when EVERY phase (invoices/orders/catalog/stock/suppliers/deleted-scan) is in.
    // Processing purges+rewrites from Firestore — must not start on a partial dataset nor be flipped early by one fast phase.
    const ingestionComplete = ingestionAlreadyComplete ||
      (referenceOk && invoiceIngestComplete && productCatalogDone && ordersDone && stockDone && suppliersDone && deletedScanDone);
    // Run the heavy downstream only when ingestion is complete AND we're either the dedicated processing pass or
    // still have a full budget reserve; else defer (large brands can't fit ingestion AND processing in one 30-min pass).
    const runProcessing = ingestionComplete && (ingestionAlreadyComplete || remainingBudgetMs() >= MV_PROCESSING_RESERVE_MS);
    // Run heavy sub-stages greedily but checkpoint between them (gapfill=0 → rfm=1 → finalize=2). `processingDoneThrough` =
    // index of the next sub-stage to run, advancing as each completes; heavy brands span passes, light ones run all inline.
    let processingDoneThrough = runProcessing
      ? PROCESSING_ORDER.indexOf(planProcessing(conn.processingStage as ProcessingStage | null | undefined).run)
      : 0;
    if (!ingestionComplete) {
      needsContinuation = true;
      logger.warn(`[Megaventory] ingestion incomplete within budget for ${brandId} — deferring to continuation pass`);
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

    // The standalone after-gap-fill stock-movement refresh was REMOVED (it ran the ~20min module in the same pass);
    // the dedicated 'stockmovement' sub-stage below covers its case (gap-fill signal) in its own budgeted pass.

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
      } else {
        // Manual/incremental invoice resume: checkpoint cursor when deferring mid-walk, mark complete (drop cursor) when exhausted.
        // NOT reset on failure (unlike catalog) — a saved cursor lets a retry resume instead of re-hitting the wall at the same spot.
        if (manualInvoiceJustCompleted) {
          patch['megaventory.manualInvoiceComplete'] = true;
          patch['megaventory.manualInvoiceCompletedAt'] = FieldValue.serverTimestamp();
          patch['megaventory.manualInvoiceCursor'] = FieldValue.delete();
        } else if (manualInvoiceResumeCursor) {
          patch['megaventory.manualInvoiceCursor'] = manualInvoiceResumeCursor;
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
      // Ingestion pass — RFM runs on the dedicated processing pass.
      rfmSkippedReason = 'deferred_to_processing_pass';
    } else if (processingDoneThrough !== 1) {
      // not the RFM sub-stage on this pass (gap-fill deferred earlier, or RFM already done in a prior pass)
    } else if (remainingBudgetMs() < MV_STAGE_RESERVE_MS.rfm) {
      // Not enough budget to fit the monolithic RFM rebuild — defer it to a fresh pass.
      needsContinuation = true;
      rfmSkippedReason = 'deferred_over_budget';
      logger.warn(`[Megaventory] insufficient budget reserve before RFM refresh for ${brandId} — deferring to continuation pass`);
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
      // not the procurement sub-stage on this pass (earlier sub-stage deferred, or already done)
    } else if (remainingBudgetMs() < MV_STAGE_RESERVE_MS.procurement) {
      // Not enough budget to fit the procurement refresh — defer it to a fresh pass.
      needsContinuation = true;
      logger.warn(`[Megaventory] insufficient budget reserve before procurement refresh for ${brandId} — deferring to continuation pass`);
    } else {
      // ── Processing sub-stage 2: procurement signals ──
      if (normalizedCounts && normalizedCounts.products > 0) {
        try {
          const procurement = await refreshProcurementSignals(brandId);
          postNormalizeRefresh = {
            ...(postNormalizeRefresh ?? {}),
            procurementSignals: procurement,
          };
        } catch (refreshErr) {
          const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          errors.push(`MegaventoryProcurementRefresh: ${msg}`);
          logger.warnAlert(`[Megaventory] Procurement refresh failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
        }
      }
      processingDoneThrough = 3; // procurement done (or skipped) — advance to stock-movement
    }

    if (!runProcessing || processingDoneThrough !== 3) {
      // not the stock-movement sub-stage on this pass (earlier sub-stage deferred, or already done)
    } else if (remainingBudgetMs() < MV_STAGE_RESERVE_MS.stockmovement) {
      // refreshStockMovement alone takes ~20min for an 88k-SKU brand (the pass-2 hard-kill on
      // staging) — only START it with a near-full budget, i.e. effectively in its OWN fresh pass.
      needsContinuation = true;
      logger.warn(`[Megaventory] insufficient budget reserve before stock-movement refresh for ${brandId} — deferring to continuation pass`);
    } else {
      // ── Processing sub-stage 3: stock movement (last) ──
      // Runs when the custom report normalized products OR gap-fill added catalog SKUs (this pass or a prior checkpoint).
      const gapFillSignal = apiCatalogGapFillCount > 0 || Number(conn.lastApiCatalogGapFill) > 0;
      if ((normalizedCounts && normalizedCounts.products > 0) || gapFillSignal) {
        try {
          await refreshStockMovement(brandId);
          postNormalizeRefresh = {
            ...(postNormalizeRefresh ?? {}),
            stockMovement: 'refreshed',
            ...(apiCatalogGapFillCount > 0 ? { apiCatalogGapFill: apiCatalogGapFillCount } : {}),
          };
        } catch (refreshErr) {
          const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          errors.push(`MegaventoryStockMovementRefresh: ${msg}`);
          logger.warnAlert(`[Megaventory] Stock-movement refresh failed for ${brandId}: ${msg}`, { alertKey: ALERT.megaventorySyncFailed });
        }
      }
      processingDoneThrough = 4; // stock-movement done — whole processing stage complete
    }

    // Persist resumable state AFTER every phase decided continuation.
    // (a) Per-phase progress — checkpoint so the next pass skips finished phases (ProductGet's own complete/cursor; ancillary per-cycle flags), persisted even mid-ingestion.
    if (!catalogAlreadyComplete) {
      if (productGetExhausted !== false && referenceOk) {
        patch['megaventory.productCatalogComplete'] = true;
        patch['megaventory.productCatalogCursor'] = FieldValue.delete();
      } else if (productCatalogNextCursor) {
        patch['megaventory.productCatalogCursor'] = productCatalogNextCursor;
        patch['megaventory.productCatalogComplete'] = false;
      }
    }
    if (ordersDoneThisPass) patch['megaventory.ordersIngestComplete'] = true;
    if (stockDoneThisPass) patch['megaventory.stockIngestComplete'] = true;
    if (suppliersDoneThisPass) patch['megaventory.suppliersIngestComplete'] = true;
    if (deletedScanDoneThisPass) {
      patch['megaventory.deletedScanComplete'] = true;
      patch['megaventory.deletedScanCursor'] = FieldValue.delete();
    } else if (deletedScanResult && deletedScanResult.nextCursor) {
      patch['megaventory.deletedScanCursor'] = deletedScanResult.nextCursor;
    }

    // (b) Ingestion → processing transition / whole-sync reset.
    if (!ingestionComplete) {
      // still ingesting — needsContinuation already set by whichever phase deferred; progress is in (a).
    } else if (runProcessing && processingDoneThrough >= PROCESSING_ORDER.length) {
      // every processing sub-stage finished → whole sync complete → reset so the next sync re-ingests fresh
      patch['megaventory.ingestionComplete'] = FieldValue.delete();
      patch['megaventory.productCatalogComplete'] = FieldValue.delete();
      patch['megaventory.productCatalogCursor'] = FieldValue.delete();
      patch['megaventory.processingStage'] = FieldValue.delete();
      patch['megaventory.ordersIngestComplete'] = FieldValue.delete();
      patch['megaventory.stockIngestComplete'] = FieldValue.delete();
      patch['megaventory.suppliersIngestComplete'] = FieldValue.delete();
      patch['megaventory.deletedScanComplete'] = FieldValue.delete();
      patch['megaventory.deletedScanCursor'] = FieldValue.delete();
      // clear the manual invoice cycle flags too so the next full sync re-walks invoices fresh
      patch['megaventory.manualInvoiceComplete'] = FieldValue.delete();
      patch['megaventory.manualInvoiceCursor'] = FieldValue.delete();
    } else {
      // ingestion complete but processing in progress/deferred → mark the processing pass + checkpoint sub-stage
      patch['megaventory.ingestionComplete'] = true;
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
      ...(deletedScanResult ? { deletedScan: deletedScanResult } : {}),
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
      ...(deletedScanResult ? {
        deletedImported: Number(deletedScanResult.imported ?? 0),
        deletedMarked: Number(deletedScanResult.marked ?? 0),
        deletedUnmarked: Number(deletedScanResult.unmarked ?? 0),
      } : {}),
      ...(errors.length ? { error: errors[0] } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Megaventory] fetchMegaventoryData error for ${brandId}:`, { alertKey: ALERT.megaventorySyncFailed, err: msg });
    return { success: false, imported: totalImported, ...counts, error: msg };
  }
}
