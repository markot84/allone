import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import { monthlyRevenueFromDailyRecord } from '../utils/roiUtils';

export type BusinessRevenueSource = 'none' | 'megaventory_invoices' | 'softone_sales_documents';

interface BusinessRevenueSummaryRaw {
  source?: BusinessRevenueSource;
  totalRevenue?: number;
  orderCount?: number;
  revenueByDay?: Record<string, number>;
  revenueByMonth?: Record<string, number>;
  syncedAt?: unknown;
}

export async function fetchBusinessRevenueSummary(brandId: string): Promise<BusinessRevenueSummaryRaw | null> {
  const snap = await getDoc(doc(db, 'business_revenue_summary', brandId));
  if (!snap.exists()) return null;
  return snap.data() as BusinessRevenueSummaryRaw;
}

/**
 * ERP συνολικός τζίρος (Megaventory / SoftOne) — ξεχωριστό doc από το ecommerce_summary (e-shop μόνο).
 */
export function useBusinessRevenueSummary() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersionQuery = useBrandSyncVersion(brandId);
  const syncVersion = syncVersionQuery.data?.version ?? 'pending';

  const { data, isPending } = useQuery({
    queryKey: ['business_revenue_summary', brandId, syncVersion],
    queryFn: () => (brandId ? fetchBusinessRevenueSummary(brandId) : Promise.resolve(null)),
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    // PER-130 (P2): όχι fetch κάτω από το throwaway 'pending' syncVersion key.
    enabled: !!brandId && syncVersion !== 'pending',
  });

  const source: BusinessRevenueSource = data?.source === 'none' || !data?.source ? 'none' : data.source;
  const hasErpRevenueData = source !== 'none';

  const revenueByDayRecord = useMemo(() => {
    const out: Record<string, number> = {};
    const raw = data?.revenueByDay;
    if (!raw) return out;
    for (const [d, v] of Object.entries(raw)) {
      if (d && d !== 'unknown' && typeof v === 'number') out[d] = v;
    }
    return out;
  }, [data?.revenueByDay]);

  const monthlyRevenue = useMemo(() => {
    if (data?.revenueByMonth && Object.keys(data.revenueByMonth).length > 0) {
      return Object.entries(data.revenueByMonth)
        .filter(([m]) => m !== 'unknown' && /^\d{4}-\d{2}$/.test(m))
        .map(([month, revenue]) => ({ month, revenue }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }
    return monthlyRevenueFromDailyRecord(revenueByDayRecord);
  }, [data?.revenueByMonth, revenueByDayRecord]);

  const revenueByMonthRecord = useMemo(
    () => (data?.revenueByMonth && typeof data.revenueByMonth === 'object' ? data.revenueByMonth : {}) as Record<string, number>,
    [data?.revenueByMonth]
  );

  return {
    isLoading: isPending,
    source,
    hasErpRevenueData,
    totalRevenue: data?.totalRevenue ?? 0,
    orderCount: data?.orderCount ?? 0,
    revenueByDay: data?.revenueByDay ?? {},
    revenueByDayRecord,
    monthlyRevenue,
    revenueByMonthRecord,
  };
}
