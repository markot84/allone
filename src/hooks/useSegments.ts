import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentCustomersService, SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import { fetchAllEcommerceOrders } from '../services/ecommerceRawOrders';
import { fetchCatalogAlignmentData, fetchCatalogAlignmentDataForDataAnalysis, normalizeCatalogAlignmentPayload } from '../services/catalogAlignment';
import {
  computeRfmOrderScopeStats,
  computeRfmSegmentsFromEcommerceOrders,
  computeSegmentMigrationFromEcommerceOrders,
  computeSegmentPeriodComparisonFromEcommerceOrders,
  type RfmCatalogContext,
} from '../services/rfmFromOrders';
import {
  isAnalysisSnapshotFresh,
  readLatestAnalysisSnapshot,
  writeAnalysisSnapshot,
  type AnalysisSnapshotPayload,
  type AnalysisSnapshotScope,
} from '../services/analysisSnapshotCache';
import { fetchDataAnalysisRfmAggregate, type DataAnalysisRfmAggregate, type DataAnalysisRfmScope } from '../services/dataAnalysisRfm';
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

/**
 * Επιλογή aggregate scope ΧΩΡΙΣ gate στο status: τα 'running'/'failed' writes του server
 * γίνονται με merge:true και διατηρούν σκόπιμα τα τελευταία καλά scopes
 * (functions/src/dataAnalysisRfmAggregator.ts:1216-1223, 1271-1276 — η πρόθεση τεκμηριώνεται
 * και στο services/dataAnalysisRfm.ts:51-54). Το παλιό gate `status === 'ready'` υποβάθμιζε
 * σιωπηλά κάθε aggregate consumer σε import/empty για έως έναν μήνα (BUG-5).
 *
 * Auto-switch identified→all: αν το 'identified' υπάρχει με canCompute:false και το 'all'
 * υπολογίζεται, σερβίρουμε το 'all'. Μονόδρομο σκόπιμα: το 'all' είναι υπερσύνολο του
 * 'identified' (computeScope: canCompute = segments.length > 0) — η αντίστροφη μετάβαση
 * δεν συμβαίνει ποτέ.
 */
function selectAggregateScope(
  scopes: DataAnalysisRfmAggregate['scopes'] | undefined,
  preferredKey: 'identified' | 'all',
): DataAnalysisRfmScope | null {
  if (!scopes) return null;
  const preferred = scopes[preferredKey] ?? null;
  if (preferredKey === 'identified' && preferred && !preferred.canCompute && scopes.all?.canCompute) {
    return scopes.all;
  }
  return preferred ?? scopes.all ?? scopes.identified ?? null;
}

// Καθαρά predicates για τα `enabled` gates των queries — extracted ώστε τα unit tests
// να ασκούν τον πραγματικό κώδικα του hook (όχι αντίγραφα των εκφράσεων).
function ordersQueryGate(a: { isDataAnalysis: boolean; skipOrderHydration: boolean; brandId: string | null; connectedPlatformsCount: number }): boolean {
  return !a.isDataAnalysis && !a.skipOrderHydration && !!a.brandId && a.connectedPlatformsCount > 0;
}
function aggregateQueryGate(a: { isDataAnalysis: boolean; useServerAggregate: boolean; brandId: string | null }): boolean {
  return (a.isDataAnalysis || a.useServerAggregate) && !!a.brandId;
}
function catalogQueryGate(a: { ordersQueryEnabled: boolean; shouldUseAggregate: boolean; hasUsableSnapshot: boolean; ordersPending: boolean; rawOrdersCount: number }): boolean {
  return a.ordersQueryEnabled && !a.shouldUseAggregate && !a.hasUsableSnapshot && !a.ordersPending && a.rawOrdersCount > 0;
}

export type UseSegmentsOptions = {
  /**
   * `data_analysis`: Data Analysis σελίδα — παραγγελίες πρώτα από ERP connectors, μετά e-shop·
   * κατάλογος χωρίς Procurement (`products` import).
   */
  variant?: 'default' | 'data_analysis';
  /**
   * Dashboard: μόνο imported Firestore segments — χωρίς fetch 400ημέρων παραγγελιών
   * (το βαρύ client-side RFM μένει στη σελίδα RFM).
   */
  skipOrderHydration?: boolean;
  /**
   * Dashboard: χρησιμοποίησε το έτοιμο server RFM aggregate (`data_analysis_rfm/{brandId}`, 1 doc read)
   * ως πηγή segments αντί για client-side υπολογισμό. Συνδυάζεται με `skipOrderHydration` ώστε να
   * εμφανίζονται πραγματικά segments γρήγορα, χωρίς να κατεβαίνουν παραγγελίες.
   */
  useServerAggregate?: boolean;
};

