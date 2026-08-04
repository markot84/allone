import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import { ChevronDown, ChevronUp, Megaphone, TrendingUp } from 'lucide-react';
import { Card, CardHeader, Tooltip, Button, ColumnExcelFilter } from '../common';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '../../utils/format';
import { eachDateInclusive } from '../../utils/marketingCostPeriod';
import { formatTrendDayLabel } from '../../utils/roiUtils';
import type { Campaign } from '../../types';
import type { ExcelFilterOption } from '../common/ColumnExcelFilter';

const SPEND_COLOR = '#FDBA74';
const REVENUE_COLOR = '#10B981';
const VISIBLE_ROW_COUNT = 7;
const ROW_HEIGHT_REM = 2.75;

type ImpactRow = {
  id: string;
  name: string;
  channel: string;
  spend: number;
  platformValue: number;
  platformRoas: number | null;
  storeCorrelated: number;
  storeRoas: number | null;
  conversions: number;
  spendBucket: string;
  roasBucket: string;
};

type SortKey = 'name' | 'channel' | 'spend' | 'platformValue' | 'platformRoas' | 'storeCorrelated' | 'storeRoas';

function aggregateDailySpend(
  campaigns: Campaign[],
  fromDate: string,
  toDate: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of campaigns) {
    const dm = c.dailyMetrics;
    if (!dm) continue;
    for (const [day, m] of Object.entries(dm)) {
      if (day < fromDate || day > toDate) continue;
      out[day] = (out[day] || 0) + (Number(m.amount_spent) || 0);
    }
  }
  return out;
}

function spendBucketId(spend: number): string {
  if (spend <= 0) return 'zero';
  if (spend < 500) return 'low';
  if (spend < 2000) return 'mid';
  return 'high';
}

function roasBucketId(roas: number | null): string {
  if (roas == null || roas <= 0) return 'none';
  if (roas < 1) return 'under1';
  if (roas < 3) return '1to3';
  return '3plus';
}

const SPEND_BUCKET_OPTIONS: ExcelFilterOption[] = [
  { id: 'zero', label: '€0' },
  { id: 'low', label: '< €500' },
  { id: 'mid', label: '€500 – €2k' },
  { id: 'high', label: '≥ €2k' },
];

const ROAS_BUCKET_OPTIONS: ExcelFilterOption[] = [
  { id: 'none', label: '— / 0' },
  { id: 'under1', label: '< 1x' },
  { id: '1to3', label: '1x – 3x' },
  { id: '3plus', label: '≥ 3x' },
];

function passesExcelFilter(selected: string[] | null, id: string): boolean {
  if (selected == null) return true;
  if (selected.length === 0) return false;
  return selected.includes(id);
}

export interface CampaignImpactPanelProps {
  campaigns: Campaign[];
  periodDates: { fromDate: string; toDate: string };
  ecommRevenueByDay: Record<string, number>;
  storeRevenueInPeriod: number;
  hasEcommerce: boolean;
}

