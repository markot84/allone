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
import { useGA4Data } from '../../hooks/useGA4Data';
import type { KPICardData } from '../common/KPICard';
import { formatCurrency } from '../../utils/format';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';

const OTHER_CHANNELS_LABEL = 'Άλλα κανάλια';

/** GA4 default channel groups: keep organic / paid / direct rows; merge referral, email, unassigned, etc. */
function channelBucket(channel: string): 'organic' | 'paid' | 'direct' | 'other' {
  const c = channel.toLowerCase().trim();
  if (c.includes('organic')) return 'organic';
  if (c.includes('paid') || c.includes('cross-network') || c.includes('cross network')) return 'paid';
  if (c === 'display') return 'paid';
  if (c.includes('direct') || c === '(direct)') return 'direct';
  return 'other';
}

type TrafficRow = {
  channel: string;
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  totalRevenue: number;
};

function aggregateOtherChannels(rows: TrafficRow[]): TrafficRow[] {
  const other: TrafficRow = {
    channel: OTHER_CHANNELS_LABEL,
    sessions: 0,
    users: 0,
    newUsers: 0,
    conversions: 0,
    totalRevenue: 0,
  };
  const kept: TrafficRow[] = [];
  for (const r of rows) {
    if (channelBucket(r.channel) === 'other') {
      other.sessions += r.sessions;
      other.users += r.users;
      other.newUsers += r.newUsers ?? 0;
      other.conversions += r.conversions;
      other.totalRevenue += r.totalRevenue ?? 0;
    } else {
      kept.push(r);
    }
  }
  const out = [...kept];
  if (other.sessions > 0 || other.conversions > 0 || other.totalRevenue > 0) {
    out.push(other);
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

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
  [OTHER_CHANNELS_LABEL]: '#78716C',
};
const DEFAULT_COLOR = '#94A3B8';

/** Το Recharts Area χρειάζεται ≥2 σημεία για ορατή γραμμή. */
function padSparklineForChart(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

type SortField = 'pageViews' | 'sessions' | 'bounceRate';

export function GA4Analytics() {
  const {
    propertyName,
    dailyEntries,
    trafficSources,
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
      return { sessions: 0, users: 0, newUsers: 0, pageViews: 0, bounceRate: 0, conversions: 0, avgDuration: 0 };
    const sum = filteredDailyEntries.reduce(
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
    };
  }, [filteredDailyEntries]);

  const displayTrafficSources = useMemo(() => {
    const rows: TrafficRow[] = trafficSources.map((s) => ({
      channel: s.channel,
      sessions: s.sessions,
      users: s.users,
      newUsers: s.newUsers ?? 0,
      conversions: s.conversions,
      totalRevenue: s.totalRevenue ?? 0,
    }));
    return aggregateOtherChannels(rows);
  }, [trafficSources]);

  const [pageSearch, setPageSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('pageViews');
  const [sortAsc, setSortAsc] = useState(false);
  const [showAllPages, setShowAllPages] = useState(false);

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

  const pieData = useMemo(
    () =>
      displayTrafficSources.slice(0, 8).map((s) => ({
        name: s.channel,
        value: s.sessions,
        color: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR,
      })),
    [displayTrafficSources]
  );

  const filteredPages = useMemo(() => {
    let pages = topPages.filter(
      (p) => !pageSearch || p.path.toLowerCase().includes(pageSearch.toLowerCase())
    );
    pages = [...pages].sort((a, b) =>
      sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]
    );
    return showAllPages ? pages : pages.slice(0, 15);
  }, [topPages, pageSearch, sortField, sortAsc, showAllPages]);

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

  const primaryKpis: KPICardData[] = [
    {
      label: 'Συνεδρίες',
      value: fmt(totals.sessions),
      change: round1(weeklyChange?.sessions),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.sessions != null ? (weeklyChange.sessions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.sessions),
      tooltip: 'Σύνολο sessions τελευταίων 90 ημερών',
    },
    {
      label: 'Χρήστες',
      value: fmt(totals.users),
      change: round1(weeklyChange?.users),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.users != null ? (weeklyChange.users >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.totalUsers),
      tooltip: 'Μοναδικοί χρήστες τελευταίων 90 ημερών',
    },
    {
      label: 'Νέοι χρήστες',
      value: fmt(totals.newUsers),
      change: round1(weeklyChange?.newUsers),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.newUsers != null ? (weeklyChange.newUsers >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.newUsers),
      tooltip: 'Νέοι χρήστες τελευταίων 90 ημερών',
    },
    {
      label: 'Μετατροπές',
      value: fmt(totals.conversions),
      change: round1(weeklyChange?.conversions),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.conversions != null ? (weeklyChange.conversions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.conversions),
      tooltip: 'Σύνολο μετατροπών (90 ημ.)',
    },
  ];

  const sparkWindow = dailyEntries.slice(-14);

  const secondaryKpis: KPICardData[] = [
    {
      label: 'Bounce rate',
      value: fmtPct(totals.bounceRate),
      change: round1(weeklyChange?.bounceRate),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.bounceRate != null ? (weeklyChange.bounceRate >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkWindow.map((d) => d.bounceRate * 100)),
      tooltip: 'Μέσος bounce rate (90 ημ.)',
    },
    {
      label: 'Μέση διάρκεια',
      value: fmtDuration(totals.avgDuration),
      change: round1(weeklyChange?.avgDuration),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.avgDuration != null ? (weeklyChange.avgDuration >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkWindow.map((d) => d.avgSessionDuration)),
      tooltip: 'Μέση διάρκεια session (GA4)',
    },
    {
      label: 'Προβολές σελίδων',
      value: fmt(totals.pageViews),
      change: round1(weeklyChange?.pageViews),
      changeLabel: 'vs 7 ημ.',
      trend: weeklyChange?.pageViews != null ? (weeklyChange.pageViews >= 0 ? 'up' : 'down') : undefined,
      sparklineData: padSparklineForChart(sparkWindow.map((d) => d.pageViews)),
      tooltip: 'Σύνολο προβολών σελίδων (90 ημ.)',
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
              <span className="ml-2 text-xs">
                (synced: {dateRange.start} — {dateRange.end})
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
        <div className="grid grid-cols-3 gap-4">
          {secondaryKpis.map((kpi, i) => (
            <KPICard key={kpi.label} kpi={kpi} index={i + 4} />
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sessions & Users Trend */}
        <Card className="lg:col-span-2">
          <CardHeader title="Τάση συνεδριών & χρηστών" subtitle="Ημερήσια/εβδομαδιαία εξέλιξη" />
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
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke="#F97316"
                  fill="url(#gradSessions)"
                  strokeWidth={2}
                  name="Sessions"
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#3B82F6"
                  fill="url(#gradUsers)"
                  strokeWidth={2}
                  name="Users"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Traffic Sources Pie */}
        <Card>
          <CardHeader title="Πηγές κίνησης" subtitle="Κατανομή sessions ανά κανάλι" />
          <div className="p-4 pt-0">
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value, name) => [
                      `${Number(value ?? 0).toLocaleString()} sessions`,
                      String(name),
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
                  />
                </PieChart>
              </ResponsiveContainer>
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
        <CardHeader title="Ανάλυση καναλιών" />
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

      {/* Top Pages */}
      <Card>
        <CardHeader title="Κορυφαίες σελίδες" subtitle="Σελίδες με τη μεγαλύτερη κίνηση" />
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
