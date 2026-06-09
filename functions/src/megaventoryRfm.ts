import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';

const SOURCE = 'megaventory_rfm';
const WRITE_BATCH_SIZE = 450;
const CUSTOMER_CHUNK_SIZE = 500;

type RfmOrder = {
  id: string;
  customerKey: string;
  customerName: string;
  date: string;
  revenue: number;
};

type CustomerAgg = {
  key: string;
  name: string;
  firstOrder: string;
  lastOrder: string;
  orderCount: number;
  revenue: number;
};

type SegmentAgg = {
  id: string;
  name: string;
  rfmScores: string[];
  customers: {
    customerId: string;
    segmentName: string;
    recency: number;
    frequency: number;
    monetary: number;
    rfmScore: string;
  }[];
  revenue: number;
};

export type MegaventoryRfmCounts = {
  source: 'invoices' | 'sales_orders' | 'none';
  orders: number;
  customers: number;
  segments: number;
  segmentCustomerDocs: number;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isCancelled(status: unknown): boolean {
  const s = text(status).toLowerCase();
  return ['cancel', 'cancelled', 'canceled', 'void', 'deleted'].some((token) => s.includes(token));
}

function sanitizeFirestoreDocId(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) s = '_';
  s = s.replace(/\//g, '_').replace(/\\/g, '_');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '_');
  if (s === '.' || s === '..') s = '_dot_';
  if (s.length > 1500) s = s.slice(0, 1500);
  return s;
}

function customerKey(id: unknown, name: unknown): string {
  const rawId = text(id);
  if (rawId) return `mv_customer_${rawId}`;
  return `mv_customer_${text(name).toLocaleUpperCase('el-GR')}`;
}

function assignQuintileScores(values: number[], lowIsHighScore: boolean): number[] {
  const n = values.length;
  if (n === 0) return [];
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => (lowIsHighScore ? a.v - b.v : b.v - a.v));
  const out = new Array<number>(n).fill(1);
  // LOGIC-10: tie-aware quintile banding — equal values share a score instead of being
  // split across quintiles by array position (e.g. all frequency=1 customers).
  let prevValue: number | undefined;
  let prevScore = 5;
  for (let j = 0; j < n; j++) {
    const band = Math.min(4, Math.floor((j * 5) / n));
    let score = 5 - band;
    if (prevValue !== undefined && idx[j].v === prevValue) score = prevScore;
    out[idx[j].i] = score;
    prevValue = idx[j].v;
    prevScore = score;
  }
  return out;
}

function segmentFromRfmScores(r: number, f: number, m: number): { id: string; name: string } {
  if (r >= 4 && f >= 4 && m >= 3) return { id: 'champions', name: 'Champions' };
  if (f <= 2 && r >= 4 && m >= 2) return { id: 'recent_customers', name: 'Recent Customers' };
  if (f <= 2 && r >= 4) return { id: 'new_customers', name: 'New Customers' };
  if (r >= 3 && f >= 3 && m >= 3) return { id: 'loyal', name: 'Loyal Customers' };
  if (r >= 3 && f >= 2 && f <= 3 && m >= 2) return { id: 'potential', name: 'Potential Loyalists' };
  if (r <= 2 && f >= 4 && m >= 4) return { id: 'cant_lose_them', name: "Can't Lose Them" };
  if (r <= 2 && f >= 3 && m >= 3) return { id: 'at_risk', name: 'At Risk' };
  if (r >= 2 && r <= 3 && f >= 2 && f <= 3) {
    return { id: 'customers_needing_attention', name: 'Customers Needing Attention' };
  }
  if (r <= 2 && f <= 2 && m <= 2) return { id: 'hibernating', name: 'Hibernating' };
  if (r === 1) return { id: 'lost', name: 'Lost' };
  return { id: 'potential', name: 'Potential Loyalists' };
}

async function deleteSourceRows(db: Firestore, collectionName: string, brandId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await db
      .collection(collectionName)
      .where('brandId', '==', brandId)
      .where('source', '==', SOURCE)
      .limit(WRITE_BATCH_SIZE)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < WRITE_BATCH_SIZE) break;
  }
  return deleted;
}

async function loadOrders(db: Firestore, brandId: string): Promise<{ source: MegaventoryRfmCounts['source']; orders: RfmOrder[] }> {
  const invoicesSnap = await db.collection('megaventory_invoices').where('brandId', '==', brandId).get();
  const invoiceOrders = invoicesSnap.docs
    .map((doc) => {
      const d = doc.data();
      const customerName = text(d.clientName);
      return {
        id: doc.id,
        customerKey: customerKey(d.clientId, customerName),
        customerName,
        date: text(d.date),
        // LOGIC-8: use the NET (ex-VAT) amount as the monetary base, consistent with
        // ecommerceAggregator — preferring totalAmount (VAT-inclusive) inflated the RFM M
        // dimension / revenue_share ~24% vs the revenue dashboards.
        revenue: num(d.netAmount || d.totalAmount),
        status: d.status,
      };
    })
    .filter((o) => o.customerName && o.date && o.revenue > 0 && !isCancelled(o.status));

  if (invoiceOrders.length > 0) {
    return { source: 'invoices', orders: invoiceOrders };
  }

  const salesSnap = await db.collection('megaventory_sales_orders').where('brandId', '==', brandId).get();
  const salesOrders = salesSnap.docs
    .map((doc) => {
      const d = doc.data();
      const customerName = text(d.clientName);
      return {
        id: doc.id,
        customerKey: customerKey(d.clientId, customerName),
        customerName,
        date: text(d.date),
        revenue: num(d.totalAmount),
        status: d.status,
      };
    })
    .filter((o) => o.customerName && o.date && o.revenue > 0 && !isCancelled(o.status));

  return { source: salesOrders.length > 0 ? 'sales_orders' : 'none', orders: salesOrders };
}

