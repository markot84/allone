import { useMemo } from 'react';
import type { GeoMekkoChannel, GeoMekkoColumn } from './campaignGeoMapUtils';
import { Tooltip as InfoTooltip } from '../common';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

const fmtMoney = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const CHANNEL_FILL: Record<GeoMekkoChannel, string> = {
  'Google Ads': '#2E7D32',
  Meta: '#1565C0',
  Other: '#757575',
};

const CHANNEL_LABEL: Record<GeoMekkoChannel, string> = {
  'Google Ads': 'Google Ads',
  Meta: 'Meta',
  Other: 'Άλλο',
};

interface Props {
  columns: GeoMekkoColumn[];
  level: 'country' | 'city';
}

type ChartRow = {
  id: string;
  label: string;
  subtitle?: string;
  totalSpend: number;
  googleAds: number;
  meta: number;
  other: number;
};

function moneyTick(value: number) {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return Math.round(value).toString();
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; payload?: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const items = [
    { key: 'googleAds', label: CHANNEL_LABEL['Google Ads'], value: row.googleAds, color: CHANNEL_FILL['Google Ads'] },
    { key: 'meta', label: CHANNEL_LABEL.Meta, value: row.meta, color: CHANNEL_FILL.Meta },
    { key: 'other', label: CHANNEL_LABEL.Other, value: row.other, color: CHANNEL_FILL.Other },
  ].filter((item) => item.value > 0);

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[#111827]">{label}</p>
      {row.subtitle && <p className="text-[11px] text-[#6B7280]">{row.subtitle}</p>}
      <p className="mt-1 text-[11px] text-[#374151]">Σύνολο: {fmtMoney(row.totalSpend)}</p>
      <div className="mt-2 space-y-1">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[#4B5563]">
              <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="font-medium text-[#111827]">
              {fmtMoney(item.value)} ({((item.value / row.totalSpend) * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CampaignsGeoMekko({ columns, level }: Props) {
  const grandTotal = useMemo(
    () => columns.reduce((s, c) => s + c.totalSpend, 0),
    [columns],
  );

  const chartData = useMemo<ChartRow[]>(
    () =>
      columns.map((col) => ({
        id: col.id,
        label: col.label,
        subtitle: col.subtitle,
        totalSpend: col.totalSpend,
        googleAds: col.segments.find((s) => s.channel === 'Google Ads')?.spend ?? 0,
        meta: col.segments.find((s) => s.channel === 'Meta')?.spend ?? 0,
        other: col.segments.find((s) => s.channel === 'Other')?.spend ?? 0,
      })),
    [columns],
  );

  const channelsInUse = useMemo(() => {
    const set = new Set<GeoMekkoChannel>();
    for (const c of columns) {
      for (const seg of c.segments) {
        if (seg.spend > 0) set.add(seg.channel);
      }
    }
    return (['Google Ads', 'Meta', 'Other'] as const).filter((ch) => set.has(ch));
  }, [columns]);

  if (columns.length === 0 || grandTotal <= 0) return null;

  const chartHeight = Math.max(220, chartData.length * 42);

  return (
    <div
      className="px-4 pb-4 border-b border-[#E5E7EB]"
      role="img"
      aria-label={
        level === 'country'
          ? 'Διάγραμμα spend ανά χώρα και κανάλι'
          : 'Διάγραμμα spend ανά τοποθεσία και κανάλι'
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-[#111827] uppercase tracking-wide">
            Spend ανά {level === 'country' ? 'χώρα' : 'τοποθεσία'} και κανάλι
          </h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Στοίβαξη spend ανά κανάλι για τις top {columns.length} περιοχές.
          </p>
        </div>
        <InfoTooltip
          content="Το ίδιο spend με τον πίνακα. Κάθε οριζόντια μπάρα είναι μία περιοχή και τα χρώματα δείχνουν την κατανομή ανά κανάλι."
          size={11}
        />
      </div>

      <div className="rounded-md border border-[#E5E7EB] bg-white px-2 py-3">
        <div style={{ width: '100%', height: chartHeight }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 12, bottom: 4 }}
              barCategoryGap={10}
            >
              <CartesianGrid stroke="#F3F4F6" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: '#6B7280' }}
                tickFormatter={moneyTick}
                stroke="#D1D5DB"
              />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                tick={{ fontSize: 11, fill: '#374151' }}
                stroke="#D1D5DB"
              />
              <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(17, 24, 39, 0.04)' }} />
              <Bar dataKey="googleAds" stackId="spend" fill={CHANNEL_FILL['Google Ads']} name={CHANNEL_LABEL['Google Ads']} radius={[0, 0, 0, 0]} />
              <Bar dataKey="meta" stackId="spend" fill={CHANNEL_FILL.Meta} name={CHANNEL_LABEL.Meta} radius={[0, 0, 0, 0]} />
              <Bar dataKey="other" stackId="spend" fill={CHANNEL_FILL.Other} name={CHANNEL_LABEL.Other} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center text-[10px] text-[#4B5563]">
        {channelsInUse.map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-sm shrink-0"
              style={{ backgroundColor: CHANNEL_FILL[ch] }}
            />
            {CHANNEL_LABEL[ch]}
          </span>
        ))}
      </div>
    </div>
  );
}
