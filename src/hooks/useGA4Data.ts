import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface GA4DailyMetrics {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  pageViews: number;
  bounceRate: number;
  avgSessionDuration: number;
  conversions: number;
  eventCount: number;
}

export interface GA4TrafficSource {
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
}

export interface GA4TopPage {
  path: string;
  pageViews: number;
  sessions: number;
  newUsers: number;
  bounceRate: number;
}

interface GA4RawData {
  propertyId: string;
  propertyName: string;
  dailyMetrics: Record<string, GA4DailyMetrics>;
  trafficSources: Record<string, GA4TrafficSource>;
  topPages: GA4TopPage[];
  syncedAt: any;
  dateRange: { start: string; end: string };
}

async function fetchGA4Data(brandId: string): Promise<GA4RawData | null> {
  const snap = await getDoc(doc(db, 'ga4_data', brandId));
  if (!snap.exists()) return null;
  return snap.data() as GA4RawData;
}

export function useGA4Data() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['ga4_data', brandId],
    queryFn: () => (brandId ? fetchGA4Data(brandId) : Promise.resolve(null)),
    staleTime: 10 * 60 * 1000,
    enabled: !!brandId,
  });

  const dailyEntries = useMemo(() => {
    if (!data?.dailyMetrics) return [];
    return Object.entries(data.dailyMetrics)
      .map(([date, m]) => ({ date, ...m }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const totals = useMemo(() => {
    if (dailyEntries.length === 0)
      return { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0 };
    const sum = dailyEntries.reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        users: acc.users + d.totalUsers,
        newUsers: acc.newUsers + d.newUsers,
        pageViews: acc.pageViews + d.pageViews,
        bounceRate: acc.bounceRate + d.bounceRate,
        conversions: acc.conversions + d.conversions,
        avgDuration: acc.avgDuration + d.avgSessionDuration,
      }),
      { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0 }
    );
    const n = dailyEntries.length;
    return {
      ...sum,
      bounceRate: sum.bounceRate / n,
      avgDuration: sum.avgDuration / n,
    };
  }, [dailyEntries]);

  // Last 7 vs previous 7 days comparison
  const weeklyChange = useMemo(() => {
    if (dailyEntries.length < 14) return null;
    const last7 = dailyEntries.slice(-7);
    const prev7 = dailyEntries.slice(-14, -7);
    const sum = (arr: typeof dailyEntries, fn: (d: typeof dailyEntries[0]) => number) => arr.reduce((a, d) => a + fn(d), 0);
    const pctChange = (prev: number, curr: number) => prev > 0 ? ((curr - prev) / prev) * 100 : null;
    const s1 = sum(prev7, d => d.sessions), s2 = sum(last7, d => d.sessions);
    const u1 = sum(prev7, d => d.totalUsers), u2 = sum(last7, d => d.totalUsers);
    const c1 = sum(prev7, d => d.conversions), c2 = sum(last7, d => d.conversions);
    const n1 = sum(prev7, d => d.newUsers), n2 = sum(last7, d => d.newUsers);
    return {
      sessions: pctChange(s1, s2),
      users: pctChange(u1, u2),
      conversions: pctChange(c1, c2),
      newUsers: pctChange(n1, n2),
    };
  }, [dailyEntries]);

  const trafficSources = useMemo(() => {
    if (!data?.trafficSources) return [];
    return Object.entries(data.trafficSources)
      .map(([channel, d]) => ({ channel, ...d }))
      .sort((a, b) => b.sessions - a.sessions);
  }, [data]);

  return {
    propertyName: data?.propertyName ?? '',
    dailyEntries,
    totals,
    weeklyChange,
    trafficSources,
    topPages: data?.topPages ?? [],
    syncedAt: data?.syncedAt,
    dateRange: data?.dateRange,
    isLoading: isPending,
    hasData: !!data,
  };
}
