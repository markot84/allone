import type { CSSProperties } from 'react';

interface SkeletonProps {
  /** CSS width — a number is treated as px. Defaults to filling the parent. */
  width?: number | string;
  /** CSS height — a number is treated as px. */
  height?: number | string;
  /** `text` rounds to the text radius, `card` to the card radius, `circle` to a disc. */
  shape?: 'text' | 'card' | 'circle';
  className?: string;
  style?: CSSProperties;
}

/**
 * A placeholder with the dimensions of the thing that is coming.
 *
 * CLAUDE.md lists "no layout shift while data loads: skeletons with fixed dimensions" as
 * non-negotiable, but the app resolves loading with `<Spinner>` in 28 files against skeletons in 4.
 * A spinner says "wait"; it also throws away the layout, so the page jumps when data lands. On
 * screens backed by Firestore aggregates, which is most of them, that jump is the most frequent
 * thing a user sees.
 *
 * Dimensions are required by the caller on purpose — a skeleton that sizes itself has not solved
 * the problem it exists for.
 */
export function Skeleton({ width, height = '1em', shape = 'text', className = '', style }: SkeletonProps) {
  const radius =
    shape === 'circle' ? 'var(--ui-radius-pill)' : shape === 'card' ? 'var(--card-radius)' : 'var(--ui-radius-sm)';

  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`.trim()}
      style={{
        width: width ?? '100%',
        height,
        borderRadius: radius,
        ...(shape === 'circle' ? { aspectRatio: '1 / 1', width: width ?? height } : null),
        ...style
      }}
    />
  );
}

interface SkeletonTextProps {
  /** Number of lines. The last one is short, the way a paragraph actually ends. */
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()} role="status" aria-label="Φόρτωση περιεχομένου">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '100%'} />
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
    <div className={`surface ${className}`.trim()} style={{ padding: 24 }} role="status" aria-label="Φόρτωση δείκτη">
      <Skeleton height={12} width="45%" />
      <div style={{ height: 14 }} />
      <Skeleton height={30} width="70%" />
      <div style={{ height: 12 }} />
      <Skeleton height={12} width="35%" />
    </div>
  );
}
