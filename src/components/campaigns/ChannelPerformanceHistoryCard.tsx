import { useMemo, useEffect, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from 'recharts';
import { axisProps, gridProps, legendProps, tooltipProps } from '../../styles/chartTheme';
import { adChannelColor } from './channelPalette';
import { Card, CardHeader } from '../common';
import { useCampaigns } from '../../hooks/useCampaigns';
import type { Campaign } from '../../types';
import { eachDateInclusive } from '../../utils/marketingCostPeriod';
import {
  eachCalendarMonthInclusive,
  formatMonthKeyShort,
  getCampaignDailyAttributedSpendInPeriod,
  getCampaignDailyAttributedValueInPeriod,
} from '../../utils/roiUtils';

const channelLineColor = adChannelColor;

const MAX_DAILY_POINTS = 90;

/** Day-axis label in MM-DD format. */
function formatChartDayLabelMmDd(ymd: string): string {
  const parts = ymd.split('-');
  const m = parts[1];
  const d = parts[2];
  if (!m || !d) return ymd;
  return `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function formatRangeSubtitle(from: string, to: string): string {
  const a = new Date(from + 'T12:00:00');
  const b = new Date(to + 'T12:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${a.toLocaleDateString('el-GR', opt)} – ${b.toLocaleDateString('el-GR', opt)}`;
}

type ChannelSv = { spend: number; value: number };

/** Weighted ROAS per channel per time bucket within [dateFrom, dateTo] (daily, or monthly if range is long). */
export function ChannelPerformanceHistoryCard({
  dateFrom,
  dateTo,
}: {
  dateFrom: string;
  dateTo: string;
}) {
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const historyChartRef = useRef<HTMLDivElement>(null);
  const [historyChartSize, setHistoryChartSize] = useState({ width: 800, height: 288 });

  const realPerformanceHistory = useMemo(() => {
    if (!hasCampaigns || campaigns.length === 0 || !dateFrom || !dateTo) return null;

    const days = eachDateInclusive(dateFrom, dateTo);
    if (days.length === 0) return null;

    const byDayCh: Record<string, Record<string, ChannelSv>> = {};

    const ensure = (day: string, ch: string) => {
      if (!byDayCh[day]) byDayCh[day] = {};
      if (!byDayCh[day][ch]) byDayCh[day][ch] = { spend: 0, value: 0 };
    };

    (campaigns as Campaign[]).forEach((c) => {
      const ch = c.channel || 'Other';
      const vMap = getCampaignDailyAttributedValueInPeriod(c, dateFrom, dateTo);
      const sMap = getCampaignDailyAttributedSpendInPeriod(c, dateFrom, dateTo);
      const daySet = new Set<string>([...vMap.keys(), ...sMap.keys()]);
      daySet.forEach((day) => {
        if (day < dateFrom || day > dateTo) return;
        ensure(day, ch);
        byDayCh[day][ch].value += vMap.get(day) || 0;
        byDayCh[day][ch].spend += sMap.get(day) || 0;
      });
    });

    const allChannelKeys = new Set<string>();
    for (const day of days) {
      const dm = byDayCh[day];
      if (dm) Object.keys(dm).forEach((ch) => allChannelKeys.add(ch));
    }
    if (allChannelKeys.size === 0) return null;

    const roasRow = (label: string, agg: Record<string, ChannelSv>) => {
      const row: Record<string, string | number> = { label };
      allChannelKeys.forEach((ch) => {
        const cell = agg[ch];
        row[ch] = cell && cell.spend > 0 ? Math.round((cell.value / cell.spend) * 100) / 100 : 0;
      });
      return row;
    };

    const useMonthly = days.length > MAX_DAILY_POINTS;
    const fromYm = dateFrom.slice(0, 7);
    const toYm = dateTo.slice(0, 7);

    if (!useMonthly) {
      const rows = days.map((day) => roasRow(formatChartDayLabelMmDd(day), byDayCh[day] || {}));
      return { rows, channels: Array.from(allChannelKeys) };
    }

    const months = eachCalendarMonthInclusive(fromYm, toYm);
    const rows = months.map((ym) => {
      const agg: Record<string, ChannelSv> = {};
      for (const day of days) {
        if (day.slice(0, 7) !== ym) continue;
        const dm = byDayCh[day];
        if (!dm) continue;
        for (const [ch, sv] of Object.entries(dm)) {
          if (!agg[ch]) agg[ch] = { spend: 0, value: 0 };
          agg[ch].spend += sv.spend;
          agg[ch].value += sv.value;
        }
      }
      return roasRow(formatMonthKeyShort(ym), agg);
    });

    return { rows, channels: Array.from(allChannelKeys) };
  }, [campaigns, hasCampaigns, dateFrom, dateTo]);

  const rangeDayCount = useMemo(() => {
    if (!dateFrom || !dateTo) return 0;
    return eachDateInclusive(dateFrom, dateTo).length;
  }, [dateFrom, dateTo]);

  const subtitle = useMemo(() => {
    const r = formatRangeSubtitle(dateFrom, dateTo);
    if (!r) return 'ROAS ανά κανάλι στο επιλεγμένο εύρος';
    const span = rangeDayCount > MAX_DAILY_POINTS ? 'μηνιαία σειρά' : 'ημερήσια σειρά';
    return `ROAS trend (${span}) · ${r}`;
  }, [dateFrom, dateTo, rangeDayCount]);

  useEffect(() => {
    const update = () => {
      if (historyChartRef.current) {
        const w = historyChartRef.current.getBoundingClientRect().width;
        if (w > 0) setHistoryChartSize({ width: Math.max(1, Math.round(w)), height: 288 });
      }
    };
    const ro = new ResizeObserver(update);
    if (historyChartRef.current) ro.observe(historyChartRef.current);
    const t = window.setTimeout(update, 0);
    const raf = requestAnimationFrame(update);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [realPerformanceHistory?.rows.length]);

  if (!hasCampaigns) return null;

  return (
    <Card padding="lg">
      <CardHeader
        title="Channel Performance History"
        subtitle={subtitle}
        icon={<TrendingUp size={20} className="text-[var(--nts-accent-text)]" />}
      />
      <div ref={historyChartRef} className="relative w-full min-w-0 max-w-full" style={{ height: 288, minHeight: 288 }}>
        {realPerformanceHistory && realPerformanceHistory.rows.length > 0 ? (
          <LineChart width={historyChartSize.width} height={historyChartSize.height} data={realPerformanceHistory.rows} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid {...gridProps()} />
            <XAxis dataKey="label" {...axisProps()} />
            <YAxis {...axisProps()} width={48} tickFormatter={(v) => `${v.toFixed(1)}x`} domain={[0, 'auto']} />
            <Tooltip
              {...tooltipProps()}
              formatter={(v, name) => [`${((v as number) || 0).toFixed(2)}x`, name as string]}
              labelFormatter={(label) => label}
            />
            <Legend {...legendProps()} />
            {realPerformanceHistory.channels.map((ch) => {
              // PER-308: render zero-ROAS channels too — a channel with spend but no purchase value (TikTok) must stay visible.
              const color = channelLineColor(ch);
              return (
                <Line key={ch} type="monotone" dataKey={ch} stroke={color} strokeWidth={2.5} name={ch} dot={{ r: 3, fill: color, strokeWidth: 0 }} connectNulls />
              );
            })}
          </LineChart>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--text-secondary)]">Δεν υπάρχουν δεδομένα performance history για αυτό το εύρος</p>
          </div>
        )}
      </div>
    </Card>
  );
}
