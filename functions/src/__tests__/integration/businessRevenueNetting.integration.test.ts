/** computeBusinessRevenueSummary credit-note netting vs the real module + Firestore emulator: canonical fields are NET, gross* preserves sales-only, only sales-linked credits net.
 * Run via `npm run test:integration` (firebase emulators:exec wraps this). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { computeBusinessRevenueSummary, setDb } from '../../ecommerceAggregator';

const PROJECT_ID = 'demo-test';
const BRAND = 'brs-netting-brand';

let db: admin.firestore.Firestore;

async function seedInvoice(id: string, fields: Record<string, unknown>) {
  await db.doc(`megaventory_invoices/${id}`).set({ brandId: BRAND, source: 'megaventory_api', ...fields });
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
  const docs = await db.collection('megaventory_invoices').where('brandId', '==', BRAND).get();
  for (const d of docs.docs) await d.ref.delete();
  await db.doc(`connectors/${BRAND}`).set({ megaventory: { connected: true } });
  await db.doc(`business_revenue_summary/${BRAND}`).delete().catch(() => undefined);
});

describe('computeBusinessRevenueSummary credit netting', () => {
  it('nets linked customer credits into canonical fields, ignores supplier/unlinked and cancelled credits, preserves gross', async () => {
    // sales — one new-style (kind set), one legacy (no kind → back-compat)
    await seedInvoice('mv_inv_D100', { documentId: 'D100', kind: 'sales_invoice', netAmount: 100, date: '2026-05-02', status: 'Approved' });
    await seedInvoice('mv_inv_D200', { documentId: 'D200', netAmount: 50, date: '2026-05-10', status: 'Approved' });
    // customer credit linked to D100 → nets
    await seedInvoice('mv_inv_C1', { documentId: 'C1', kind: 'credit_note', netAmount: -20, parentDocumentId: 'D100', date: '2026-05-15', status: 'Approved' });
    // supplier-return credit — parent is a purchase doc not in the collection → unlinked, NOT netted
    await seedInvoice('mv_inv_C2', { documentId: 'C2', kind: 'credit_note', netAmount: -7, parentDocumentId: 'P999', date: '2026-05-16', status: 'Approved' });
    // cancelled credit → ignored entirely
    await seedInvoice('mv_inv_C3', { documentId: 'C3', kind: 'credit_note', netAmount: -5, parentDocumentId: 'D200', date: '2026-05-17', status: 'Cancelled' });

    await computeBusinessRevenueSummary(BRAND);

    const snap = await db.doc(`business_revenue_summary/${BRAND}`).get();
    expect(snap.exists).toBe(true);
    const s = snap.data() as Record<string, unknown>;

    // canonical = NET (every consumer now sees net-of-returns)
    expect(s.totalRevenue).toBe(130);
    expect(s.orderCount).toBe(2); // returns are not orders
    expect((s.revenueByMonth as Record<string, number>)['2026-05']).toBe(130);
    expect((s.revenueByDay as Record<string, number>)['2026-05-15']).toBe(-20);
    expect((s.revenueByDay as Record<string, number>)['2026-05-02']).toBe(100);

    // gross preserved + credit diagnostics
    expect(s.grossTotalRevenue).toBe(150);
    expect((s.grossRevenueByMonth as Record<string, number>)['2026-05']).toBe(150);
    expect(s.creditTotal).toBe(-20);
    expect(s.creditNotesApplied).toBe(1);
    expect(s.unlinkedCreditTotal).toBe(-7);
  });

  it('produces identical canonical and gross fields when no credit notes exist', async () => {
    await seedInvoice('mv_inv_D300', { documentId: 'D300', netAmount: 75.5, date: '2026-04-01', status: 'Approved' });

    await computeBusinessRevenueSummary(BRAND);

    const s = (await db.doc(`business_revenue_summary/${BRAND}`).get()).data() as Record<string, unknown>;
    expect(s.totalRevenue).toBe(75.5);
    expect(s.grossTotalRevenue).toBe(75.5);
    expect(s.creditNotesApplied).toBe(0);
    expect(s.unlinkedCreditTotal).toBe(0);
    expect(s.revenueByMonth).toEqual(s.grossRevenueByMonth);
  });

  it('allows negative canonical days/months when returns exceed sales in a period', async () => {
    await seedInvoice('mv_inv_D400', { documentId: 'D400', netAmount: 30, date: '2026-03-01', status: 'Approved' });
    await seedInvoice('mv_inv_C4', { documentId: 'C4', kind: 'credit_note', netAmount: -45, parentDocumentId: 'D400', date: '2026-04-02', status: 'Approved' });

    await computeBusinessRevenueSummary(BRAND);

    const s = (await db.doc(`business_revenue_summary/${BRAND}`).get()).data() as Record<string, unknown>;
    expect(s.totalRevenue).toBe(-15);
    expect((s.revenueByMonth as Record<string, number>)['2026-04']).toBe(-45);
    expect((s.grossRevenueByMonth as Record<string, number>)['2026-03']).toBe(30);
  });
});
