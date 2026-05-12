import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getLastImportDates } from './import';
import { coerceToDate } from '../utils/coerceDate';

export type BrandSyncVersion = {
  brandId: string;
  version: string;
  latestSyncAt: string | null;
};

function pushDate(values: number[], value: unknown): void {
  const d = coerceToDate(value);
  if (d) values.push(d.getTime());
}

function collectConnectorSyncDates(values: number[], data: unknown): void {
  if (!data || typeof data !== 'object') return;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (normalized === 'lastsyncat' || normalized.endsWith('syncat') || normalized === 'syncedat') {
      pushDate(values, value);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectConnectorSyncDates(values, value);
    }
  }
}

export async function fetchBrandSyncVersion(brandId: string): Promise<BrandSyncVersion> {
  const syncTimes: number[] = [];
  const [connectorsSnap, ecommerceSnap, businessSnap, lastImportDates] = await Promise.all([
    getDoc(doc(db, 'connectors', brandId)).catch(() => null),
    getDoc(doc(db, 'ecommerce_summary', brandId)).catch(() => null),
    getDoc(doc(db, 'business_revenue_summary', brandId)).catch(() => null),
    getLastImportDates(brandId).catch(() => ({} as Record<string, Date>)),
  ]);

  if (connectorsSnap?.exists()) {
    collectConnectorSyncDates(syncTimes, connectorsSnap.data());
  }
  if (ecommerceSnap?.exists()) {
    pushDate(syncTimes, (ecommerceSnap.data() as { syncedAt?: unknown }).syncedAt);
  }
  if (businessSnap?.exists()) {
    pushDate(syncTimes, (businessSnap.data() as { syncedAt?: unknown }).syncedAt);
  }
  Object.values(lastImportDates).forEach((d) => pushDate(syncTimes, d));

  const latest = syncTimes.length > 0 ? Math.max(...syncTimes) : 0;
  return {
    brandId,
    version: latest > 0 ? String(latest) : 'empty',
    latestSyncAt: latest > 0 ? new Date(latest).toISOString() : null,
  };
}
