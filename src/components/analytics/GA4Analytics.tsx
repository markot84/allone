import { useState, useMemo } from 'react';
import {
  BarChart3,
  Globe,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardHeader, KPICard, PageHeader } from '../common';
import { useGA4Data, type OrganicSearchSource } from '../../hooks/useGA4Data';
import type { KPICardData } from '../common/KPICard';
import { formatCurrency } from '../../utils/format';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';

type TrafficRow = {
  channel: string;
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  totalRevenue: number;
};

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search': '#34D399',
  'Organic Social': '#4ADE80',
  'Direct': '#A78BFA',
  'Paid Search': '#3B82F6',
  'Paid Social': '#EC4899',
  'Paid Other': '#F59E0B',
  'Cross-network': '#6366F1',
  'Email': '#FB923C',
  'Referral': '#FBBF24',
  'Display': '#06B6D4',
  'Social': '#F472B6',
  '(Other)': '#9CA3AF',
  'Λοιπά κανάλια': '#78716C',
};
const DEFAULT_COLOR = '#94A3B8';

/** Το Recharts Area χρειάζεται ≥2 σημεία για ορατή γραμμή. */
function padSparklineForChart(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

/** Ημερομηνία YYYY-MM-DD → DD/MM/YYYY για tooltips */
function formatDateTooltipEl(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

type SortField = 'pageViews' | 'sessions' | 'bounceRate';
type OrganicSortField = 'clicks' | 'impressions' | 'position' | 'sessions' | 'users' | 'conversions';

type OrganicSearchRow = {
  label: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  sessions?: number;
  users?: number;
  conversions?: number;
};

export function GA4Analytics() {
  const {
    propertyName,
    dailyEntries,
    trafficSources,
    dailyTrafficByChannel,
    organicSearchFallbackRows,
    searchConsoleRows,
    organicSearchSource,
    isSearchConsoleConnected,
    searchConsoleSiteName,
    searchConsoleDateRange,
    topPages,
    dateRange,
    isLoading,
    hasData,
  } = useGA4Data();

  // Date range: local override (session-only) falls back to global
  const { fromDate: globalFrom, toDate: globalTo, period: globalPeriod, setPeriod: setGlobalPeriod } = useGlobalDate();
  const [localDateFrom, setLocalDateFrom] = useState('');
  const [localDateTo,   setLocalDateTo]   = useState('');
  const effectiveFrom = localDateFrom || globalFrom;
  const effectiveTo   = localDateTo   || globalTo;
  const hasLocalOverride = !!(localDateFrom || localDateTo);

  // Filter daily entries by effective date range
  const filteredDailyEntries = useMemo(
    () => dailyEntries.filter(d => d.date >= effectiveFrom && d.date <= effectiveTo),
    [dailyEntries, effectiveFrom, effectiveTo]
  );

  // Recompute totals from filtered entries
  const totals = useMemo(() => {
    if (filteredDailyEntries.length === 0)
      return { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0, addToCarts: 0 };
    const sum = filteredDailyEntries.reduce(
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
    const n = filteredDailyEntries.length;
    return { ...sum, bounceRate: sum.bounceRate / n, avgDuration: sum.avgDuration / n };
  }, [filteredDailyEntries]);

  // weeklyChange από τα φιλτραρισμένα ημερήσια (τελευταία 7 vs προηγούμενες 7)
  const weeklyChange = useMemo(() => {
    if (filteredDailyEntries.length < 14) return null;
    const last7 = filteredDailyEntries.slice(-7);
    const prev7 = filteredDailyEntries.slice(-14, -7);
    const sum = (arr: typeof filteredDailyEntries, fn: (d: typeof filteredDailyEntries[0]) => number) => arr.reduce((a, d) => a + fn(d), 0);
    const avg = (arr: typeof filteredDailyEntries, fn: (d: typeof filteredDailyEntries[0]) => number) =>
      arr.length ? sum(arr, fn) / arr.length : 0;
    const pct = (prev: number, curr: number) => prev > 0 ? ((curr - prev) / prev) * 100 : null;
    return {
      sessions: pct(sum(prev7, d => d.sessions), sum(last7, d => d.sessions)),
      users: pct(sum(prev7, d => d.totalUsers), sum(last7, d => d.totalUsers)),
      conversions: pct(sum(prev7, d => d.conversions), sum(last7, d => d.conversions)),
      newUsers: pct(sum(prev7, d => d.newUsers), sum(last7, d => d.newUsers)),
      pageViews: pct(sum(prev7, d => d.pageViews), sum(last7, d => d.pageViews)),
      bounceRate: pct(avg(prev7, d => d.bounceRate), avg(last7, d => d.bounceRate)),
      avgDuration: pct(avg(prev7, d => d.avgSessionDuration), avg(last7, d => d.avgSessionDuration)),
      addToCarts: pct(sum(prev7, d => (typeof d.addToCarts === 'number' ? d.addToCarts : 0)), sum(last7, d => (typeof d.addToCarts === 'number' ? d.addToCarts : 0))),
    };
  }, [filteredDailyEntries]);

  /** Αθροίζει ημερήσια κανάλια στο εύρος· αν το άθροισμα βγει κενό, κλίμακα από trafficSources. */
  const { trafficSourcesForPeriod, channelMixSource } = useMemo(() => {
    type Row = {
      channel: string;
      sessions: number;
      users: number;
      newUsers: number;
      conversions: number;
      totalRevenue: number;
    };
    type MixSource = 'daily' | 'proportional' | 'full';

    /** Ίδιες ημέρες με τα φιλτραρισμένα ημερήσια KPI — όχι «όλα τα κλειδιά του map» που μπορεί να ξεφεύγουν. */
    const aggregateFromDaily = (): Row[] | null => {
      const daily = dailyTrafficByChannel;
      if (!daily || Object.keys(daily).length === 0) return null;
      const map = new Map<string, Row>();
      for (const { date } of filteredDailyEntries) {
        const chans = daily[date];
        if (!chans || typeof chans !== 'object') continue;
        for (const [channel, m] of Object.entries(chans)) {
          const cur = map.get(channel) || {
            channel,
            sessions: 0,
            users: 0,
            newUsers: 0,
            conversions: 0,
            totalRevenue: 0,
          };
          cur.sessions += m.sessions || 0;
          cur.users += m.users || 0;
          cur.newUsers += m.newUsers || 0;
          cur.conversions += m.conversions || 0;
          cur.totalRevenue += m.totalRevenue || 0;
          map.set(channel, cur);
        }
      }
      if (map.size === 0) return null;
      return [...map.values()].sort((a, b) => b.sessions - a.sessions);
    };

    const scaleFullTrafficToPeriod = (): Row[] | null => {
      const denom = dailyEntries.reduce((a, d) => a + d.sessions, 0);
      const numer = filteredDailyEntries.reduce((a, d) => a + d.sessions, 0);
      if (denom <= 0 || trafficSources.length === 0) return null;
      const ratio = numer / denom;
      const scaled = trafficSources
        .map((s) => ({
          channel: s.channel,
          sessions: s.sessions * ratio,
          users: s.users * ratio,
          newUsers: (s.newUsers ?? 0) * ratio,
          conversions: s.conversions * ratio,
          totalRevenue: (s.totalRevenue ?? 0) * ratio,
        }))
        .filter((s) => s.sessions > 1e-6 || s.conversions > 1e-6 || (s.totalRevenue ?? 0) > 1e-6);
      return scaled.length > 0 ? scaled : null;
    };

    const fromDaily = aggregateFromDaily();
    if (fromDaily) return { trafficSourcesForPeriod: fromDaily, channelMixSource: 'daily' satisfies MixSource };

    const scaled = scaleFullTrafficToPeriod();
    if (scaled) return { trafficSourcesForPeriod: scaled, channelMixSource: 'proportional' satisfies MixSource };

    return { trafficSourcesForPeriod: trafficSources, channelMixSource: 'full' satisfies MixSource };
  }, [dailyTrafficByChannel, effectiveFrom, effectiveTo, trafficSources, dailyEntries, filteredDailyEntries]);

  const displayTrafficSources = useMemo((): TrafficRow[] => {
    return trafficSourcesForPeriod.map((s) => ({
      channel: s.channel,
      sessions: s.sessions,
      users: s.users,
      newUsers: s.newUsers ?? 0,
      conversions: s.conversions,
      totalRevenue: s.totalRevenue ?? 0,
    }));
  }, [trafficSourcesForPeriod]);

  const [pageSearch, setPageSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('pageViews');
  const [sortAsc, setSortAsc] = useState(false);
  const [showAllPages, setShowAllPages] = useState(false);
  const [organicSearchText, setOrganicSearchText] = useState('');
  const [organicSortField, setOrganicSortField] = useState<OrganicSortField>('clicks');
  const [organicSortAsc, setOrganicSortAsc] = useState(false);
  const [showAllOrganicRows, setShowAllOrganicRows] = useState(false);

  const chartData = useMemo(() => {
    if (filteredDailyEntries.length === 0) return [];
    const step = filteredDailyEntries.length > 30 ? 7 : 1;
    const aggregated: { date: string; sessions: number; users: number; conversions: number }[] = [];
    for (let i = 0; i < filteredDailyEntries.length; i += step) {
      const chunk = filteredDailyEntries.slice(i, i + step);
      aggregated.push({
        date: chunk[0].date.slice(5),
        sessions: chunk.reduce((a, d) => a + d.sessions, 0),
        users: chunk.reduce((a, d) => a + d.totalUsers, 0),
        conversions: chunk.reduce((a, d) => a + d.conversions, 0),
      });
    }
    return aggregated;
  }, [filteredDailyEntries]);

  const pieData = useMemo(() => {
    const sorted = [...displayTrafficSources].sort((a, b) => b.sessions - a.sessions);
    if (sorted.length <= 9) {
      return sorted.map((s) => ({
        name: s.channel,
        value: s.sessions,
        color: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR,
      }));
    }
    const top = sorted.slice(0, 8);
    const restSessions = sorted.slice(8).reduce((a, s) => a + s.sessions, 0);
    return [
      ...top.map((s) => ({
        name: s.channel,
        value: s.sessions,
        color: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR,
      })),
      { name: 'Λοιπά κανάλια', value: restSessions, color: '#78716C' },
    ];
  }, [displayTrafficSources]);

  /** Άθροισμα φετών πίτας (ισορροπεί με τον πίνακα· μπορεί να διαφέρει ελάχιστα από GA4 totals). */
  const pieSlicesTotal = useMemo(
    () => pieData.reduce((a, p) => a + Number(p.value || 0), 0),
    [pieData]
  );

  const pieRechartsKey = `${effectiveFrom}|${effectiveTo}|${channelMixSource}|${pieData.map((p) => p.name).join(',')}|${pieData.map((p) => Number(p.value).toFixed(4)).join(',')}`;

  const filteredPages = useMemo(() => {
    let pages = topPages.filter(
      (p) => !pageSearch || p.path.toLowerCase().includes(pageSearch.toLowerCase())
    );
    pages = [...pages].sort((a, b) =>
      sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]
    );
    return showAllPages ? pages : pages.slice(0, 15);
  }, [topPages, pageSearch, sortField, sortAsc, showAllPages]);

  const filteredSearchConsoleRows = useMemo(
    () => searchConsoleRows.filter((row) => row.date >= effectiveFrom && row.date <= effectiveTo),
    [searchConsoleRows, effectiveFrom, effectiveTo]
  );

  const filteredOrganicFallbackRows = useMemo(
    () => organicSearchFallbackRows.filter((row) => row.date >= effectiveFrom && row.date <= effectiveTo),
    [organicSearchFallbackRows, effectiveFrom, effectiveTo]
  );

  const organicRows = useMemo<OrganicSearchRow[]>(() => {
    if (organicSearchSource === 'gsc') {
      const grouped = new Map<string, { clicks: number; impressions: number; weightedPosition: number }>();
      for (const row of filteredSearchConsoleRows) {
        const current = grouped.get(row.query) || { clicks: 0, impressions: 0, weightedPosition: 0 };
        current.clicks += row.clicks;
        current.impressions += row.impressions;
        current.weightedPosition += row.position * row.impressions;
        grouped.set(row.query, current);
      }
      return [...grouped.entries()].map(([label, value]) => ({
        label,
        clicks: value.clicks,
        impressions: value.impressions,
        ctr: value.impressions > 0 ? value.clicks / value.impressions : 0,
        position: value.impressions > 0 ? value.weightedPosition / value.impressions : 0,
      }));
    }

    if (organicSearchSource === 'ga4_fallback') {
      const grouped = new Map<string, { sessions: number; users: number; conversions: number }>();
      for (const row of filteredOrganicFallbackRows) {
        const current = grouped.get(row.path) || { sessions: 0, users: 0, conversions: 0 };
        current.sessions += row.sessions;
        current.users += row.users;
        current.conversions += row.conversions;
        grouped.set(row.path, current);
      }
      return [...grouped.entries()].map(([label, value]) => ({
        label,
        sessions: value.sessions,
        users: value.users,
        conversions: value.conversions,
      }));
    }

    return [];
  }, [organicSearchSource, filteredOrganicFallbackRows, filteredSearchConsoleRows]);

  const visibleOrganicSortField: OrganicSortField =
    organicSearchSource === 'gsc'
      ? ['clicks', 'impressions', 'position'].includes(organicSortField)
        ? organicSortField
        : 'clicks'
      : organicSearchSource === 'ga4_fallback'
        ? ['sessions', 'users', 'conversions'].includes(organicSortField)
          ? organicSortField
          : 'sessions'
        : organicSortField;

  const filteredOrganicRows = useMemo(() => {
    const query = organicSearchText.trim().toLowerCase();
    let rows = organicRows.filter((row) => !query || row.label.toLowerCase().includes(query));
    rows = [...rows].sort((a, b) => {
      const direction = organicSortAsc ? 1 : -1;
      const left = Number(a[visibleOrganicSortField] || 0);
      const right = Number(b[visibleOrganicSortField] || 0);
      return direction * (left - right);
    });
    return showAllOrganicRows ? rows : rows.slice(0, 15);
  }, [organicRows, organicSearchText, visibleOrganicSortField, organicSortAsc, showAllOrganicRows]);

  /** Sparklines ευθυγραμμισμένα με το φίλτρο ημερομηνιών (όχι πάντα «τελευταίες 14» από όλο το sync). */
  const sparkFiltered = useMemo(() => filteredDailyEntries.slice(-14), [filteredDailyEntries]);

  const kpiTooltipBase = useMemo(() => {
    const period = `${formatDateTooltipEl(effectiveFrom)} — ${formatDateTooltipEl(effectiveTo)}`;
    const sync =
      dateRange?.start && dateRange?.end
        ? `Αποθηκευμένο εύρος από το τελευταίο GA4 sync: ${formatDateTooltipEl(dateRange.start)} — ${formatDateTooltipEl(dateRange.end)}. Για ημέρες εκτός αυτού του εύρους δεν υπάρχουν ημερήσια σημεία.`
        : 'Τα ημερήσια σημεία προέρχονται από το τελευταίο GA4 sync.';
    const cmp =
      'Η σύγκριση «vs 7 ημ.» συγκρίνει τις τελευταίες 7 ημέρες της περιόδου με τις 7 προηγούμενες (απαιτούνται τουλάχιστον 14 ημέρες με δεδομένα εντός της περιόδου).';
    const spark =
      'Η μικρή γραμμή δείχνει έως τις 14 πιο πρόσφατες ημέρες με δεδομένα στην επιλεγμένη περίοδο.';
    return { period, sync, cmp, spark };
  }, [effectiveFrom, effectiveTo, dateRange?.start, dateRange?.end]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField === field ? (
      sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
    ) : null;

  const handleOrganicSort = (field: OrganicSortField) => {
    if (organicSortField === field) setOrganicSortAsc(!organicSortAsc);
    else {
      setOrganicSortField(field);
      setOrganicSortAsc(field === 'position');
    }
  };

  const OrganicSortIcon = ({ field }: { field: OrganicSortField }) =>
    visibleOrganicSortField === field ? (
      organicSortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
    ) : null;

  if (isLoading) {
    return (
      <div className="py-16 text-center text-[#6B7280]">
        <div className="animate-spin h-8 w-8 border-2 border-orange-400 border-t-transparent rounded-full mx-auto mb-3" />
        Φόρτωση GA4 δεδομένων...
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="py-16 text-center">
        <Globe size={48} className="mx-auto mb-4 text-[#D1D5DB]" />
        <h3 className="text-lg font-semibold text-[#1A1A1A] mb-2">Δεν υπάρχουν GA4 δεδομένα</h3>
        <p className="text-sm text-[#6B7280]">
          Συνδέστε το Google Analytics 4 από τις Συνδέσεις (sidebar) και κάντε Sync.
        </p>
      </div>
    );
  }

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('el-GR');
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const round1 = (v: number | null | undefined) => (v != null ? Math.round(v * 10) / 10 : undefined);
  const organicSourceMeta: Record<OrganicSearchSource, { label: string; subtitle: string; badgeClass: string }> = {
    gsc: {
      label: 'Google Search Console',
      subtitle: searchConsoleSiteName
        ? `Πραγματικά search queries από ${searchConsoleSiteName}`
        : 'Πραγματικά search queries από το Search Console',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    ga4_fallback: {
      label: 'GA4 (organic landing)',
      subtitle: 'Οργανικές σελίδες εισόδου από το GA4 όταν δεν υπάρχει σύνδεση Search Console',
      badgeClass: 'border-orange-200 bg-orange-50 text-orange-700',
    },
    none: {
      label: 'Χωρίς πηγή',
      subtitle: 'Συνδέστε Search Console για πραγματικά queries ή κάντε sync GA4 για fallback landing pages',
      badgeClass: 'border-slate-200 bg-slate-50 text-slate-600',
    },
  };
  const activeOrganicMeta = organicSourceMeta[organicSearchSource];

  const primaryKpis: KPICardData[] = [
    {
      label: 'Συνεδρίες',
      value: fmt(totals.sessions),
      change: round1(weeklyChange?.sessions),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.sessions != null ? (weeklyChange.sessions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: sparkFiltered.map((d) => d.sessions),
      tooltip: `Άθροισμα συνεδριών (sessions) για την επιλεγμένη περίοδο (${kpiTooltipBase.period}).\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Χρήστες',
      value: fmt(totals.users),
      change: round1(weeklyChange?.users),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.users != null ? (weeklyChange.users >= 0 ? 'up' : 'down') : undefined,
      sparklineData: sparkFiltered.map((d) => d.totalUsers),
      tooltip: `Άθροισμα μοναδικών χρηστών (totalUsers ανά ημέρα) για την περίοδο (${kpiTooltipBase.period}). Στο GA4 είναι «εντός ημέρας», όχι de-duplicated σε όλη την περίοδο.\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Νέοι χρήστες',
      value: fmt(totals.newUsers),
      change: round1(weeklyChange?.newUsers),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.newUsers != null ? (weeklyChange.newUsers >= 0 ? 'up' : 'down') : undefined,
      sparklineData: sparkFiltered.map((d) => d.newUsers),
      tooltip: `Άθροισμα νέων χρηστών ανά ημέρα για την περίοδο (${kpiTooltipBase.period}).\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Μετατροπές',
      value: fmt(totals.conversions),
      change: round1(weeklyChange?.conversions),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.conversions != null ? (weeklyChange.conversions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: sparkFiltered.map((d) => d.conversions),
      tooltip: `Άθροισμα μετατροπών από την ημερήσια αναφορά GA4 για την περίοδο (${kpiTooltipBase.period}). Αντιστοιχεί στα key events / μετρήσεις μετατροπής όπως στο GA4.\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
  ];

  const secondaryKpis: KPICardData[] = [
    {
      label: 'Bounce rate',
      value: fmtPct(totals.bounceRate),
      change: round1(weeklyChange?.bounceRate),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.bounceRate != null ? (weeklyChange.bounceRate >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkFiltered.map((d) => d.bounceRate * 100)),
      tooltip: `Μέσος όρος bounce rate ανά ημέρα για την περίοδο (${kpiTooltipBase.period}), μετά μέσος όρος των ημερών (όχι bounce σε επίπεδο περιόδου).\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Μέση διάρκεια',
      value: fmtDuration(totals.avgDuration),
      change: round1(weeklyChange?.avgDuration),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.avgDuration != null ? (weeklyChange.avgDuration >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkFiltered.map((d) => d.avgSessionDuration)),
      tooltip: `Μέσος όρος διάρκειας session (λεπτά:δευτ.) ανά ημέρα για την περίοδο (${kpiTooltipBase.period}).\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Προβολές σελίδων',
      value: fmt(totals.pageViews),
      change: round1(weeklyChange?.pageViews),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.pageViews != null ? (weeklyChange.pageViews >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkFiltered.map((d) => d.pageViews)),
      tooltip: `Άθροισμα προβολών οθόνης/σελίδας (screenPageViews) για την περίοδο (${kpiTooltipBase.period}).\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
    {
      label: 'Προσθήκες στο καλάθι',
      value: fmt(totals.addToCarts),
      change: round1(weeklyChange?.addToCarts),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.addToCarts != null ? (weeklyChange.addToCarts >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkFiltered.map((d) => (typeof d.addToCarts === 'number' ? d.addToCarts : 0))),
      tooltip: `Μετρήσεις GA4 «addToCarts»: πόσες φορές προστέθηκαν προϊόντα στο καλάθι (${kpiTooltipBase.period}). Δεν είναι ίδιο με «εγκαταλειφθέντα καλάθια» (session χωρίς αγορά)· για εκεί χρειάζεται funnel/exploration στο GA4.\n${kpiTooltipBase.sync}\n${kpiTooltipBase.cmp}\n${kpiTooltipBase.spark}`,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">
            <BarChart3 size={24} className="shrink-0 text-orange-500" />
            Αναλυτικά ιστού (GA4)
          </h2>
        }
        description={
          <p className="text-[14px] text-[var(--nts-medium-gray)]">
            Ιδιότητα GA4:{' '}
            <span className="font-medium text-[var(--nts-charcoal)]">{propertyName}</span>
            {dateRange && (
              <span className="ml-2 text-xs text-[#6B7280]">
                (τελευταίος συγχρονισμός: {formatDateTooltipEl(dateRange.start)} — {formatDateTooltipEl(dateRange.end)})
              </span>
            )}
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {GLOBAL_PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setGlobalPeriod(opt.key); setLocalDateFrom(''); setLocalDateTo(''); }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    !hasLocalOverride && globalPeriod === opt.key
                      ? 'bg-white text-[var(--nts-orange)] shadow-sm font-semibold'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <DateRangePicker
              from={effectiveFrom}
              to={effectiveTo}
              onChange={(f, t) => { setLocalDateFrom(f); setLocalDateTo(t); }}
              onClear={() => { setLocalDateFrom(''); setLocalDateTo(''); }}
            />
            {hasLocalOverride && (
              <button
                onClick={() => { setLocalDateFrom(''); setLocalDateTo(''); }}
                className="text-xs text-[var(--nts-orange)] hover:underline whitespace-nowrap"
              >
                ↩ Global
              </button>
            )}
          </div>
        }
      />

      {/* KPI Cards — Primary row */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {primaryKpis.map((kpi, i) => (
            <KPICard key={kpi.label} kpi={kpi} index={i} />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {secondaryKpis.map((kpi, i) => (
            <KPICard key={kpi.label} kpi={kpi} index={i + 4} />
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sessions & Users Trend */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Επισκεψιμότητα"
            subtitle="Τάση συνεδριών και χρηστών· σε μεγάλο εύρος ημέρων το chart ομαδοποιεί ανά ~7 ημέρες"
          />
          <div className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
                  formatter={(value: number | undefined, name: string | undefined) => [
                    `${Number(value ?? 0).toLocaleString('el-GR')}`,
                    name === 'users' ? 'Χρήστες' : 'Συνεδρίες',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke="#F97316"
                  fill="url(#gradSessions)"
                  strokeWidth={2}
                  name="sessions"
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#3B82F6"
                  fill="url(#gradUsers)"
                  strokeWidth={2}
                  name="users"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Traffic Sources Pie */}
        <Card>
          <CardHeader
            title="Πηγές κίνησης"
            subtitle={
              channelMixSource === 'daily'
                ? `Συνεδρίες ανά default channel group για ${formatDateTooltipEl(effectiveFrom)} — ${formatDateTooltipEl(effectiveTo)} (ημερήσια ανά κανάλι από sync). Οι γωνίες αλλάζουν όταν η κατανομή ανά ημέρα διαφέρει.`
                : channelMixSource === 'proportional'
                  ? `Για ${formatDateTooltipEl(effectiveFrom)} — ${formatDateTooltipEl(effectiveTo)}: τα μερίδια φετών ακολουθούν το σύνολο του τελευταίου GA4 sync (κλίμακα μόνο στο απόλυτο μέγεθος). Το κέντρο δείχνει τις συνεδρίες της περιόδου από τα ημερήσια KPI — κάντε επιτυχές sync με «ημερήσια ανά κανάλι» για δυναμική πίτα.`
                  : `Συνεδρίες ανά κανάλι από το property report του τελευταίου sync· χωρίς ημερήσια ανά κανάλι το σχήμα πίτας δεν φιλτράρεται στο ημερολόγιο.`
            }
          />
          <div className="p-4 pt-0">
            <div className="flex flex-col items-center">
              <div className="relative w-full h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      key={pieRechartsKey}
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      isAnimationActive={pieData.length > 0}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value, name) => [
                        `${Number(value ?? 0).toLocaleString('el-GR', { maximumFractionDigits: 1 })} συνεδρίες`,
                        String(name),
                      ]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  aria-hidden
                >
                  <div className="text-center px-2">
                    <div className="text-base font-bold text-[#111827] tabular-nums leading-tight">
                      {Math.round(pieSlicesTotal).toLocaleString('el-GR')}
                    </div>
                    <div className="text-[10px] text-[#6B7280] mt-0.5">συνεδρίες (άθροισμα καναλιών)</div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="text-[11px] text-[#374151]">{entry.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

        {/* Traffic Sources Detail Table */}
        <Card>
        <CardHeader
          title="Ανάλυση καναλιών"
          subtitle={`Ίδιο εύρος με το ημερολόγιο (${formatDateTooltipEl(effectiveFrom)} — ${formatDateTooltipEl(effectiveTo)}). Χρήστες/νέοι: άθροιση ημερών (ενδέχεται να διαφέρει από το de-duplicated GA4). Όλα τα κανάλια του property εμφανίζονται ξεχωριστά.`}
        />
        <div className="p-4 pt-0 overflow-x-auto">
          {displayTrafficSources.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#6B7280]">
              <BarChart3 size={32} className="mx-auto mb-2 text-[#D1D5DB]" />
              <p className="font-medium text-[#374151] mb-1">Δεν υπάρχουν δεδομένα καναλιών</p>
              <p>Το report των channel groups δεν ήταν διαθέσιμο κατά το τελευταίο sync.<br />
                Δοκιμάστε <strong>Sync τώρα</strong> από τη σελίδα Συνδέσεις.</p>
            </div>
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#6B7280] border-b border-[#F3F4F6]">
                <th className="pb-2 font-medium">Κανάλι</th>
                <th className="pb-2 font-medium text-right">Sessions</th>
                <th className="pb-2 font-medium text-right">Χρήστες</th>
                <th className="pb-2 font-medium text-right">Νέοι χρήστες</th>
                <th className="pb-2 font-medium text-right">Μετατροπές</th>
                <th className="pb-2 font-medium text-right">Έσοδα (GA4)</th>
                <th className="pb-2 font-medium text-right">Έσοδο / μετ.</th>
                <th className="pb-2 font-medium text-right">Conv. rate</th>
                <th className="pb-2 font-medium text-right">Μερίδιο</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalSessions = displayTrafficSources.reduce((a, x) => a + x.sessions, 0);
                return displayTrafficSources.map((s) => {
                const share = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                const convRate = s.sessions > 0 ? (s.conversions / s.sessions) * 100 : 0;
                return (
                  <tr key={s.channel} className="border-b border-[#F9FAFB] hover:bg-[#FAFAFA]">
                    <td className="py-2 flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR }}
                      />
                      {s.channel}
                    </td>
                    <td className="py-2 text-right font-medium">{s.sessions.toLocaleString()}</td>
                    <td className="py-2 text-right">{s.users.toLocaleString()}</td>
                    <td className="py-2 text-right">{(s.newUsers || 0).toLocaleString()}</td>
                    <td className="py-2 text-right">{s.conversions.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono text-[#1A1A1A]">
                      €{formatCurrency(s.totalRevenue ?? 0, 0)}
                    </td>
                    <td className="py-2 text-right font-mono text-[#374151] text-xs">
                      {s.conversions > 0
                        ? `€${formatCurrency((s.totalRevenue ?? 0) / s.conversions, 2)}`
                        : '—'}
                    </td>
                    <td className="py-2 text-right">{convRate.toFixed(1)}%</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(share, 100)}%`,
                              backgroundColor: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR,
                            }}
                          />
                        </div>
                        <span className="text-xs w-10 text-right">{share.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              });
              })()}
            </tbody>
          </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Organic Search Terms" subtitle={activeOrganicMeta.subtitle} />
        <div className="p-4 pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${activeOrganicMeta.badgeClass}`}>
                {activeOrganicMeta.label}
              </span>
              {(organicSearchSource === 'gsc' ? searchConsoleDateRange : dateRange) && (
                <span className="text-xs text-[#6B7280]">
                  Συγχρ.:{' '}
                  {formatDateTooltipEl(
                    (organicSearchSource === 'gsc' ? searchConsoleDateRange : dateRange)!.start
                  )}{' '}
                  —{' '}
                  {formatDateTooltipEl(
                    (organicSearchSource === 'gsc' ? searchConsoleDateRange : dateRange)!.end
                  )}
                </span>
              )}
            </div>
          </div>

          {organicSearchSource === 'none' ? (
            <div className="py-6 text-center text-sm text-[#6B7280]">
              <Search size={30} className="mx-auto mb-2 text-[#D1D5DB]" />
              <p className="font-medium text-[#374151] mb-1">Δεν υπάρχουν διαθέσιμα organic search terms</p>
              <p>
                {isSearchConsoleConnected
                  ? 'Το Search Console connector είναι συνδεδεμένο, αλλά δεν επέστρεψε query rows στο τελευταίο sync για αυτό το brand.'
                  : 'Συνδέστε το Google Search Console για πραγματικά queries. Αν δεν υπάρχει GSC, το GA4 fallback θα εμφανίσει οργανικά landing pages μετά από sync.'}
              </p>
            </div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  type="text"
                  placeholder={organicSearchSource === 'gsc' ? 'Αναζήτηση query...' : 'Αναζήτηση landing page...'}
                  value={organicSearchText}
                  onChange={(e) => setOrganicSearchText(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:ring-2 focus:ring-orange-200 focus:border-orange-400 outline-none"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#6B7280] border-b border-[#F3F4F6]">
                      <th className="pb-2 font-medium">{organicSearchSource === 'gsc' ? 'Query' : 'Landing page'}</th>
                      {organicSearchSource === 'gsc' ? (
                        <>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('clicks')}>
                            Clicks <OrganicSortIcon field="clicks" />
                          </th>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('impressions')}>
                            Impressions <OrganicSortIcon field="impressions" />
                          </th>
                          <th className="pb-2 font-medium text-right">CTR</th>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('position')}>
                            Avg. position <OrganicSortIcon field="position" />
                          </th>
                        </>
                      ) : (
                        <>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('sessions')}>
                            Sessions <OrganicSortIcon field="sessions" />
                          </th>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('users')}>
                            Users <OrganicSortIcon field="users" />
                          </th>
                          <th className="pb-2 font-medium text-right cursor-pointer select-none" onClick={() => handleOrganicSort('conversions')}>
                            Conversions <OrganicSortIcon field="conversions" />
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrganicRows.map((row) => (
                      <tr key={row.label} className="border-b border-[#F9FAFB] hover:bg-[#FAFAFA]">
                        <td className={`py-2 ${organicSearchSource === 'ga4_fallback' ? 'font-mono text-xs text-[#374151]' : 'text-[#111827]'}`} title={row.label}>
                          <div className="max-w-[460px] truncate">{row.label}</div>
                        </td>
                        {organicSearchSource === 'gsc' ? (
                          <>
                            <td className="py-2 text-right font-medium">{(row.clicks || 0).toLocaleString('el-GR')}</td>
                            <td className="py-2 text-right">{(row.impressions || 0).toLocaleString('el-GR')}</td>
                            <td className="py-2 text-right">{fmtPct(row.ctr || 0)}</td>
                            <td className="py-2 text-right">{(row.position || 0).toFixed(1)}</td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 text-right font-medium">{(row.sessions || 0).toLocaleString('el-GR')}</td>
                            <td className="py-2 text-right">{(row.users || 0).toLocaleString('el-GR')}</td>
                            <td className="py-2 text-right">{(row.conversions || 0).toLocaleString('el-GR')}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredOrganicRows.length === 0 && (
                <div className="py-6 text-center text-sm text-[#6B7280]">
                  Δεν βρέθηκαν organic rows για το επιλεγμένο διάστημα.
                </div>
              )}

              {organicRows.length > 15 && (
                <button
                  onClick={() => setShowAllOrganicRows(!showAllOrganicRows)}
                  className="mt-3 text-xs text-orange-600 hover:text-orange-700 font-medium"
                >
                  {showAllOrganicRows ? 'Λιγότερα' : `Εμφάνιση όλων (${organicRows.length})`}
                </button>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Top Pages */}
      <Card>
        <CardHeader
          title="Κορυφαίες σελίδες"
          subtitle="Από το τελευταίο GA4 sync (top paths ανά προβολές) — όχι φιλτραρισμένο από το ημερολόγιο"
        />
        <div className="p-4 pt-0">
          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Αναζήτηση σελίδας..."
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:ring-2 focus:ring-orange-200 focus:border-orange-400 outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#6B7280] border-b border-[#F3F4F6]">
                  <th className="pb-2 font-medium">Διαδρομή σελίδας</th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('pageViews')}
                  >
                    Προβολές <SortIcon field="pageViews" />
                  </th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('sessions')}
                  >
                    Sessions <SortIcon field="sessions" />
                  </th>
                  <th className="pb-2 font-medium text-right">Νέοι χρήστες</th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('bounceRate')}
                  >
                    Bounce rate <SortIcon field="bounceRate" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((p) => (
                  <tr key={p.path} className="border-b border-[#F9FAFB] hover:bg-[#FAFAFA]">
                    <td className="py-2 font-mono text-xs text-[#374151] max-w-[400px] truncate" title={p.path}>
                      {p.path}
                    </td>
                    <td className="py-2 text-right font-medium">{p.pageViews.toLocaleString()}</td>
                    <td className="py-2 text-right">{p.sessions.toLocaleString()}</td>
                    <td className="py-2 text-right">{((p as any).newUsers || 0).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`${
                          p.bounceRate > 0.7 ? 'text-red-500' : p.bounceRate > 0.4 ? 'text-orange-500' : 'text-amber-500'
                        }`}
                      >
                        {(p.bounceRate * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {topPages.length > 15 && (
            <button
              onClick={() => setShowAllPages(!showAllPages)}
              className="mt-3 text-xs text-orange-600 hover:text-orange-700 font-medium"
            >
              {showAllPages ? 'Λιγότερα' : `Εμφάνιση όλων (${topPages.length})`}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
