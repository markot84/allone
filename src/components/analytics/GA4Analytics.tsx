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
import { Card, CardHeader, KPICard } from '../common';
import { useGA4Data } from '../../hooks/useGA4Data';
import type { KPICardData } from '../common/KPICard';

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
};
const DEFAULT_COLOR = '#94A3B8';

type SortField = 'pageViews' | 'sessions' | 'bounceRate';

export function GA4Analytics() {
  const {
    propertyName,
    dailyEntries,
    totals,
    weeklyChange,
    trafficSources,
    topPages,
    dateRange,
    isLoading,
    hasData,
  } = useGA4Data();

  const [pageSearch, setPageSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('pageViews');
  const [sortAsc, setSortAsc] = useState(false);
  const [showAllPages, setShowAllPages] = useState(false);

  const chartData = useMemo(() => {
    if (dailyEntries.length === 0) return [];
    const step = dailyEntries.length > 30 ? 7 : 1;
    const aggregated: { date: string; sessions: number; users: number; conversions: number }[] = [];

    for (let i = 0; i < dailyEntries.length; i += step) {
      const chunk = dailyEntries.slice(i, i + step);
      aggregated.push({
        date: chunk[0].date.slice(5),
        sessions: chunk.reduce((a, d) => a + d.sessions, 0),
        users: chunk.reduce((a, d) => a + d.totalUsers, 0),
        conversions: chunk.reduce((a, d) => a + d.conversions, 0),
      });
    }
    return aggregated;
  }, [dailyEntries]);

  const pieData = useMemo(
    () =>
      trafficSources.slice(0, 8).map((s) => ({
        name: s.channel,
        value: s.sessions,
        color: CHANNEL_COLORS[s.channel] || DEFAULT_COLOR,
      })),
    [trafficSources]
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
          Συνδέστε το Google Analytics 4 από τη σελίδα Data Import και κάντε Sync.
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
      label: 'Sessions',
      value: fmt(totals.sessions),
      change: round1(weeklyChange?.sessions),
      changeLabel: 'vs 7d',
      trend: weeklyChange?.sessions != null ? (weeklyChange.sessions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.sessions),
      tooltip: 'Σύνολο sessions τελευταίων 90 ημερών',
    },
    {
      label: 'Users',
      value: fmt(totals.users),
      change: round1(weeklyChange?.users),
      changeLabel: 'vs 7d',
      trend: weeklyChange?.users != null ? (weeklyChange.users >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.totalUsers),
      tooltip: 'Μοναδικοί χρήστες τελευταίων 90 ημερών',
    },
    {
      label: 'New Users',
      value: fmt(totals.newUsers),
      change: round1(weeklyChange?.newUsers),
      changeLabel: 'vs 7d',
      trend: weeklyChange?.newUsers != null ? (weeklyChange.newUsers >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.newUsers),
      tooltip: 'Νέοι χρήστες τελευταίων 90 ημερών',
    },
    {
      label: 'Conversions',
      value: fmt(totals.conversions),
      change: round1(weeklyChange?.conversions),
      changeLabel: 'vs 7d',
      trend: weeklyChange?.conversions != null ? (weeklyChange.conversions >= 0 ? 'up' : 'down') : undefined,
      sparklineData: dailyEntries.slice(-14).map((d) => d.conversions),
      tooltip: 'Σύνολο conversions (90d)',
    },
  ];

  const secondaryKpis: KPICardData[] = [
    {
      label: 'Bounce Rate',
      value: fmtPct(totals.bounceRate),
      tooltip: 'Μέσος bounce rate (90d)',
    },
    {
      label: 'Avg Duration',
      value: fmtDuration(totals.avgDuration),
      tooltip: 'Μέση διάρκεια session',
    },
    {
      label: 'Page Views',
      value: fmt(totals.pageViews),
      sparklineData: dailyEntries.slice(-14).map((d) => d.pageViews),
      tooltip: 'Σύνολο page views (90d)',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight flex items-center gap-2">
          <BarChart3 size={24} className="text-orange-500" />
          Web Analytics
        </h2>
        <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
          GA4 Property: <span className="font-medium text-[var(--nts-charcoal)]">{propertyName}</span>
          {dateRange && (
            <span className="ml-2 text-xs">
              ({dateRange.start} — {dateRange.end})
            </span>
          )}
        </p>
      </div>

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
          <CardHeader title="Sessions & Users Trend" subtitle="Ημερήσια/εβδομαδιαία εξέλιξη" />
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
          <CardHeader title="Traffic Sources" subtitle="Κατανομή sessions ανά κανάλι" />
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
        <CardHeader title="Channel Breakdown" subtitle="Αναλυτικά ανά κανάλι κίνησης" />
        <div className="p-4 pt-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#6B7280] border-b border-[#F3F4F6]">
                <th className="pb-2 font-medium">Channel</th>
                <th className="pb-2 font-medium text-right">Sessions</th>
                <th className="pb-2 font-medium text-right">Users</th>
                <th className="pb-2 font-medium text-right">New Users</th>
                <th className="pb-2 font-medium text-right">Conversions</th>
                <th className="pb-2 font-medium text-right">Conv. Rate</th>
                <th className="pb-2 font-medium text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalSessions = trafficSources.reduce((a, x) => a + x.sessions, 0);
                return trafficSources.map((s) => {
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
        </div>
      </Card>

      {/* Top Pages */}
      <Card>
        <CardHeader title="Top Pages" subtitle="Σελίδες με τη μεγαλύτερη κίνηση" />
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
                  <th className="pb-2 font-medium">Page Path</th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('pageViews')}
                  >
                    Page Views <SortIcon field="pageViews" />
                  </th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('sessions')}
                  >
                    Sessions <SortIcon field="sessions" />
                  </th>
                  <th className="pb-2 font-medium text-right">New Users</th>
                  <th
                    className="pb-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('bounceRate')}
                  >
                    Bounce Rate <SortIcon field="bounceRate" />
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
