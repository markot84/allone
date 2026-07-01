import { doc, getDoc } from 'firebase/firestore';
import { auth, db, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../config/firebase';
import type { InventorySummary, Product } from '../types';

export type ProductIntelligenceStatus = 'running' | 'ready' | 'failed' | 'skipped';
export type ProductIntelligenceBucket = 'all' | 'healthy' | 'excess' | 'dead' | 'low' | 'no_stock';

export type ProductIntelligenceAggregate = {
  brandId: string;
  status: ProductIntelligenceStatus;
  sourceLabel: string;
  sourceKind: 'erp' | 'connector_catalog' | 'procurement';
  stockSource?: string;
  /** Megaventory warehouses (InventoryLocationID) this aggregate reflects; empty/absent = all. */
  stockLocations?: string[];
  /** Display names for stockLocations, in the same order — for the UI warehouse badge. */
  stockLocationLabels?: string[];
  totalCount: number;
  syncVersion?: string;
  latestSyncAt?: string | null;
  pageSize: number;
  pagesByBucket: Record<ProductIntelligenceBucket, number>;
  categories: Array<{ name: string; count: number }>;
  brands?: Array<{ name: string; count: number }>;
  summary: InventorySummary;
  charts?: ProductIntelligenceCharts;
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

export type ProductIntelligenceCharts = {
  marginDistribution: Array<{ name: string; count: number }>;
  stockAgeDistribution: Array<{ name: string; count: number }>;
  stockStatus: Array<{ name: string; value: number; color: string }>;
  categoryBreakdown?: Array<{ name: string; count: number }>;
  topProductsByMargin: Array<{ name: string; margin: number; price: number }>;
  stockAgeVsLevel: Array<{ age: number; level: number; margin: number }>;
};

export type ProductIntelligenceQuery = {
  page: number;
  pageSize?: number;
  bucket?: ProductIntelligenceBucket;
  search?: string;
  categories?: string[];
  brands?: string[];
  tags?: string[];
  margin?: 'all' | 'high' | 'medium' | 'low';
  stockAge?: 'all' | 'dead' | 'near-dead' | 'high-margin-low-stock';
  sortField?: 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
  sortDirection?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
  dateMode?: 'imported' | 'first_available';
  includeNoStock?: boolean;
};

export type ProductIntelligenceQueryResult = {
  brandId: string;
  status: 'ready';
  sourceLabel: string;
  sourceKind: 'erp' | 'connector_catalog' | 'procurement';
  totalCount: number;
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  bucket: ProductIntelligenceBucket;
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

export async function queryProductIntelligencePage(
  brandId: string,
  query: ProductIntelligenceQuery
): Promise<ProductIntelligenceQueryResult | null> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/queryProductIntelligence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(await getAppCheckHeader()),
    },
    body: JSON.stringify({ brandId, ...query }),
  });
  const json = await res.json().catch(() => null) as { result?: ProductIntelligenceQueryResult; error?: string } | null;
  if (!res.ok) throw new Error(json?.error || `Product Intelligence query failed (${res.status})`);
  return json?.result ?? null;
}

export async function refreshProductIntelligenceOnServer(brandId: string): Promise<{ totalCount?: number }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/refreshProductIntelligence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(await getAppCheckHeader()),
    },
    body: JSON.stringify({ brandId }),
  });
  const json = await res.json().catch(() => null) as { result?: { totalCount?: number }; error?: string } | null;
  if (!res.ok) throw new Error(json?.error || `Product Intelligence refresh failed (${res.status})`);
  return json?.result ?? {};
}

