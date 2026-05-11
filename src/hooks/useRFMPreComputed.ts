/**
 * Hook: reads pre-computed RFM data from rfm_computed/{brandId}.
 *
 * Pre-computed data is written by the `computeRFMSegments` Cloud Function
 * after each ERP / e-shop connector sync.
 *
 * Returns converted RFMSegment[] ready for the UI. Per-segment behavioral
 * data lives in `rfm_computed/{brandId}/segments/{segmentId}` and is fetched
 * on-demand via {@link useRFMSegmentBehavioral}.
 */
import { useQuery } from '@tanstack/react-query';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getSegmentColor } from '../utils/segmentColors';
import type { BehavioralProfile, CategoryAffinity, RFMSegment, SegmentCustomer } from '../types';

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
  segmentDocCount?: number;
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
  /** Number of per-segment behavioral docs written by the server (0 = no per-segment data yet). */
  segmentDocCount: number;
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
      segmentDocCount: 0,
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
    segmentDocCount: data.segmentDocCount ?? 0,
  };
}

// ─── Per-segment behavioral hook ────────────────────────────────────────────

interface ServerAffinityRow {
  name: string;
  affinity: number;
  avg_order: number;
  revenue_eur: number;
  revenue_share_pct: number;
  stock_on_hand?: number;
  qty_sold?: number;
  category_path?: string[];
}

interface ServerPreferredChannel {
  channel: string;
  orders: number;
  revenue: number;
  share_pct: number;
}

interface ServerBehavioralData {
  catalog_match: {
    revenue_matched_pct: number;
    lines_matched_pct: number;
    lines_total: number;
    lines_matched: number;
  } | null;
  brand_affinity: ServerAffinityRow[];
  category_affinity: ServerAffinityRow[];
  category_affinity_catalog: ServerAffinityRow[];
  subcategory_affinity: ServerAffinityRow[];
  sku_affinity: ServerAffinityRow[];
  price_sensitivity: 'low' | 'medium' | 'high' | null;
  preferred_channels: ServerPreferredChannel[];
}

interface RFMSegmentBehavioralDoc {
  brandId: string;
  segmentId: string;
  segmentName: string;
  behavioral: ServerBehavioralData;
}

/**
 * Converts the server-side per-segment behavioral doc into the
 * `BehavioralProfile` shape that the UI components consume.
 * Returns `null` when server has no useful data (no line items, no channels).
 */
function serverBehavioralToProfile(data: ServerBehavioralData): Partial<BehavioralProfile> | null {
  const hasAnything =
    data.catalog_match != null ||
    data.brand_affinity?.length > 0 ||
    data.category_affinity?.length > 0 ||
    data.subcategory_affinity?.length > 0 ||
    data.sku_affinity?.length > 0 ||
    data.preferred_channels?.length > 0;
  if (!hasAnything) return null;

  const toAffinity = (rows: ServerAffinityRow[] | undefined): CategoryAffinity[] =>
    (rows ?? []).map((r) => ({
      name: r.name,
      affinity: r.affinity,
      avg_order: r.avg_order,
      revenue_eur: r.revenue_eur,
      revenue_share_pct: r.revenue_share_pct,
      ...(r.stock_on_hand != null ? { stock_on_hand: r.stock_on_hand } : {}),
      ...(r.qty_sold != null ? { qty_sold: r.qty_sold } : {}),
      ...(r.category_path?.length ? { category_path: r.category_path } : {}),
    }));

  const channelLabels = (data.preferred_channels ?? []).map((c) => c.channel);

  return {
    category_affinity: toAffinity(data.category_affinity),
    category_affinity_catalog: toAffinity(data.category_affinity_catalog),
    brand_affinity: toAffinity(data.brand_affinity),
    subcategory_affinity: toAffinity(data.subcategory_affinity),
    sku_affinity: toAffinity(data.sku_affinity),
    ...(data.catalog_match ? { catalog_match: data.catalog_match } : {}),
    ...(data.price_sensitivity ? { price_sensitivity: data.price_sensitivity } : {}),
    ...(channelLabels.length > 0 ? { preferred_channels: channelLabels } : {}),
  };
}

export interface RFMSegmentBehavioralResult {
  /** UI-shaped `BehavioralProfile` (partial) ready to merge into a segment. */
  behavioral: Partial<BehavioralProfile> | null;
  isLoading: boolean;
  exists: boolean;
}

interface ServerRFMCustomer {
  customerId: string;
  email?: string;
  segmentId: string;
  rfmScore: string;
  recencyScore?: number;
  frequencyScore?: number;
  monetaryScore?: number;
  daysSinceLastOrder?: number;
  orderCount?: number;
  totalRevenue?: number;
}

/**
 * Loads the full per-customer list from `rfm_computed/{brandId}/chunks/*` and groups by segment.
 * Used by exports when the client-side raw-orders fetch is skipped (server pre-computed path).
 *
 * Returns an empty map when no chunks are present (e.g. brand without pre-computed RFM yet).
 */
export async function loadPreComputedCustomersBySegment(
  brandId: string
): Promise<Map<string, SegmentCustomer[]>> {
  const chunksColl = collection(db, 'rfm_computed', brandId, 'chunks');
  const snap = await getDocs(chunksColl);
  const out = new Map<string, SegmentCustomer[]>();
  for (const docSnap of snap.docs) {
    const json = docSnap.get('customersJson');
    if (typeof json !== 'string' || !json) continue;
    let parsed: ServerRFMCustomer[];
    try {
      parsed = JSON.parse(json) as ServerRFMCustomer[];
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const c of parsed) {
      if (!c?.segmentId) continue;
      const list = out.get(c.segmentId) ?? [];
      list.push({
        customerId: c.customerId,
        ...(c.email ? { email: c.email } : {}),
        ...(c.daysSinceLastOrder != null ? { recency: c.daysSinceLastOrder } : {}),
        ...(c.orderCount != null ? { frequency: c.orderCount } : {}),
        ...(c.totalRevenue != null ? { monetary: c.totalRevenue } : {}),
        ...(c.rfmScore ? { rfmScore: c.rfmScore } : {}),
      });
      out.set(c.segmentId, list);
    }
  }
  return out;
}

/**
 * Reads per-segment behavioral data from `rfm_computed/{brandId}/segments/{segmentId}`.
 * Returns `null` behavioral when the segment doc doesn't exist (e.g. ERP-only brand
 * without line items, or older snapshots written before server-side rollups).
 */
export function useRFMSegmentBehavioral(
  brandId: string | null,
  segmentId: string | null
): RFMSegmentBehavioralResult {
  const { data, isPending } = useQuery({
    queryKey: ['rfm_segment_behavioral', brandId, segmentId],
    queryFn: async () => {
      if (!brandId || !segmentId) return null;
      const ref = doc(db, 'rfm_computed', brandId, 'segments', segmentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return snap.data() as RFMSegmentBehavioralDoc;
    },
    enabled: !!brandId && !!segmentId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!data) {
    return { behavioral: null, isLoading: isPending, exists: false };
  }
  return {
    behavioral: serverBehavioralToProfile(data.behavioral),
    isLoading: false,
    exists: true,
  };
}
