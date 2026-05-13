import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, type DocumentSnapshot } from 'firebase/firestore';
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
  /** GA4 ecommerce: φορές που προστέθηκαν προϊόντα στο καλάθι (ανά ημέρα). */
  addToCarts?: number;
}

export interface GA4TrafficSource {
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  /** Έσοδα αγορών ανά default channel group στο GA4 (`totalRevenue`). */
  totalRevenue?: number;
}

export interface GA4TopPage {
  path: string;
  pageViews: number;
  sessions: number;
  newUsers: number;
  bounceRate: number;
}

export interface GA4OrganicFallbackRow {
  date: string;
  path: string;
  sessions: number;
  users: number;
  conversions: number;
  /** Εμπορικά έσοδα ανά ημέρα/path όταν τα επιστρέφει το GA4 για organic landing rows. */
  totalRevenue?: number;
}

export interface SearchConsoleQueryRow {
  date: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type OrganicSearchSource = 'gsc' | 'ga4_fallback' | 'none';

/** YYYY-MM-DD → channel → metrics (για φίλτρο ημερολογίου στο UI). */
export type GA4DailyTrafficByChannel = Record<
  string,
  Record<
    string,
    {
      sessions: number;
      users: number;
      newUsers: number;
      conversions: number;
      totalRevenue: number;
    }
  >
>;

interface GA4RawData {
  propertyId: string;
  propertyName: string;
  dailyMetrics: Record<string, GA4DailyMetrics>;
  trafficSources: Record<string, GA4TrafficSource>;
  dailyTrafficByChannel?: GA4DailyTrafficByChannel;
  /** YYYY-MM-DD → organic-channel revenue (from GA4 sync; used in ROI daily trend when no monthly import). */
  organicRevenueByDay?: Record<string, number>;
  organicSearchFallbackRows?: GA4OrganicFallbackRow[];
  topPages: GA4TopPage[];
  syncedAt: any;
  dateRange: { start: string; end: string };
}

interface SearchConsoleRawData {
  siteUrl: string;
  siteName: string;
  queryRows: SearchConsoleQueryRow[];
  syncedAt: any;
  dateRange: { start: string; end: string };
}

interface GA4PageRawData {
  ga4: GA4RawData | null;
  searchConsole: SearchConsoleRawData | null;
  connectors: { search_console?: { connected?: boolean } } | null;
}

interface GA4ChunkData {
  dailyTrafficByChannel?: GA4DailyTrafficByChannel;
  organicSearchFallbackRows?: GA4OrganicFallbackRow[];
}

const missingSnap = (): DocumentSnapshot =>
  ({ exists: () => false } as DocumentSnapshot);

async function fetchGA4Data(brandId: string): Promise<GA4PageRawData> {
  const settled = await Promise.allSettled([
    getDoc(doc(db, 'ga4_data', brandId)),
    getDoc(doc(db, 'search_console_data', brandId)),
    getDoc(doc(db, 'connectors', brandId)),
  ]);

  if (settled[0].status === 'rejected') throw settled[0].reason;

  const ga4Snap = settled[0].value;
  const searchConsoleSnap =
    settled[1].status === 'fulfilled' ? settled[1].value : missingSnap();
  const connectorsSnap =
    settled[2].status === 'fulfilled' ? settled[2].value : missingSnap();

  return {
    ga4: ga4Snap.exists() ? (ga4Snap.data() as GA4RawData) : null,
    searchConsole: searchConsoleSnap.exists() ? (searchConsoleSnap.data() as SearchConsoleRawData) : null,
    connectors: connectorsSnap.exists() ? (connectorsSnap.data() as { search_console?: { connected?: boolean } }) : null,
  };
}

async function fetchGA4Chunks(brandId: string): Promise<GA4ChunkData> {
  const settled = await Promise.allSettled([
    getDoc(doc(db, 'ga4_data', brandId, 'chunks', 'dailyTraffic')),
    getDoc(doc(db, 'ga4_data', brandId, 'chunks', 'organicFallback')),
  ]);
  const dailyTrafficSnap = settled[0].status === 'fulfilled' ? settled[0].value : missingSnap();
  const organicFallbackSnap = settled[1].status === 'fulfilled' ? settled[1].value : missingSnap();
  const out: GA4ChunkData = {};
  if (dailyTrafficSnap.exists()) {
    const raw = dailyTrafficSnap.data();
    const dtc = typeof raw?.json === 'string'
      ? JSON.parse(raw.json)
      : raw?.dailyTrafficByChannel;
    if (dtc) out.dailyTrafficByChannel = dtc;
  }
  if (organicFallbackSnap.exists()) {
    const raw = organicFallbackSnap.data();
    const ofr = typeof raw?.json === 'string'
      ? JSON.parse(raw.json)
      : raw?.organicSearchFallbackRows;
    if (ofr) out.organicSearchFallbackRows = ofr;
  }
  return out;
}

export function useGA4Data() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['ga4_data', brandId],
    queryFn: () => (brandId ? fetchGA4Data(brandId) : Promise.resolve(null)),
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    enabled: !!brandId,
  });
  const { data: chunkData } = useQuery<GA4ChunkData>({
    queryKey: ['ga4_data_chunks', brandId],
    queryFn: () => (brandId ? fetchGA4Chunks(brandId) : Promise.resolve({})),
    enabled: !!brandId && Boolean(data?.ga4),
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
  const mergedData = useMemo<GA4PageRawData | null>(() => {
    if (!data?.ga4) return data ?? null;
    return {
      ...data,
      ga4: {
        ...data.ga4,
        ...(chunkData?.dailyTrafficByChannel && !data.ga4.dailyTrafficByChannel
          ? { dailyTrafficByChannel: chunkData.dailyTrafficByChannel }
          : {}),
        ...(chunkData?.organicSearchFallbackRows && !data.ga4.organicSearchFallbackRows
          ? { organicSearchFallbackRows: chunkData.organicSearchFallbackRows }
          : {}),
      },
    };
  }, [data, chunkData]);

  const dailyEntries = useMemo(() => {
    if (!mergedData?.ga4?.dailyMetrics) return [];
    return Object.entries(mergedData.ga4.dailyMetrics)
      .map(([date, m]) => ({ date, ...m }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [mergedData]);

  const totals = useMemo(() => {
    if (dailyEntries.length === 0)
      return { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0, addToCarts: 0 };
    const sum = dailyEntries.reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        users: acc.users + d.totalUsers,
        newUsers: acc.newUsers + d.newUsers,
        pageViews: acc.pageViews + d.pageViews,
        bounceRate: acc.bounceRate + d.bounceRate,
        conversions: acc.conversions + d.conversions,
        avgDuration: acc.avgDuration + d.avgSessionDuration,
        addToCarts: acc.addToCarts + (typeof d.addToCarts === 'number' ? d.addToCarts : 0),
      }),
      { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0, addToCarts: 0 }
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
    const cart1 = sum(prev7, d => (typeof d.addToCarts === 'number' ? d.addToCarts : 0));
    const cart2 = sum(last7, d => (typeof d.addToCarts === 'number' ? d.addToCarts : 0));
    return {
      sessions: pctChange(s1, s2),
      users: pctChange(u1, u2),
      conversions: pctChange(c1, c2),
      newUsers: pctChange(n1, n2),
      addToCarts: pctChange(cart1, cart2),
    };
  }, [dailyEntries]);

  const trafficSources = useMemo(() => {
    if (!mergedData?.ga4?.trafficSources) return [];
    return Object.entries(mergedData.ga4.trafficSources)
      .map(([channel, d]) => ({
        channel,
        ...d,
        totalRevenue: typeof d.totalRevenue === 'number' ? d.totalRevenue : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);
  }, [mergedData]);

  const dailyTrafficByChannel = useMemo((): GA4DailyTrafficByChannel | null => {
    const raw = mergedData?.ga4?.dailyTrafficByChannel;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const normalizeDateKey = (k: string): string | null => {
      const s = String(k).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      return null;
    };

    const out: GA4DailyTrafficByChannel = {};
    for (const [rawDate, chans] of Object.entries(raw)) {
      const date = normalizeDateKey(String(rawDate));
      if (!date) continue;
      if (!chans || typeof chans !== 'object' || Array.isArray(chans)) continue;
      out[date] = {};
      for (const [channel, m] of Object.entries(chans as Record<string, unknown>)) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        const o = m as Record<string, unknown>;
        out[date][channel] = {
          sessions: Number(o.sessions) || 0,
          users: Number(o.users) || 0,
          newUsers: Number(o.newUsers) || 0,
          conversions: Number(o.conversions) || 0,
          totalRevenue: Number(o.totalRevenue) || 0,
        };
      }
      if (Object.keys(out[date]).length === 0) delete out[date];
    }
    return Object.keys(out).length > 0 ? out : null;
  }, [mergedData?.ga4?.dailyTrafficByChannel]);

  /** Sum of `totalRevenue` for channels whose name includes "organic" (matches GA4 default channel labels). */
  const totalOrganicRevenueFromChannels = useMemo(() => {
    return trafficSources
      .filter((s) => s.channel.toLowerCase().includes('organic'))
      .reduce((sum, s) => sum + (s.totalRevenue ?? 0), 0);
  }, [trafficSources]);

  const organicRevenueByDay = useMemo((): Record<string, number> => {
    const raw = mergedData?.ga4?.organicRevenueByDay;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v > 0) out[k] = v;
    }
    return out;
  }, [mergedData?.ga4?.organicRevenueByDay]);

  const organicSearchFallbackRows = useMemo(() => {
    const rows = mergedData?.ga4?.organicSearchFallbackRows;
    if (!Array.isArray(rows)) return [] as GA4OrganicFallbackRow[];
    return rows.filter((row) => Boolean(row?.date && row?.path));
  }, [mergedData?.ga4?.organicSearchFallbackRows]);

  const searchConsoleRows = useMemo(() => {
    const rows = mergedData?.searchConsole?.queryRows;
    if (!Array.isArray(rows)) return [] as SearchConsoleQueryRow[];
    return rows.filter((row) => Boolean(row?.date && row?.query));
  }, [mergedData?.searchConsole?.queryRows]);

  const isSearchConsoleConnected = Boolean(mergedData?.connectors?.search_console?.connected);
  const organicSearchSource: OrganicSearchSource =
    isSearchConsoleConnected
      ? searchConsoleRows.length > 0
        ? 'gsc'
        : 'none'
      : organicSearchFallbackRows.length > 0
        ? 'ga4_fallback'
        : 'none';

  return {
    propertyName: mergedData?.ga4?.propertyName ?? '',
    dailyEntries,
    totals,
    weeklyChange,
    trafficSources,
    dailyTrafficByChannel,
    totalOrganicRevenueFromChannels,
    organicRevenueByDay,
    organicSearchFallbackRows,
    searchConsoleRows,
    organicSearchSource,
    isSearchConsoleConnected,
    searchConsoleSiteName: mergedData?.searchConsole?.siteName ?? '',
    searchConsoleSiteUrl: mergedData?.searchConsole?.siteUrl ?? '',
    searchConsoleSyncedAt: mergedData?.searchConsole?.syncedAt,
    searchConsoleDateRange: mergedData?.searchConsole?.dateRange,
    topPages: mergedData?.ga4?.topPages ?? [],
    syncedAt: mergedData?.ga4?.syncedAt,
    dateRange: mergedData?.ga4?.dateRange,
    isLoading: isPending,
    hasData: Boolean(mergedData?.ga4),
  };
}
