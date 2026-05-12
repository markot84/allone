import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentCustomersService, SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import { fetchAllEcommerceOrders, fetchDataAnalysisOrders } from '../services/ecommerceRawOrders';
import { fetchCatalogAlignmentData, fetchCatalogAlignmentDataForDataAnalysis, normalizeCatalogAlignmentPayload } from '../services/catalogAlignment';
import { computeRfmOrderScopeStats, computeRfmSegmentsFromEcommerceOrders, computeSegmentMigrationFromEcommerceOrders, type RfmCatalogContext } from '../services/rfmFromOrders';
import { readLatestAnalysisSnapshot, writeAnalysisSnapshot, type AnalysisSnapshotPayload, type AnalysisSnapshotScope } from '../services/analysisSnapshotCache';
import type { RFMSegment } from '../types';

const STORAGE_KEY = (brandId: string) => `pp-rfm-data-source-${brandId}`;
const RFM_ORDER_FETCH_WINDOW_DAYS = 400;

export type RfmDataSourcePreference = 'orders' | 'external';

export function getStoredRfmSource(brandId: string | null): RfmDataSourcePreference {
  if (!brandId || typeof localStorage === 'undefined') return 'orders';
  const v = localStorage.getItem(STORAGE_KEY(brandId));
  if (v === 'external' || v === 'import') return 'external';
  if (v === 'orders' || v === 'auto') return 'orders';
  return 'orders';
}

export function setStoredRfmSource(brandId: string, source: RfmDataSourcePreference): void {
  localStorage.setItem(STORAGE_KEY(brandId), source);
}

export type SegmentsDataSource = 'import' | 'ecommerce' | 'none';

export interface SegmentDataCoverage {
  sourcePreference: RfmDataSourcePreference;
  activeSource: SegmentsDataSource;
  eShopCustomers: number;
  totalCustomers: number;
  otherCustomers: number;
  eShopPenetration: number;
  hasEshopOrders: boolean;
  hasExternalData: boolean;
  policyLabel: 'e-shop orders' | 'e-shop & others';
  marketingPolicy: string;
}

type SegmentCustomerSummary = {
  segmentName?: string;
  source?: string;
  count: number;
  monetary: number;
};

/**
 * Persisted React Query cache (localStorage) JSON-serializes Map → plain object.
 * Rehydrated data then has no `.entries()` — normalize before any Map iteration.
 */
function coerceToSegmentSummaryMap(data: unknown): Map<string, SegmentCustomerSummary> {
  if (!data) return new Map();
  if (data instanceof Map) return data as Map<string, SegmentCustomerSummary>;
  if (typeof data === 'object' && !Array.isArray(data)) {
    return new Map(Object.entries(data as Record<string, SegmentCustomerSummary>));
  }
  return new Map();
}

