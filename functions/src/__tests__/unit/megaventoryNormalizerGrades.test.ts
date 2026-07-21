/** normalizer omits grade/status it cannot populate ('' breaks classification) and derives days-of-cover. */
import { describe, it, expect } from 'vitest';
import { normalizeMegaventoryCustomReportRows } from '../../megaventoryNormalizer';
import { customReportPeriodDays } from '../../megaventoryConnector';

type Written = { path: string; data: Record<string, unknown> };

function stubDb() {
  const writes: Written[] = [];
  const emptySnap = { empty: true, size: 0, docs: [] as unknown[] };
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => emptySnap,
  };
  const db = {
    collection: (name: string) => ({ ...query, doc: (id: string) => ({ path: `${name}/${id}` }) }),
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }),
      delete: () => {},
      commit: async () => {},
    }),
  };
  return { db: db as never, writes };
}

const row = (over: Record<string, unknown> = {}) => ({
  SKU_ID: 'SKU-1',
  Product_Name: 'Ρακέτα',
  Available_Stock: 100,
  Qty_Sold_Period: 365,
  ...over,
});

async function normalize(rows: Record<string, unknown>[], periodDays?: number) {
  const { db, writes } = stubDb();
  await normalizeMegaventoryCustomReportRows(db, 'e-tennis', rows, { periodDays });
  const inv = writes.find((w) => w.path.startsWith('procurement_inventory/'));
  const evalDoc = writes.find((w) => w.path.startsWith('procurement_item_evaluation/'));
  return { inv: inv?.data ?? {}, evalDoc: evalDoc?.data ?? {} };
}

describe('megaventory normalizer — evaluative fields', () => {
  it('omits grade/status when the report has none (never writes an empty string)', async () => {
    const { inv, evalDoc } = await normalize([row()], 365);
    expect('ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ' in inv).toBe(false);
    expect('STATUS_ΚΩΔΙΚΟΥ' in inv).toBe(false);
    expect('ΑΞΙΟΛΟΓΗΣΗ' in evalDoc).toBe(false);
  });

  it('keeps grade/status when the report does provide them', async () => {
    const { inv } = await normalize([row({ ABC_Class: 'A', Status: 'Ενεργό' })], 365);
    expect(inv.ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ).toBe('A');
    expect(inv.STATUS_ΚΩΔΙΚΟΥ).toBe('Ενεργό');
  });

  it('derives days-of-cover from the period velocity', async () => {
    // 365 sold over 365 days = 1/day; 100 in stock ⇒ 100 days of cover.
    const { inv } = await normalize([row()], 365);
    expect(inv.ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ).toBe(100);
  });

  it('omits days-of-cover when it cannot be known (no sales, or no window)', async () => {
    const noSales = await normalize([row({ Qty_Sold_Period: 0 })], 365);
    expect('ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ' in noSales.inv).toBe(false);

    const noWindow = await normalize([row()], undefined);
    expect('ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ' in noWindow.inv).toBe(false);
  });
});

describe('customReportPeriodDays', () => {
  it('spans the report window and rejects unusable ones', () => {
    expect(customReportPeriodDays('2025-01-01', '2026-01-01')).toBe(365);
    expect(customReportPeriodDays('2026-01-01', '2026-01-01')).toBeUndefined();
    expect(customReportPeriodDays('', '2026-01-01')).toBeUndefined();
  });
});
