import { 
  collection,
  collectionGroup,
  doc, 
  getDoc, 
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  query, 
  where, 
  orderBy, 
  limit,
  startAfter,
  getCountFromServer,
  Timestamp,
  QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

// Helper to create orderBy constraint
export const createOrderBy = (field: string, direction: 'asc' | 'desc' = 'desc') => {
  return orderBy(field, direction);
};
import { db } from '../config/firebase';
import { logger } from '../utils/logger';
import type { MarketBrief } from './aiMarketBrief';
import { marketBriefDocId } from './aiMarketBrief';

/** Firestore rejects `undefined` anywhere; recursively omit it, preserving null, Timestamp,
 *  Date, and non-plain objects (e.g. FieldValue). */
function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out;
}

// Generic CRUD operations
export class FirestoreService {
  // Get single document
  static async getDocument<T>(collectionName: string, docId: string): Promise<T | null> {
    try {
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { ...docSnap.data(), id: docSnap.id } as T;
      }
      return null;
    } catch (error) {
      logger.error('Error getting document', { docId, collectionName, err: error });
      throw error;
    }
  }

  /** Same as getDocument but with a timeout to avoid an endless spinner when the Firestore
   *  client hangs (network, offline persistence, rare SDK race). */
  static async getDocumentWithTimeout<T>(
    collectionName: string,
    docId: string,
    timeoutMs = 20000
  ): Promise<T | null> {
    const docRef = doc(db, collectionName, docId);
    const load = async (): Promise<T | null> => {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { ...docSnap.data(), id: docSnap.id } as T;
      }
      return null;
    };
    return new Promise<T | null>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Firestore timeout ${timeoutMs}ms (${collectionName}/${docId})`));
      }, timeoutMs);
      load()
        .then((r) => {
          clearTimeout(t);
          resolve(r);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  }

  /** Brand IDs where the user has a `brands/{brandId}/members/{userId}` document;
   *  used when `users/{uid}.brandIds` is empty or stale. */
  static async getBrandIdsFromMembershipDocuments(userId: string): Promise<string[]> {
    if (!userId?.trim()) return [];
    try {
      // `brands/{brandId}/members/{uid}` docs always carry `userId` in the data (see MembersService.set).
      const q = query(collectionGroup(db, 'members'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const ids: string[] = [];
      for (const d of snap.docs) {
        const parts = d.ref.path.split('/');
        if (parts[0] === 'brands' && parts[2] === 'members' && parts.length >= 4) {
          ids.push(parts[1]);
        }
      }
      return [...new Set(ids)];
    } catch (error) {
      logger.error('getBrandIdsFromMembershipDocuments:', { err: error });
      return [];
    }
  }

  // Get all documents (filtered by brandId when provided). `forceServer` skips local cache so new connector writes show up immediately after sync.
  static async getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    brandId?: string | null,
    options?: { forceServer?: boolean; cacheFirst?: boolean }
  ): Promise<T[]> {
    try {
      const allConstraints: QueryConstraint[] = [];
      if (brandId) {
        allConstraints.push(where('brandId', '==', brandId));
      }
      allConstraints.push(...constraints);
      const q = query(collection(db, collectionName), ...allConstraints);
      const querySnapshot = options?.forceServer
        ? await getDocsFromServer(q)
        : options?.cacheFirst
          ? await getDocsFromCache(q).then((snap) => (snap.empty ? getDocs(q) : snap)).catch(() => getDocs(q))
          : await getDocs(q);

      return querySnapshot.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as T[];
    } catch (error) {
      logger.error('Error getting documents from', { collectionName, err: error });
      throw error;
    }
  }

  static async getDocumentsPaginated<T>(
    collectionName: string,
    options: {
      brandId?: string | null;
      pageSize: number;
      cursor?: QueryDocumentSnapshot<DocumentData> | null;
      constraints?: QueryConstraint[];
      /** Skip getCountFromServer (a server round-trip). Useful on later pages of a pagination loop
       *  where the total was already computed on the first page. Returns totalCount: -1. */
      skipCount?: boolean;
    },
  ): Promise<{ items: T[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; totalCount: number }> {
    try {
      const baseConstraints: QueryConstraint[] = [];
      if (options.brandId) baseConstraints.push(where('brandId', '==', options.brandId));
      if (options.constraints) baseConstraints.push(...options.constraints);

      let totalCount = -1;
      if (!options.skipCount) {
        const countQ = query(collection(db, collectionName), ...baseConstraints);
        const countSnap = await getCountFromServer(countQ);
        totalCount = countSnap.data().count;
      }

      const pageConstraints = [...baseConstraints, limit(options.pageSize)];
      if (options.cursor) pageConstraints.push(startAfter(options.cursor));

      const q = query(collection(db, collectionName), ...pageConstraints);
      const snap = await getDocs(q);

      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id })) as T[];
      const lastDoc = snap.docs[snap.docs.length - 1] ?? null;

      return { items, lastDoc, totalCount };
    } catch (error) {
      logger.error('Error paginating', { collectionName, err: error });
      throw error;
    }
  }

  // Batch write with auto-chunking (Firestore limit: 500 ops per batch).
  static async batchSet(
    collectionName: string,
    items: { id: string; data: Record<string, unknown> }[],
    brandId?: string | null
  ): Promise<void> {
    if (items.length === 0) return;
    const MAX_BATCH = 500;
    if (import.meta.env.MODE === 'development') {
      logger.debug('[FirestoreService] batchSet:', { collectionName, count: items.length, brandId });
    }
    for (let i = 0; i < items.length; i += MAX_BATCH) {
      const chunk = items.slice(i, i + MAX_BATCH);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const docRef = doc(db, collectionName, item.id);
        const merged: Record<string, unknown> = {
          ...item.data,
          updatedAt: Timestamp.now(),
          ...(brandId ? { brandId } : {}),
        };
        const clean = stripUndefinedDeep(merged) as Record<string, unknown>;
        Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k]);
        batch.set(docRef, clean, { merge: true });
      }
      await batch.commit();
    }
    if (import.meta.env.MODE === 'development') {
      logger.debug(`[FirestoreService] batchSet completed: ${collectionName}`);
    }
  }

  // Create or update document
  static async setDocument<T extends Record<string, any>>(
    collectionName: string, 
    docId: string, 
    data: T
  ): Promise<void> {
    try {
      const docRef = doc(db, collectionName, docId);
      const deep = stripUndefinedDeep(data) as Record<string, unknown>;
      // Remove undefined and null values at top level (legacy: callers relied on null being dropped)
      const clean: Record<string, unknown> = {};
      for (const key in deep) {
        const value = deep[key];
        if (value !== undefined && value !== null) {
          clean[key] = value;
        }
      }
      clean.updatedAt = Timestamp.now();
      // Use setDoc with merge to update existing fields, but clean object ensures no undefined values
      await setDoc(docRef, clean, { merge: true });
    } catch (error) {
      logger.error('Error setting document', { docId, collectionName, err: error });
      throw error;
    }
  }

  // Update document
  static async updateDocument<T extends Record<string, any>>(
    collectionName: string, 
    docId: string, 
    data: Partial<T>
  ): Promise<void> {
    try {
      const docRef = doc(db, collectionName, docId);
      const payload = stripUndefinedDeep({
        ...data,
        updatedAt: Timestamp.now(),
      }) as DocumentData;
      await updateDoc(docRef, payload);
    } catch (error) {
      logger.error('Error updating document', { docId, collectionName, err: error });
      throw error;
    }
  }

  // Delete document
  static async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      const docRef = doc(db, collectionName, docId);
      await deleteDoc(docRef);
    } catch (error) {
      logger.error('Error deleting document', { docId, collectionName, err: error });
      throw error;
    }
  }

  // Delete all documents in collection. When brandId provided, only deletes docs with that brandId.
  static async deleteCollection(collectionName: string, brandId?: string | null): Promise<void> {
    const colRef = collection(db, collectionName);
    const constraints = brandId ? [where('brandId', '==', brandId)] : [];
    const q = constraints.length ? query(colRef, ...constraints) : colRef;
    const BATCH_SIZE = 500;
    let totalDeleted = 0;
    let snapshot = await getDocs(q);

    if (snapshot.empty) {
      if (import.meta.env.MODE === 'development') {
        logger.debug(`[FirestoreService] deleteCollection: No documents to delete in ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
      }
      return;
    }

    if (import.meta.env.MODE === 'development') {
      logger.debug(`[FirestoreService] deleteCollection: Starting deletion of ${snapshot.size} documents from ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
    }

    while (!snapshot.empty) {
      const batch = writeBatch(db);
      const docsToDelete = snapshot.docs.slice(0, BATCH_SIZE);
      docsToDelete.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += docsToDelete.length;

      if (snapshot.docs.length <= BATCH_SIZE) break;
      snapshot = await getDocs(q);
    }

    if (import.meta.env.MODE === 'development') {
      logger.debug(`[FirestoreService] deleteCollection: Deleted ${totalDeleted} documents from ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
    }
  }

}

