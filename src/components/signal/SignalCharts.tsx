import { useId } from 'react';
import { MONO } from './SignalBoard';

/**
 * The board's charts.
 *
 * Hand-drawn SVG rather than a charting library, for one reason: at this size the artboard has no
 * axes, no ticks and no frame — three hairlines and a shape. A library spends its effort on the
 * furniture that has been removed here, and fights you for the rest. What is left is a projection
 * from a value range onto a viewBox, which is the twenty lines below.
 *
 * Every series is drawn into a fixed viewBox with `preserveAspectRatio="none"`, so the card can be
 * any width and the chart neither reflows nor needs measuring. That is also why there is no
 * ResizeObserver on this page any more.
 */

/** Charts are decorative restatements of numbers printed beside them, so they are hidden from AT. */
const A11Y = { 'aria-hidden': true as const, role: 'presentation' };

interface Projection {
  x: (index: number) => number;
  y: (value: number) => number;
}

function project(count: number, values: number[], box: { left: number; right: number; top: number; bottom: number }): Projection {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  // A flat series would divide by zero; give it a range so it draws down the middle.
  const span = max - min || Math.abs(max) || 1;
  const step = count > 1 ? (box.right - box.left) / (count - 1) : 0;
  return {
    x: (i) => box.left + step * i,
    y: (v) => box.bottom - ((v - min) / span) * (box.bottom - box.top),
  };
}

function linePath(values: number[], p: Projection): string {
  if (values.length === 0) return '';
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${p.x(i).toFixed(1)},${p.y(v).toFixed(1)}`).join(' ');
}

/** Same, for a series with holes in it: each unbroken run starts a fresh subpath, so a gap reads as
 *  a gap rather than as a straight line drawn through data nobody has. */
function sparseLinePath(values: (number | null)[], p: Projection): string {
  const out: string[] = [];
  let runLength = 0;
  values.forEach((v, i) => {
    if (v === null) { runLength = 0; return; }
    const point = `${p.x(i).toFixed(1)},${p.y(v).toFixed(1)}`;
    // A lone covered bucket is a moveto with nowhere to go, which paints nothing. Doubling the
    // point turns it into a zero-length segment that a round cap renders as a dot.
    out.push(runLength === 0 ? `M${point} L${point}` : `L${point}`);
    runLength += 1;
  });
  return out.join(' ');
}

function areaPath(values: number[], p: Projection, baseline: number): string {
  if (values.length === 0) return '';
  const last = p.x(values.length - 1).toFixed(1);
  const first = p.x(0).toFixed(1);
  return `${linePath(values, p)} L${last},${baseline} L${first},${baseline} Z`;
}

/**
 * The wash behind the hero figure — the period's shape, at 16% opacity, under the number it
 * describes. It is not read; it is the texture that tells you whether the number has been climbing.
 */
export function HeroSpark({ values }: { values: number[] }) {
  const gradientId = useId();
  if (values.length < 2) return null;
  const p = project(values.length, values, { left: 0, right: 600, top: 60, bottom: 250 });

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 0.16, pointerEvents: 'none' }} {...A11Y}>
      <svg viewBox="0 0 600 300" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--orange-500)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--orange-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath(values, p, 300)} fill={`url(#${gradientId})`} />
        <path d={linePath(values, p)} fill="none" stroke="var(--orange-500)" strokeWidth={3} />
      </svg>
    </div>
  );
}

/**
 * Revenue as a filled line, traffic as a dashed one over it.
 *
 * The two series carry different units, so each is scaled to its own range — the chart answers
 * "did these move together?", not "which is bigger", and the figures above it carry the magnitudes.
 */
export function RevenueTrendChart({ revenue, sessions }: { revenue: number[]; sessions: (number | null)[] }) {
  const gradientId = useId();
  if (revenue.length < 2) return null;

  const box = { left: 75, right: 1125, top: 20, bottom: 220 };
  const revenueP = project(revenue.length, revenue, box);
  const sessionValues = sessions.filter((v): v is number => v !== null);
  const sessionsP =
    sessions.length === revenue.length && sessionValues.length > 0
      ? project(sessions.length, sessionValues, { ...box, top: 60, bottom: 210 })
      : null;

  return (
    <svg viewBox="0 0 1200 240" preserveAspectRatio="none" style={{ width: '100%', height: 240, display: 'block' }} {...A11Y}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--orange-500)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--orange-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[60, 120, 180].map((y) => (
        <line key={y} x1="0" y1={y} x2="1200" y2={y} stroke="var(--border)" strokeWidth={1} />
      ))}
      <path d={areaPath(revenue, revenueP, 240)} fill={`url(#${gradientId})`} />
      <path d={linePath(revenue, revenueP)} fill="none" stroke="var(--orange-500)" strokeWidth={2.5} />
      {sessionsP && (
        <path
          d={sparseLinePath(sessions, sessionsP)}
          fill="none"
          stroke="var(--sky-500)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="5 4"
        />
      )}
    </svg>
  );
}

