import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
  /** CSS width — a number is treated as px. Defaults to filling the parent. */
  width?: number | string;
  /** CSS height — a number is treated as px. */
  height?: number | string;
  /**
   * `text` rounds to the text radius, `card` to the card radius, `pill` to a capsule (badges,
   * chips, segmented controls), `circle` to a disc — which also forces a 1:1 ratio.
   */
  shape?: 'text' | 'card' | 'circle' | 'pill';
  className?: string;
  style?: CSSProperties;
}

/**
 * A placeholder with the dimensions of the thing that is coming.
 *
 * CLAUDE.md lists "no layout shift while data loads: skeletons with fixed dimensions" as
 * non-negotiable, but the app resolved loading with `<Spinner>` in 28 files against skeletons in 4.
 * A spinner says "wait"; it also throws away the layout, so the page jumps when data lands. On
 * screens backed by Firestore aggregates, which is most of them, that jump is the most frequent
 * thing a user sees.
 *
 * Dimensions are required by the caller on purpose — a skeleton that sizes itself has not solved
 * the problem it exists for.
 *
 * EVERY VALUE HERE RESOLVES THROUGH A TOKEN. That is what makes this file work unchanged on all
 * four directions: A, B, C and D each redefine `--surface-*`, `--card-*` and the radii, so the
 * loading state picks up the direction's surfaces without any per-branch edit. Hardcode one grey
 * and the skeleton starts announcing which branch it was written on.
 */
export function Skeleton({ width, height = '1em', shape = 'text', className = '', style }: SkeletonProps) {
  const radius =
    shape === 'circle' || shape === 'pill'
      ? 'var(--ui-radius-pill)'
      : shape === 'card'
        ? 'var(--card-radius)'
        : 'var(--ui-radius-sm)';

  // A circle takes ONE dimension and squares it. Setting `aspect-ratio` is not enough: it only
  // applies when a dimension is missing, and `height` already defaults to '1em' — which rendered
  // every "circle" as a 1em-tall bar.
  const size = shape === 'circle' ? (width ?? height) : undefined;

  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`.trim()}
      style={{
        width: size ?? width ?? '100%',
        height: size ?? height,
        borderRadius: radius,
        ...style
      }}
    />
  );
}

/**
 * The one announcing wrapper.
 *
 * Every composite below is `aria-hidden`, because a screen this size resolves into eight or ten
 * placeholders and a `role="status"` on each of them reads the same sentence ten times. Wrap a
 * loading screen in this instead and it announces once. `aria-busy` is what actually tells
 * assistive tech the region is mid-update; the label is the human sentence for it.
 */
export function SkeletonScreen({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label={label} className={className || undefined}>
      {children}
    </div>
  );
}

interface SkeletonTextProps {
  /** Number of lines. The last one is short, the way a paragraph actually ends. */
  lines?: number;
  /** Line height in px. */
  size?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, size = 12, className = '' }: SkeletonTextProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={size} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/**
 * The loading form of a KPI card: same padding, same figure height, same gaps — so the row does not
 * move when the numbers arrive.
 */
export function SkeletonKPI({ className = '' }: { className?: string }) {
  return (
    <div className={`surface ${className}`.trim()} style={{ padding: 24 }} aria-hidden="true">
      <Skeleton height={12} width="45%" />
      <div style={{ height: 14 }} />
      <Skeleton height={30} width="70%" />
      <div style={{ height: 12 }} />
      <Skeleton height={12} width="35%" />
    </div>
  );
}

/**
 * A generic card: a title line, then body lines. `lines={0}` gives a title-only card for the cases
 * where the body is a chart or a table that has its own skeleton.
 */
export function SkeletonCard({
  lines = 3,
  padding = 24,
  className = '',
  children,
}: {
  lines?: number;
  padding?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`surface ${className}`.trim()} style={{ padding }} aria-hidden="true">
      <Skeleton height={14} width="38%" />
      {lines > 0 && (
        <div style={{ marginTop: 18 }}>
          <SkeletonText lines={lines} />
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The silhouette of a chart, inside a card with the card's own title.
 *
 * The bar heights are a fixed list, not `Math.random()`. A random silhouette redraws differently on
 * every render — including the re-render that happens the moment before the real chart mounts — so
 * the last thing the user sees before the data lands is the placeholder twitching.
 */
const BAR_HEIGHTS = [52, 74, 41, 88, 63, 96, 57, 79, 46, 84, 68, 38];

export function SkeletonChart({
  height = 240,
  variant = 'bars',
  className = '',
}: {
  height?: number;
  /** `bars` for column/line charts, `donut` for the pie and treemap slots. */
  variant?: 'bars' | 'donut';
  className?: string;
}) {
  return (
    <div className={`surface ${className}`.trim()} style={{ padding: 24 }} aria-hidden="true">
      <Skeleton height={14} width="34%" />
      <div style={{ height: 20 }} />
      {variant === 'donut' ? (
        <div className="flex items-center justify-center" style={{ height }}>
          <Skeleton shape="circle" width={Math.min(height - 32, 200)} />
        </div>
      ) : (
        <div className="flex items-end gap-2" style={{ height }}>
          {BAR_HEIGHTS.map((h, i) => (
            <Skeleton key={i} height={`${h}%`} shape="card" className="flex-1" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A table's loading form, built on `.data-table` so the header band, the row rule and the row
 * height are the table's own and not a second opinion about what a table looks like.
 */
export function SkeletonTable({
  rows = 8,
  columns = 5,
  /** Off when the table already sits inside a card — a card in a card reads as a nesting bug. */
  surface = true,
  className = '',
}: {
  rows?: number;
  columns?: number;
  surface?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${surface ? 'surface ' : ''}overflow-hidden pointer-events-none ${className}`.trim()}
      aria-hidden="true"
    >
      <table className="data-table w-full">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, c) => (
              <th key={c} style={{ padding: '12px 16px' }}>
                <Skeleton height={10} width={c === 0 ? '55%' : '40%'} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <td key={c} style={{ padding: '14px 16px' }}>
                  <Skeleton height={12} width={c === 0 ? '80%' : '50%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The page header's loading form — title, subtitle and the toolbar on the right.
 *
 * This one matters more than it looks. The header is the tallest thing above the fold, so a page
 * that renders its content skeleton but not its header still jumps by ~70px when the real title
 * arrives, which is the shift the skeletons exist to remove.
 */
export function SkeletonPageHeader({ actions = 2, className = '' }: { actions?: number; className?: string }) {
  return (
    <div
      className={`flex flex-col gap-3 min-w-0 lg:flex-row lg:items-start lg:justify-between lg:gap-x-6 ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="min-w-0 flex-1 space-y-2 lg:min-w-[240px]">
        <Skeleton height={26} width={220} />
        <Skeleton height={12} width="70%" style={{ maxWidth: 460 }} />
      </div>
      {actions > 0 && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} height={36} width={i === 0 ? 132 : 108} shape="card" />
          ))}
        </div>
      )}
    </div>
  );
}
