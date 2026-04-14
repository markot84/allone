import { useMemo, useEffect, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from 'recharts';
import { Card, CardHeader } from '../common';
import { useCampaigns } from '../../hooks';
import type { Campaign } from '../../types';
import { getEffectiveConversionValue } from '../../utils/roiUtils';

const CHANNEL_COLORS: Record<string, string> = {
  'Google Ads': '#4285F4',
  Meta: '#8B5CF6',
  Other: '#F59E0B',
  TikTok: '#000000',
  LinkedIn: '#0A66C2',
  Pinterest: '#E60023',
  Skroutz: '#F68B24',
};

/**
 * Weighted-average ROAS per channel per month (last 6 buckets), from imported campaigns.
 */
export function ChannelPerformanceHistoryCard() {
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const historyChartRef = useRef<HTMLDivElement>(null);
  const [historyChartSize, setHistoryChartSize] = useState({ width: 800, height: 288 });

  const realPerformanceHistory = useMemo(() => {
    if (!hasCampaigns || campaigns.length === 0) return null;

    const buckets: Record<string, Record<string, { spend: number; value: number }>> = {};

    (campaigns as Campaign[]).forEach(c => {
      const dateStr = c.start_date || c.period || '';
      if (!dateStr) return;
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) return;
      const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
      const channel = c.channel || 'Other';

      if (!buckets[key]) buckets[key] = {};
      if (!buckets[key][channel]) buckets[key][channel] = { spend: 0, value: 0 };
      buckets[key][channel].spend += c.amount_spent || 0;
      buckets[key][channel].value += getEffectiveConversionValue(c);
    });

    const allChannelKeys = new Set<string>();
    Object.values(buckets).forEach(chMap => Object.keys(chMap).forEach(ch => allChannelKeys.add(ch)));

    const rows = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([ym, data]) => {
        const [y, m] = ym.split('-');
        const label = new Date(Number(y), Number(m) - 1).toLocaleDateString('el-GR', { month: 'short', year: '2-digit' });
        const row: Record<string, string | number> = { month: label };
        allChannelKeys.forEach(ch => {
          const d = data[ch];
          row[ch] = d && d.spend > 0 ? Math.round((d.value / d.spend) * 100) / 100 : 0;
        });
        return row;
      });

    return rows.length > 0 ? { rows, channels: Array.from(allChannelKeys) } : null;
  }, [campaigns, hasCampaigns]);

  useEffect(() => {
    const update = () => {
      if (historyChartRef.current) {
        const w = historyChartRef.current.offsetWidth || 800;
        setHistoryChartSize({ width: Math.max(w, 400), height: 288 });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (historyChartRef.current) ro.observe(historyChartRef.current);
    return () => ro.disconnect();
  }, []);

  if (!hasCampaigns) return null;

  return (
    <Card padding="lg">
      <CardHeader
        title="Channel Performance History"
        subtitle="ROAS trend τελευταίων 6 μηνών"
        icon={<TrendingUp size={20} className="text-[var(--nts-accent)]" />}
      />
      <div ref={historyChartRef} className="w-full" style={{ width: '100%', height: 288, minHeight: 288, position: 'relative' }}>
        {realPerformanceHistory && realPerformanceHistory.rows.length > 0 ? (
          <LineChart width={historyChartSize.width} height={historyChartSize.height} data={realPerformanceHistory.rows} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
            <XAxis dataKey="month" tick={{ fill: '#4A4A4A', fontSize: 12 }} axisLine={{ stroke: '#E5E5E5' }} />
            <YAxis
              tick={{ fill: '#4A4A4A', fontSize: 12 }}
              axisLine={{ stroke: '#E5E5E5' }}
              tickFormatter={(v) => `${v.toFixed(1)}x`}
              domain={[0, 'auto']}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5E5', borderRadius: '8px', padding: '10px 14px' }}
              formatter={(v, name) => [`${((v as number) || 0).toFixed(2)}x`, name as string]}
              labelFormatter={(label) => label}
            />
            <Legend />
            {realPerformanceHistory.channels.map((ch) => {
              const hasData = realPerformanceHistory.rows.some(d => (d[ch] as number) > 0);
              if (!hasData) return null;
              const color = CHANNEL_COLORS[ch] || '#6B7280';
              return (
                <Line key={ch} type="monotone" dataKey={ch} stroke={color} strokeWidth={2.5} name={ch} dot={{ r: 4, fill: color }} connectNulls />
              );
            })}
          </LineChart>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν δεδομένα performance history</p>
          </div>
        )}
      </div>
    </Card>
  );
}
