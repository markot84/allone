import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
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
import type { Product } from '../types';

// Generic CRUD operations
export class FirestoreService {
  // Get single document
  static async getDocument<T>(collectionName: string, docId: string): Promise<T | null> {
    try {
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as T;
      }
      return null;
    } catch (error) {
      console.error(`Error getting document ${docId} from ${collectionName}:`, error);
      throw error;
    }
  }

  // Get all documents from collection. When brandId is provided, filters by brandId.
  static async getDocuments<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    brandId?: string | null
  ): Promise<T[]> {
    try {
      const allConstraints: QueryConstraint[] = [];
      if (brandId) {
        allConstraints.push(where('brandId', '==', brandId));
      }
      allConstraints.push(...constraints);
      const q = query(collection(db, collectionName), ...allConstraints);
      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as T[];
    } catch (error) {
      console.error(`Error getting documents from ${collectionName}:`, error);
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
    },
  ): Promise<{ items: T[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; totalCount: number }> {
    try {
      const baseConstraints: QueryConstraint[] = [];
      if (options.brandId) baseConstraints.push(where('brandId', '==', options.brandId));
      if (options.constraints) baseConstraints.push(...options.constraints);

      const countQ = query(collection(db, collectionName), ...baseConstraints);
      const countSnap = await getCountFromServer(countQ);
      const totalCount = countSnap.data().count;

      const pageConstraints = [...baseConstraints, limit(options.pageSize)];
      if (options.cursor) pageConstraints.push(startAfter(options.cursor));

      const q = query(collection(db, collectionName), ...pageConstraints);
      const snap = await getDocs(q);

      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
      const lastDoc = snap.docs[snap.docs.length - 1] ?? null;

      return { items, lastDoc, totalCount };
    } catch (error) {
      console.error(`Error paginating ${collectionName}:`, error);
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
      console.debug(`[FirestoreService] batchSet: ${collectionName}, ${items.length} items, brandId:`, brandId);
    }
    for (let i = 0; i < items.length; i += MAX_BATCH) {
      const chunk = items.slice(i, i + MAX_BATCH);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const docRef = doc(db, collectionName, item.id);
        const clean: Record<string, unknown> = {
          ...item.data,
          updatedAt: Timestamp.now(),
          ...(brandId ? { brandId } : {}),
        };
        Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k]);
        batch.set(docRef, clean, { merge: true });
      }
      await batch.commit();
    }
    if (import.meta.env.MODE === 'development') {
      console.debug(`[FirestoreService] batchSet completed: ${collectionName}`);
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
      // Remove undefined and null values (Firestore doesn't accept undefined)
      const clean: Record<string, unknown> = {};
      // Only copy non-undefined and non-null values
      for (const key in data) {
        const value = data[key];
        if (value !== undefined && value !== null) {
          clean[key] = value;
        }
      }
      // Always set updatedAt
      clean.updatedAt = Timestamp.now();
      // Use setDoc with merge to update existing fields, but clean object ensures no undefined values
      await setDoc(docRef, clean, { merge: true });
    } catch (error) {
      console.error(`Error setting document ${docId} in ${collectionName}:`, error);
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
      await updateDoc(docRef, {
        ...data,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      console.error(`Error updating document ${docId} in ${collectionName}:`, error);
      throw error;
    }
  }

  // Delete document
  static async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      const docRef = doc(db, collectionName, docId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error(`Error deleting document ${docId} from ${collectionName}:`, error);
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
        console.debug(`[FirestoreService] deleteCollection: No documents to delete in ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
      }
      return;
    }

    if (import.meta.env.MODE === 'development') {
      console.debug(`[FirestoreService] deleteCollection: Starting deletion of ${snapshot.size} documents from ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
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
      console.debug(`[FirestoreService] deleteCollection: Deleted ${totalDeleted} documents from ${collectionName}${brandId ? ` for brandId ${brandId}` : ''}`);
    }
  }

}

