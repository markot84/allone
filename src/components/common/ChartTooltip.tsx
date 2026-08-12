import type { ReactNode } from 'react';

interface ChartTooltipEntry {
  name?: ReactNode;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: ReactNode;
  payload?: ChartTooltipEntry[];
  /** Turns a raw series value into what the user should read. */
  format?: (value: number | string, entry: ChartTooltipEntry) => ReactNode;
  /** Turns the x-axis key into a heading. */
  formatLabel?: (label: ReactNode) => ReactNode;
}

/**
 * The tooltip, designed rather than configured.
 *
 * Recharts' own tooltip is a bordered box with the series name and value on one line in the series
 * colour. It is legible and it looks like a library — which is most of why a chart reads as
 * generic no matter how carefully its colours are chosen. The pointer spends more time on the
 * tooltip than on any other part of a chart, so it is worth more than a `contentStyle` object.
 *
 * What changes: the label becomes a small muted heading rather than another value; each series gets
 * a colour swatch so the eye matches it to the chart instead of reading its name; and the number is
 * the largest thing in the box, in the mono face with tabular figures, so it does not reflow as the
 * pointer moves along the series.
 */
export function ChartTooltip({ active, label, payload, format, formatLabel }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--ui-radius-md)',
        boxShadow: 'var(--elev-3)',
        padding: '10px 12px',
        minWidth: 132,
        pointerEvents: 'none'
      }}
    >
      {label != null && label !== '' && (
        <div
          style={{
            font: '500 11px/1.4 var(--font-body)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 6
          }}
        >
          {formatLabel ? formatLabel(label) : label}
        </div>
      )}

      <div style={{ display: 'grid', gap: 4 }}>
        {payload.map((entry, index) => (
          <div key={entry.dataKey ?? index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {entry.color && (
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 'var(--ui-radius-pill)',
                  background: entry.color,
                  flexShrink: 0
                }}
              />
            )}
            {payload.length > 1 && entry.name != null && (
              <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--text-secondary)' }}>
                {entry.name}
              </span>
            )}
            <span
              className="metric"
              style={{
                marginLeft: 'auto',
                font: '600 15px/1.2 var(--font-mono)',
                color: 'var(--text-primary)'
              }}
            >
              {format && entry.value != null ? format(entry.value, entry) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
