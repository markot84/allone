import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
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
