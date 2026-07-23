import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import type { EcommerceExclusionReason, EcommerceSalesChannel } from '../services/ecommerceSalesChannel';

export interface EcommerceTopProduct {
  sku: string;
  name: string;
  revenue: number;
  quantity: number;
}

export interface EcommerceRecentOrder {
  orderId: string;
  orderName?: string;
  platform: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  paymentMethod?: string;
  shippingMethod?: string;
  salesChannel?: EcommerceSalesChannel;
  revenueIncluded?: boolean;
  exclusionReason?: EcommerceExclusionReason;
}

export interface PlatformBreakdown {
  revenue: number;
  orders: number;
}

interface EcommerceSummaryRaw {
  totalRevenue: number;
  orderCount: number;
  aov: number;
  revenueByDay: Record<string, number>;
  revenueByMonth: Record<string, number>;
  revenueByPlatform: Record<string, PlatformBreakdown>;
  revenueBySalesChannel?: Record<string, number>;
  ordersBySalesChannel?: Record<string, number>;
  includedRevenueBySalesChannel?: Record<string, number>;
  includedOrdersBySalesChannel?: Record<string, number>;
  excludedRevenueByReason?: Record<string, number>;
  excludedOrdersByReason?: Record<string, number>;
  topProducts: EcommerceTopProduct[];
  /** Marketplace-inclusive valid orders per day (e.g. direct e-shop + Skroutz). */
  allOrdersByDay?: Record<string, number>;
  ordersByDay: Record<string, number>;
  recentOrders: EcommerceRecentOrder[];
  connectedPlatforms: string[];
  skuStats?: Record<string, {
    stock: number;
    sold: number;
    sold7d?: number;
    sold30d?: number;
    sold90d?: number;
    lastSaleAt?: string | null;
  }>;
  skuStatsJson?: string;
  skuStatsCount?: number;
  /** Stock movement (global — works for all brands regardless of connector) */
  skuMovementJson?: string;
  /** Parsed movement map (client-only) — avoids the stringify→parse round-trip. */
  skuMovement?: SkuMovementMap;
  skuMovementCount?: number;
  stockMovementBaselineDate?: string | null;
  stockMovementUpdatedAt?: any;
  syncedAt: any;
}

interface StockMovementRaw {
  skuMovementJson?: string;
  stockMovementChunkCount?: number;
  skuMovementCount?: number;
  stockMovementBaselineDate?: string | null;
  stockMovementUpdatedAt?: any;
}

type SkuStatsMap = Record<
  string,
  {
    stock: number; sold: number; sold7d?: number; sold30d?: number; sold90d?: number; lastSaleAt?: string | null;
    /** Gross/returns split — present only when the ERP backend signs credit notes (Megaventory). */
    soldPos?: number; soldNeg?: number;
    soldPos7d?: number; soldNeg7d?: number;
    soldPos30d?: number; soldNeg30d?: number;
    soldPos90d?: number; soldNeg90d?: number;
  }
>;

export type ErpVelocityMap = SkuStatsMap;

/** All-channel ERP per-SKU velocity (erp_sku_velocity chunks) — carries the ± sales split.
 * Separate hook so only surfaces that need it (Commercial Strategy) pay the read. */
export function useErpSkuVelocity() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { data } = useQuery({
    queryKey: ['erp_sku_velocity', brandId],
    queryFn: () => (brandId ? fetchSkuStatsFromChunks(brandId, 'erp_sku_velocity') : Promise.resolve({} as SkuStatsMap)),
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!brandId,
  });
  return data ?? {};
}

export type SkuMovementMap = Record<
  string,
  { dec7d?: number; dec30d?: number; dec90d?: number }
>;

function parseSkuStats(raw: EcommerceSummaryRaw | null | undefined): SkuStatsMap {
  if (!raw) return {};
  if (raw.skuStatsJson) {
    try {
      return JSON.parse(raw.skuStatsJson) as SkuStatsMap;
    } catch {
      return {};
    }
  }
  return raw.skuStats ?? {};
}

