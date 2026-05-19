import { useMemo } from 'react';
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
import { Megaphone, TrendingUp } from 'lucide-react';
import { Card, CardHeader, Tooltip } from '../common';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '../../utils/format';
import { eachDateInclusive } from '../../utils/marketingCostPeriod';
import { formatTrendDayLabel } from '../../utils/roiUtils';
import type { Campaign } from '../../types';

const SPEND_COLOR = '#FDBA74';
const REVENUE_COLOR = '#10B981';

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

  const totalPlatformValue = useMemo(
    () => campaigns.reduce((s, c) => s + (c.conversion_value || 0), 0),
    [campaigns]
  );

  const tableRows = useMemo(() => {
    return [...campaigns]
      .map((c) => {
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
          channel: c.channel,
          spend,
          platformValue,
          platformRoas,
          storeCorrelated,
          storeRoas,
          conversions: c.conversions || 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns, hasEcommerce, storeRevenueInPeriod, totalPlatformValue]);

  const timelineData = useMemo(() => {
    const spendByDay = aggregateDailySpend(campaigns, fromDate, toDate);
    return eachDateInclusive(fromDate, toDate).map((date) => ({
      date,
      label: formatTrendDayLabel(date),
      spend: Math.round((spendByDay[date] || 0) * 100) / 100,
      storeRevenue: Math.round((ecommRevenueByDay[date] || 0) * 100) / 100,
    }));
  }, [campaigns, ecommRevenueByDay, fromDate, toDate]);

  if (campaigns.length === 0) return null;

  return (
    <Card padding="lg">
      <CardHeader
        title="Απόδοση καμπανιών × πωλήσεις"
        subtitle="Hybrid: platform reported (Google/Meta) + e-shop revenue στην ίδια περίοδο (correlated, όχι incrementality)."
        icon={<Megaphone size={20} className="text-[var(--nts-accent)]" />}
      />

      <div className="mt-4 overflow-x-auto rounded-xl border border-[#E5E7EB]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#FAFAFA] text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              <th className="px-3 py-2.5">Καμπάνια</th>
              <th className="px-3 py-2.5">Κανάλι</th>
              <th className="px-3 py-2.5 text-right">Spend</th>
              <th className="px-3 py-2.5 text-right">
                <Tooltip content="Conversion value από Google Ads / Meta για την περίοδο.">Platform value</Tooltip>
              </th>
              <th className="px-3 py-2.5 text-right">Platform ROAS</th>
              {hasEcommerce && (
                <>
                  <th className="px-3 py-2.5 text-right">
                    <Tooltip content="Μερίδιο τζίρου e-shop στην περίοδο ανάλογα με platform value (εκτίμηση correlation).">
                      Store corr.
                    </Tooltip>
                  </th>
                  <th className="px-3 py-2.5 text-right">Store ROAS</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.id} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                <td className="max-w-[220px] truncate px-3 py-2 font-medium text-[#1A1A1A]" title={row.name}>
                  {row.name}
                </td>
                <td className="px-3 py-2 text-[#4A4A4A]">{row.channel}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(row.spend, 0)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(row.platformValue, 0)}</td>
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
            ))}
          </tbody>
        </table>
      </div>

      {hasEcommerce && timelineData.some((d) => d.spend > 0 || d.storeRevenue > 0) && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1A1A1A]">
            <TrendingUp size={16} className="text-[var(--nts-accent)]" />
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