function buildSegments(orders: RfmOrder[]): { customers: CustomerAgg[]; segments: SegmentAgg[] } {
  const byCustomer = new Map<string, CustomerAgg>();
  for (const order of orders) {
    const existing = byCustomer.get(order.customerKey);
    if (!existing) {
      byCustomer.set(order.customerKey, {
        key: order.customerKey,
        name: order.customerName,
        firstOrder: order.date,
        lastOrder: order.date,
        orderCount: 1,
        revenue: order.revenue,
      });
      continue;
    }
    existing.orderCount += 1;
    existing.revenue += order.revenue;
    if (order.date < existing.firstOrder) existing.firstOrder = order.date;
    if (order.date > existing.lastOrder) existing.lastOrder = order.date;
  }

  const customers = [...byCustomer.values()];
  if (customers.length === 0) return { customers, segments: [] };

  const asOf = new Date();
  asOf.setHours(23, 59, 59, 999);
  const recencies = customers.map((c) => {
    const t = asOf.getTime() - new Date(c.lastOrder).getTime();
    return Math.max(0, Math.floor(t / 86400000));
  });
  const rScores = assignQuintileScores(recencies, true);
  const fScores = assignQuintileScores(customers.map((c) => c.orderCount), false);
  const mScores = assignQuintileScores(customers.map((c) => c.revenue), false);

  const bySegment = new Map<string, SegmentAgg>();
  for (let i = 0; i < customers.length; i++) {
    const r = rScores[i] ?? 3;
    const f = fScores[i] ?? 3;
    const m = mScores[i] ?? 3;
    const segment = segmentFromRfmScores(r, f, m);
    const agg = bySegment.get(segment.id) ?? {
      id: segment.id,
      name: segment.name,
      rfmScores: [],
      customers: [],
      revenue: 0,
    };
    const rfmScore = `${r}-${f}-${m}`;
    agg.rfmScores.push(rfmScore);
    agg.revenue += customers[i].revenue;
    agg.customers.push({
      customerId: customers[i].key,
      segmentName: segment.name,
      recency: recencies[i] ?? 0,
      frequency: customers[i].orderCount,
      monetary: Math.round(customers[i].revenue * 100) / 100,
      rfmScore,
    });
    bySegment.set(segment.id, agg);
  }

  return { customers, segments: [...bySegment.values()].sort((a, b) => b.revenue - a.revenue) };
}

async function writeSegments(db: Firestore, brandId: string, segments: SegmentAgg[], totalCustomers: number): Promise<number> {
  const totalRevenue = segments.reduce((sum, s) => sum + s.revenue, 0);
  let written = 0;
  for (let i = 0; i < segments.length; i += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const s of segments.slice(i, i + WRITE_BATCH_SIZE)) {
      const docId = sanitizeFirestoreDocId(`${brandId}_${SOURCE}_${s.id}`);
      batch.set(db.collection('segments').doc(docId), {
        id: s.id,
        name: s.name,
        rfm_score: s.rfmScores[0] || '',
        count: s.customers.length,
        percentage: totalCustomers > 0 ? Math.round((s.customers.length / totalCustomers) * 1000) / 10 : 0,
        revenue_share: totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 1000) / 10 : 0,
        color: '#6B7280',
        description: 'Υπολογισμένο από Megaventory invoices / sales orders',
        icon: '',
        brandId,
        source: SOURCE,
        updatedAt: FieldValue.serverTimestamp(),
      });
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

async function writeSegmentCustomers(db: Firestore, brandId: string, segments: SegmentAgg[]): Promise<number> {
  let docs = 0;
  let batch = db.batch();
  let ops = 0;
  const commitIfNeeded = async (force = false) => {
    if (ops === 0 || (!force && ops < WRITE_BATCH_SIZE)) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const segment of segments) {
    for (let i = 0; i < segment.customers.length; i += CUSTOMER_CHUNK_SIZE) {
      const chunk = segment.customers.slice(i, i + CUSTOMER_CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CUSTOMER_CHUNK_SIZE);
      const docId = sanitizeFirestoreDocId(`${brandId}_${SOURCE}_${segment.id}_${chunkIndex}`);
      batch.set(db.collection('segment_customers').doc(docId), {
        segmentId: segment.id,
        segmentName: segment.name,
        totalInSegment: segment.customers.length,
        customers: chunk,
        brandId,
        source: SOURCE,
        updatedAt: FieldValue.serverTimestamp(),
      });
      docs += 1;
      ops += 1;
      await commitIfNeeded();
    }
  }

  await commitIfNeeded(true);
  return docs;
}

export async function refreshMegaventoryRfmSegments(db: Firestore, brandId: string): Promise<MegaventoryRfmCounts> {
  await Promise.all([
    deleteSourceRows(db, 'segments', brandId),
    deleteSourceRows(db, 'segment_customers', brandId),
  ]);

  const { source, orders } = await loadOrders(db, brandId);
  const { customers, segments } = buildSegments(orders);
  if (segments.length === 0) {
    const empty = { source, orders: orders.length, customers: customers.length, segments: 0, segmentCustomerDocs: 0 } as const;
    logger.info(`[MegaventoryRFM] ${brandId}: ${JSON.stringify(empty)}`);
    return empty;
  }

  const segmentCount = await writeSegments(db, brandId, segments, customers.length);
  const segmentCustomerDocs = await writeSegmentCustomers(db, brandId, segments);
  const counts = {
    source,
    orders: orders.length,
    customers: customers.length,
    segments: segmentCount,
    segmentCustomerDocs,
  };
  logger.info(`[MegaventoryRFM] ${brandId}: ${JSON.stringify(counts)}`);
  return counts;
}
