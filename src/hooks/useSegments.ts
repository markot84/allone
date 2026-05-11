import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentCustomersService, SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { fetchAllEcommerceOrders, fetchDataAnalysisOrders, MAX_ORDERS_PER_PLATFORM_RFM } from '../services/ecommerceRawOrders';
import { fetchCatalogAlignmentData, fetchCatalogAlignmentDataForDataAnalysis, normalizeCatalogAlignmentPayload } from '../services/catalogAlignment';
import { computeRfmSegmentsFromEcommerceOrders, computeSegmentMigrationFromEcommerceOrders, type RfmCatalogContext } from '../services/rfmFromOrders';
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
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: rawSegmentCustomerSummaries, isPending: segmentCustomersPending } = useQuery({
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

  const { data: rawOrders = [], isPending: ordersPending, error: ordersError } = useQuery({
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
  const { data: catalogAlignment, isPending: catalogPending } = useQuery({
    queryKey: [catalogQueryKeyPrefix, brandId, platformsKey],
    queryFn: () =>
      brandId
        ? (variant === 'data_analysis'
            ? fetchCatalogAlignmentDataForDataAnalysis(brandId, ecomm.connectedPlatforms)
            : fetchCatalogAlignmentData(brandId, ecomm.connectedPlatforms))
        : Promise.resolve(null),
    enabled: ordersQueryEnabled && !ordersPending,
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
    if (sourcePref === 'external') return importSegmentsAvailable ? 'import' : canComputeFromOrders ? 'ecommerce' : 'none';
    return canComputeFromOrders ? 'ecommerce' : importSegmentsAvailable ? 'import' : 'none';
  }, [sourcePref, canComputeFromOrders, importSegmentsAvailable]);

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
    blocksOnImportedSegmentsOnly || (sourcePref === 'external' && segmentCustomersPending);

  const ordersLoading = ordersQueryEnabled && ordersPending;
  const isCatalogEnriching = ordersQueryEnabled && catalogPending;
  /** True when the orders fetch hit the per-platform limit — RFM is computed from a sample, not full history. */
  const ordersSampled = !ordersPending && ordersQueryEnabled && rawOrders.length >= MAX_ORDERS_PER_PLATFORM_RFM;

  const hasImported =
    resolvedSource === 'ecommerce' ? orderRfm.totalCustomers > 0 : importSegmentsAvailable;

  return {
    segments,
    totalCustomers,
    isLoading,
    /** True όσο τραβάμε πρόσφατο order history για ecommerce RFM — UI δεν πρέπει να μπλοκάρει. */
    ordersLoading,
    ordersError: (ordersError as Error | null) ?? null,
    /** True when orders were capped at MAX_ORDERS_PER_PLATFORM_RFM — data is a sample. */
    ordersSampled,
    /** Φόρτωση *_products + unified products για catalog tabs — δεν μπλοκάρει το κύριο RFM grid. */
    isCatalogEnriching,
    hasImported,
    /** Πραγματική πηγή μετά την επιλογή του χρήστη. */
    dataSource: resolvedSource,
    setDataSourcePreference,
    sourcePreference: sourcePref,
    canComputeFromOrders,
    dataCoverage,
    orderRfmMeta:
      resolvedSource === 'ecommerce'
        ? {
            ordersAttributed: orderRfm.ordersAttributed,
            guestOrdersSkipped: orderRfm.guestOrdersSkipped,
          }
        : undefined,
    segmentMigration: resolvedSource === 'ecommerce' ? orderSegmentMigration : undefined,
    importSegmentsAvailable,
  };
}
