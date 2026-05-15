import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { SegmentDataCoverage, RfmDataSourcePreference, SegmentsDataSource } from '../hooks/useSegments';
import type { SegmentMigrationResult } from './rfmFromOrders';
import type { RFMSegment } from '../types';

export type DataAnalysisRfmScope = {
  sourcePreference: RfmDataSourcePreference;
  segments: RFMSegment[];
  totalCustomers: number;
  ordersAttributed: number;
  guestOrdersSkipped: number;
  dataCoverage: SegmentDataCoverage;
  canCompute: boolean;
};

export type DataAnalysisRfmAggregate = {
  brandId: string;
  status: 'running' | 'ready' | 'failed';
  sourceLabel: string;
  dataSource: SegmentsDataSource;
  dataOrigin: 'erp_orders' | 'ecommerce_orders' | 'none';
  syncVersion: string;
  latestSyncAt: string | null;
  processedOrders: number;
  catalogSkus: number;
  segmentMigration?: SegmentMigrationResult;
  scopes: {
    identified?: DataAnalysisRfmScope;
    all?: DataAnalysisRfmScope;
  };
};

function isReadyAggregate(value: unknown): value is DataAnalysisRfmAggregate {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DataAnalysisRfmAggregate>;
  return row.status === 'ready' && typeof row.syncVersion === 'string' && !!row.scopes;
}

export async function fetchDataAnalysisRfmAggregate(
  brandId: string,
  _syncVersion: string | null
): Promise<DataAnalysisRfmAggregate | null> {
  const snap = await getDoc(doc(db, 'data_analysis_rfm', brandId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!isReadyAggregate(data)) return data.status === 'running' || data.status === 'failed'
    ? (data as DataAnalysisRfmAggregate)
    : null;
  // Keep the last good server snapshot visible until the next RFM refresh replaces it.
  // `syncVersion` can change after unrelated connector/product syncs; using it as a hard
  // gate forced the UI back to client-side order reads for large brands.
  return data;
}

