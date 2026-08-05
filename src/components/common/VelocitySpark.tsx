/**
 * Sales-velocity sparkline for a single table row.
 *
 * Component sourcing (CLAUDE.md rule — say what was searched): the brief asks for Tremor's
 * `SparkAreaChart` here. It was not used, for two reasons. Tremor arrives through a `shadcn init`
 * this project has never run, and its spark charts are Recharts `ResponsiveContainer`s — each one
 * mounts a ResizeObserver and a full chart tree. At 150 virtualized rows scrolling at 60fps that is
 * the single most expensive thing on the page, for a line with three points. So: a static inline
 * SVG polyline, no library, no observer, no re-render on scroll.
 *
 * The three points are not a time series — the catalogue does not store one. They are the average
 * daily sales rate over the last 90 / 30 / 7 days, oldest to newest, which is what a merchant
 * actually reads a row sparkline for: is this SKU accelerating or dying. The tooltip says so, so
 * the shape is never mistaken for daily history.
 */
import { useId } from 'react';
import type { Product } from '../../types';
import { velocityPoints } from '../../utils/salesVelocity';

const WIDTH = 44;
const HEIGHT = 16;
const PAD = 1.5;

export function VelocitySpark({ product }: { product: Product }) {
  const gradientId = useId();
  const points = velocityPoints(product);

  // One point is not a trend, and zero across the board is not a line worth drawing.
  if (points.length < 2 || points.every((p) => p.rate === 0)) {
    return <span className="text-[10px] text-[var(--text-muted)]">—</span>;
  }

  const peak = Math.max(...points.map((p) => p.rate));
  const trough = Math.min(...points.map((p) => p.rate));
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: PAD + i * step,
    // Scale against the row's own peak: the shape carries the direction, not the magnitude. An
    // unchanged rate has no shape at all, so it sits mid-box rather than pinned to the ceiling.
    y:
      peak === trough
        ? HEIGHT / 2
        : HEIGHT - PAD - (p.rate / peak) * (HEIGHT - PAD * 2),
  }));

  const first = points[0].rate;
  const last = points[points.length - 1].rate;
  const direction = last > first ? 'up' : last < first ? 'down' : 'flat';
  const stroke =
    direction === 'up' ? 'var(--success)' : direction === 'down' ? 'var(--danger)' : 'var(--text-muted)';

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${PAD},${HEIGHT} ${line} ${(WIDTH - PAD).toFixed(1)},${HEIGHT}`;

  const title = `Μέσος ρυθμός πωλήσεων ανά ημέρα — ${points
    .map((p) => `${p.label}: ${p.rate.toFixed(p.rate < 1 ? 2 : 1)}/ημ.`)
    .join(' · ')}`;

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={title}
      className="overflow-visible"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="1.6" fill={stroke} />
    </svg>
  );
}
