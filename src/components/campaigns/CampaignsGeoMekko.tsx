import { useMemo } from 'react';
import type { GeoChartMetric, GeoMekkoChannel, GeoMekkoColumn } from './campaignGeoMapUtils';
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
import { adChannelColor } from './channelPalette';
import { axisProps, gridProps } from '../../styles/chartTheme';

const fmtMoney = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 0 });
const fmtConv = (n: number) =>
  n.toLocaleString('el-GR', { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

/** The module's one channel palette — see `channelPalette.ts` for why it is not three. */
const CHANNEL_FILL: Record<GeoMekkoChannel, string> = {
  'Google Ads': adChannelColor('Google Ads'),
  Meta: adChannelColor('Meta'),
  Other: adChannelColor('Other'),
};

const CHANNEL_LABEL: Record<GeoMekkoChannel, string> = {
  'Google Ads': 'Google Ads',
  Meta: 'Meta',
  Other: 'Άλλο',
};

interface Props {
  columns: GeoMekkoColumn[];
  level: 'country' | 'city';
  metric: GeoChartMetric;
  onMetricChange: (metric: GeoChartMetric) => void;
}

type ChartRow = {
  id: string;
  label: string;
  subtitle?: string;
  totalValue: number;
  googleAds: number;
  meta: number;
  other: number;
};

const METRIC_META: Record<
  GeoChartMetric,
  {
    label: string;
    shortLabel: string;
    tooltipLabel: string;
    format: (value: number) => string;
    tick: (value: number) => string;
  }
> = {
  amount_spent: {
    label: 'Spend',
    shortLabel: 'Spend',
    tooltipLabel: 'Spend',
    format: fmtMoney,
    tick: (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value).toString()),
  },
  impressions: {
    label: 'Impressions',
    shortLabel: 'Impr.',
    tooltipLabel: 'Impressions',
    format: fmtNum,
    tick: (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value).toString()),
  },
  clicks: {
    label: 'Clicks',
    shortLabel: 'Clicks',
    tooltipLabel: 'Clicks',
    format: fmtNum,
    tick: (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value).toString()),
  },
  conversions: {
    label: 'Conversions',
    shortLabel: 'Conv.',
    tooltipLabel: 'Αγορές',
    format: fmtConv,
    tick: (value) => Math.round(value).toString(),
  },
  conversion_value: {
    label: 'Revenue',
    shortLabel: 'Revenue',
    tooltipLabel: 'Έσοδα',
    format: fmtMoney,
    tick: (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value).toString()),
  },
};

const METRIC_OPTIONS: GeoChartMetric[] = [
  'amount_spent',
  'impressions',
  'clicks',
  'conversions',
  'conversion_value',
];

