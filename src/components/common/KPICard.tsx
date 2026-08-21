import { Card } from './Card';
import { Tooltip } from './Tooltip';
import { MONO, MetricSpark, deltaColor, directionOf, type Delta } from '../signal';

/**
 * A labelled figure with a delta under it — the board's `MetricTile`, in card form.
 *
 * Three things changed when this moved onto the Signal Board's vocabulary, and each removed
 * something rather than adding it:
 *  - the arrow chip in the corner is gone; the delta line already says which way the number went,
 *    and it now says it in colour instead of in a grey box that said it twice
 *  - the Recharts sparkline is a hand-drawn SVG, which is what took the last literal accent hex out
 *    of this file
 *  - the entrance animation is gone, for the reason `Card` gives.
 */

export interface KPICardData {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  /**
   * Which way the number moved. Callers set it from the sign of `change`, so it says nothing about
   * whether the move was welcome — which is why it does not decide the colour.
   */
  trend?: 'up' | 'down';
  /**
   * Whether rising is good news. Bounce rate, ad spend, refunds and churn all fall the other way,
   * and only the caller knows which metric this is — the same rule `MetricTile` follows on the
   * dashboard, where the caller names the direction rather than the component guessing from a sign.
   */
  goodWhenRising?: boolean;
  sparklineData?: number[];
  tooltip?: string;
  /** Small caption rendered under the value (e.g. PER-301 non-merchandise revenue share). */
  subtext?: string;
  /** Pulsing dot next to the tooltip indicating the KPI is refreshing. */
  refreshing?: boolean;
}

interface KPICardProps {
  kpi: KPICardData;
  /** Position in the row. Kept for call-site compatibility; no longer staggers an animation. */
  index?: number;
  onClick?: () => void;
  className?: string;
}

/** Labels that are counts or scores rather than percentage changes — printed as-is, in neutral. */
const PLAIN_LABELS = new Set(['active', 'ενεργά', 'avg score', 'μέσος score', 'υγιή']);

export function KPICard({ kpi, onClick, className }: KPICardProps) {
  const isPlainLabel = kpi.changeLabel !== undefined && PLAIN_LABELS.has(kpi.changeLabel);

  const formatChange = (): string | null => {
    if (kpi.change == null) return null;
    if (isPlainLabel) return `${kpi.change}`;
    if (kpi.changeLabel === 'campaigns_revenue_share') return `${kpi.change}%`;
    return `${kpi.change > 0 ? '+' : ''}${kpi.change}%`;
  };

  /** A plain count carries no direction at all; everything else is judged against `goodWhenRising`. */
  const direction: Delta = isPlainLabel ? 'flat' : directionOf(kpi.change, kpi.goodWhenRising ?? true);

  const changeText = formatChange();

  return (
    <Card padding="lg" hover={!!onClick} onClick={onClick} className={`h-full ${className || ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, height: '100%' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            {kpi.label}
          </span>
          {kpi.tooltip && <Tooltip content={kpi.tooltip} size={13} />}
          {kpi.refreshing && (
            <span
              className="animate-pulse"
              title="Ανανέωση δεδομένων…"
              aria-label="Ανανέωση δεδομένων"
              style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--orange-500)', flex: 'none' }}
            />
          )}
        </span>

        <span
          style={{
            fontFamily: MONO,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--text-primary)',
          }}
        >
          {kpi.value}
        </span>

        {kpi.subtext && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{kpi.subtext}</span>}

        {kpi.sparklineData && kpi.sparklineData.length > 1 && (
          <div style={{ marginTop: 2 }}>
            <MetricSpark values={kpi.sparklineData} />
          </div>
        )}

        {(changeText || kpi.changeLabel) && (
          <span
            style={{
              marginTop: 'auto',
              paddingTop: 6,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            {changeText && (
              <span
                style={{
                  fontFamily: MONO,
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: deltaColor(direction),
                }}
              >
                {changeText}
              </span>
            )}
            {kpi.changeLabel && !isPlainLabel && kpi.changeLabel !== 'campaigns_revenue_share' && (
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{kpi.changeLabel}</span>
            )}
            {isPlainLabel && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{kpi.changeLabel}</span>}
          </span>
        )}
      </div>
    </Card>
  );
}
