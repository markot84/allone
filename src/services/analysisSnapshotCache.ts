import type { RFMSegment } from '../types';
import type { SegmentDataCoverage, RfmDataSourcePreference, SegmentsDataSource } from '../hooks/useSegments';
import type { SegmentMigrationResult } from './rfmFromOrders';

const SNAPSHOT_PREFIX = 'pp-analysis-snapshot-v6';

export type AnalysisSnapshotScope = {
  brandId: string;
  variant: 'default' | 'data_analysis';
  sourcePref: RfmDataSourcePreference;
  ordersSinceDate: string;
};

export type AnalysisSnapshotPayload = AnalysisSnapshotScope & {
  syncVersion: string;
  savedAt: string;
  segments: RFMSegment[];
  totalCustomers: number;
  hasImported: boolean;
  dataSource: SegmentsDataSource;
  dataOrigin: 'erp_orders' | 'ecommerce_orders' | 'none';
  sourceLabel: string;
  sourcePreference: RfmDataSourcePreference;
  canComputeFromOrders: boolean;
  canComputeIdentifiedOrders: boolean;
  dataCoverage: SegmentDataCoverage;
  orderRfmMeta?: {
    ordersAttributed: number;
    guestOrdersSkipped: number;
  };
  segmentMigration?: SegmentMigrationResult;
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function scopeBase(scope: AnalysisSnapshotScope): string {
  return `${SNAPSHOT_PREFIX}:${scope.brandId}:${scope.variant}:${scope.sourcePref}:${scope.ordersSinceDate}`;
}

function snapshotKey(scope: AnalysisSnapshotScope, syncVersion: string): string {
  return `${scopeBase(scope)}:${syncVersion}`;
}

function latestKey(scope: AnalysisSnapshotScope): string {
  return `${scopeBase(scope)}:latest`;
}

function parseSnapshot(raw: string | null): AnalysisSnapshotPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AnalysisSnapshotPayload;
    return Array.isArray(parsed?.segments) && parsed.brandId ? parsed : null;
  } catch {
    return null;
  }
}

export function readLatestAnalysisSnapshot(scope: AnalysisSnapshotScope): AnalysisSnapshotPayload | null {
  const s = storage();
  if (!s) return null;
  const pointer = s.getItem(latestKey(scope));
  return parseSnapshot(s.getItem(pointer || '')) ?? null;
}

export function writeAnalysisSnapshot(payload: AnalysisSnapshotPayload): void {
  const s = storage();
  if (!s) return;
  const key = snapshotKey(payload, payload.syncVersion);
  const pointerKey = latestKey(payload);
  try {
    const previousKey = s.getItem(pointerKey);
    s.setItem(key, JSON.stringify(payload));
    s.setItem(pointerKey, key);
    if (previousKey && previousKey !== key) s.removeItem(previousKey);
  } catch {
    // Ignore quota/private-mode failures; the live query result still renders.
  }
}

export function clearAnalysisSnapshots(brandId?: string | null): void {
  const s = storage();
  if (!s) return;
  if (!brandId) return;
  const prefix = `${SNAPSHOT_PREFIX}:${brandId}:`;
  try {
    Object.keys(s)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => s.removeItem(key));
  } catch {
    // Storage iteration can fail in restricted modes.
  }
}