export function CampaignImpactPanel({
  campaigns,
  periodDates,
  ecommRevenueByDay,
  storeRevenueInPeriod,
  hasEcommerce,
}: CampaignImpactPanelProps) {
  const { fromDate, toDate } = periodDates;
  const [tableExpanded, setTableExpanded] = useState(false);
  const [nameFilter, setNameFilter] = useState<string[] | null>(null);
  const [channelFilter, setChannelFilter] = useState<string[] | null>(null);
  const [spendFilter, setSpendFilter] = useState<string[] | null>(null);
  const [roasFilter, setRoasFilter] = useState<string[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const totalPlatformValue = useMemo(
    () => campaigns.reduce((s, c) => s + (c.conversion_value || 0), 0),
    [campaigns]
  );

  const tableRows = useMemo((): ImpactRow[] => {
    return campaigns.map((c) => {
      const spend = c.amount_spent || 0;
      const platformValue = c.conversion_value || 0;
      const platformRoas = spend > 0 ? platformValue / spend : null;
      const share = totalPlatformValue > 0 ? platformValue / totalPlatformValue : 0;
      const storeCorrelated =
        hasEcommerce && storeRevenueInPeriod > 0 ? storeRevenueInPeriod * share : 0;
      const storeRoas = spend > 0 && storeCorrelated > 0 ? storeCorrelated / spend : null;
      return {
        id: c.id,
        name: c.name,
        channel: c.channel || 'Other',
        spend,
        platformValue,
        platformRoas,
        storeCorrelated,
        storeRoas,
        conversions: c.conversions || 0,
        spendBucket: spendBucketId(spend),
        roasBucket: roasBucketId(platformRoas),
      };
    });
  }, [campaigns, hasEcommerce, storeRevenueInPeriod, totalPlatformValue]);

  const nameOptions = useMemo(
    () =>
      [...new Map(tableRows.map((r) => [r.id, { id: r.id, label: r.name }])).values()].sort((a, b) =>
        a.label.localeCompare(b.label, 'el'),
      ),
    [tableRows],
  );

  const channelOptions = useMemo(
    () =>
      [...new Set(tableRows.map((r) => r.channel))]
        .sort((a, b) => a.localeCompare(b, 'el'))
        .map((ch) => ({ id: ch, label: ch })),
    [tableRows],
  );

  const filteredRows = useMemo(() => {
    const rows = tableRows.filter(
      (r) =>
        passesExcelFilter(nameFilter, r.id) &&
        passesExcelFilter(channelFilter, r.channel) &&
        passesExcelFilter(spendFilter, r.spendBucket) &&
        passesExcelFilter(roasFilter, r.roasBucket),
    );
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') return mult * av.localeCompare(bv, 'el');
      const na = typeof av === 'number' ? av : -1;
      const nb = typeof bv === 'number' ? bv : -1;
      return mult * (na - nb);
    });
  }, [tableRows, nameFilter, channelFilter, spendFilter, roasFilter, sortKey, sortDir]);

  const timelineData = useMemo(() => {
    const spendByDay = aggregateDailySpend(campaigns, fromDate, toDate);
    return eachDateInclusive(fromDate, toDate).map((date) => ({
      date,
      label: formatTrendDayLabel(date),
      spend: Math.round((spendByDay[date] || 0) * 100) / 100,
      storeRevenue: Math.round((ecommRevenueByDay[date] || 0) * 100) / 100,
    }));
  }, [campaigns, ecommRevenueByDay, fromDate, toDate]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'channel' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (campaigns.length === 0) return null;

  const showExpandControl = filteredRows.length > VISIBLE_ROW_COUNT;

  const ThLabel = ({
    label,
    sortableKey,
    filter,
  }: {
    label: string;
    sortableKey?: SortKey;
    filter?: React.ReactNode;
  }) => (
    <th className="px-2 py-2 align-bottom">
      <div className="flex flex-col items-stretch gap-1">
        {sortableKey ? (
          <button
            type="button"
            onClick={() => toggleSort(sortableKey)}
            className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] hover:text-[#111827]"
          >
            {label}
            {sortIndicator(sortableKey)}
          </button>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</span>
        )}
        {filter}
      </div>
    </th>
  );

  return (
    <Card padding="lg">
      <CardHeader
        title="Απόδοση καμπανιών × πωλήσεις"
        subtitle="Hybrid: platform reported (Google/Meta) + e-shop revenue στην ίδια περίοδο (correlated, όχι incrementality)."
        icon={<Megaphone size={20} className="text-[var(--nts-accent-text)]" />}
      />

      <div
        className="mt-4 overflow-x-auto overflow-y-auto rounded-xl border border-[#E5E7EB]"
        style={tableExpanded ? undefined : { maxHeight: `calc(${VISIBLE_ROW_COUNT} * ${ROW_HEIGHT_REM}rem + 3.5rem)` }}
      >
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#FAFAFA] shadow-[0_1px_0_#E5E7EB]">
            <tr className="border-b border-[#E5E7EB]">
              <ThLabel
                label="Καμπάνια"
                sortableKey="name"
                filter={
                  <ColumnExcelFilter
                    compact
                    label="Καμπάνια"
                    options={nameOptions}
                    value={nameFilter}
                    onChange={setNameFilter}
                  />
                }
              />
              <ThLabel
                label="Κανάλι"
                sortableKey="channel"
                filter={
                  <ColumnExcelFilter
                    compact
                    label="Κανάλι"
                    options={channelOptions}
                    value={channelFilter}
                    onChange={setChannelFilter}
                  />
                }
              />
              <ThLabel
                label="Spend"
                sortableKey="spend"
                filter={
                  <ColumnExcelFilter
                    compact
                    label="Spend"
                    options={SPEND_BUCKET_OPTIONS}
                    value={spendFilter}
                    onChange={setSpendFilter}
                  />
                }
              />
              <th className="px-2 py-2 align-bottom text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('platformValue')}
                  className="text-right text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] hover:text-[#111827]"
                >
                  <Tooltip content="Conversion value από Google Ads / Meta για την περίοδο.">
                    Platform value
                  </Tooltip>
                  {sortIndicator('platformValue')}
                </button>
              </th>
              <ThLabel
                label="Platform ROAS"
                sortableKey="platformRoas"
                filter={
                  <ColumnExcelFilter
                    compact
                    label="Platform ROAS"
                    options={ROAS_BUCKET_OPTIONS}
                    value={roasFilter}
                    onChange={setRoasFilter}
                  />
                }
              />
              {hasEcommerce && (
                <>
                  <th className="px-2 py-2 align-bottom text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('storeCorrelated')}
                      className="text-right text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] hover:text-[#111827]"
                    >
                      <Tooltip content="Μερίδιο τζίρου e-shop στην περίοδο ανάλογα με platform value (εκτίμηση correlation).">
                        Store corr.
                      </Tooltip>
                      {sortIndicator('storeCorrelated')}
                    </button>
                  </th>
                  <ThLabel label="Store ROAS" sortableKey="storeRoas" />
                </>
              )}
            </tr>
          </thead>
          <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={hasEcommerce ? 7 : 5}
                    className="px-3 py-8 text-center text-sm text-[#6B7280]"
                  >
                    Καμία καμπάνια με τα τρέχοντα φίλτρα.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                    <td
                      className="max-w-[220px] truncate px-3 py-2 font-medium text-[#1A1A1A]"
                      style={{ height: `${ROW_HEIGHT_REM}rem` }}
                      title={row.name}
                    >
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-[#4A4A4A]" style={{ height: `${ROW_HEIGHT_REM}rem` }}>
                      {row.channel}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(row.spend, 0)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(row.platformValue, 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.platformRoas != null ? `${formatNumber(row.platformRoas, 2)}x` : '—'}
                    </td>
                    {hasEcommerce && (
                      <>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-[#059669]">
                          {formatCurrency(row.storeCorrelated, 0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {row.storeRoas != null ? `${formatNumber(row.storeRoas, 2)}x` : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
          </tbody>
        </table>
      </div>

      {(showExpandControl || filteredRows.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#6B7280]">
            {filteredRows.length} καμπάνι{filteredRows.length === 1 ? 'α' : 'ες'}
            {!tableExpanded && showExpandControl
              ? ` · εμφανίζονται ${VISIBLE_ROW_COUNT} με scroll`
              : ''}
          </p>
          {showExpandControl && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setTableExpanded((v) => !v)}
              className="gap-1.5"
            >
              {tableExpanded ? (
                <>
                  <ChevronUp size={16} aria-hidden />
                  Σύμπτυξη πίνακα
                </>
              ) : (
                <>
                  <ChevronDown size={16} aria-hidden />
                  Εμφάνιση όλων ({filteredRows.length})
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {hasEcommerce && timelineData.some((d) => d.spend > 0 || d.storeRevenue > 0) && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1A1A1A]">
            <TrendingUp size={16} className="text-[var(--nts-accent-text)]" />
            Timeline: ad spend vs e-shop revenue
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timelineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  yAxisId="spend"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatCurrencyCompact(Number(v))}
                />
                <YAxis
                  yAxisId="rev"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatCurrencyCompact(Number(v))}
                />
                <RechartsTooltip
                  formatter={(value, name) => [
                    formatCurrency(Number(value) || 0, 0),
                    name === 'spend' ? 'Ad spend' : 'E-shop revenue',
                  ]}
                />
                <Legend />
                <Area
                  yAxisId="spend"
                  type="monotone"
                  dataKey="spend"
                  name="Ad spend"
                  stroke={SPEND_COLOR}
                  fill={SPEND_COLOR}
                  fillOpacity={0.25}
                />
                <Line
                  yAxisId="rev"
                  type="monotone"
                  dataKey="storeRevenue"
                  name="E-shop revenue"
                  stroke={REVENUE_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-[#6B7280]">
            Το e-shop revenue είναι πραγματικός τζίρος ημέρας· το spend αθροίζει daily metrics καμπανιών (όπου διαθέσιμα).
          </p>
        </div>
      )}
    </Card>
  );
}
