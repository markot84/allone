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
  /** Stock movement (καθολικό — δουλεύει για όλα τα brands ανεξάρτητα από connector) */
  skuMovementJson?: string;
  /** PER-130/BUG-11: parsed movement map (client-only) — αποφεύγει το stringify→parse round-trip. */
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
  { stock: number; sold: number; sold7d?: number; sold30d?: number; sold90d?: number; lastSaleAt?: string | null }
>;

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

/**
 * Διαβάζει το `sku_stats/{brandId}` collection (chunked layout) και επιστρέφει merged map.
 * Συμβατό με legacy: αν το main summary έχει `skuStatsJson` (παλιά docs), επιστρέφεται κενό
 * εδώ — το `parseSkuStats` του summary κάνει fallback.
 */
/** PER-130/BUG-11: macrotask yield ώστε το main thread να ανασαίνει ανάμεσα στα chunk parses. */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function fetchSkuStatsFromChunks(brandId: string): Promise<SkuStatsMap> {
  try {
    const chunksSnap = await getDocs(collection(db, 'sku_stats', brandId, 'chunks'));
    if (chunksSnap.empty) return {};
    const merged: SkuStatsMap = {};
    // PER-130/BUG-11: parse κάθε chunk (~900KB) σε ξεχωριστό task με yield ανάμεσα — ένα ενιαίο
    // JSON.parse 2-5MB μπλόκαρε το main thread για δευτερόλεπτα· τώρα σπάει σε ~1 task/chunk.
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
    // PER-130/BUG-11: yield ανάμεσα στα chunks (βλ. fetchSkuStatsFromChunks).
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
  // PER-130/BUG-11: προτίμησε το ήδη-parsed map (από chunks) — απόφυγε το stringify (στο fetch)
  // + parse (εδώ) round-trip πάνω σε έως ~44k entries. Legacy inline json μένει ως fallback.
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

  /**
   * Νέο layout: `sku_stats/{brandId}/chunks/*` — απαραίτητο γιατί το παλιό inline `skuStatsJson`
   * πρόσθετε το serialized map στο main summary doc και ξεπερνούσε το Firestore όριο 1 MiB
   * σε brands με μεγάλους καταλόγους SKU → απέτυχε το doc read → κενά δεδομένα στο UI.
   */
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
    // PER-130/BUG-11: κράτα το parsed map απευθείας όταν έρχεται από chunks — χωρίς stringify
    // εδώ + parse στο hook. Legacy inline json μένει ως fallback για παλιά docs.
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
    /** Μετά sync το invalidateQueries ανανεώνει· εδώ αποφεύγουμε refetch σε κάθε mount/focus. */
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

  // Per-day order counts — full aggregate (NOT capped όπως το recentOrders).
  // Χρειάζεται για date-range KPIs χωρίς το 50-row cap του recentOrders.
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