export function useSegments(options: UseSegmentsOptions = {}) {
  const variant = options.variant ?? 'default';
  const isDataAnalysis = variant === 'data_analysis';
  const skipOrderHydration = options.skipOrderHydration === true;
  const useServerAggregate = options.useServerAggregate === true;
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
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
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: rawSegmentCustomerSummaries } = useQuery({
    queryKey: ['segmentCustomerSummaries', brandId],
    queryFn: () => (brandId ? SegmentCustomersService.getSummariesBySegment(brandId) : Promise.resolve(new Map())),
    enabled: !!brandId && sourcePref === 'external',
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const segmentCustomerSummaries = useMemo(
    () => coerceToSegmentSummaryMap(rawSegmentCustomerSummaries),
    [rawSegmentCustomerSummaries]
  );

  const ordersQueryEnabled = ordersQueryGate({
    isDataAnalysis,
    skipOrderHydration,
    brandId,
    connectedPlatformsCount: ecomm.connectedPlatforms.length,
  });
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
  const { data: dataAnalysisAggregate = null, isPending: dataAnalysisAggregatePending } = useQuery({
    queryKey: ['dataAnalysisRfmAggregate', brandId],
    queryFn: () => (brandId ? fetchDataAnalysisRfmAggregate(brandId, syncVersion) : Promise.resolve(null)),
    enabled: aggregateQueryGate({ isDataAnalysis, useServerAggregate, brandId }),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const aggregateScopeKey = sourcePref === 'external' ? 'all' : 'identified';
  // Default variant: scopes όποτε υπάρχουν, ανεξάρτητα από status (βλ. selectAggregateScope).
  // Το data_analysis branch μένει ως έχει — η σελίδα RFM έχει δικό της fallback ladder.
  const aggregateScope = isDataAnalysis
    ? dataAnalysisAggregate?.scopes?.[aggregateScopeKey] ?? null
    : selectAggregateScope(dataAnalysisAggregate?.scopes, aggregateScopeKey);
  const aggregateIsBuilding = isDataAnalysis && dataAnalysisAggregate?.status === 'running';
  const isDataAnalysisAggregatePending = isDataAnalysis && dataAnalysisAggregatePending && !dataAnalysisAggregate;
  const shouldUseAggregate = !!aggregateScope?.canCompute;
  const snapshotScope = useMemo<AnalysisSnapshotScope | null>(
    () => brandId ? { brandId, variant, sourcePref, ordersSinceDate } : null,
    [brandId, variant, sourcePref, ordersSinceDate]
  );
  const analysisSnapshot = useMemo(
    () => (snapshotScope ? readLatestAnalysisSnapshot(snapshotScope) : null),
    [snapshotScope]
  );
  const freshAnalysisSnapshot = useMemo(
    () => (isDataAnalysis ? analysisSnapshot : isAnalysisSnapshotFresh(analysisSnapshot) ? analysisSnapshot : null),
    [analysisSnapshot, isDataAnalysis]
  );
  const freshSnapshotForCurrentSync = useMemo(
    () =>
      isDataAnalysis && freshAnalysisSnapshot
        ? freshAnalysisSnapshot
        : freshAnalysisSnapshot && syncVersion && freshAnalysisSnapshot.syncVersion === syncVersion
        ? freshAnalysisSnapshot
        : null,
    [freshAnalysisSnapshot, isDataAnalysis, syncVersion]
  );
  const usableSnapshot =
    variant === 'data_analysis' &&
    freshSnapshotForCurrentSync &&
    freshSnapshotForCurrentSync.dataOrigin !== 'none' &&
    freshSnapshotForCurrentSync.segments.length > 0
      ? freshSnapshotForCurrentSync
      : null;
  const staleAnalysisSnapshot =
    variant === 'data_analysis' &&
    analysisSnapshot &&
    !freshAnalysisSnapshot &&
    !!syncVersion &&
    analysisSnapshot.syncVersion === syncVersion &&
    analysisSnapshot.dataOrigin !== 'none' &&
    analysisSnapshot.segments.length > 0
      ? analysisSnapshot
      : null;
  const ordersSourceFingerprint = variant === 'data_analysis' ? (syncVersion ?? 'latest') : platformsKey;

  const { data: rawOrders = [], isPending: ordersPending, error: ordersError } = useQuery({
    queryKey: [ordersQueryKeyPrefix, brandId, platformsKey, ordersSinceDate, ordersSourceFingerprint],
    queryFn: () =>
      brandId
        ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, { sinceDate: ordersSinceDate })
        : Promise.resolve([]),
    enabled:
      ordersQueryEnabled &&
      !shouldUseAggregate,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const rawOrdersCatalogKey = useMemo(() => {
    if (rawOrders.length === 0) return 'empty';
    const first = rawOrders[0]?.orderId || rawOrders[0]?.createdAt || '';
    const last = rawOrders[rawOrders.length - 1]?.orderId || rawOrders[rawOrders.length - 1]?.createdAt || '';
    return `${rawOrders.length}:${first}:${last}`;
  }, [rawOrders]);

  /** Μετά τις παραγγελίες ώστε να μην «δένει» το UI σε διπλό βαρύ parallel fetch· τα segments εμφανίζονται χωρίς catalog enrichment. */
  const { data: catalogAlignment, isPending: catalogPending } = useQuery({
    queryKey: [catalogQueryKeyPrefix, brandId, platformsKey, rawOrdersCatalogKey],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchCatalogAlignmentDataForDataAnalysis(brandId, ecomm.connectedPlatforms, rawOrders)
            : fetchCatalogAlignmentData(brandId, ecomm.connectedPlatforms))
        : Promise.resolve(null),
    enabled: catalogQueryGate({
      ordersQueryEnabled,
      shouldUseAggregate,
      hasUsableSnapshot: !!usableSnapshot,
      ordersPending,
      rawOrdersCount: rawOrders.length,
    }),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const catalogContext: RfmCatalogContext | null = useMemo(() => {
    const normalized = normalizeCatalogAlignmentPayload(catalogAlignment ?? null);
    if (!normalized) return null;
    return { indexes: normalized.indexes, erpBySku: normalized.erpBySku };
  }, [catalogAlignment]);

  const analysisOrders = rawOrders;
  const orderScopeStats = useMemo(() => computeRfmOrderScopeStats(analysisOrders), [analysisOrders]);
  const orderOrigin = useMemo(() => {
    if (
      analysisOrders.some((order) =>
        order.erpBacked === true ||
        order.platform === 'megaventory_invoices' ||
        order.platform === 'softone_sales_documents'
      )
    ) {
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
    if (shouldUseAggregate) return 'ecommerce';
    if (isDataAnalysis) return 'none';
    if (orderRfm.canCompute) return 'ecommerce';
    if (ordersQueryEnabled && (ordersPending || aggregateIsBuilding || isDataAnalysisAggregatePending)) return 'none';
    if (sourcePref === 'external' && importSegmentsAvailable) return 'import';
    return importSegmentsAvailable ? 'import' : 'none';
  }, [shouldUseAggregate, isDataAnalysis, orderRfm.canCompute, ordersQueryEnabled, ordersPending, aggregateIsBuilding, isDataAnalysisAggregatePending, sourcePref, importSegmentsAvailable]);

  const segments = useMemo(() => {
    let base: RFMSegment[];
    if (shouldUseAggregate && aggregateScope) {
      base = aggregateScope.segments;
    } else if (resolvedSource === 'ecommerce') {
      base = orderRfm.segments;
    } else if (resolvedSource === 'import') {
      base = externalSegments;
    } else {
      base = [];
    }
    return base.map((s) => ({ ...s, color: getSegmentColor(s) }));
  }, [shouldUseAggregate, aggregateScope, resolvedSource, orderRfm.segments, externalSegments]);

  const totalCustomers = useMemo(() => {
    if (shouldUseAggregate && aggregateScope) return aggregateScope.totalCustomers;
    if (resolvedSource === 'ecommerce') return orderRfm.totalCustomers;
    return segments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
  }, [shouldUseAggregate, aggregateScope, resolvedSource, orderRfm.totalCustomers, segments]);

  const externalTotalCustomers = useMemo(
    () => {
      return externalSegments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
    },
    [externalSegments]
  );

  const dataCoverage = useMemo<SegmentDataCoverage>(() => {
    if (shouldUseAggregate && aggregateScope) return aggregateScope.dataCoverage;
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
  }, [shouldUseAggregate, aggregateScope, effectiveSourcePref, resolvedSource, orderScopeStats, externalTotalCustomers, externalSegments]);

  const orderSegmentMigration = useMemo(
    () => {
      if (resolvedSource !== 'ecommerce' || analysisOrders.length === 0) return undefined;
      const monthly = computeSegmentMigrationFromEcommerceOrders(analysisOrders, 30);
      return monthly.canCompute ? monthly : computeSegmentMigrationFromEcommerceOrders(analysisOrders, 90);
    },
    [resolvedSource, analysisOrders]
  );

  const orderSegmentPeriodComparison = useMemo(
    () => {
      if (resolvedSource !== 'ecommerce' || analysisOrders.length === 0) return undefined;
      const monthly = computeSegmentPeriodComparisonFromEcommerceOrders(analysisOrders, 30);
      return monthly.canCompute ? monthly : computeSegmentPeriodComparisonFromEcommerceOrders(analysisOrders, 90);
    },
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
  const serverAggregatePending = useServerAggregate && dataAnalysisAggregatePending && !dataAnalysisAggregate;
  const isLoading = skipOrderHydration
    ? serverAggregatePending || blocksOnImportedSegmentsOnly
    : (isDataAnalysis && !dataAnalysisAggregate && dataAnalysisAggregatePending) ||
      (!isDataAnalysis && aggregateIsBuilding && !usableSnapshot && !orderRfm.canCompute) ||
      isDataAnalysisAggregatePending ||
      (blocksOnImportedSegmentsOnly ||
        (variant !== 'data_analysis' && ordersQueryEnabled && ordersPending && !orderRfm.canCompute));

  const ordersLoading = skipOrderHydration ? false : variant !== 'data_analysis' && !shouldUseAggregate && ordersQueryEnabled && ordersPending;
  const isCatalogEnriching = variant !== 'data_analysis' && !shouldUseAggregate && ordersQueryEnabled && catalogPending;

  const hasImported =
    shouldUseAggregate && aggregateScope
      ? aggregateScope.totalCustomers > 0
      : resolvedSource === 'ecommerce'
      ? orderRfm.totalCustomers > 0
      : resolvedSource === 'import'
        ? importSegmentsAvailable
        : false;
  const sourceLabel =
    shouldUseAggregate && dataAnalysisAggregate
      ? dataAnalysisAggregate.sourceLabel || 'ERP'
      : resolvedSource === 'ecommerce'
      ? orderOrigin === 'erp_orders'
        ? 'ERP'
        : effectiveSourcePref === 'external'
          ? 'E-shop + guests'
          : 'E-shop orders'
      : resolvedSource === 'import'
        ? 'ERP / import'
        : 'Pending';

  const liveSnapshotPayload = useMemo<AnalysisSnapshotPayload | null>(() => {
    if (!snapshotScope || variant !== 'data_analysis' || !hasImported || segments.length === 0) return null;
    const snapshotSyncVersion = syncVersion ?? dataAnalysisAggregate?.syncVersion ?? 'local';
    if (shouldUseAggregate && aggregateScope && dataAnalysisAggregate) {
      return {
        ...snapshotScope,
        syncVersion: snapshotSyncVersion,
        savedAt: new Date().toISOString(),
        segments,
        totalCustomers,
        hasImported,
        dataSource: dataAnalysisAggregate.dataSource,
        dataOrigin: dataAnalysisAggregate.dataOrigin,
        sourceLabel,
        sourcePreference: aggregateScope.sourcePreference,
        canComputeFromOrders: true,
        canComputeIdentifiedOrders: true,
        dataCoverage,
        orderRfmMeta: {
          ordersAttributed: aggregateScope.ordersAttributed,
          guestOrdersSkipped: aggregateScope.guestOrdersSkipped,
        },
        segmentMigration: dataAnalysisAggregate.segmentMigration,
        segmentPeriodComparison: dataAnalysisAggregate.segmentPeriodComparison,
      };
    }
    if (resolvedSource !== 'ecommerce' || orderOrigin === 'none') return null;
    return {
      ...snapshotScope,
      syncVersion: snapshotSyncVersion,
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
      segmentPeriodComparison: resolvedSource === 'ecommerce' ? orderSegmentPeriodComparison : undefined,
    };
  }, [
    snapshotScope,
    variant,
    syncVersion,
    dataAnalysisAggregate,
    aggregateScope,
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
    orderSegmentPeriodComparison,
    shouldUseAggregate,
  ]);

  useEffect(() => {
    if (!liveSnapshotPayload || isLoading || ordersPending) return;
    writeAnalysisSnapshot(liveSnapshotPayload);
  }, [liveSnapshotPayload, isLoading, ordersPending]);

  const shouldUseSnapshot =
    !!usableSnapshot &&
    (isLoading || ordersPending || segments.length === 0);
  const shouldUseStaleSnapshot =
    !!staleAnalysisSnapshot &&
    !shouldUseAggregate &&
    (isLoading || ordersPending || segments.length === 0);
  const displayedSnapshot = shouldUseSnapshot ? usableSnapshot : shouldUseStaleSnapshot ? staleAnalysisSnapshot : null;
  const displayedSegments = displayedSnapshot ? displayedSnapshot.segments : segments;
  const displayedTotalCustomers = displayedSnapshot ? displayedSnapshot.totalCustomers : totalCustomers;
  const displayedDataCoverage = displayedSnapshot ? displayedSnapshot.dataCoverage : dataCoverage;
  const displayedDataSource = displayedSnapshot ? displayedSnapshot.dataSource : resolvedSource;
  const displayedDataOrigin = shouldUseSnapshot
    ? usableSnapshot.dataOrigin
    : shouldUseStaleSnapshot && staleAnalysisSnapshot
      ? staleAnalysisSnapshot.dataOrigin
    : shouldUseAggregate && dataAnalysisAggregate
      ? dataAnalysisAggregate.dataOrigin
      : orderOrigin;
  const displayedSourceLabel = displayedSnapshot ? displayedSnapshot.sourceLabel : sourceLabel;
  const displayedSourcePreference = displayedSnapshot ? displayedSnapshot.sourcePreference : shouldUseAggregate && aggregateScope ? aggregateScope.sourcePreference : effectiveSourcePref;
  const displayedCanComputeFromOrders = displayedSnapshot ? displayedSnapshot.canComputeFromOrders : shouldUseAggregate ? true : canComputeFromOrders;
  const displayedCanComputeIdentifiedOrders = displayedSnapshot ? displayedSnapshot.canComputeIdentifiedOrders : shouldUseAggregate ? true : canComputeIdentifiedOrders;
  const displayedHasImported = displayedSnapshot ? displayedSnapshot.hasImported : hasImported;
  const displayedOrderRfmMeta =
    displayedSnapshot
      ? displayedSnapshot.orderRfmMeta
        : shouldUseAggregate && aggregateScope
          ? {
              ordersAttributed: aggregateScope.ordersAttributed,
              guestOrdersSkipped: aggregateScope.guestOrdersSkipped,
            }
        : resolvedSource === 'ecommerce'
        ? {
            ordersAttributed: orderRfm.ordersAttributed,
            guestOrdersSkipped: orderRfm.guestOrdersSkipped,
          }
        : undefined;
  const displayedSegmentMigration =
    displayedSnapshot
      ? displayedSnapshot.segmentMigration
      : shouldUseAggregate && dataAnalysisAggregate
        ? dataAnalysisAggregate.segmentMigration
      : resolvedSource === 'ecommerce'
        ? orderSegmentMigration
        : undefined;
  const displayedSegmentPeriodComparison =
    displayedSnapshot
      ? displayedSnapshot.segmentPeriodComparison
      : shouldUseAggregate && dataAnalysisAggregate
        ? dataAnalysisAggregate.segmentPeriodComparison
      : resolvedSource === 'ecommerce'
        ? orderSegmentPeriodComparison
        : undefined;

  return {
    segments: displayedSegments,
    totalCustomers: displayedTotalCustomers,
    isLoading: displayedSnapshot ? false : isLoading,
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
    segmentPeriodComparison: displayedSegmentPeriodComparison,
    importSegmentsAvailable,
    /** Status του server RFM aggregate — 'running' όσο ξαναχτίζεται (τα segments μένουν τα τελευταία καλά)· null χωρίς aggregate. */
    aggregateStatus: dataAnalysisAggregate?.status ?? null,
    analysisSnapshotSavedAt: displayedSnapshot?.savedAt ?? null,
    analysisSnapshotIsStale: shouldUseStaleSnapshot,
    analysisLastAnalyzedAt:
      displayedSnapshot?.savedAt ??
      (shouldUseAggregate && dataAnalysisAggregate ? dataAnalysisAggregate.latestSyncAt : null),
  };
}

export const __test = { selectAggregateScope, ordersQueryGate, aggregateQueryGate, catalogQueryGate };