// Specific collections helpers - pass brandId for scoped queries
export const ProductsService = {
  getAll: async (brandId?: string | null) => {
    const products = await FirestoreService.getDocuments('products', [], brandId);
    
    // Debug: Log sample products to help diagnose data issues
    if (import.meta.env.MODE === 'development' && products.length > 0) {
      const sample = products.slice(0, 5) as any[];
      console.debug('[ProductsService.getAll] Sample products from Firestore:', sample.map((p: any) => ({
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
      })));
      
      // Also log summary statistics
      const withStockLevel = products.filter((p: any) => (p.stock_level ?? 0) > 0).length;
      const withMargin = products.filter((p: any) => (p.margin_percentage ?? 0) > 0).length;
      const withStockAge = products.filter((p: any) => (p.stock_age_days ?? 0) > 0).length;
      const withPrice = products.filter((p: any) => (p.price ?? 0) > 0).length;
      const withCostPrice = products.filter((p: any) => (p.cost_price ?? 0) > 0).length;
      
      console.debug('[ProductsService.getAll] Summary:', {
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
  getPaginated: (brandId: string, pageSize: number, cursor?: QueryDocumentSnapshot<DocumentData> | null) =>
    FirestoreService.getDocumentsPaginated<Product>('products', { brandId, pageSize, cursor }),
  getById: (id: string) => FirestoreService.getDocument('products', id),
  create: (id: string, data: Record<string, unknown>, brandId?: string | null) =>
    FirestoreService.setDocument('products', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: any) => FirestoreService.updateDocument('products', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('products', id),
};

export const SegmentsService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('segments', [], brandId),
  getById: (id: string) => FirestoreService.getDocument('segments', id),
  create: (id: string, data: Record<string, unknown>, brandId?: string | null) =>
    FirestoreService.setDocument('segments', id, { ...data, ...(brandId ? { brandId } : {}) }),
  update: (id: string, data: any) => FirestoreService.updateDocument('segments', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('segments', id),
};

export const SegmentCustomersService = {
  async getForSegment(brandId: string, segmentId: string): Promise<{ customerId: string; email?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[]> {
    const docs = await FirestoreService.getDocuments<{
      segmentId: string;
      customers: { customerId: string; email?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[];
    }>('segment_customers', [where('segmentId', '==', segmentId)], brandId);
    return docs.flatMap(d => d.customers || []);
  },
  async getAllBySegment(brandId: string): Promise<Map<string, { customerId: string; email?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[]>> {
    const docs = await FirestoreService.getDocuments<{
      segmentId: string;
      customers: { customerId: string; email?: string; recency?: number; frequency?: number; monetary?: number; rfmScore?: string }[];
    }>('segment_customers', [], brandId);
    const map = new Map<string, typeof docs[0]['customers']>();
    for (const d of docs) {
      const existing = map.get(d.segmentId) || [];
      existing.push(...(d.customers || []));
      map.set(d.segmentId, existing);
    }
    return map;
  },
  hasData: async (brandId: string): Promise<boolean> => {
    const docs = await FirestoreService.getDocuments('segment_customers', [], brandId);
    return docs.length > 0;
  },
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
  getAll: (brandId?: string | null) => {
    return FirestoreService.getDocuments('campaigns', [orderBy('createdAt', 'desc')], brandId)
      .catch(() => {
        return FirestoreService.getDocuments('campaigns', [], brandId)
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
  getAll: (collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number], brandId?: string | null) =>
    FirestoreService.getDocuments(collectionKey, [], brandId),
  batchSet: (collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number], items: { id: string; data: Record<string, unknown> }[], brandId?: string | null) =>
    FirestoreService.batchSet(collectionKey, items, brandId),
  deleteAll: (collectionKey: (typeof PROCUREMENT_COLLECTIONS)[number], brandId?: string | null) =>
    FirestoreService.deleteCollection(collectionKey, brandId),
  /** Save current state to snapshot before replace. Keeps last N snapshots per brand. */
  async saveSnapshot(
    brandId: string,
    snapshotData: Record<string, unknown[]>,
    replacedByFileName?: string
  ): Promise<void> {
    const id = `snap_${brandId}_${Date.now()}`;
    await FirestoreService.setDocument('procurement_snapshots', id, {
      brandId,
      createdAt: Timestamp.now(),
      replacedByFileName: replacedByFileName ?? null,
      ...snapshotData,
    });
    const existing = await FirestoreService.getDocuments<{ id: string; createdAt: unknown }>(
      'procurement_snapshots',
      [where('brandId', '==', brandId), orderBy('createdAt', 'asc')],
      null
    );
    if (existing.length > PROCUREMENT_MAX_SNAPSHOTS) {
      const toDelete = existing.slice(0, existing.length - PROCUREMENT_MAX_SNAPSHOTS);
      for (const doc of toDelete) {
        await FirestoreService.deleteDocument('procurement_snapshots', doc.id);
      }
    }
  },
  getSnapshots: (brandId?: string | null) =>
    FirestoreService.getDocuments('procurement_snapshots', [orderBy('createdAt', 'desc')], brandId),
};

/** Enables seedDemoData in ProcurementService */