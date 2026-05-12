import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { InventorySummary, Product } from '../types';

export type ProductIntelligenceStatus = 'running' | 'ready' | 'failed' | 'skipped';
export type ProductIntelligenceBucket = 'all' | 'healthy' | 'excess' | 'dead' | 'low';

export type ProductIntelligenceAggregate = {
  brandId: string;
  status: ProductIntelligenceStatus;
  sourceLabel: string;
  sourceKind: 'erp' | 'connector_catalog';
  totalCount: number;
  syncVersion?: string;
  latestSyncAt?: string | null;
  pageSize: number;
  pagesByBucket: Record<ProductIntelligenceBucket, number>;
  categories: Array<{ name: string; count: number }>;
  summary: InventorySummary;
  error?: string;
};

export type ProductIntelligencePage = {
  brandId: string;
  bucket: ProductIntelligenceBucket;
  page: number;
  pageSize: number;
  totalRows: number;
  products: Product[];
};

function isAggregateReady(value: unknown): value is ProductIntelligenceAggregate {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ProductIntelligenceAggregate>;
  return row.status === 'ready' && typeof row.totalCount === 'number' && !!row.summary;
}

export async function fetchProductIntelligenceAggregate(
  brandId: string,
  _syncVersion: string | null
): Promise<ProductIntelligenceAggregate | null> {
  const snap = await getDoc(doc(db, 'product_intelligence', brandId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!isAggregateReady(data)) return data as ProductIntelligenceAggregate;
  return data;
}

export async function fetchProductIntelligencePage(
  brandId: string,
  bucket: ProductIntelligenceBucket,
  page: number
): Promise<ProductIntelligencePage | null> {
  const snap = await getDoc(doc(db, 'product_intelligence_pages', `${brandId}_${bucket}_${page}`));
  return snap.exists() ? (snap.data() as ProductIntelligencePage) : null;
}