/** Reads the chunked `sku_stats/{brandId}` collection into a merged map; empty for legacy `skuStatsJson` docs (summary's `parseSkuStats` handles fallback). */
/** Macrotask yield so the main thread can breathe between chunk parses. */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function fetchSkuStatsFromChunks(brandId: string, collectionName = 'sku_stats'): Promise<SkuStatsMap> {
  try {
    const chunksSnap = await getDocs(collection(db, collectionName, brandId, 'chunks'));
    if (chunksSnap.empty) return {};
    const merged: SkuStatsMap = {};
    // Parse each chunk (~900KB) in a separate task with a yield between — a single
    // JSON.parse of 2-5MB blocked the main thread for seconds.
    const docs = chunksSnap.docs;
    for (let i = 0; i < docs.length; i++) {
      const data = docs[i].data() as { skuStatsJson?: string };
      if (data.skuStatsJson) {
        try {
          const partial = JSON.parse(data.skuStatsJson);
          if (partial && typeof partial === 'object') {
            for (const k of Object.keys(partial)) {
              if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
              merged[k] = (partial as SkuStatsMap)[k];
            }
          }
        } catch {
          // ignore corrupt chunk
        }
      }
      if (i < docs.length - 1) await yieldToMain();
    }
    return merged;
  } catch {
    return {};
  }
}

async function fetchSkuMovementFromChunks(brandId: string): Promise<SkuMovementMap> {
  try {
    const chunksSnap = await getDocs(collection(db, 'stock_movement', brandId, 'chunks'));
    if (chunksSnap.empty) return {};
    const merged: SkuMovementMap = {};
    // Yield between chunks (see fetchSkuStatsFromChunks).
    const docs = chunksSnap.docs.slice().sort((a, b) => Number(a.id) - Number(b.id));
    for (let i = 0; i < docs.length; i++) {
      const data = docs[i].data() as { skuMovementJson?: string };
      if (data.skuMovementJson) {
        try {
          Object.assign(merged, JSON.parse(data.skuMovementJson) as SkuMovementMap);
        } catch {
          // ignore corrupt chunk
        }
      }
      if (i < docs.length - 1) await yieldToMain();
    }
    return merged;
  } catch {
    return {};
  }
}

function parseSkuMovement(raw: EcommerceSummaryRaw | null | undefined): SkuMovementMap {
  // Prefer the already-parsed map (from chunks) to skip the stringify+parse round-trip over
  // ~44k entries; legacy inline json stays as fallback.
  if (raw?.skuMovement) return raw.skuMovement;
  if (!raw?.skuMovementJson) return {};
  try {
    return JSON.parse(raw.skuMovementJson) as SkuMovementMap;
  } catch {
    return {};
  }
}

export async function fetchEcommerceSummary(
  brandId: string,
  options?: { includeSkuDetails?: boolean; includeStockMovement?: boolean }
): Promise<EcommerceSummaryRaw | null> {
  const includeSkuDetails = options?.includeSkuDetails !== false;
  const includeStockMovement = options?.includeStockMovement !== false;
  const [summarySnap, movementSnap, chunkedSkuStats, chunkedSkuMovement] = await Promise.all([
    getDoc(doc(db, 'ecommerce_summary', brandId)),
    includeStockMovement ? getDoc(doc(db, 'stock_movement', brandId)) : Promise.resolve(null),
    includeSkuDetails ? fetchSkuStatsFromChunks(brandId) : Promise.resolve({} as SkuStatsMap),
    includeStockMovement ? fetchSkuMovementFromChunks(brandId) : Promise.resolve({} as SkuMovementMap),
  ]);
  if (!summarySnap.exists()) return null;
  const summary = summarySnap.data() as EcommerceSummaryRaw;

  /** New layout `sku_stats/{brandId}/chunks/*`: the old inline `skuStatsJson` in the summary doc
   * exceeded the Firestore 1 MiB limit for large catalogs → doc read failed → empty UI. */
  const merged: EcommerceSummaryRaw = {
    ...summary,
    ...(Object.keys(chunkedSkuStats).length > 0
      ? { skuStats: chunkedSkuStats, skuStatsJson: undefined }
      : {}),
  };

  if (!movementSnap?.exists()) return merged;
  const movement = movementSnap.data() as StockMovementRaw;
  return {
    ...merged,
    // Keep the parsed map directly when it comes from chunks — no stringify+parse round-trip;
    // legacy inline json stays as fallback for old docs.
    ...(Object.keys(chunkedSkuMovement).length > 0
      ? { skuMovement: chunkedSkuMovement, skuMovementJson: undefined }
      : { skuMovementJson: movement.skuMovementJson ?? merged.skuMovementJson }),
    skuMovementCount: movement.skuMovementCount ?? merged.skuMovementCount,
    stockMovementBaselineDate: movement.stockMovementBaselineDate ?? merged.stockMovementBaselineDate,
    stockMovementUpdatedAt: movement.stockMovementUpdatedAt ?? merged.stockMovementUpdatedAt,
  };
}

