/**
 * PER-60 — Megaventory sync INTEGRATION harness.
 *
 * Runs the REAL `fetchMegaventoryData` checkpointed state machine against the
 * Firestore emulator with:
 *   • a controllable clock — `vi.useFakeTimers({ toFake: ['Date'] })` fakes ONLY
 *     Date/Date.now() (leaving setTimeout/gRPC timers real so firebase-admin
 *     still talks to the emulator), and the Megaventory `fetch` mock advances the
 *     fake clock per page to simulate a phase burning minutes → drives
 *     `overBudget()` deterministically without touching production code.
 *   • a Megaventory API mock — `fetch` is stubbed and serves per-endpoint,
 *     cursor-paginated datasets so the resume/defer transitions are exercised.
 *   • mocked heavy downstream sub-modules (RFM / procurement / stock-movement /
 *     normalizer / cleanup) so a pass is fast and the assertions target the
 *     ingestion→processing STATE MACHINE, not those modules.
 *
 * Run via `npm run test:integration` (wraps this in `firebase emulators:exec`).
 *
 * These tests pin the behaviour the slow, non-deterministic staging cycles can't
 * prove: invoice resume-across-passes, products-wait-for-invoices, catalog
 * cursor persistence, and whole-sync reset.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

// ── Mock the heavy downstream modules BEFORE importing the connector ──────────
// Each mock advances the fake clock by a configurable per-test duration, so a test can give the
// processing modules realistic costs (e-tennis profile: stock-movement ~20min, gap-fill ~5min)
// and prove the per-module sub-stage checkpoints split them across passes.
const moduleDurations = { rfm: 0, procurement: 0, stockMovement: 0, gapFill: 0 };
const burn = (ms: number) => { if (ms) vi.setSystemTime(Date.now() + ms); };
vi.mock('../../megaventoryRfm', () => ({
  refreshMegaventoryRfmSegments: vi.fn(async () => { burn(moduleDurations.rfm); return { segments: 0, customers: 0 }; }),
}));
vi.mock('../../procurementSignals', () => ({
  refreshProcurementSignals: vi.fn(async () => { burn(moduleDurations.procurement); return { signals: 0 }; }),
}));
vi.mock('../../stockMovementTracker', () => ({
  refreshStockMovement: vi.fn(async () => { burn(moduleDurations.stockMovement); }),
}));
vi.mock('../../megaventoryNormalizer', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Pretend the custom report normalized into 5 products so the processing
    // procurement/stock-movement sub-stages (which gate on normalizedCounts.products > 0) run.
    normalizeMegaventoryCustomReportRows: vi.fn(async () => ({ products: 5, invoices: 0, stock: 0 })),
    // gap-fill purges+rewrites the whole catalog from Firestore — return 0 fast by default; tests
    // with a non-zero moduleDurations.gapFill simulate the heavy variant.
    mergeMegaventoryApiCatalogProducts: vi.fn(async () => { burn(moduleDurations.gapFill); return 0; }),
  };
});
vi.mock('../../manualDataCleanup', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    cleanupManualImportsForMegaventoryMaster: vi.fn(async () => ({ products: 0, invoices: 0, segments: 0 })),
  };
});

import { fetchMegaventoryData, setDb } from '../../megaventoryConnector';

const PROJECT_ID = 'demo-test';
const BRAND = 'etennis';
const API_KEY = 'mv-integration-key';
const MIN = 60 * 1000;

// Fixed fake-clock origin (UTC) — the connector stamps syncDeadlineAt = now + 25min.
const CLOCK_START = Date.UTC(2026, 5, 9, 2, 0, 0);

let db: admin.firestore.Firestore;

// ── Megaventory API mock ──────────────────────────────────────────────────────
type Row = Record<string, unknown>;
interface MvDataset {
  documentTypes: Row[];
  invoices: Row[]; // sorted DESC by DocumentId
  salesOrders: Row[];
  purchaseOrders: Row[];
  products: Row[]; // sorted DESC by ProductID
  /** served when the request body carries showDeleted (the deleted-products reconcile walk) */
  deletedProducts?: Row[];
  stock: Row[];
  suppliers: Row[];
  customReportRows: Row[];
}
/** ms the fake clock advances per fetched page, per endpoint — makes a phase "expensive". */
type MsPerPage = Partial<Record<string, number>>;

