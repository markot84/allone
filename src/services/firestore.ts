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

  // Get all documents from collection
  static async getDocuments<T>(
    collectionName: string, 
    constraints: QueryConstraint[] = []
  ): Promise<T[]> {
    try {
      const q = query(collection(db, collectionName), ...constraints);
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
    } catch (error) {
      console.error(`Error getting documents from ${collectionName}:`, error);
      throw error;
    }
  }

  // Batch write (max 500 ops per batch; Firestore limit)
  static async batchSet(
    collectionName: string,
    items: { id: string; data: Record<string, unknown> }[]
  ): Promise<void> {
    if (items.length === 0) return;
    const batch = writeBatch(db);
    for (const item of items) {
      const docRef = doc(db, collectionName, item.id);
      const clean: Record<string, unknown> = { ...item.data, updatedAt: Timestamp.now() };
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

  // Delete all documents in collection (batch delete, for replacing customer-level with aggregated segments)
  static async deleteCollection(collectionName: string): Promise<void> {
    const colRef = collection(db, collectionName);
    const BATCH_SIZE = 500;
    let snapshot = await getDocs(colRef);
    while (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.slice(0, BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snapshot.docs.length <= BATCH_SIZE) break;
      snapshot = await getDocs(colRef);
    }
  }
}

// Specific collections helpers
export const ProductsService = {
  getAll: () => FirestoreService.getDocuments('products'),
  getById: (id: string) => FirestoreService.getDocument('products', id),
  create: (id: string, data: any) => FirestoreService.setDocument('products', id, data),
  update: (id: string, data: any) => FirestoreService.updateDocument('products', id, data),
  delete: (id: string) => FirestoreService.deleteDocument('products', id),
};

export const SegmentsService = {
  getAll: () => FirestoreService.getDocuments('segments'),
  getById: (id: string) => FirestoreService.getDocument('segments', id),
  create: (id: string, data: any) => FirestoreService.setDocument('segments', id, data),
  update: (id: string, data: any) => FirestoreService.updateDocument('segments', id, data),
};

export const CampaignsService = {
  getAll: () => FirestoreService.getDocuments('campaigns', [orderBy('createdAt', 'desc')]),
  getById: (id: string) => FirestoreService.getDocument('campaigns', id),
  create: (id: string, data: any) => FirestoreService.setDocument('campaigns', id, data),
  update: (id: string, data: any) => FirestoreService.updateDocument('campaigns', id, data),
};

export const ContentService = {
  getAll: () => FirestoreService.getDocuments('content', [orderBy('createdAt', 'desc')]),
  getById: (id: string) => FirestoreService.getDocument('content', id),
  create: (id: string, data: any) => FirestoreService.setDocument('content', id, data),
  update: (id: string, data: any) => FirestoreService.updateDocument('content', id, data),
};

export const AnalyticsService = {
  getAll: () => FirestoreService.getDocuments('analytics', [orderBy('date', 'desc')]),
  getByDateRange: (startDate: Date, endDate: Date) => 
    FirestoreService.getDocuments('analytics', [
      where('date', '>=', Timestamp.fromDate(startDate)),
      where('date', '<=', Timestamp.fromDate(endDate)),
      orderBy('date', 'desc')
    ]),
  create: (id: string, data: any) => FirestoreService.setDocument('analytics', id, data),
};
