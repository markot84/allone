import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentCustomersService, SegmentsService } from '../services/firestore';
import { mergeDuplicateSegmentRowsByName } from '../utils/mergeDuplicateSegments';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import { useEcommerceSummary } from './useEcommerceSummary';
import { fetchAllEcommerceOrders } from '../services/ecommerceRawOrders';
import { fetchCatalogAlignmentData, normalizeCatalogAlignmentPayload } from '../services/catalogAlignment';
import { computeRfmSegmentsFromEcommerceOrders, computeSegmentMigrationFromEcommerceOrders, type RfmCatalogContext } from '../services/rfmFromOrders';
import type { RFMSegment } from '../types';

const STORAGE_KEY = (brandId: string) => `pp-rfm-data-source-${brandId}`;

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

export function useSegments() {
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
    queryFn: () => (brandId ? SegmentsService.getAll(brandId, { forceServer: true }) : Promise.resolve([])) as Promise<RFMSegment[]>,
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

  const ordersQueryEnabled = !!brandId && ecomm.connectedPlatforms.length > 0;
  const { data: rawOrders = [], isPending: ordersPending } = useQuery({
    queryKey: ['ecommerceOrdersRaw', brandId, platformsKey],
    queryFn: () => (brandId ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms) : Promise.resolve([])),
    enabled: ordersQueryEnabled,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /** Μετά τις παραγγελίες ώστε να μην «δένει» το UI σε διπλό βαρύ parallel fetch· τα segments εμφανίζονται χωρίς catalog enrichment. */
  const { data: catalogAlignment, isPending: catalogPending } = useQuery({
    queryKey: ['catalogAlignment', brandId, platformsKey],
    queryFn: () => (brandId ? fetchCatalogAlignmentData(brandId, ecomm.connectedPlatforms) : Promise.resolve(null)),
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

  /** Όχι catalogPending: μεγάλα brand catalogs θα κρατούσαν αόριστα το spinner· το enrichment είναι progressive. */
  const isLoading =
    fsPending ||
    (sourcePref === 'external' && segmentCustomersPending) ||
    (ordersQueryEnabled && ordersPending);

  const isCatalogEnriching = ordersQueryEnabled && catalogPending;

  const hasImported =
    resolvedSource === 'ecommerce' ? orderRfm.totalCustomers > 0 : importSegmentsAvailable;

  return {
    segments,
    totalCustomers,
    isLoading,
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
