import { useId } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { Card } from './Card';
import { Tooltip } from './Tooltip';
import { useAccentColor } from '../../hooks/useAccentColor';
import { useChartTheme } from '../../theme/chartTheme';

export interface KPICardData {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  trend?: 'up' | 'down';
  sparklineData?: number[];
  tooltip?: string;
  /** Pulsing dot next to the tooltip indicating the KPI is refreshing. */
  refreshing?: boolean;
}

interface KPICardProps {
  kpi: KPICardData;
  index: number;
  onClick?: () => void;
  className?: string;
}

export function KPICard({ kpi, index, onClick, className }: KPICardProps) {
  const sparkGradientId = `kpi-spark-${useId().replace(/:/g, '')}`;
  // A literal hex from the active profile. The old note here claimed var() does not resolve inside
  // SVG gradient stops — measured in Chromium, it does, for stroke, fill and stop-color alike. The
  // hook stays because the accent is a per-profile runtime value, not because var() is unavailable.
  const { accent: accentColor } = useAccentColor();
  const chartTheme = useChartTheme();

  const isPlainLabel =
    kpi.changeLabel === 'active' ||
    kpi.changeLabel === 'ενεργά' ||
    kpi.changeLabel === 'avg score' ||
    kpi.changeLabel === 'μέσος score' ||
    kpi.changeLabel === 'υγιή';

  const formatChange = () => {
    if (kpi.change == null) return null;
    if (isPlainLabel) return `${kpi.change}`;
    if (kpi.changeLabel === 'campaigns_revenue_share') return `${kpi.change}%`;
    return `${kpi.change > 0 ? '+' : ''}${kpi.change}%`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="h-full min-w-0"
    >
      {/*
        The `border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)]` that used to be
        here never rendered: Card put className on its animation wrapper, an element with no
        background and no radius. Now that className reaches the card, it still would not render —
        `.surface` sets the `border` shorthand and wins on source order — so it is dropped rather
        than left as a class that looks like it does something. Each visual direction decides its
        own hover accent deliberately.
      */}
      <Card
        padding="lg"
        hover={!!onClick}
        className={`relative h-full overflow-hidden ${className || ''}`.trim()}
        onClick={onClick}
      >
        {/*
          The sparkline is the card's BACKGROUND, not a 32px strip wedged under the number.

          As a strip it was a decoration nobody read: too short to show a shape, and it pushed the
          figure and the delta apart so the card had no centre. Full-bleed and faint, it stops being
          a chart to inspect and becomes the texture of the period — the eye registers the direction
          before it reads anything, which is the only job a sparkline this size can actually do.

          aria-hidden and pointer-events-none: it carries no information a screen reader can use and
          the number above it is already labelled.
        */}
        {kpi.sparklineData && kpi.sparklineData.length > 1 && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] opacity-[0.14]"
            aria-hidden="true"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={kpi.sparklineData.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                {/*
                  Without this, Recharts anchors the domain at zero, and a series that moves between
                  €48K and €53K renders as a flat line a few pixels tall — which is what every
                  sparkline on the dashboard was. A sparkline shows SHAPE; the magnitude is the
                  figure printed over it.
                */}
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <defs>
                  <linearGradient id={sparkGradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accentColor} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={accentColor}
                  fill={`url(#${sparkGradientId})`}
                  strokeWidth={2}
                  dot={false}
                  {...chartTheme.animation}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="relative flex items-start justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[13px] font-medium text-[var(--nts-medium-gray)]">{kpi.label}</p>
            {kpi.tooltip && <Tooltip content={kpi.tooltip} size={13} />}
            {kpi.refreshing && (
              <span
                className="inline-flex w-2 h-2 rounded-full bg-[var(--nts-accent)] animate-pulse"
                title="Ανανέωση δεδομένων…"
                aria-label="Ανανέωση δεδομένων"
              />
            )}
          </div>
          {kpi.trend === 'up' ? (
            <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
              <ArrowUpRight size={16} className="text-[var(--nts-medium-gray)]" />
            </div>
          ) : kpi.trend === 'down' ? (
            <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
              <ArrowDownRight size={16} className="text-[var(--nts-medium-gray)]" />
            </div>
          ) : null}
        </div>

        {/* `.kpi-value` carries the size, face, weight and tabular figures — see tokens.css. It
            replaces `text-3xl font-bold font-mono tracking-tight`, which set all four inline and
            skipped the tabular figures the same class exists to apply. `relative` keeps it above
            the sparkline that now sits behind the card. */}
        <p className="kpi-value relative mb-1 truncate">{kpi.value}</p>

        {(kpi.change != null || kpi.changeLabel) && (
          <div className="relative flex items-center gap-2 mt-2">
            {kpi.change != null && (
              <span className="text-[14px] font-semibold px-2 py-0.5 rounded-lg text-[var(--nts-medium-gray)] bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)]">
                {formatChange()}
              </span>
            )}
            {kpi.changeLabel && (
              <span className="text-[13px] text-[var(--nts-medium-gray)]">{kpi.changeLabel}</span>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