function titleFromSegmentId(segmentId: string): string {
  return segmentId
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function rebuildSegmentsFromCustomerSummaries(summariesBySegment: Map<string, SegmentCustomerSummary>): RFMSegment[] {
  const entries = [...summariesBySegment.entries()].filter(([, summary]) => summary.count > 0);
  const totalCount = entries.reduce((sum, [, summary]) => sum + summary.count, 0);
  const totalMonetary = entries.reduce((sum, [, summary]) => sum + summary.monetary, 0);

  return entries.map(([segmentId, summary]) => {
    const name = summary.segmentName || titleFromSegmentId(segmentId);
    return {
      id: segmentId,
      name,
      source: summary.source,
      rfm_score: '',
      count: summary.count,
      percentage: totalCount > 0 ? Math.round((summary.count / totalCount) * 10000) / 100 : 0,
      revenue_share: totalMonetary > 0 ? Math.round((summary.monetary / totalMonetary) * 10000) / 100 : 0,
      color: '#6B7280',
      description: '',
      icon: '',
    } as RFMSegment;
  });
}

export type UseSegmentsOptions = {
  /**
   * `data_analysis`: Data Analysis σελίδα — παραγγελίες πρώτα από ERP connectors, μετά e-shop·
   * κατάλογος χωρίς Procurement (`products` import).
   */
  variant?: 'default' | 'data_analysis';
};

export function useSegments(options: UseSegmentsOptions = {}) {
  const variant = options.variant ?? 'default';
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary();
  const platformsKey = useMemo(() => [...ecomm.connectedPlatforms].sort().join('|'), [ecomm.connectedPlatforms]);

  const [sourcePref, setSourcePrefState] = useState<RfmDataSourcePreference>('orders');

  useEffect(() => {
    if (!brandId || typeof window === 'undefined') return;
    const t = window.setTimeout(() => setSourcePrefState(getStoredRfmSource(brandId)), 0);
    return () => window.clearTimeout(t);
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
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: rawSegmentCustomerSummaries } = useQuery({
    queryKey: ['segmentCustomerSummaries', brandId],
    queryFn: () => (brandId ? SegmentCustomersService.getSummariesBySegment(brandId) : Promise.resolve(new Map())),
    enabled: !!brandId && sourcePref === 'external',
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const segmentCustomerSummaries = useMemo(
    () => coerceToSegmentSummaryMap(rawSegmentCustomerSummaries),
    [rawSegmentCustomerSummaries]
  );

  const ordersQueryEnabled =
    !!brandId && (ecomm.connectedPlatforms.length > 0 || variant === 'data_analysis');
  const ordersSinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RFM_ORDER_FETCH_WINDOW_DAYS);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);
  const ordersQueryKeyPrefix = variant === 'data_analysis' ? 'dataAnalysisOrdersRaw' : 'ecommerceOrdersRaw';
  const catalogQueryKeyPrefix = variant === 'data_analysis' ? 'catalogAlignmentDataAnalysis' : 'catalogAlignment';
  const brandSyncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = brandSyncVersionQuery.data?.version ?? null;
  const snapshotScope = useMemo<AnalysisSnapshotScope | null>(
    () => brandId ? { brandId, variant, sourcePref, ordersSinceDate } : null,
    [brandId, variant, sourcePref, ordersSinceDate]
  );
  const analysisSnapshot = useMemo(
    () => (snapshotScope ? readLatestAnalysisSnapshot(snapshotScope) : null),
    [snapshotScope]
  );
  const usableSnapshot =
    variant === 'data_analysis' &&
    analysisSnapshot &&
    (!syncVersion || analysisSnapshot.syncVersion === syncVersion)
      ? analysisSnapshot
      : null;
  const shouldServeCachedAnalysis = !!usableSnapshot;

  const ordersSourceFingerprint = variant === 'data_analysis' ? (syncVersion ?? 'sync-pending') : platformsKey;

  const { data: rawOrders = [], isPending: ordersPending, error: ordersError } = useQuery({
    queryKey: [ordersQueryKeyPrefix, brandId, platformsKey, ordersSinceDate, ordersSourceFingerprint],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, { sinceDate: ordersSinceDate, cacheFirst: true })
            : fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, { sinceDate: ordersSinceDate }))
        : Promise.resolve([]),
    enabled: ordersQueryEnabled && !shouldServeCachedAnalysis && (variant !== 'data_analysis' || !!syncVersion),
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const rawOrdersCatalogKey = useMemo(() => {
    if (shouldServeCachedAnalysis) return 'cached';
    if (rawOrders.length === 0) return 'empty';
    const first = rawOrders[0]?.orderId || rawOrders[0]?.createdAt || '';
    const last = rawOrders[rawOrders.length - 1]?.orderId || rawOrders[rawOrders.length - 1]?.createdAt || '';
    return `${rawOrders.length}:${first}:${last}`;
  }, [rawOrders, shouldServeCachedAnalysis]);

  /** Μετά τις παραγγελίες ώστε να μην «δένει» το UI σε διπλό βαρύ parallel fetch· τα segments εμφανίζονται χωρίς catalog enrichment. */
  const { data: catalogAlignment, isPending: catalogPending } = useQuery({
    queryKey: [catalogQueryKeyPrefix, brandId, platformsKey, rawOrdersCatalogKey],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchCatalogAlignmentDataForDataAnalysis(brandId, ecomm.connectedPlatforms, rawOrders)
            : fetchCatalogAlignmentData(brandId, ecomm.connectedPlatforms))
        : Promise.resolve(null),
    enabled: ordersQueryEnabled && !ordersPending && !shouldServeCachedAnalysis,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const catalogContext: RfmCatalogContext | null = useMemo(() => {
    const normalized = normalizeCatalogAlignmentPayload(catalogAlignment ?? null);
    if (!normalized) return null;
    return { indexes: normalized.indexes, erpBySku: normalized.erpBySku };
  }, [catalogAlignment]);

  const analysisOrders = shouldServeCachedAnalysis ? [] : rawOrders;
  const orderScopeStats = useMemo(() => computeRfmOrderScopeStats(analysisOrders), [analysisOrders]);
  const orderOrigin = useMemo(() => {
    if (analysisOrders.some((order) => order.platform === 'megaventory_invoices' || order.platform === 'softone_sales_documents')) {
      return 'erp_orders' as const;
    }
    return analysisOrders.length > 0 ? ('ecommerce_orders' as const) : ('none' as const);
  }, [analysisOrders]);
  const effectiveSourcePref =
    sourcePref === 'orders' &&
    !ordersPending &&
    !orderScopeStats.canComputeIdentified &&
    orderScopeStats.canComputeAll
      ? 'external'
      : sourcePref;
  const orderRfm = useMemo(
    () => computeRfmSegmentsFromEcommerceOrders(analysisOrders, catalogContext, { includeAnonymousGuests: effectiveSourcePref === 'external' }),
    [analysisOrders, catalogContext, effectiveSourcePref]
  );

  const canComputeFromOrders = orderScopeStats.canComputeAll;
  const canComputeIdentifiedOrders = orderScopeStats.canComputeIdentified;
  const rebuiltCustomerSegments = useMemo(
    () => rebuildSegmentsFromCustomerSummaries(segmentCustomerSummaries),
    [segmentCustomerSummaries]
  );
  const importSegmentsAvailable = (firestoreSegments?.length ?? 0) > 0 || rebuiltCustomerSegments.length > 0;

  const externalSegments = useMemo(() => {
    const raw = (brandId ? (firestoreSegments ?? []) : []) as RFMSegment[];
    const cleaned = raw.filter((s): s is RFMSegment => s != null && typeof s.id === 'string');
    const merged = mergeDuplicateSegmentRowsByName(cleaned);
    const importedTotal = merged.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
    const rebuiltTotal = rebuiltCustomerSegments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
    return rebuiltTotal > importedTotal ? rebuiltCustomerSegments : merged;
  }, [brandId, firestoreSegments, rebuiltCustomerSegments]);

  const resolvedSource: SegmentsDataSource = useMemo(() => {
    if (orderRfm.canCompute) return 'ecommerce';
    if (ordersQueryEnabled && ordersPending) return 'none';
    if (sourcePref === 'external' && importSegmentsAvailable) return 'import';
    return importSegmentsAvailable ? 'import' : 'none';
  }, [sourcePref, orderRfm.canCompute, ordersQueryEnabled, ordersPending, importSegmentsAvailable]);

  const segments = useMemo(() => {
    let base: RFMSegment[];
    if (resolvedSource === 'ecommerce') {
      base = orderRfm.segments;
    } else if (resolvedSource === 'import') {
      base = externalSegments;
    } else {
      base = [];
    }
    return base.map((s) => ({ ...s, color: getSegmentColor(s) }));
  }, [resolvedSource, orderRfm.segments, externalSegments]);

  const totalCustomers = useMemo(() => {
    if (resolvedSource === 'ecommerce') return orderRfm.totalCustomers;
    return segments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
  }, [resolvedSource, orderRfm.totalCustomers, segments]);

  const externalTotalCustomers = useMemo(
    () => {
      return externalSegments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
    },
    [externalSegments]
  );

  const dataCoverage = useMemo<SegmentDataCoverage>(() => {
    const eShopCustomers = orderScopeStats.identifiedCustomers;
    const allOrderCustomers = orderScopeStats.allBuyers;
    const usesExternalPolicy = effectiveSourcePref === 'external';
    const usesConnectorRfm = usesExternalPolicy && externalSegments.some((s) => String((s as RFMSegment & { source?: string }).source || '').endsWith('_rfm'));
    const fullBase = resolvedSource === 'ecommerce'
      ? (usesExternalPolicy ? allOrderCustomers : eShopCustomers)
      : usesExternalPolicy
        ? usesConnectorRfm
          ? eShopCustomers + externalTotalCustomers
          : Math.max(externalTotalCustomers, eShopCustomers)
        : eShopCustomers;
    const otherCustomers = resolvedSource === 'ecommerce'
      ? Math.max(0, allOrderCustomers - eShopCustomers)
      : usesExternalPolicy && usesConnectorRfm
        ? externalTotalCustomers
        : Math.max(0, fullBase - eShopCustomers);
    const eShopPenetration = fullBase > 0 ? Math.round((eShopCustomers / fullBase) * 1000) / 10 : 0;
    const policyLabel = usesExternalPolicy ? 'e-shop & others' : 'e-shop orders';
    const marketingPolicy =
      usesExternalPolicy
        ? 'Χρησιμοποιεί όλες τις έγκυρες παραγγελίες, μαζί με guest checkouts.'
        : 'Χρησιμοποιεί αγοραστές με σταθερό id ή email.';
    return {
      sourcePreference: effectiveSourcePref,
      activeSource: resolvedSource,
      eShopCustomers,
      totalCustomers: fullBase,
      otherCustomers,
      eShopPenetration,
      hasEshopOrders: eShopCustomers > 0,
      hasExternalData: externalTotalCustomers > 0,
      policyLabel,
      marketingPolicy,
    };
  }, [effectiveSourcePref, resolvedSource, orderScopeStats, externalTotalCustomers, externalSegments]);

  const orderSegmentMigration = useMemo(
    () => (resolvedSource === 'ecommerce' && analysisOrders.length <= 2000 ? computeSegmentMigrationFromEcommerceOrders(analysisOrders, 30) : undefined),
    [resolvedSource, analysisOrders]
  );

  /**
   * Μην μπλοκάρεις RFM όσο περιμένεις «άδεια» segments αν το brand έχει e-shop:
   * το `ordersLoading` δείχνει την κατάσταση φόρτωσης παραγγελιών.
   * Μπλοκ μόνο για import-only (όχι connectors) ή external preference (segment_customers).
   */
  const ecommReady = !ecomm.isLoading;
  const blocksOnImportedSegmentsOnly =
    fsPending &&
    ecommReady &&
    ecomm.connectedPlatforms.length === 0 &&
    !ecomm.hasData;
  const isLoading =
    !shouldServeCachedAnalysis &&
    (blocksOnImportedSegmentsOnly ||
      (ordersQueryEnabled && ordersPending && !orderRfm.canCompute));

  const ordersLoading = !shouldServeCachedAnalysis && ordersQueryEnabled && ordersPending;
  const isCatalogEnriching = !shouldServeCachedAnalysis && ordersQueryEnabled && catalogPending;

  const hasImported =
    resolvedSource === 'ecommerce'
      ? orderRfm.totalCustomers > 0
      : resolvedSource === 'import'
        ? importSegmentsAvailable
        : false;
  const sourceLabel =
    resolvedSource === 'ecommerce'
      ? orderOrigin === 'erp_orders'
        ? 'ERP'
        : effectiveSourcePref === 'external'
          ? 'E-shop + guests'
          : 'E-shop orders'
      : resolvedSource === 'import'
        ? 'ERP / import'
        : 'Pending';

  const liveSnapshotPayload = useMemo<AnalysisSnapshotPayload | null>(() => {
    if (!snapshotScope || variant !== 'data_analysis' || !syncVersion || !hasImported) return null;
    return {
      ...snapshotScope,
      syncVersion,
      savedAt: new Date().toISOString(),
      segments,
      totalCustomers,
      hasImported,
      dataSource: resolvedSource,
      dataOrigin: orderOrigin,
      sourceLabel,
      sourcePreference: effectiveSourcePref,
      canComputeFromOrders,
      canComputeIdentifiedOrders,
      dataCoverage,
      orderRfmMeta:
        resolvedSource === 'ecommerce'
          ? {
              ordersAttributed: orderRfm.ordersAttributed,
              guestOrdersSkipped: orderRfm.guestOrdersSkipped,
            }
          : undefined,
      segmentMigration: resolvedSource === 'ecommerce' ? orderSegmentMigration : undefined,
    };
  }, [
    snapshotScope,
    variant,
    syncVersion,
    hasImported,
    segments,
    totalCustomers,
    resolvedSource,
    sourceLabel,
    orderOrigin,
    effectiveSourcePref,
    canComputeFromOrders,
    canComputeIdentifiedOrders,
    dataCoverage,
    orderRfm.ordersAttributed,
    orderRfm.guestOrdersSkipped,
    orderSegmentMigration,
  ]);

  useEffect(() => {
    if (!liveSnapshotPayload || isLoading || ordersPending) return;
    writeAnalysisSnapshot(liveSnapshotPayload);
  }, [liveSnapshotPayload, isLoading, ordersPending]);

  const shouldUseSnapshot = shouldServeCachedAnalysis || (!!usableSnapshot && (isLoading || ordersPending || segments.length === 0));
  const displayedSegments = shouldUseSnapshot ? usableSnapshot.segments : segments;
  const displayedTotalCustomers = shouldUseSnapshot ? usableSnapshot.totalCustomers : totalCustomers;
  const displayedDataCoverage = shouldUseSnapshot ? usableSnapshot.dataCoverage : dataCoverage;
  const displayedDataSource = shouldUseSnapshot ? usableSnapshot.dataSource : resolvedSource;
  const displayedDataOrigin = shouldUseSnapshot ? usableSnapshot.dataOrigin : orderOrigin;
  const displayedSourceLabel = shouldUseSnapshot ? usableSnapshot.sourceLabel : sourceLabel;
  const displayedSourcePreference = shouldUseSnapshot ? usableSnapshot.sourcePreference : effectiveSourcePref;
  const displayedCanComputeFromOrders = shouldUseSnapshot ? usableSnapshot.canComputeFromOrders : canComputeFromOrders;
  const displayedCanComputeIdentifiedOrders = shouldUseSnapshot ? usableSnapshot.canComputeIdentifiedOrders : canComputeIdentifiedOrders;
  const displayedHasImported = shouldUseSnapshot ? usableSnapshot.hasImported : hasImported;
  const displayedOrderRfmMeta =
    shouldUseSnapshot
      ? usableSnapshot.orderRfmMeta
      : resolvedSource === 'ecommerce'
        ? {
            ordersAttributed: orderRfm.ordersAttributed,
            guestOrdersSkipped: orderRfm.guestOrdersSkipped,
          }
        : undefined;
  const displayedSegmentMigration =
    shouldUseSnapshot
      ? usableSnapshot.segmentMigration
      : resolvedSource === 'ecommerce'
        ? orderSegmentMigration
        : undefined;

  return {
    segments: displayedSegments,
    totalCustomers: displayedTotalCustomers,
    isLoading: shouldUseSnapshot ? false : isLoading,
    /** True όσο τραβάμε πρόσφατο order history για ecommerce RFM — UI δεν πρέπει να μπλοκάρει. */
    ordersLoading,
    ordersError: (ordersError as Error | null) ?? null,
    /** Φόρτωση *_products + unified products για catalog tabs — δεν μπλοκάρει το κύριο RFM grid. */
    isCatalogEnriching,
    hasImported: displayedHasImported,
    /** Πραγματική πηγή μετά την επιλογή του χρήστη. */
    dataSource: displayedDataSource,
    dataOrigin: displayedDataOrigin,
    sourceLabel: displayedSourceLabel,
    setDataSourcePreference,
    sourcePreference: displayedSourcePreference,
    canComputeFromOrders: displayedCanComputeFromOrders,
    canComputeIdentifiedOrders: displayedCanComputeIdentifiedOrders,
    dataCoverage: displayedDataCoverage,
    orderRfmMeta: displayedOrderRfmMeta,
    segmentMigration: displayedSegmentMigration,
    importSegmentsAvailable,
  };
}