function descById(n: number, idField: string, startId: number, extra: (id: number) => Row): Row[] {
  // ids: startId, startId-1, ... (DESC) so cursor (LessThan minId) walks downward
  return Array.from({ length: n }, (_, i) => ({ [idField]: startId - i, ...extra(startId - i) }));
}

function emptyDataset(): MvDataset {
  return {
    documentTypes: [
      { DocumentTypeId: 1, DocumentTypeAbbreviation: 'SI', DocumentTypeDescription: 'Sales Invoice' },
    ],
    invoices: [],
    salesOrders: [],
    purchaseOrders: [],
    products: [],
    stock: [],
    suppliers: [],
    customReportRows: [{ Index: 0, Data: ['sku-1', '10'] }],
  };
}

function cursorOf(body: Row, field: string): number | null {
  const filters = (body.Filters as Row[] | undefined) ?? [];
  const f = filters.find((x) => x.SearchOperator === 'LessThan' && x.FieldName === field);
  return f ? Number(f.SearchValue) : null;
}
function hasFieldFilter(body: Row, field: string): boolean {
  const filters = (body.Filters as Row[] | undefined) ?? [];
  return filters.some((x) => x.FieldName === field);
}
function page(all: Row[], idField: string, body: Row): Row[] {
  const pageSize = Number(body.ReturnTopNRecords) || 500;
  const cursor = cursorOf(body, idField);
  const filtered = cursor != null ? all.filter((r) => Number(r[idField]) < cursor) : all;
  return filtered.slice(0, pageSize);
}
/**
 * ASC variant mirroring the REAL InventoryLocationStockGet behaviour (probe-verified): rows come in
 * ASCENDING productID order and the cursor must be GreaterThan. A DESC LessThan walk against this
 * shape silently truncates to the first page — the live bug this mock pins against regression.
 */
function pageAsc(all: Row[], idField: string, body: Row): Row[] {
  const pageSize = Number(body.ReturnTopNRecords) || 500;
  const filters = (body.Filters as Row[] | undefined) ?? [];
  const gt = filters.find((x) => x.SearchOperator === 'GreaterThan' && x.FieldName === idField.toLowerCase());
  const lt = filters.find((x) => x.SearchOperator === 'LessThan' && x.FieldName === idField.toLowerCase());
  const sorted = [...all].sort((a, b) => Number(a[idField]) - Number(b[idField]));
  let filtered = sorted;
  if (gt) filtered = sorted.filter((r) => Number(r[idField]) > Number(gt.SearchValue));
  else if (lt) filtered = sorted.filter((r) => Number(r[idField]) < Number(lt.SearchValue));
  return filtered.slice(0, pageSize);
}

// Largest simulated elapsed (ms since the pass clock origin) reached during a
// single fetchMegaventoryData pass — used to assert no pass runs into the wall.
let passMaxElapsed = 0;

