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
  skuStats?: Record<string, { stock: number; sold: number }>;
  syncedAt: any;
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
      .filter(([, v]) => v.orders > 0)
      .map(([platform, v]) => ({ platform, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
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
    connectedPlatforms: data?.connectedPlatforms ?? [],
    skuStats: data?.skuStats ?? {},
    syncedAt: data?.syncedAt,
    isLoading: isPending,
    hasData: !!data && (data.orderCount > 0 || data.connectedPlatforms.length > 0),
  };
}
