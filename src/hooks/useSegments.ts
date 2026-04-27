import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { fetchAllEcommerceOrders } from '../services/ecommerceRawOrders';
import { computeRfmSegmentsFromEcommerceOrders } from '../services/rfmFromOrders';
import type { RFMSegment } from '../types';

const STORAGE_KEY = (brandId: string) => `pp-rfm-data-source-${brandId}`;

export type RfmDataSourcePreference = 'auto' | 'orders' | 'import';

export function getStoredRfmSource(brandId: string | null): RfmDataSourcePreference {
  if (!brandId || typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(STORAGE_KEY(brandId));
  if (v === 'orders' || v === 'import' || v === 'auto') return v;
  return 'auto';
}

export function setStoredRfmSource(brandId: string, source: RfmDataSourcePreference): void {
  localStorage.setItem(STORAGE_KEY(brandId), source);
}

export type SegmentsDataSource = 'import' | 'ecommerce' | 'none';

export function useSegments() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary();
  const platformsKey = useMemo(() => [...ecomm.connectedPlatforms].sort().join('|'), [ecomm.connectedPlatforms]);

  const [sourcePref, setSourcePrefState] = useState<RfmDataSourcePreference>('auto');

  useEffect(() => {
    if (brandId) setSourcePrefState(getStoredRfmSource(brandId));
  }, [brandId]);

  const setDataSourcePreference = useCallback(
    (next: RfmDataSourcePreference) => {
      if (brandId) setStoredRfmSource(brandId, next);
      setSourcePrefState(next);
    },
    [brandId]
  );

  const { data: firestoreSegments = [], isPending: fsPending } = useQuery({
    queryKey: ['segments', brandId],
    queryFn: () => (brandId ? SegmentsService.getAll(brandId) : Promise.resolve([])) as Promise<RFMSegment[]>,
  });

  const ordersQueryEnabled = !!brandId && ecomm.connectedPlatforms.length > 0;
  const { data: rawOrders = [], isPending: ordersPending } = useQuery({
    queryKey: ['ecommerceOrdersRaw', brandId, platformsKey],
    queryFn: () => (brandId ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms) : Promise.resolve([])),
    enabled: ordersQueryEnabled,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const orderRfm = useMemo(() => computeRfmSegmentsFromEcommerceOrders(rawOrders), [rawOrders]);

  const canComputeFromOrders = orderRfm.canCompute;
  const importSegmentsAvailable = (firestoreSegments?.length ?? 0) > 0;

  const resolvedSource: SegmentsDataSource = useMemo(() => {
    if (sourcePref === 'import') return importSegmentsAvailable ? 'import' : canComputeFromOrders ? 'ecommerce' : 'none';
    if (sourcePref === 'orders') return canComputeFromOrders ? 'ecommerce' : importSegmentsAvailable ? 'import' : 'none';
    // auto
    if (canComputeFromOrders) return 'ecommerce';
    if (importSegmentsAvailable) return 'import';
    return 'none';
  }, [sourcePref, canComputeFromOrders, importSegmentsAvailable]);

  const segments = useMemo(() => {
    let base: RFMSegment[];
    if (resolvedSource === 'ecommerce') {
      base = orderRfm.segments;
    } else if (resolvedSource === 'import') {
      const raw = (brandId ? (firestoreSegments ?? []) : []) as RFMSegment[];
      base = raw.filter((s): s is RFMSegment => s != null && typeof s.id === 'string');
      base = mergeDuplicateSegmentRowsByName(base);
    } else {
      base = [];
    }
    return base.map((s) => ({ ...s, color: getSegmentColor(s) }));
  }, [resolvedSource, orderRfm.segments, firestoreSegments, brandId]);

  const totalCustomers = useMemo(() => {
    if (resolvedSource === 'ecommerce') return orderRfm.totalCustomers;
    return segments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
  }, [resolvedSource, orderRfm.totalCustomers, segments]);

  const isLoading =
    fsPending || (ordersQueryEnabled && ordersPending && (sourcePref === 'orders' || sourcePref === 'auto'));

  const hasImported =
    resolvedSource === 'ecommerce' ? orderRfm.totalCustomers > 0 : importSegmentsAvailable;

  return {
    segments,
    totalCustomers,
    isLoading,
    hasImported,
    /** Πραγματική πηγή μετά auto / override */
    dataSource: resolvedSource,
    setDataSourcePreference,
    sourcePreference: sourcePref,
    canComputeFromOrders,
    orderRfmMeta:
      resolvedSource === 'ecommerce'
        ? {
            ordersAttributed: orderRfm.ordersAttributed,
            guestOrdersSkipped: orderRfm.guestOrdersSkipped,
          }
        : undefined,
    importSegmentsAvailable,
  };
}
