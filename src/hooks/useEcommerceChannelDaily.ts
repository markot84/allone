import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import {
  SALES_CHANNEL_LABELS,
  type EcommerceSalesChannel,
} from '../services/ecommerceSalesChannel';

/** channel -> dateKey -> value (dateKey is YYYY-MM-DD or YYYY-MM per `granularity`). */
type ChannelDailyMap = Record<string, Record<string, number>>;

export interface EcommerceChannelDaily {
  granularity: 'day' | 'month';
  revenue: ChannelDailyMap;
  includedRevenue: ChannelDailyMap;
  orders: ChannelDailyMap;
  includedOrders: ChannelDailyMap;
}

/** Same shape as the dashboard's SalesChannelBreakdownRow (structural). */
export interface ChannelBreakdownRow {
  channel: EcommerceSalesChannel;
  label: string;
  revenue: number;
  orders: number;
  includedRevenue: number;
  includedOrders: number;
  excludedRevenue: number;
  excludedOrders: number;
}

/**
 * Sum the per-day(-or-month)-per-channel rollup over [fromISO, toISO] (YYYY-MM-DD), producing the
 * period-correct Sales Channel breakdown WITHOUT any raw-orders fetch (PER-170). String key compare
 * works because the keys are zero-padded ISO. Returns null when the rollup doc isn't present yet so
 * the caller can fall back.
 */
export function sumChannelDailyWindow(
  cd: EcommerceChannelDaily | null | undefined,
  fromISO: string,
  toISO: string,
): ChannelBreakdownRow[] | null {
  if (!cd || !cd.revenue) return null;
  const len = cd.granularity === 'month' ? 7 : 10;
  const from = fromISO.slice(0, len);
  const to = toISO.slice(0, len);
  const sumCh = (m: ChannelDailyMap | undefined, ch: string): number => {
    const byKey = m?.[ch];
    if (!byKey) return 0;
    let s = 0;
    for (const k in byKey) if (k >= from && k <= to) s += byKey[k];
    return s;
  };
  const channels = new Set<string>([...Object.keys(cd.revenue), ...Object.keys(cd.orders || {})]);
  const rows: ChannelBreakdownRow[] = [];
  for (const ch of channels) {
    const revenue = sumCh(cd.revenue, ch);
    const orders = sumCh(cd.orders, ch);
    const includedRevenue = sumCh(cd.includedRevenue, ch);
    const includedOrders = sumCh(cd.includedOrders, ch);
    if (revenue === 0 && orders === 0) continue;
    rows.push({
      channel: ch as EcommerceSalesChannel,
      label: SALES_CHANNEL_LABELS[ch as EcommerceSalesChannel] || String(ch),
      revenue,
      orders,
      includedRevenue,
      includedOrders,
      excludedRevenue: revenue - includedRevenue,
      excludedOrders: orders - includedOrders,
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

/** Reads the per-day-per-channel rollup doc (own 1MB budget; built by the ecommerce aggregator). */
export function useEcommerceChannelDaily(): EcommerceChannelDaily | null {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { data } = useQuery({
    queryKey: ['ecommerce_channel_daily', brandId],
    queryFn: async (): Promise<EcommerceChannelDaily | null> => {
      if (!brandId) return null;
      const snap = await getDoc(doc(db, 'ecommerce_channel_daily', brandId));
      return snap.exists() ? (snap.data() as EcommerceChannelDaily) : null;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!brandId,
  });
  return data ?? null;
}