// Specific collections helpers - pass brandId for scoped queries
export const ProductsService = {
  getAll: async (brandId?: string | null, constraints: QueryConstraint[] = [], opts?: { cacheFirst?: boolean; forceServer?: boolean }) => {
    const products = await FirestoreService.getDocuments('products', constraints, brandId, opts);
    
    // Debug: Log sample products to help diagnose data issues
    if (import.meta.env.MODE === 'development' && products.length > 0) {
      const sample = products.slice(0, 5) as any[];
      logger.debug('[ProductsService.getAll] Sample products from Firestore:', { sample: sample.map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price,
        cost_price: p.cost_price,
        margin_percentage: p.margin_percentage,
        stock_level: p.stock_level,
        stock_capacity: p.stock_capacity,
        stock_age_days: p.stock_age_days,
        first_available_date: p.first_available_date,
        createdAt: p.createdAt,
        hasQuestionMarks: String(p.name || '').includes('?') || String(p.sku || '').includes('?'),
      })) });
      
      // Also log summary statistics
      const withStockLevel = products.filter((p: any) => (p.stock_level ?? 0) > 0).length;
      const withMargin = products.filter((p: any) => (p.margin_percentage ?? 0) > 0).length;
      const withStockAge = products.filter((p: any) => (p.stock_age_days ?? 0) > 0).length;
      const withPrice = products.filter((p: any) => (p.price ?? 0) > 0).length;
      const withCostPrice = products.filter((p: any) => (p.cost_price ?? 0) > 0).length;
      
      logger.debug('[ProductsService.getAll] Summary:', {
        total: products.length,
        withStockLevel,
        withMargin,
        withStockAge,
        withPrice,
        withCostPrice,
        stockLevelPercentage: products.length > 0 ? Math.round((withStockLevel / products.length) * 100) : 0,
        marginPercentage: products.length > 0 ? Math.round((withMargin / products.length) * 100) : 0,
        stockAgePercentage: products.length > 0 ? Math.round((withStockAge / products.length) * 100) : 0,
      });
    }
    
    return products;
  },
  getCount: async (brandId?: string | null) => {
    const constraints: QueryConstraint[] = [];
    if (brandId) constraints.push(where('brandId', '==', brandId));
    const countQ = query(collection(db, 'products'), ...constraints);
    const countSnap = await getCountFromServer(countQ);
    return countSnap.data().count;
  },
  getById: (id: string) => FirestoreService.getDocument('products', id),
  create: (id: string, data: Record<string, unknown>, brandId?: string | null) =>
    FirestoreService.setDocument('products', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: any) => FirestoreService.updateDocument('products', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('products', id),
};

