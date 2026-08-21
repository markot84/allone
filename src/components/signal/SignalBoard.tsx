import type { CSSProperties, ReactNode } from 'react';

/**
 * The Signal Board vocabulary.
 *
 * Every card on the dashboard is one of four things: a white panel, an eyebrow over a title, a
 * labelled number, or a delta. They are here rather than inline in `DashboardOverview` so the board
 * stays one system when it grows a fifth panel, and so `/styleguide` can show what the parts are.
 *
 * Two typefaces do the work. Plus Jakarta Sans carries prose and headings; JetBrains Mono carries
 * everything that is a measurement or a label about a measurement — figures, eyebrows, axis ticks,
 * status chips. The split is what makes a dense board scannable: if it is set in mono, it is data.
 */
export const MONO = "'JetBrains Mono', monospace";

/** Numbers must not jitter as they update, and mono alone does not guarantee that. */
const NUMERIC: CSSProperties = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };

export type Delta = 'up' | 'down' | 'flat';

/** Positive is not always "up": spend rising is not good news, so the caller names the direction. */
export function deltaColor(direction: Delta): string {
  if (direction === 'up') return 'var(--success-700)';
  if (direction === 'down') return 'var(--danger-700)';
  return 'var(--text-muted)';
}

export function directionOf(value: number | null | undefined, goodWhenRising = true): Delta {
  if (value === null || value === undefined || Math.abs(value) < 0.05) return 'flat';
  const rising = value > 0;
  return rising === goodWhenRising ? 'up' : 'down';
}

/**
 * A panel on the board.
 *
 * `accent` paints the leading edge — the board's way of saying "this one is not just a
 * measurement". Used by the alert cards and the briefing, and nowhere else; an accent edge on every
 * card is no accent at all.
 */
export function SignalCard({
  accent,
  padding = 24,
  elevated = false,
  style,
  children,
  ...rest
}: {
  accent?: string;
  padding?: number;
  elevated?: boolean;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'children'>) {
  return (
    <div
      {...rest}
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--navy-100)',
        borderRadius: 16,
        ...(accent ? { borderLeft: `4px solid ${accent}` } : null),
        padding,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: elevated
          ? '0 4px 8px -2px rgba(16,24,40,0.08), 0 12px 24px -4px rgba(16,24,40,0.10)'
          : '0 3px 6px -2px rgba(16,24,40,0.07)',
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The mono kicker above a card title. Orange-700, because orange at full strength is not text. */
export function SignalEyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--orange-700)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SignalCardHeader({ eyebrow, title }: { eyebrow: string; title: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <SignalEyebrow>{eyebrow}</SignalEyebrow>
      <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.015em' }}>
        {title}
      </span>
    </div>
  );
}

/** A labelled figure: mono caps label, mono figure, optional delta line under it. */
export function MetricTile({
  label,
  value,
  size = 20,
  note,
  noteDirection,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  size?: number;
  note?: ReactNode;
  noteDirection?: Delta;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ ...NUMERIC, fontSize: size, fontWeight: 700, color: valueColor ?? 'var(--text-primary)' }}>
        {value}
      </span>
      {note !== undefined && note !== null && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: deltaColor(noteDirection ?? 'flat') }}>{note}</span>
      )}
    </div>
  );
}

/** A status chip — severity on an alert, freshness on a data source. */
export function SignalChip({
  tone,
  background,
  children,
}: {
  tone: string;
  background: string;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '5px 10px',
        borderRadius: 999,
        color: tone,
        background,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** The legend swatch shared by the revenue, campaign and segment charts. */
export function LegendKey({ color, shape = 'line', children }: { color: string; shape?: 'line' | 'block'; children: ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span
        style={{
          width: shape === 'line' ? 18 : 11,
          height: shape === 'line' ? 3 : 11,
          background: color,
          borderRadius: shape === 'line' ? 2 : 3,
          display: 'block',
          flex: 'none',
        }}
      />
      {children}
    </span>
  );
}

/** The row of mono tick labels under a chart. */
export function AxisTicks({ ticks }: { ticks: string[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(1, ticks.length)},1fr)`,
        textAlign: 'center',
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        paddingTop: 8,
      }}
    >
      {ticks.map((tick, i) => (
        <span key={`${tick}-${i}`}>{tick}</span>
      ))}
    </div>
  );
}

/** A pill button — the alert triage row and the insight "Εφαρμογή" control. */
export function PillButton({
  active,
  tone,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  tone?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const accent = tone ?? 'var(--navy-500)';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="signal-pill"
      style={{
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? accent : 'var(--surface-0)',
        color: active ? 'var(--surface-0)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        padding: '8px 13px',
        borderRadius: 999,
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

/**
 * A skeleton block with the dimensions of the thing it stands in for.
 *
 * Fixed height and width, always — a skeleton that grows into its content is a layout shift with
 * extra steps, and the board is a grid where one card resizing moves five others.
 */
export function SignalSkeleton({ height, width = '100%', radius = 8 }: { height: number; width?: number | string; radius?: number }) {
  return (
    <div
      className="animate-pulse"
      aria-hidden
      style={{ height, width, borderRadius: radius, background: 'var(--surface-2)', flex: 'none' }}
    />
  );
}
