import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentCustomersService, SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { fetchAllEcommerceOrders, fetchDataAnalysisOrders } from '../services/ecommerceRawOrders';
import { fetchCatalogAlignmentData, fetchCatalogAlignmentDataForDataAnalysis, normalizeCatalogAlignmentPayload } from '../services/catalogAlignment';
import { computeRfmSegmentsFromEcommerceOrders, computeSegmentMigrationFromEcommerceOrders, type RfmCatalogContext, type SegmentMigrationResult } from '../services/rfmFromOrders';
import { useRFMPreComputed, type RFMPreComputedMigration, type RFMPrecomputedVariant } from './useRFMPreComputed';
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

/**
 * Convert server pre-computed migration to the SegmentMigrationResult shape that
 * the RFM UI components already consume. We derive `percentage` from
 * `comparedCustomers` so the value matches the existing client-side semantics
 * (% of compared cohort that moved through this flow).
 */
function preComputedMigrationToResult(m: RFMPreComputedMigration): SegmentMigrationResult {
  const compared = m.comparedCustomers || 0;
  const flows = m.flows
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((flow) => ({
      from: flow.from,
      fromName: flow.fromName,
      to: flow.to,
      toName: flow.toName,
      count: flow.count,
      revenue: flow.revenue,
      percentage: compared > 0 ? Math.round((flow.count / compared) * 1000) / 10 : 0,
    }));
  return {
    periodDays: m.periodDays || 0,
    comparedCustomers: compared,
    flows,
    canCompute: (m.totalFlowsCount ?? 0) > 0 && flows.length > 0,
    comparedAt: m.comparedAt,
  };
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
    if (brandId) setSourcePrefState(getStoredRfmSource(brandId));
  }, [brandId]);

  const setDataSourcePreference = useCallback(
    (next: RfmDataSourcePreference) => {
      if (brandId) setStoredRfmSource(brandId, next);
      setSourcePrefState(next);
    },
    [brandId]
  );

  /** Dual-variant server RFM — pick slice from user source preference. */
  const preRf = useRFMPreComputed(brandId);
  const preActive = sourcePref === 'external' ? preRf.merged : preRf.orders;
  const preOrders = preRf.orders;

  /**
   * Server variant for the active source has fresh pre-computed RFM + customer chunks.
   * When true, skip client-side order/catalog fetch for RFM (authoritative server slices).
   */
  const serverVariantReady =
    !preRf.isLoading &&
    preActive.isPreComputed &&
    (preActive.segmentDocCount > 0 || preActive.segments.length > 0);

  const usePreComputedActive = serverVariantReady;

  const { data: firestoreSegments = [], isPending: fsPending } = useQuery({
    queryKey: ['segments', brandId],
    queryFn: () => (brandId ? SegmentsService.getAll(brandId) : Promise.resolve([])) as Promise<RFMSegment[]>,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: rawSegmentCustomerSummaries, isPending: segmentCustomersPending } = useQuery({
    queryKey: ['segmentCustomerSummaries', brandId],
    queryFn: () => (brandId ? SegmentCustomersService.getSummariesBySegment(brandId) : Promise.resolve(new Map())),
    enabled: !!brandId && sourcePref === 'external' && serverVariantReady,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const segmentCustomerSummaries = useMemo(
    () => coerceToSegmentSummaryMap(rawSegmentCustomerSummaries),
    [rawSegmentCustomerSummaries]
  );

  /** True when per-segment behavioral subdocs exist for the active variant. */
  const hasServerBehavioralDocs = usePreComputedActive && preActive.segmentDocCount > 0;

  /**
   * Client-side order + catalog fetch (όλο το εύρος ημερομηνιών μέσω σελιδοποίησης Firestore) —
   * fallback όταν δεν υπάρχει έγκυρο server `rfm_computed` για την ενεργή πηγή.
   * Η σελίδα Data Analysis (`variant: 'data_analysis'`) δεν χρησιμοποιεί αυτό το fallback· εκεί το RFM
   * είναι αποκλειστικά server-side.
   */
  const allowClientOrdersRfmFallback = variant !== 'data_analysis';

  /**
   * «e-shop & others» must never show raw imported Firestore counts as the RFM grid — only merged
   * `rfm_computed/.../variants/merged`. Until then, skip orders/catalog fetch (no misleading pills).
   */
  const ordersQueryEnabled =
    allowClientOrdersRfmFallback &&
    !preRf.isLoading &&
    !serverVariantReady &&
    sourcePref !== 'external' &&
    !!brandId &&
    ecomm.connectedPlatforms.length > 0;
  const ordersSinceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RFM_ORDER_FETCH_WINDOW_DAYS);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);
  const ordersQueryKeyPrefix = variant === 'data_analysis' ? 'dataAnalysisOrdersRaw' : 'ecommerceOrdersRaw';
  const catalogQueryKeyPrefix = variant === 'data_analysis' ? 'catalogAlignmentDataAnalysis' : 'catalogAlignment';

  const {
    data: rawOrders = [],
    isPending: ordersPending,
    isFetching: ordersFetching,
    error: ordersError,
  } = useQuery({
    queryKey: [ordersQueryKeyPrefix, brandId, platformsKey, ordersSinceDate],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, { sinceDate: ordersSinceDate })
            : fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, { sinceDate: ordersSinceDate }))
        : Promise.resolve([]),
    enabled: ordersQueryEnabled,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  /** Μετά τις παραγγελίες ώστε να μην «δένει» το UI σε διπλό βαρύ parallel fetch· τα segments εμφανίζονται χωρίς catalog enrichment. */
  const {
    data: catalogAlignment,
    isFetching: catalogFetching,
  } = useQuery({
    queryKey: [catalogQueryKeyPrefix, brandId, platformsKey],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchCatalogAlignmentDataForDataAnalysis(brandId, ecomm.connectedPlatforms)
            : fetchCatalogAlignmentData(brandId, ecomm.connectedPlatforms))
        : Promise.resolve(null),
    enabled: ordersQueryEnabled && !ordersFetching,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const catalogContext: RfmCatalogContext | null = useMemo(() => {
    const normalized = normalizeCatalogAlignmentPayload(catalogAlignment ?? null);
    if (!normalized) return null;
    return { indexes: normalized.indexes, erpBySku: normalized.erpBySku };
  }, [catalogAlignment]);

  const orderRfm = useMemo(
    () => computeRfmSegmentsFromEcommerceOrders(rawOrders, catalogContext),
    [rawOrders, catalogContext]
  );
  const orderSegmentMigration = useMemo(() => computeSegmentMigrationFromEcommerceOrders(rawOrders, 30), [rawOrders]);

  const canComputeFromOrders = orderRfm.canCompute;
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
    if (usePreComputedActive && sourcePref === 'external') return 'import';
    if (sourcePref === 'external') return 'none';
    if (sourcePref === 'orders' && ordersQueryEnabled && ordersPending && !canComputeFromOrders) return 'none';
    return canComputeFromOrders ? 'ecommerce' : importSegmentsAvailable ? 'import' : 'none';
  }, [
    usePreComputedActive,
    sourcePref,
    canComputeFromOrders,
    importSegmentsAvailable,
    ordersQueryEnabled,
    ordersPending,
  ]);

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
    const eShopCustomers = orderRfm.totalCustomers;
    const usesExternalPolicy = sourcePref === 'external' && externalTotalCustomers > 0;
    const usesConnectorRfm = usesExternalPolicy && externalSegments.some((s) => String((s as RFMSegment & { source?: string }).source || '').endsWith('_rfm'));
    const fullBase = usesExternalPolicy
      ? usesConnectorRfm
        ? eShopCustomers + externalTotalCustomers
        : Math.max(externalTotalCustomers, eShopCustomers)
      : eShopCustomers;
    const otherCustomers = usesExternalPolicy && usesConnectorRfm
      ? externalTotalCustomers
      : Math.max(0, fullBase - eShopCustomers);
    const eShopPenetration = fullBase > 0 ? Math.round((eShopCustomers / fullBase) * 1000) / 10 : 0;
    const policyLabel = usesExternalPolicy ? 'e-shop & others' : 'e-shop orders';
    const marketingPolicy =
      usesExternalPolicy
        ? 'Χρησιμοποιεί ευρύτερο πελατολόγιο από e-shop και ERP/other πηγές. Οι προτάσεις πρέπει να λαμβάνουν υπόψη ότι μέρος του κοινού επηρεάζεται ψηφιακά αλλά μπορεί να αγοράζει offline.'
        : 'Χρησιμοποιεί μόνο αναγνωρίσιμους e-shop αγοραστές. Οι προτάσεις μπορούν να δίνουν μεγαλύτερη έμφαση σε performance, retargeting, CRM και online conversion.';
    return {
      sourcePreference: sourcePref,
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
  }, [sourcePref, resolvedSource, orderRfm.totalCustomers, externalTotalCustomers, externalSegments]);

  /**
   * Μην μπλοκάρεις RFM όσο περιμένεις «άδεια» segments αν το brand έχει e-shop.
   * Το `ordersLoading` αντιστοιχεί μόνο στο ενεργό pipeline παραγγελιών (`ordersQueryEnabled`).
   * Μπλοκ μόνο για import-only (όχι connectors) ή external preference (segment_customers).
   */
  const ecommReady = !ecomm.isLoading;
  const blocksOnImportedSegmentsOnly =
    fsPending &&
    ecommReady &&
    ecomm.connectedPlatforms.length === 0 &&
    !ecomm.hasData;
  const isLoading =
    blocksOnImportedSegmentsOnly ||
    (sourcePref === 'external' && segmentCustomersPending && !usePreComputedActive);

  // When pre-computed data is available for the selected source, use that variant's Firestore slice.
  // (Removed duplicate usePreComputedActive — unified with serverVariantReady above.)

  /** Orders/catalog pipelines run only when `ordersQueryEnabled` — mutually exclusive with server-ready path after `preRf` resolves. */
  const ordersLoading = ordersQueryEnabled && ordersFetching;
  const isCatalogEnriching = ordersQueryEnabled && catalogFetching;

  const hasImported = useMemo(() => {
    if (usePreComputedActive) {
      return preActive.totalCustomers > 0 || preActive.segments.length > 0;
    }
    if (sourcePref === 'external') {
      return false;
    }
    if (resolvedSource === 'none') return false;
    if (resolvedSource === 'ecommerce') return orderRfm.totalCustomers > 0;
    return importSegmentsAvailable;
  }, [
    usePreComputedActive,
    sourcePref,
    resolvedSource,
    preActive.totalCustomers,
    preActive.segments.length,
    orderRfm.totalCustomers,
    importSegmentsAvailable,
  ]);

  const preComputedLoading = preRf.isLoading;

  /**
   * When false, RFM headline KPIs / segment grid should show placeholders.
   * Waits for both order history and catalog alignment while the client pipeline runs (incl. refetch & persisted cache).
   */
  const clientRfmPipelineBusy =
    sourcePref === 'orders' && ordersQueryEnabled && (ordersFetching || catalogFetching);
  const rfmPresentationReady = !preRf.isLoading && (usePreComputedActive || !clientRfmPipelineBusy);

  /**
   * When pre-computed RFM is the active source we still want the segment detail panel to show
   * brand / subcategory / SKU affinities — those come from client-side `orderRfm` (computed once
   * raw orders + catalog arrive in the background). Merge by `segmentId` so counts/colors stay
   * authoritative from pre-computed while behavioral/predictive/customers are enriched lazily.
   */
  const orderRfmBySegmentId = useMemo(() => {
    const m = new Map<string, RFMSegment>();
    for (const s of orderRfm.segments) m.set(s.id, s);
    return m;
  }, [orderRfm.segments]);

  const activeSegments = useMemo<RFMSegment[]>(() => {
    if (!usePreComputedActive) return segments;
    if (orderRfmBySegmentId.size === 0) return preActive.segments;
    return preActive.segments.map((s) => {
      const enriched = orderRfmBySegmentId.get(s.id);
      if (!enriched) return s;
      return {
        ...s,
        behavioral: enriched.behavioral,
        predictive: enriched.predictive,
        customers: enriched.customers,
      };
    });
  }, [usePreComputedActive, segments, preActive.segments, orderRfmBySegmentId]);
  const activeTotalCustomers = usePreComputedActive ? preActive.totalCustomers : totalCustomers;

  // Override dataCoverage when pre-computed data is the active source — old client-side coverage
  // only sees imported segments + (skipped) orderRfm and reports incorrect counts.
  const activeDataCoverage = useMemo<SegmentDataCoverage>(() => {
    if (!usePreComputedActive) return dataCoverage;
    if (sourcePref === 'external') {
      const usesConnectorRfm = externalSegments.some((s) =>
        String((s as RFMSegment & { source?: string }).source || '').endsWith('_rfm')
      );
      const eShopCustomers = preOrders.totalCustomers;
      const fullBase = usesConnectorRfm
        ? eShopCustomers + externalTotalCustomers
        : Math.max(externalTotalCustomers, preActive.totalCustomers);
      const otherCustomers =
        usesConnectorRfm
          ? externalTotalCustomers
          : Math.max(0, fullBase - eShopCustomers);
      const eShopPenetration = fullBase > 0 ? Math.round((eShopCustomers / fullBase) * 1000) / 10 : 0;
      return {
        sourcePreference: sourcePref,
        activeSource: 'import',
        eShopCustomers,
        totalCustomers: fullBase,
        otherCustomers,
        eShopPenetration,
        hasEshopOrders: eShopCustomers > 0,
        hasExternalData: externalTotalCustomers > 0 || preActive.totalCustomers > eShopCustomers,
        policyLabel: 'e-shop & others',
        marketingPolicy:
          'Χρησιμοποιεί ευρύτερο πελατολόγιο από e-shop και ERP/other πηγές. Οι προτάσεις πρέπει να λαμβάνουν υπόψη ότι μέρος του κοινού επηρεάζεται ψηφιακά αλλά μπορεί να αγοράζει offline.',
      };
    }
    const isErp = preOrders.dataSource === 'erp';
    const eShopCustomers = isErp ? 0 : preOrders.totalCustomers;
    const otherCustomers = isErp ? preOrders.totalCustomers : externalTotalCustomers;
    const total = preOrders.totalCustomers + (isErp ? 0 : externalTotalCustomers);
    const eShopPenetration = total > 0 ? Math.round((eShopCustomers / total) * 1000) / 10 : 0;
    return {
      sourcePreference: sourcePref,
      activeSource: 'ecommerce',
      eShopCustomers,
      totalCustomers: total,
      otherCustomers,
      eShopPenetration,
      hasEshopOrders: !isErp && preOrders.totalCustomers > 0,
      hasExternalData: isErp || externalTotalCustomers > 0,
      policyLabel: isErp || externalTotalCustomers > 0 ? 'e-shop & others' : 'e-shop orders',
      marketingPolicy:
        isErp
          ? 'Χρησιμοποιεί δεδομένα από ERP (Megaventory/SoftOne). Καλύπτει όλο το πελατολόγιο της επιχείρησης, συμπεριλαμβανομένων και offline αγορών.'
          : externalTotalCustomers > 0
          ? 'Χρησιμοποιεί ευρύτερο πελατολόγιο από e-shop και ERP/other πηγές. Οι προτάσεις πρέπει να λαμβάνουν υπόψη ότι μέρος του κοινού επηρεάζεται ψηφιακά αλλά μπορεί να αγοράζει offline.'
          : 'Χρησιμοποιεί μόνο αναγνωρίσιμους e-shop αγοραστές. Οι προτάσεις μπορούν να δίνουν μεγαλύτερη έμφαση σε performance, retargeting, CRM και online conversion.',
    };
  }, [
    usePreComputedActive,
    sourcePref,
    preOrders.dataSource,
    preOrders.totalCustomers,
    preActive.totalCustomers,
    dataCoverage,
    externalTotalCustomers,
    externalSegments,
  ]);

  // With pre-computed data, the toggle (orders vs external) should still be available
  // when both pre-computed orders AND imported segments exist.
  const activeCanComputeFromOrders = preOrders.isPreComputed
    ? preOrders.totalCustomers > 0
    : canComputeFromOrders;

  return {
    segments: activeSegments,
    totalCustomers: activeTotalCustomers,
    isLoading,
    /** True όσο τραβάμε πρόσφατο order history για ecommerce RFM — UI δεν πρέπει να μπλοκάρει. */
    ordersLoading,
    ordersError: (ordersError as Error | null) ?? null,
    /** Φόρτωση *_products + unified products για catalog tabs — δεν μπλοκάρει το κύριο RFM grid. */
    isCatalogEnriching,
    hasImported,
    /** Πραγματική πηγή μετά την επιλογή του χρήστη. */
    dataSource: resolvedSource,
    setDataSourcePreference,
    sourcePreference: sourcePref,
    canComputeFromOrders: activeCanComputeFromOrders,
    dataCoverage: activeDataCoverage,
    orderRfmMeta:
      usePreComputedActive
        ? {
            ordersAttributed: 0,
            guestOrdersSkipped: 0,
          }
        : resolvedSource === 'ecommerce'
        ? {
            ordersAttributed: orderRfm.ordersAttributed,
            guestOrdersSkipped: orderRfm.guestOrdersSkipped,
          }
        : undefined,
    segmentMigration: usePreComputedActive && preActive.migration
      ? preComputedMigrationToResult(preActive.migration)
      : resolvedSource === 'ecommerce' ? orderSegmentMigration : undefined,
    importSegmentsAvailable,
    /** True when reading from server pre-computed RFM (Cloud Function). */
    isPreComputed: usePreComputedActive,
    /** Timestamp of the last server-side RFM computation. */
    lastComputedAt: preActive.lastComputedAt,
    /** Data source used for pre-computed RFM (active variant). */
    preComputedDataSource: preActive.dataSource,
    /** Platforms used for pre-computed RFM (active variant). */
    preComputedPlatforms: preActive.dataSourcePlatforms,
    /**
     * True when the server has pre-computed per-segment behavioral docs available.
     * The UI should then load segment detail from `rfm_computed/{brandId}/segments/{segmentId}`
     * (via {@link useRFMSegmentBehavioral}) rather than computing client-side from raw orders.
     */
    serverBehavioralAvailable: hasServerBehavioralDocs,
    /** Firestore path variant for the active source (`orders` vs `merged`). */
    preComputedVariant: (sourcePref === 'external' ? 'merged' : 'orders') as RFMPrecomputedVariant,
    /** Merged variant only: no import cohort was available server-side — same as orders. */
    mergedFallbackToOrders: sourcePref === 'external' ? preRf.merged.mergedFallbackToOrders : undefined,
    /** True while Firestore `rfm_computed` bundle (orders + merged variants) is loading. */
    preComputedLoading,
    /** False → show skeleton placeholders for authoritative RFM numbers / grid. */
    rfmPresentationReady,
  };
}
