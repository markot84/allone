/**
 * Hook: reads pre-computed RFM data from rfm_computed/{brandId}.
 *
 * Pre-computed data is written by the `computeRFMSegments` Cloud Function
 * after each ERP / e-shop connector sync.
 *
 * Returns converted RFMSegment[] ready for the UI (no behavioral/predictive —
 * those are only available when the client computes from raw orders).
 */
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getSegmentColor } from '../utils/segmentColors';
import type { RFMSegment } from '../types';

/** Max age before pre-computed data is considered stale (25 hours). */
const MAX_PRECOMPUTED_AGE_MS = 25 * 60 * 60 * 1000;

interface RFMSegmentSummary {
  segment: string;
  segmentId: string;
  count: number;
  revenue: number;
  avgOrderValue: number;
  pct: number;
}

type FirestoreTimestampLike = { toDate?: () => Date; seconds?: number } | null;

export interface PreComputedFlow {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  count: number;
  revenue: number;
  sampleCustomerIds: string[];
}

export interface PreComputedSegmentDelta {
  segmentId: string;
  segmentName: string;
  prevCount: number;
  newCount: number;
  countDelta: number;
  prevRevenue: number;
  newRevenue: number;
  revenueDelta: number;
}

interface RFMMigrationDoc {
  comparedAt: FirestoreTimestampLike;
  periodDays: number;
  comparedCustomers: number;
  totalFlowsCount: number;
  flows: PreComputedFlow[];
  segmentDeltas: PreComputedSegmentDelta[];
}

interface RFMComputedDoc {
  brandId: string;
  computedAt: FirestoreTimestampLike;
  dataSource: 'erp' | 'eshop';
  dataSourcePlatforms: string[];
  totalCustomers: number;
  totalOrders: number;
  ordersAttributed: number;
  guestOrdersSkipped: number;
  segments: RFMSegmentSummary[];
  chunkCount: number;
  migration?: RFMMigrationDoc | null;
}

function toDate(v: FirestoreTimestampLike): Date | null {
  if (!v) return null;
  if (typeof v.toDate === 'function') {
    try { return v.toDate(); } catch { return null; }
  }
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}

function summaryToRFMSegment(s: RFMSegmentSummary, totalRevenue: number): RFMSegment {
  const revenueShare = totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 1000) / 10 : 0;
  const seg: RFMSegment = {
    id: s.segmentId,
    name: s.segment,
    rfm_score: '',
    count: s.count,
    percentage: s.pct,
    revenue_share: revenueShare,
    color: '#6B7280',
    description: '',
    icon: '',
  };
  seg.color = getSegmentColor(seg);
  return seg;
}

export interface RFMPreComputedMigration {
  comparedAt: Date | null;
  periodDays: number;
  comparedCustomers: number;
  totalFlowsCount: number;
  flows: PreComputedFlow[];
  segmentDeltas: PreComputedSegmentDelta[];
}

export interface RFMPreComputedResult {
  segments: RFMSegment[];
  isPreComputed: boolean;
  lastComputedAt: Date | null;
  dataSource: 'erp' | 'eshop' | null;
  dataSourcePlatforms: string[];
  totalCustomers: number;
  totalOrders: number;
  isLoading: boolean;
  isStale: boolean;
  migration: RFMPreComputedMigration | null;
}

export function useRFMPreComputed(brandId: string | null): RFMPreComputedResult {
  const { data, isPending } = useQuery({
    queryKey: ['rfm_computed', brandId],
    queryFn: async () => {
      if (!brandId) return null;
      const ref = doc(db, 'rfm_computed', brandId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data() as RFMComputedDoc;
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!data) {
    return {
      segments: [],
      isPreComputed: false,
      lastComputedAt: null,
      dataSource: null,
      dataSourcePlatforms: [],
      totalCustomers: 0,
      totalOrders: 0,
      isLoading: isPending,
      isStale: false,
      migration: null,
    };
  }

  const computedAt = toDate(data.computedAt);
  const ageMs = computedAt ? Date.now() - computedAt.getTime() : Infinity;
  const isStale = ageMs > MAX_PRECOMPUTED_AGE_MS;
  const isPreComputed = !isStale && (data.segments?.length ?? 0) > 0;

  const totalRevenue = (data.segments ?? []).reduce((sum, s) => sum + s.revenue, 0);
  const segments = isPreComputed
    ? (data.segments ?? []).map((s) => summaryToRFMSegment(s, totalRevenue))
    : [];

  const rawMigration = data.migration ?? null;
  const migration: RFMPreComputedMigration | null = rawMigration
    ? {
        comparedAt: toDate(rawMigration.comparedAt),
        periodDays: rawMigration.periodDays ?? 0,
        comparedCustomers: rawMigration.comparedCustomers ?? 0,
        totalFlowsCount: rawMigration.totalFlowsCount ?? 0,
        flows: Array.isArray(rawMigration.flows) ? rawMigration.flows : [],
        segmentDeltas: Array.isArray(rawMigration.segmentDeltas) ? rawMigration.segmentDeltas : [],
      }
    : null;

  return {
    segments,
    isPreComputed,
    lastComputedAt: computedAt,
    dataSource: data.dataSource ?? null,
    dataSourcePlatforms: data.dataSourcePlatforms ?? [],
    totalCustomers: data.totalCustomers ?? 0,
    totalOrders: data.totalOrders ?? 0,
    isLoading: isPending,
    isStale,
    migration,
  };
}
