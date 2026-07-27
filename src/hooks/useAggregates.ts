import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../config/firebase';
import { useBrand } from './useBrand';

const REFRESH_URL = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/refreshAggregates`;

interface ProductAggregates {
  totalSkus: number;
  totalInventoryValue: number;
  deadStock: { count: number; value: number };
  lowStock: { count: number };
  healthyStock: { count: number };
  excessStock: { count: number; value: number };
  avgMargin: number;
  withStockLevel: number;
  withMargin: number;
  updatedAt: string;
}

interface SegmentAggregates {
  totalCustomers: number;
  segments: Record<string, { count: number; percentage: number; revenue: number }>;
  atRiskPercentage: number;
  championsPercentage: number;
  updatedAt: string;
}

interface CampaignAggregates {
  totalCampaigns: number;
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  avgRoas: number;
  topByRoas: { name: string; roas: number; spend: number; revenue: number }[];
  worstByRoas: { name: string; roas: number; spend: number; revenue: number }[];
  byMonth: Record<string, { spend: number; revenue: number; conversions: number }>;
  updatedAt: string;
}

async function fetchAggregate<T>(brandId: string, type: string): Promise<T | null> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'aggregates', type));
  return snap.exists() ? (snap.data() as T) : null;
}

export function useProductAggregates() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['aggregates', 'products', brandId],
    queryFn: () => (brandId ? fetchAggregate<ProductAggregates>(brandId, 'products') : null),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: !!brandId,
  });

  return { productStats: data, isLoading: isPending };
}

export function useSegmentAggregates() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['aggregates', 'segments', brandId],
    queryFn: () => (brandId ? fetchAggregate<SegmentAggregates>(brandId, 'segments') : null),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: !!brandId,
  });

  return { segmentStats: data, isLoading: isPending };
}

export function useCampaignAggregates() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['aggregates', 'campaigns', brandId],
    queryFn: () => (brandId ? fetchAggregate<CampaignAggregates>(brandId, 'campaigns') : null),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: !!brandId,
  });

  return { campaignStats: data, isLoading: isPending };
}

export function useRefreshAggregates() {
  const queryClient = useQueryClient();
  const { currentBrand } = useBrand();

  const refresh = async (): Promise<{ ok: boolean; error?: string }> => {
    const brandId = currentBrand?.id;
    if (!brandId) return { ok: false, error: 'no-brand' };

    const token = await auth.currentUser?.getIdToken();
    if (!token) return { ok: false, error: 'no-auth' };

    try {
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(await getAppCheckHeader()),
        },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${txt}` };
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['ecommerce_summary', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['business_revenue_summary', brandId] }),
      ]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  return { refresh };
}
