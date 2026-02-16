import { FirestoreService } from './firestore';
import type { FeedSource } from '../types';

const COLLECTION = 'feed_sources';

export const FeedSourcesService = {
  async getAll(brandId: string | null): Promise<FeedSource[]> {
    const docs = await FirestoreService.getDocuments<FeedSource>(
      COLLECTION,
      [],
      brandId ?? undefined
    );
    return docs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  async create(data: Omit<FeedSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await FirestoreService.setDocument(COLLECTION, id, {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  },

  async update(id: string, data: Partial<Omit<FeedSource, 'id' | 'createdAt'>>): Promise<void> {
    await FirestoreService.updateDocument(COLLECTION, id, data);
  },

  async delete(id: string): Promise<void> {
    await FirestoreService.deleteDocument(COLLECTION, id);
  },

  async updateLastRun(
    id: string,
    status: 'success' | 'failed',
    imported?: number,
    error?: string
  ): Promise<void> {
    await FirestoreService.updateDocument(COLLECTION, id, {
      lastRun: new Date().toISOString(),
      lastStatus: status,
      ...(imported != null ? { lastImported: imported } : {}),
      ...(error ? { lastError: error } : {}),
    });
  },
};