function installMvMock(dataset: MvDataset, msPerPage: MsPerPage = {}) {
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    const endpoint = String(url).split('/').pop() as string;
    const body = JSON.parse(init.body) as Row;
    const advance = msPerPage[endpoint] ?? 0;
    if (advance) vi.setSystemTime(Date.now() + advance);
    passMaxElapsed = Math.max(passMaxElapsed, Date.now() - CLOCK_START);

    let payload: Row = { ResponseStatus: { ErrorCode: '0' } };
    switch (endpoint) {
      case 'DocumentTypeGet':
        payload.mvDocumentTypes = dataset.documentTypes;
        break;
      case 'DocumentGet': {
        // The manual/incremental invoice fetch uses a DocumentDate filter; the
        // rolling-merge / fallback / latest-sample calls are cursor-only → serve
        // empty for those so this harness drives the MAIN-fetch resume path.
        if (hasFieldFilter(body, 'DocumentDate')) {
          payload.mvDocuments = page(dataset.invoices, 'DocumentId', body);
        } else {
          payload.mvDocuments = [];
        }
        break;
      }
      case 'SalesOrderGet':
        payload.mvSalesOrders = page(dataset.salesOrders, 'SalesOrderId', body);
        break;
      case 'PurchaseOrderGet':
        payload.mvPurchaseOrders = page(dataset.purchaseOrders, 'PurchaseOrderId', body);
        break;
      case 'ProductGet':
        // the deleted-products reconcile walk sends showDeleted — serve the deleted dataset
        payload.mvProducts = body.showDeleted
          ? page(dataset.deletedProducts ?? [], 'ProductID', body)
          : page(dataset.products, 'ProductID', body);
        break;
      case 'InventoryLocationStockGet':
        // real shape (probe-verified): ASC ordering, one row per product with row-level
        // Stock*Total fields plus nested mvStock per-location entries. ProductGet carries
        // NO stock fields — this endpoint is the only stock source.
        payload.mvProductStockList = pageAsc(dataset.stock, 'productID', body).map((r) => ({
          productID: r.productID,
          StockOnHandTotal: Number(r.qty ?? 1),
          StockPhysicalTotal: Number(r.qty ?? 1),
          mvStock: [
            { InventoryLocationID: 18, StockPhysical: Number(r.qty ?? 1), StockOnHand: Number(r.qty ?? 1), SubLocation: '' },
          ],
        }));
        break;
      case 'SupplierClientGet':
        payload.mvSupplierClients = page(dataset.suppliers, 'SupplierClientID', body);
        break;
      case 'CustomReportGetData':
        payload = { ResponseStatus: { ErrorCode: '0' }, Rows: dataset.customReportRows };
        break;
      default:
        payload.ResponseStatus = { ErrorCode: '0' };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function seedConnector(overrides: Record<string, unknown> = {}) {
  await db.doc(`connectors/${BRAND}`).set({
    megaventory: {
      connected: true,
      apiKey: API_KEY,
      currency: 'EUR',
      customReportId: '321',
      customReportEnabled: true,
      ...overrides,
    },
  });
}

async function connState(): Promise<Record<string, unknown>> {
  const snap = await db.doc(`connectors/${BRAND}`).get();
  return ((snap.data()?.megaventory as Record<string, unknown>) ?? {}) as Record<string, unknown>;
}

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
  setDb(db);
});

afterAll(async () => {
  await admin.app().delete();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(CLOCK_START);
  moduleDurations.rfm = 0;
  moduleDurations.procurement = 0;
  moduleDurations.stockMovement = 0;
  moduleDurations.gapFill = 0;
  await db.doc(`connectors/${BRAND}`).delete();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Megaventory sync — light brand (single pass)', () => {
  it('runs all phases inline and resets resumable state on whole-sync completion', async () => {
    installMvMock({
      ...emptyDataset(),
      invoices: descById(3, 'DocumentId', 9000, (id) => ({ DocumentDate: '2026-06-01', DocumentTypeId: 1, DocumentId: id })),
      products: descById(4, 'ProductID', 500, (id) => ({ ProductID: id, ProductSKU: `sku-${id}`, ProductDescription: 'x' })),
      suppliers: descById(2, 'SupplierClientID', 10, (id) => ({ SupplierClientID: id, SupplierClientType: 'supplier', SupplierClientName: `s${id}` })),
    });
    await seedConnector();

    const res = await fetchMegaventoryData(BRAND, { mode: 'manual' });

    expect(res.success).toBe(true);
    expect(res.needsContinuation).toBeFalsy();
    const st = await connState();
    // whole sync finished → every resumable flag cleared
    expect(st.productCatalogComplete).toBeUndefined();
    expect(st.productCatalogCursor).toBeUndefined();
    expect(st.processingStage).toBeUndefined();
    expect(st.manualInvoiceComplete).toBeUndefined();
    expect(st.manualInvoiceCursor).toBeUndefined();
  });
});

