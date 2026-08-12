import { useId, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Tooltip } from './Tooltip';
import { useAccentColor } from '../../hooks/useAccentColor';
import { useCountUpOnce } from '../../hooks/useCountUpOnce';

export interface HeroKPICardProps {
  label: string;
  /** The raw figure, so it can be counted up. `format` turns it into what is displayed. */
  value: number;
  format: (value: number) => string;
  /** Identifies the FIGURE for the once-per-session count — metric + brand + period, not the component. */
  countKey: string;
  change?: number;
  changeLabel?: string;
  trend?: 'up' | 'down';
  sparklineData?: number[];
  tooltip?: string;
  refreshing?: boolean;
  footer?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * The one figure the screen is about.
 *
 * A row of equally sized KPI cards says every number matters equally, which means none of them
 * does — the eye has nowhere to land and the page gets read left to right like a table. This card
 * breaks that tie: the same data as a KPICard, given roughly four times the area and a number large
 * enough to read across a room, which is the actual use during a presentation.
 *
 * The sparkline is the card's BACKGROUND rather than a strip below the number. At low opacity it is
 * not a chart to be read precisely; it is the shape of the period sitting underneath its own total,
 * so "up" or "down" registers before any axis is examined.
 */
export function HeroKPICard({
  label,
  value,
  format,
  countKey,
  change,
  changeLabel,
  trend,
  sparklineData,
  tooltip,
  refreshing,
  footer,
  onClick,
  className = ''
}: HeroKPICardProps) {
  const gradientId = `hero-spark-${useId().replace(/:/g, '')}`;
  // Literal hex from the active profile: var() does not resolve inside SVG gradient stops.
  const { accent } = useAccentColor();
  const counted = useCountUpOnce(value, countKey);

  const hasSpark = !!sparklineData && sparklineData.length > 1;
  const TrendIcon = trend === 'down' ? ArrowDownRight : ArrowUpRight;

  return (
    <div
      className={`surface relative flex h-full min-w-0 flex-col overflow-hidden ${className}`.trim()}
      data-interactive={onClick ? 'true' : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{ cursor: onClick ? 'pointer' : 'default', padding: 0 }}
    >
      {hasSpark && (
        // aria-hidden and pointer-events-none: it is texture behind the figure, not a control and
        // not information a screen reader can act on.
        <div
          // Full height, not the bottom 62%: in a 2x2 bento the hero is roughly 360px tall and the
          // figure sits at the bottom, so a short sparkline left the top third as blank white. The
          // shape of the period filling the card is the whole idea.
          className="pointer-events-none absolute inset-0"
          style={{ opacity: 'var(--hero-spark-opacity)' }}
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData!.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={accent}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[13px] font-medium uppercase tracking-[0.10em] text-[var(--text-muted)]">
              {label}
            </p>
            {tooltip && <Tooltip content={tooltip} size={13} />}
            {refreshing && (
              <span
                className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--nts-accent)]"
                title="Ανανέωση δεδομένων…"
                aria-label="Ανανέωση δεδομένων"
              />
            )}
          </div>
          {trend && (
            <span
              className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5"
              aria-hidden="true"
            >
              <TrendIcon size={16} className="text-[var(--text-secondary)]" />
            </span>
          )}
        </div>

        <div className="min-w-0">
          {/*
            clamp() rather than breakpoints, because this number has to survive from a 375px phone
            to a projector without a set of size classes per viewport. Tabular figures matter more
            here than anywhere else: at this size a proportional digit would visibly shift the whole
            figure while it counts.
          */}
          <p
            className="kpi-value truncate"
            style={{ fontSize: 'clamp(2.25rem, 6.2vw, 4.5rem)' }}
          >
            {format(counted)}
          </p>
          {(change != null || changeLabel) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {change != null && (
                <span
                  className="rounded-lg border px-2 py-0.5 text-[14px] font-semibold"
                  style={{
                    color: change >= 0 ? 'var(--success)' : 'var(--danger)',
                    borderColor: change >= 0 ? 'var(--success)' : 'var(--danger)',
                    background: change >= 0 ? 'var(--success-light)' : 'var(--danger-light)'
                  }}
                >
                  {change > 0 ? '+' : ''}
                  {change}%
                </span>
              )}
              {changeLabel && <span className="text-[13px] text-[var(--text-muted)]">{changeLabel}</span>}
            </div>
          )}
        </div>

        {footer && <div className="min-w-0">{footer}</div>}
      </div>
    </div>
  );
}
