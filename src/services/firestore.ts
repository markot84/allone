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
  Timestamp,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../config/firebase';

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
      const allConstraints = [...constraints];
      if (brandId) {
        allConstraints.push(where('brandId', '==', brandId));
      }
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

  // Batch write (max 500 ops per batch; Firestore limit). Pass brandId to add to each doc.
  static async batchSet(
    collectionName: string,
    items: { id: string; data: Record<string, unknown> }[],
    brandId?: string | null
  ): Promise<void> {
    if (items.length === 0) return;
    const batch = writeBatch(db);
    for (const item of items) {
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

  // Create or update document
  static async setDocument<T extends Record<string, any>>(
    collectionName: string, 
    docId: string, 
    data: T
  ): Promise<void> {
    try {
      const docRef = doc(db, collectionName, docId);
      await setDoc(docRef, {
        ...data,
        updatedAt: Timestamp.now()
      }, { merge: true });
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
    let snapshot = await getDocs(q);
    while (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.slice(0, BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snapshot.docs.length <= BATCH_SIZE) break;
      snapshot = await getDocs(q);
    }
  }
}

// Specific collections helpers - pass brandId for scoped queries
export const ProductsService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('products', [], brandId),
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

export const CampaignsService = {
  getAll: (brandId?: string | null) => FirestoreService.getDocuments('campaigns', [orderBy('createdAt', 'desc')], brandId),
  getById: (id: string) => FirestoreService.getDocument('campaigns', id),
  create: (id: string, data: any, brandId?: string | null) =>
    FirestoreService.setDocument('campaigns', id, { ...data, ...(brandId ? { brandId } : {}) }),
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