describe('Megaventory sync — invoice ingestion is budgeted + resumable', () => {
  it('defers mid-walk when over budget: persists manualInvoiceCursor, leaves products for the next pass', async () => {
    // 4 invoice pages × 10min/page → exceeds the 25min soft deadline mid-walk.
    installMvMock(
      {
        ...emptyDataset(),
        invoices: descById(2000, 'DocumentId', 9000, (id) => ({ DocumentDate: '2026-06-01', DocumentTypeId: 1, DocumentId: id })),
        products: descById(10, 'ProductID', 500, (id) => ({ ProductID: id, ProductSKU: `sku-${id}` })),
      },
      { DocumentGet: 10 * MIN },
    );
    await seedConnector();

    const res = await fetchMegaventoryData(BRAND, { mode: 'manual' });

    expect(res.needsContinuation).toBe(true);
    const st = await connState();
    expect(typeof st.manualInvoiceCursor).toBe('number'); // checkpointed resume point
    expect(st.manualInvoiceComplete).toBeUndefined(); // NOT marked complete
    // products were deferred (invoices not done) → no catalog cursor written either
    expect(st.productCatalogComplete).toBeUndefined();
  });

  it('resumes invoices from the saved cursor, marks them complete, then starts the (deferred) catalog', async () => {
    // Few invoices remaining (exhaust fast), but a big SLOW catalog so products
    // defer over budget → we can observe manualInvoiceComplete=true persisting
    // alongside a productCatalogCursor in the same pass.
    installMvMock(
      {
        ...emptyDataset(),
        invoices: descById(3, 'DocumentId', 100, (id) => ({ DocumentDate: '2026-06-01', DocumentTypeId: 1, DocumentId: id })),
        products: descById(5000, 'ProductID', 80000, (id) => ({ ProductID: id, ProductSKU: `sku-${id}` })),
      },
      { ProductGet: 9 * MIN },
    );
    // seed as if a prior pass had checkpointed the invoice walk
    await seedConnector({ manualInvoiceCursor: 9000 });

    const res = await fetchMegaventoryData(BRAND, { mode: 'manual' });

    expect(res.needsContinuation).toBe(true);
    const st = await connState();
    expect(st.manualInvoiceComplete).toBe(true); // invoices exhausted this pass
    expect(st.manualInvoiceCursor).toBeUndefined(); // cursor dropped on completion
    expect(st.productCatalogComplete).toBe(false); // catalog deferred mid-walk
    expect(typeof st.productCatalogCursor).toBe('number');
  });
});