export interface AdsPoint {
  spend: number;
  value: number;
  roas: number | null;
}

/**
 * Spend and conversion value as paired bars, with efficiency riding over them as a line.
 *
 * The pairing is the point: two bars side by side make the gap between what was spent and what came
 * back a visible distance, which a stacked or overlaid form would hide.
 */
export function AdsPerformanceChart({ points }: { points: AdsPoint[] }) {
  if (points.length === 0) return null;

  const box = { left: 14, right: 686, top: 16, bottom: 184 };
  const maxMoney = Math.max(...points.flatMap((p) => [p.spend, p.value]), 0) || 1;
  // Bars thin out as the period lengthens, but never past the point of disappearing.
  const slot = (box.right - box.left) / points.length;
  const barWidth = Math.max(4, Math.min(26, slot / 2.6));
  const barHeight = (v: number) => Math.max(0, (v / maxMoney) * (box.bottom - box.top));

  const roasValues = points.map((p) => p.roas).filter((v): v is number => v !== null);
  const maxRoas = Math.max(...roasValues, 0) || 1;
  const roasY = (v: number) => box.bottom - (v / maxRoas) * (box.bottom - box.top) * 0.8;
  const centreX = (i: number) => box.left + slot * i + slot / 2;

  const roasPath = points
    .map((p, i) => (p.roas === null ? null : `${centreX(i).toFixed(1)},${roasY(p.roas).toFixed(1)}`))
    .filter((v): v is string => v !== null)
    .map((coord, i) => `${i === 0 ? 'M' : 'L'}${coord}`)
    .join(' ');

  // Grows into whatever height the card has left over, never below the 200px it was drawn for.
  return (
    <svg
      viewBox="0 0 700 200"
      preserveAspectRatio="none"
      style={{ width: '100%', flex: '1 1 auto', minHeight: 200, display: 'block' }}
      {...A11Y}
    >
      {[50, 100, 150].map((y) => (
        <line key={y} x1="0" y1={y} x2="700" y2={y} stroke="var(--border)" strokeWidth={1} />
      ))}
      {points.map((p, i) => {
        const spendH = barHeight(p.spend);
        const valueH = barHeight(p.value);
        const cx = centreX(i);
        return (
          <g key={i}>
            <rect x={cx - barWidth - 2} y={box.bottom - spendH} width={barWidth} height={spendH} fill="var(--sky-500)" />
            <rect x={cx + 2} y={box.bottom - valueH} width={barWidth} height={valueH} fill="var(--orange-500)" />
          </g>
        );
      })}
      {roasPath && <path d={roasPath} fill="none" stroke="var(--navy-500)" strokeWidth={2.5} />}
      {points.map((p, i) =>
        p.roas === null ? null : <circle key={i} cx={centreX(i)} cy={roasY(p.roas)} r={4} fill="var(--navy-500)" />
      )}
    </svg>
  );
}

/**
 * The RFM share bar: every segment's slice of the customer base, in one 44px band.
 *
 * A share bar rather than the donut this replaced. Six segments in a ring is six angles to compare
 * against each other; six segments in a bar is one line to read left to right, and it leaves the
 * width of the card for the table underneath rather than spending it on a hole in the middle.
 */
export function SegmentShareBar({
  segments,
}: {
  segments: { id: string; name: string; percentage: number; color: string; labelColor: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.percentage, 0);
  if (total <= 0) return null;

  return (
    <div style={{ display: 'flex', height: 44, borderRadius: 10, overflow: 'hidden' }}>
      {segments.map((segment) => {
        const share = (segment.percentage / total) * 100;
        return (
          <div
            key={segment.id}
            title={`${segment.name} · ${share.toFixed(1)}%`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: `${share}%`,
              background: segment.color,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 700,
              color: segment.labelColor,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Below roughly 6% the label cannot fit; the tooltip and the table below still carry it. */}
            {share >= 6 ? `${Math.round(share)}%` : ''}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The 32px sparkline under a KPI figure.
 *
 * Same projection as {@link HeroSpark}, smaller and in a card rather than behind one. It replaces a
 * Recharts `AreaChart` that existed to draw twenty points and no axes — the library was paying for
 * furniture that had already been removed, and it forced a literal accent hex into every KPI card.
 */
export function MetricSpark({ values, color = 'var(--orange-500)' }: { values: number[]; color?: string }) {
  const gradientId = useId();
  if (values.length < 2) return null;
  const p = project(values.length, values, { left: 1, right: 199, top: 3, bottom: 37 });

  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
      style={{ width: '100%', height: 32, display: 'block' }}
      {...A11Y}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath(values, p, 40)} fill={`url(#${gradientId})`} />
      <path d={linePath(values, p)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