export const SegmentsService = {
  getAll: (brandId?: string | null, opts?: { forceServer?: boolean }) =>
    FirestoreService.getDocuments('segments', [], brandId, opts),
  getById: (id: string) => FirestoreService.getDocument('segments', id),
  create: (id: string, data: Record<string, unknown>, brandId?: string | null) =>
    FirestoreService.setDocument('segments', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: any) => FirestoreService.updateDocument('segments', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('segments', id),
};

/** Dedupe a customer list by customerId (keeps first occurrence); rows without a customerId are kept. */
export function dedupeCustomersById<T extends { customerId?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((c) => {
    if (!c.customerId) return true;
    if (seen.has(c.customerId)) return false;
    seen.add(c.customerId);
    return true;
  });
}

export const SegmentCustomersService = {
  async getForSegment(brandId: string, segmentId: string): Promise<{ customerId: string; email?: string; name?: string; segmentName?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[]> {
    const docs = await FirestoreService.getDocuments<{
      segmentId: string;
      customers: { customerId: string; email?: string; name?: string; segmentName?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[];
    }>('segment_customers', [where('segmentId', '==', segmentId)], brandId, { forceServer: true });
    // Dedupe by customerId — a brand can carry rows from multiple RFM writers (megaventory_rfm +
    // data_analysis_rfm) for the same segment.
    return dedupeCustomersById(docs.flatMap(d => d.customers || []));
  },
  async getAllBySegment(brandId: string): Promise<Map<string, { customerId: string; email?: string; name?: string; segmentName?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[]>> {
    const docs = await FirestoreService.getDocuments<{
      segmentId: string;
      customers: { customerId: string; email?: string; name?: string; segmentName?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[];
    }>('segment_customers', [], brandId, { forceServer: true });
    const map = new Map<string, typeof docs[0]['customers']>();
    for (const d of docs) {
      const existing = map.get(d.segmentId) || [];
      existing.push(...(d.customers || []));
      map.set(d.segmentId, existing);
    }
    for (const [segId, list] of map) map.set(segId, dedupeCustomersById(list));
    return map;
  },
  async getSummariesBySegment(brandId: string): Promise<Map<string, { segmentName?: string; count: number; monetary: number }>> {
    const docs = await FirestoreService.getDocuments<{
      segmentId: string;
      segmentName?: string;
      totalInSegment?: number;
      source?: string;
      customers: { customerId: string; email?: string; segmentName?: string; monetary?: number }[];
    }>('segment_customers', [], brandId, { forceServer: true });
    const map = new Map<string, { segmentName?: string; source?: string; count: number; monetary: number; fallbackCount: number }>();
    for (const d of docs) {
      if (!d.segmentId) continue;
      const existing = map.get(d.segmentId) || { segmentName: d.segmentName, source: d.source, count: 0, monetary: 0, fallbackCount: 0 };
      existing.segmentName = existing.segmentName || d.segmentName || d.customers?.find((c) => c.segmentName)?.segmentName;
      existing.source = existing.source || d.source;
      existing.count = Math.max(existing.count, d.totalInSegment ?? 0);
      existing.fallbackCount += d.customers?.length ?? 0;
      existing.monetary += (d.customers || []).reduce((sum, c) => sum + (c.monetary ?? 0), 0);
      map.set(d.segmentId, existing);
    }
    return new Map(
      [...map.entries()].map(([segmentId, value]) => [
        segmentId,
        {
          segmentName: value.segmentName,
          source: value.source,
          count: value.count || value.fallbackCount,
          monetary: value.monetary,
        },
      ])
    );
  },
  hasData: async (brandId: string): Promise<boolean> => {
    const docs = await FirestoreService.getDocuments('segment_customers', [], brandId);
    return docs.length > 0;
  },
};

export type MarketBriefFirestoreDoc = {
  id: string;
  brandId: string;
  countryCode: string;
  countryName: string;
  verticalFocus?: string;
  brief: MarketBrief;
  createdAt?: string;
  updatedAt?: string;
};

export const MarketBriefsService = {
  getAll: (brandId: string) =>
    FirestoreService.getDocuments<MarketBriefFirestoreDoc>('market_briefs', [], brandId),

  getById: (id: string) => FirestoreService.getDocument<MarketBriefFirestoreDoc>('market_briefs', id),

  async save(
    brandId: string,
    countryName: string,
    countryCode: string,
    verticalFocus: string | undefined,
    brief: MarketBrief
  ): Promise<string> {
    const id = marketBriefDocId(brandId, countryCode);
    const existing = await FirestoreService.getDocument<MarketBriefFirestoreDoc>('market_briefs', id);
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    await FirestoreService.setDocument('market_briefs', id, {
      brandId,
      countryCode: countryCode.toUpperCase().slice(0, 2),
      countryName,
      verticalFocus: verticalFocus?.trim() || '',
      brief,
      createdAt,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>);
    return id;
  },

  delete: (id: string) => FirestoreService.deleteDocument('market_briefs', id),
};

export const SuppliersService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('suppliers', [], brandId),
  getById: (id: string) => FirestoreService.getDocument('suppliers', id),
  create: (id: string, data: Record<string, unknown>, brandId?: string | null) =>
    FirestoreService.setDocument('suppliers', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: Record<string, unknown>) => FirestoreService.updateDocument('suppliers', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('suppliers', id),
  batchSet: (items: { id: string; data: Record<string, unknown> }[], brandId?: string | null) =>
    FirestoreService.batchSet('suppliers', items, brandId),
  deleteAll: (brandId?: string | null) => FirestoreService.deleteCollection('suppliers', brandId),
};

export const CampaignsService = {
  getAll: (brandId?: string | null, opts?: { forceServer?: boolean; cacheFirst?: boolean }) => {
    const force = opts?.forceServer === true;
    const cacheFirst = opts?.cacheFirst === true;
    return FirestoreService.getDocuments('campaigns', [orderBy('createdAt', 'desc')], brandId, { forceServer: force, cacheFirst })
      .catch(() => {
        return FirestoreService.getDocuments('campaigns', [], brandId, { forceServer: force, cacheFirst })
          .then(campaigns => campaigns.sort((a: any, b: any) => {
            const aDate = a.createdAt?.toDate?.() || a.importedAt?.toDate?.() || new Date(0);
            const bDate = b.createdAt?.toDate?.() || b.importedAt?.toDate?.() || new Date(0);
            return bDate.getTime() - aDate.getTime();
          }));
      });
  },
  getById: (id: string) => FirestoreService.getDocument('campaigns', id),
  create: (id: string, data: any, brandId?: string | null) =>
    FirestoreService.setDocument('campaigns', id, { ...data, ...(brandId ? { brandId } : {}), createdAt: Timestamp.now() }),
  update: (id: string, data: any) => FirestoreService.updateDocument('campaigns', id, data),
};

export const ContentService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('content', [orderBy('createdAt', 'desc')], brandId),
  getById: (id: string) => FirestoreService.getDocument('content', id),
  create: (id: string, data: any, brandId?: string | null) =>
    FirestoreService.setDocument('content', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: any) => FirestoreService.updateDocument('content', id, data),
};

export const AnalyticsService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('analytics', [orderBy('date', 'desc')], brandId),
  getByDateRange: (startDate: Date, endDate: Date, brandId?: string | null) =>
    FirestoreService.getDocuments('analytics', [
      where('date', '>=', Timestamp.fromDate(startDate)),
      where('date', '<=', Timestamp.fromDate(endDate)),
      orderBy('date', 'desc')
    ], brandId),
  create: (id: string, data: any, brandId?: string | null) =>
    FirestoreService.setDocument('analytics', id, { ...data, ...(brandId ? { brandId } : {}) }),
};

export const OrganicService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('organic', [orderBy('period', 'desc')], brandId),
  create: (id: string, data: any, brandId?: string | null) =>
    FirestoreService.setDocument('organic', id, { ...data, ...(brandId ? { brandId } : {}) }),
};

// Procurement: 7 collections matching PROCUREMENT_TEMPLATE.xlsx sheets
export const PROCUREMENT_COLLECTIONS = [
  'procurement_inventory',
  'procurement_costing',
  'procurement_item_evaluation',
  'procurement_customer_evaluation',
  'procurement_pricing_policy',
  'procurement_fiscal_year',
  'procurement_statistics',
] as const;

const PROCUREMENT_MAX_SNAPSHOTS = 5;

export const ProcurementService = {
  getAll: (
    collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number],
    brandId?: string | null,
    opts?: { cacheFirst?: boolean; forceServer?: boolean }
  ) => FirestoreService.getDocuments(collectionKey, [], brandId, opts),
  batchSet: (collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number], items: { id: string; data: Record<string, unknown> }[], brandId?: string | null) =>
    FirestoreService.batchSet(collectionKey, items, brandId),
  deleteAll: (collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number], brandId?: string | null) =>
    FirestoreService.deleteCollection(collectionKey, brandId),
  /** Save current state to snapshot before replace. Keeps last N snapshots per brand.
   *  Data is split into subcollection chunks to avoid the 1MB Firestore doc limit. */
  async saveSnapshot(
    brandId: string,
    snapshotData: Record<string, unknown[]>,
    replacedByFileName?: string
  ): Promise<void> {
    const id = `snap_${brandId}_${Date.now()}`;
    const sheetKeys = Object.keys(snapshotData);

    // Parent doc: metadata only (small)
    await FirestoreService.setDocument('procurement_snapshots', id, {
      brandId,
      createdAt: Timestamp.now(),
      replacedByFileName: replacedByFileName ?? null,
      sheetKeys,
    });

    // Each sheet's rows → subcollection doc (stays under 1MB per sheet)
    const CHUNK_ROWS = 500;
    for (const key of sheetKeys) {
      const rows = snapshotData[key] || [];
      if (rows.length === 0) continue;
      for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
        const chunkIdx = Math.floor(i / CHUNK_ROWS);
        const chunkId = `${key}_${chunkIdx}`;
        const chunk = rows.slice(i, i + CHUNK_ROWS);
        const chunkRef = doc(db, 'procurement_snapshots', id, 'chunks', chunkId);
        await setDoc(chunkRef, { key, chunkIdx, rows: chunk });
      }
    }

    // Prune old snapshots
    const existing = await FirestoreService.getDocuments<{ id: string; createdAt: unknown }>(
      'procurement_snapshots',
      [where('brandId', '==', brandId), orderBy('createdAt', 'asc')],
      null
    );
    if (existing.length > PROCUREMENT_MAX_SNAPSHOTS) {
      const toDelete = existing.slice(0, existing.length - PROCUREMENT_MAX_SNAPSHOTS);
      for (const snap of toDelete) {
        // Delete chunk subcollection first
        const chunksSnap = await getDocs(collection(db, 'procurement_snapshots', snap.id, 'chunks'));
        for (const chunkDoc of chunksSnap.docs) {
          await deleteDoc(chunkDoc.ref);
        }
        await FirestoreService.deleteDocument('procurement_snapshots', snap.id);
      }
    }
  },
  getSnapshots: (brandId?: string | null) =>
    FirestoreService.getDocuments('procurement_snapshots', [orderBy('createdAt', 'desc')], brandId),
};

/** Enables seedDemoData in ProcurementService */