describe('Megaventory sync — full ingestion converges within the worker cap (no wall-hit)', () => {
  const HARD_CAP_MS = 30 * MIN; // onSchedule worker hard timeout
  const MAX_PASSES = 8; // MAX_CONTINUATIONS in the worker

  async function driveToCompletion() {
    const elapsedPerPass: number[] = [];
    const totals = { products: 0, suppliers: 0, salesOrders: 0, purchaseOrders: 0, stock: 0 };
    let res: Awaited<ReturnType<typeof fetchMegaventoryData>> | undefined;
    for (let pass = 0; pass < MAX_PASSES + 2; pass++) {
      vi.setSystemTime(CLOCK_START); // each worker invocation starts a fresh 30-min clock
      passMaxElapsed = 0;
      res = await fetchMegaventoryData(BRAND, { mode: 'manual' });
      // pass cost = furthest the clock got, via fetches OR module burns (Date.now() at pass end)
      elapsedPerPass.push(Math.max(passMaxElapsed, Date.now() - CLOCK_START));
      totals.products += res.products ?? 0;
      totals.suppliers += res.suppliers ?? 0;
      totals.salesOrders += res.salesOrders ?? 0;
      totals.purchaseOrders += res.purchaseOrders ?? 0;
      totals.stock += res.stock ?? 0;
      if (!res.needsContinuation) break;
    }
    return { res: res!, elapsedPerPass, totals };
  }

  it('e-tennis shape: heavy invoices + slow suppliers + catalog complete without any pass exceeding 30min', async () => {
    // invoices ~20min (exhaust), suppliers a slow 12-min fetch, modest catalog.
    installMvMock(
      {
        ...emptyDataset(),
        invoices: descById(2200, 'DocumentId', 90000, (id) => ({ DocumentDate: '2026-06-01', DocumentTypeId: 1, DocumentId: id })),
        salesOrders: descById(50, 'SalesOrderId', 700, (id) => ({ SalesOrderId: id, SalesOrderDate: '2026-06-01' })),
        purchaseOrders: descById(50, 'PurchaseOrderId', 600, (id) => ({ PurchaseOrderId: id, PurchaseOrderDate: '2026-06-01' })),
        products: descById(600, 'ProductID', 80000, (id) => ({ ProductID: id, ProductSKU: `sku-${id}` })),
        // 1,200 stock products = 3 ASC pages → proves the GreaterThan cursor walks the FULL set
        // (the live bug ingested only the lowest 500 = page 1). IDs overlap the catalog so the
        // totals→mirror→gap-fill stock chain is asserted end-to-end below.
        stock: descById(1200, 'productID', 80000, (id) => ({ productID: id, qty: 2 })),
        suppliers: descById(120, 'SupplierClientID', 5000, (id) => ({ SupplierClientID: id, SupplierClientType: 'supplier', SupplierClientName: `s${id}` })),
      },
      { DocumentGet: 5 * MIN, SupplierClientGet: 12 * MIN, ProductGet: 2 * MIN },
    );
    await seedConnector();

    const { res, elapsedPerPass, totals } = await driveToCompletion();

    // (1) converges to a terminal (no-continuation) state within the worker's continuation budget
    expect(res.needsContinuation).toBeFalsy();
    expect(elapsedPerPass.length).toBeLessThanOrEqual(MAX_PASSES);
    // (2) NO pass ever ran a fetch past the 30-min hard wall
    const worst = Math.max(...elapsedPerPass);
    expect(worst).toBeLessThanOrEqual(HARD_CAP_MS);
    // (3) ALL data ingested exactly once across the passes — no phase stranded, no double-fetch
    //     (the user's hard requirement: a completed sync must contain the full dataset).
    expect(totals.products).toBe(600);
    expect(totals.suppliers).toBe(120);
    expect(totals.salesOrders).toBe(50);
    expect(totals.purchaseOrders).toBe(50);
    // ASC stock walk crossed all 3 pages (1,200 products × 1 location each) — not just page 1
    expect(totals.stock).toBe(1200);
    // (4) stock totals flowed walk → mirror → gap-fill (ProductGet has no stock fields, so this
    //     chain is the ONLY way products.stock_level can be non-zero — the live "everything
    //     without stock" bug).
    const mirror = (await db.doc('megaventory_products/mv_p_80000').get()).data();
    expect(mirror?.stockOnHand).toBe(2);
    expect(mirror?.availableStockTotal).toBe(2);
    const intel = (await db.doc(`products/mv_api_cat_${BRAND}_sku-80000`).get()).data();
    expect(intel?.stock_level).toBe(2);
    expect(intel?.stock_capacity).toBe(4);
    // whole sync finished → every resumable flag cleared for the next cycle
    const st = await connState();
    expect(st.ingestionComplete).toBeUndefined();
    expect(st.suppliersIngestComplete).toBeUndefined();
    expect(st.manualInvoiceComplete).toBeUndefined();
  });

  it('heavy processing modules (gap-fill 5min, procurement 8min, stock-movement 20min) split across passes — the staging pass-2 hard-kill profile', async () => {
    moduleDurations.gapFill = 5 * MIN;
    moduleDurations.procurement = 8 * MIN;
    moduleDurations.stockMovement = 20 * MIN;
    installMvMock({
      ...emptyDataset(),
      invoices: descById(5, 'DocumentId', 9000, (id) => ({ DocumentDate: '2026-06-01', DocumentTypeId: 1, DocumentId: id })),
      products: descById(20, 'ProductID', 500, (id) => ({ ProductID: id, ProductSKU: `sku-${id}` })),
    });
    await seedConnector();

    const { res, elapsedPerPass } = await driveToCompletion();

    expect(res.needsContinuation).toBeFalsy();
    expect(elapsedPerPass.length).toBeLessThanOrEqual(MAX_PASSES);
    // No single pass may run a module past the hard wall — the exact bug that killed staging pass 2
    // (stock-movement started with 12min of budget and ran to minute 33).
    const worst = Math.max(...elapsedPerPass);
    expect(worst).toBeLessThanOrEqual(HARD_CAP_MS);
    const st = await connState();
    expect(st.processingStage).toBeUndefined(); // chain completed and reset
  });
});