export function useEcommerceSummary(options?: { includeSkuDetails?: boolean; includeStockMovement?: boolean }) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const includeSkuDetails = options?.includeSkuDetails !== false;
  const includeStockMovement = options?.includeStockMovement !== false;
  const { data, isPending } = useQuery({
    queryKey: ['ecommerce_summary', brandId, includeSkuDetails ? 'sku' : 'summary', includeStockMovement ? 'movement' : 'no_movement'],
    queryFn: () => (brandId ? fetchEcommerceSummary(brandId, { includeSkuDetails, includeStockMovement }) : Promise.resolve(null)),
    /** After sync, invalidateQueries refreshes; here we avoid refetch on every mount/focus. */
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    enabled: !!brandId,
  });

  const dailyRevenue = useMemo(() => {
    if (!data?.revenueByDay) return [];
    return Object.entries(data.revenueByDay)
      .filter(([d]) => d !== 'unknown')
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const monthlyRevenue = useMemo(() => {
    if (!data?.revenueByMonth) return [];
    return Object.entries(data.revenueByMonth)
      .filter(([m]) => m !== 'unknown')
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  const platformBreakdown = useMemo(() => {
    if (!data?.revenueByPlatform) return [];
    return Object.entries(data.revenueByPlatform)
      .filter(([, v]) => (v?.orders ?? 0) > 0)
      .map(([platform, v]) => ({ platform, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [data]);

  const skuStats = useMemo(() => parseSkuStats(data), [data]);
  const skuMovement = useMemo(() => parseSkuMovement(data), [data]);

  // Per-day order counts — full aggregate (NOT capped like recentOrders), for date-range
  // KPIs without the 50-row cap.
  const ordersByDay = useMemo(() => {
    if (!data?.ordersByDay) return [];
    return Object.entries(data.ordersByDay)
      .filter(([d]) => d !== 'unknown')
      .map(([date, orders]) => ({ date, orders: Number(orders) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const allOrdersByDay = useMemo(() => {
    const raw = data?.allOrdersByDay || data?.ordersByDay;
    if (!raw) return [];
    return Object.entries(raw)
      .filter(([d]) => d !== 'unknown')
      .map(([date, orders]) => ({ date, orders: Number(orders) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return {
    totalRevenue: data?.totalRevenue ?? 0,
    orderCount: data?.orderCount ?? 0,
    aov: data?.aov ?? 0,
    dailyRevenue,
    monthlyRevenue,
    platformBreakdown,
    revenueBySalesChannel: data?.revenueBySalesChannel ?? {},
    ordersBySalesChannel: data?.ordersBySalesChannel ?? {},
    includedRevenueBySalesChannel: data?.includedRevenueBySalesChannel ?? {},
    includedOrdersBySalesChannel: data?.includedOrdersBySalesChannel ?? {},
    excludedRevenueByReason: data?.excludedRevenueByReason ?? {},
    excludedOrdersByReason: data?.excludedOrdersByReason ?? {},
    topProducts: data?.topProducts ?? [],
    recentOrders: data?.recentOrders ?? [],
    ordersByDay,
    allOrdersByDay,
    connectedPlatforms: data?.connectedPlatforms ?? [],
    skuStats,
    skuMovement,
    stockMovementBaselineDate: data?.stockMovementBaselineDate ?? null,
    stockMovementUpdatedAt: data?.stockMovementUpdatedAt ?? null,
    syncedAt: data?.syncedAt,
    isLoading: isPending,
    hasData:
      !!data &&
      (data.orderCount > 0 || (data.connectedPlatforms?.length ?? 0) > 0),
  };
}
