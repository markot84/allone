import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

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
  topProducts: EcommerceTopProduct[];
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
  skuMovementCount?: number;
  stockMovementBaselineDate?: string | null;
  stockMovementUpdatedAt?: any;
  syncedAt: any;
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

function parseSkuMovement(raw: EcommerceSummaryRaw | null | undefined): SkuMovementMap {
  if (!raw?.skuMovementJson) return {};
  try {
    return JSON.parse(raw.skuMovementJson) as SkuMovementMap;
  } catch {
    return {};
  }
}

async function fetchEcommerceSummary(brandId: string): Promise<EcommerceSummaryRaw | null> {
  const snap = await getDoc(doc(db, 'ecommerce_summary', brandId));
  if (!snap.exists()) return null;
  return snap.data() as EcommerceSummaryRaw;
}

export function useEcommerceSummary() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['ecommerce_summary', brandId],
    queryFn: () => (brandId ? fetchEcommerceSummary(brandId) : Promise.resolve(null)),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
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

  return {
    totalRevenue: data?.totalRevenue ?? 0,
    orderCount: data?.orderCount ?? 0,
    aov: data?.aov ?? 0,
    dailyRevenue,
    monthlyRevenue,
    platformBreakdown,
    topProducts: data?.topProducts ?? [],
    recentOrders: data?.recentOrders ?? [],
    ordersByDay,
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