describe('Megaventory sync — deleted-products lifecycle (import, tombstone, undelete)', () => {
  async function purgeBrandCatalog() {
    for (const coll of ['megaventory_products', 'products']) {
      const snap = await db.collection(coll).where('brandId', '==', BRAND).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
    }
  }

  async function runCycle() {
    let res: Awaited<ReturnType<typeof fetchMegaventoryData>> | undefined;
    for (let pass = 0; pass < 10; pass++) {
      vi.setSystemTime(CLOCK_START);
      res = await fetchMegaventoryData(BRAND, { mode: 'manual' });
      if (!res.needsContinuation) break;
    }
    return res!;
  }

  async function mirrorDoc(pid: number) {
    const snap = await db.doc(`megaventory_products/mv_p_${pid}`).get();
    return snap.exists ? snap.data()! : null;
  }
  async function intelDoc(sku: string) {
    const snap = await db.doc(`products/mv_api_cat_${BRAND}_${sku}`).get();
    return snap.exists ? snap.data()! : null;
  }

  const liveProduct = (id: number) => ({ ProductID: id, ProductSKU: `sku-${id}`, ProductDescription: `P${id}` });

  it('imports the deleted backlog tombstoned, marks later deletions, heals undeletes', async () => {
    await purgeBrandCatalog();
    await seedConnector();

    // ── Cycle 1: 5 live + 2 deleted (never synced → full import, tombstoned) ──
    installMvMock({
      ...emptyDataset(),
      products: [500, 499, 498, 497, 496].map(liveProduct),
      deletedProducts: [900, 899].map(liveProduct),
    });
    const res1 = await runCycle();
    expect(res1.success).toBe(true);
    expect(res1.deletedImported).toBe(2);
    const dead900 = await mirrorDoc(900);
    expect(dead900?.mvDeletedAt).toBeTruthy();
    expect(dead900?.stockOnHand).toBe(0);
    expect((await mirrorDoc(500))?.mvDeletedAt).toBeUndefined();
    // gap-fill propagated marker + zero stock into the intelligence catalog
    const intel900 = await intelDoc('sku-900');
    expect(intel900?.discontinued_at).toBeTruthy();
    expect(intel900?.stock_level).toBe(0);
    expect((await intelDoc('sku-500'))?.discontinued_at).toBeUndefined();

    // ── Cycle 2: product 500 gets deleted in MV → tombstoned (not re-imported) ──
    installMvMock({
      ...emptyDataset(),
      products: [499, 498, 497, 496].map(liveProduct),
      deletedProducts: [900, 899, 500].map(liveProduct),
    });
    const res2 = await runCycle();
    expect(res2.deletedMarked).toBe(1);
    expect((await mirrorDoc(500))?.mvDeletedAt).toBeTruthy();
    expect((await intelDoc('sku-500'))?.discontinued_at).toBeTruthy();
    expect((await intelDoc('sku-500'))?.stock_level).toBe(0);

    // ── Cycle 3: product 900 is UNDELETED in MV → marker cleared, doc heals ──
    installMvMock({
      ...emptyDataset(),
      products: [900, 499, 498, 497, 496].map(liveProduct),
      deletedProducts: [899, 500].map(liveProduct),
    });
    const res3 = await runCycle();
    expect(res3.deletedUnmarked).toBe(1);
    expect((await mirrorDoc(900))?.mvDeletedAt).toBeUndefined();
    expect((await intelDoc('sku-900'))?.discontinued_at).toBeUndefined();
  });
});