function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; payload?: ChartRow }>;
  label?: string;
  metric: GeoChartMetric;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const meta = METRIC_META[metric];

  const items = [
    { key: 'googleAds', label: CHANNEL_LABEL['Google Ads'], value: row.googleAds, color: CHANNEL_FILL['Google Ads'] },
    { key: 'meta', label: CHANNEL_LABEL.Meta, value: row.meta, color: CHANNEL_FILL.Meta },
    { key: 'other', label: CHANNEL_LABEL.Other, value: row.other, color: CHANNEL_FILL.Other },
  ].filter((item) => item.value > 0);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[var(--text-primary)]">{label}</p>
      {row.subtitle && <p className="text-[11px] text-[var(--text-muted)]">{row.subtitle}</p>}
      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
        Σύνολο {meta.tooltipLabel}: {meta.format(row.totalValue)}
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="font-medium text-[var(--text-primary)]">
              {meta.format(item.value)} ({((item.value / row.totalValue) * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CampaignsGeoMekko({ columns, level, metric, onMetricChange }: Props) {
  const metricMeta = METRIC_META[metric];
  const grandTotal = useMemo(
    () => columns.reduce((s, c) => s + c.totalValue, 0),
    [columns],
  );

  const chartData = useMemo<ChartRow[]>(
    () =>
      columns.map((col) => ({
        id: col.id,
        label: col.label,
        subtitle: col.subtitle,
        totalValue: col.totalValue,
        googleAds: col.segments.find((s) => s.channel === 'Google Ads')?.value ?? 0,
        meta: col.segments.find((s) => s.channel === 'Meta')?.value ?? 0,
        other: col.segments.find((s) => s.channel === 'Other')?.value ?? 0,
      })),
    [columns],
  );

  const channelsInUse = useMemo(() => {
    const set = new Set<GeoMekkoChannel>();
    for (const c of columns) {
      for (const seg of c.segments) {
        if (seg.value > 0) set.add(seg.channel);
      }
    }
    return (['Google Ads', 'Meta', 'Other'] as const).filter((ch) => set.has(ch));
  }, [columns]);

  const chartHeight = Math.max(220, chartData.length * 42);

  return (
    <div
      className="px-4 pb-4 border-b border-[var(--border)]"
      role="img"
      aria-label={
        level === 'country'
          ? `Διάγραμμα ${metricMeta.label} ανά χώρα και κανάλι`
          : `Διάγραμμα ${metricMeta.label} ανά τοποθεσία και κανάλι`
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
            {metricMeta.label} ανά {level === 'country' ? 'χώρα' : 'τοποθεσία'} και κανάλι
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Top {columns.length} περιοχές με βάση το επιλεγμένο metric και στοίβαξη ανά κανάλι.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* A segmented control inside a card, so it is the board's pill row rather than the grey
              Tailwind group every page used to grow its own version of. */}
          <div className="flex items-center gap-1.5">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onMetricChange(option)}
                aria-pressed={metric === option}
                className={`signal-pill px-3 py-1.5 rounded-full text-xs font-semibold ${
                  metric === option
                    ? 'text-[var(--surface-0)] bg-[var(--orange-700)] border border-[var(--orange-700)]'
                    : 'text-[var(--text-secondary)] bg-[var(--surface-0)] border border-[var(--border)]'
                }`}
              >
                {METRIC_META[option].shortLabel}
              </button>
            ))}
          </div>
          <InfoTooltip
            content="Επίλεξε metric για να αλλάξει η κατάταξη των περιοχών και η στοίβαξη του chart. Τα χρώματα δείχνουν το μερίδιο κάθε καναλιού."
            size={11}
          />
        </div>
      </div>

      <div className="rounded-md border border-[var(--border)] bg-white px-2 py-3">
        {columns.length === 0 || grandTotal <= 0 ? (
          <div className="flex h-[220px] items-center justify-center text-center text-sm text-[var(--text-muted)]">
            Δεν υπάρχουν διαθέσιμα δεδομένα για το metric `{metricMeta.shortLabel}` σε αυτό το επίπεδο τοποθεσίας.
          </div>
        ) : (
          <div style={{ width: '100%', height: chartHeight }}>
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 12, bottom: 4 }}
                barCategoryGap={10}
              >
                {/* Horizontal bars, so the grid runs the other way: the hairlines follow the value
                    axis, which is the one a reader compares along. */}
                <CartesianGrid {...gridProps()} vertical horizontal={false} />
                <XAxis
                  type="number"
                  {...axisProps()}
                  tickFormatter={(value) => METRIC_META[metric].tick(Number(value))}
                />
                <YAxis type="category" dataKey="label" width={130} {...axisProps()} />
                <RechartsTooltip content={<ChartTooltip metric={metric} />} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="googleAds" stackId="spend" fill={CHANNEL_FILL['Google Ads']} name={CHANNEL_LABEL['Google Ads']} radius={[0, 0, 0, 0]} />
                <Bar dataKey="meta" stackId="spend" fill={CHANNEL_FILL.Meta} name={CHANNEL_LABEL.Meta} radius={[0, 0, 0, 0]} />
                <Bar dataKey="other" stackId="spend" fill={CHANNEL_FILL.Other} name={CHANNEL_LABEL.Other} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {channelsInUse.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center text-[10px] text-[var(--text-secondary)]">
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
      )}
    </div>
  );
}
