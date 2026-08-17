import { useId } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Card } from './Card';
import { Tooltip } from './Tooltip';
import { useAccentColor } from '../../hooks/useAccentColor';

export interface KPICardData {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  trend?: 'up' | 'down';
  sparklineData?: number[];
  tooltip?: string;
  /** Small caption rendered under the value (e.g. PER-301 non-merchandise revenue share). */
  subtext?: string;
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
  // Literal hex from the active profile; var(--nts-accent) does not resolve reliably
  // inside SVG gradient stops / url(#id).
  const { accent: accentColor } = useAccentColor();

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
      <Card
        padding="lg"
        hover={!!onClick}
        className={`border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)] h-full ${className || ''}`}
        onClick={onClick}
      >
        <div className="flex items-start justify-between mb-3">
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

        <p className="text-3xl font-bold text-[var(--nts-charcoal)] mb-1 font-mono tracking-tight">
          {kpi.value}
        </p>

        {kpi.subtext && (
          <p className="text-[11px] text-[var(--nts-medium-gray)] mb-1">{kpi.subtext}</p>
        )}

        {kpi.sparklineData && kpi.sparklineData.length > 0 && (
          <div className="my-1 h-[32px] w-full min-w-0 -mx-1">
            <ResponsiveContainer width="100%" height={32}>
              <AreaChart data={kpi.sparklineData.map((v, i) => ({ v, i }))} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
                <defs>
                  <linearGradient id={sparkGradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={accentColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={accentColor}
                  fill={`url(#${sparkGradientId})`}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {(kpi.change != null || kpi.changeLabel) && (
          <div className="flex items-center gap-2 mt-2">
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
