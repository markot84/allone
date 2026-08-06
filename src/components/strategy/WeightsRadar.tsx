import { useMemo } from 'react';
import { ResponsiveRadar } from '@nivo/radar';
import { weightFactors } from '../../data';
import { useTokenColors } from '../../hooks/useTokenColors';

/**
 * The shape of a strategy.
 *
 * A single orange outline on a light surface (colors.md §5) rather than five coloured series: the
 * point is to recognise one silhouette at a glance, and five filled shapes would compete. The five
 * factor colours live on the sliders beside it, where telling them apart is what matters.
 *
 * Driven by the live weights, not the debounced ones — redrawing five points is cheap, and the
 * whole purpose is that the shape moves with the thumb rather than after it.
 */

/** Weights always sum to 100 across five factors, so 20 is the neutral radius. The ceiling grows in
 *  decades and never shrinks below 50, so the silhouette stays comparable between adjustments
 *  instead of rescaling under the user's hand — while a weight pushed past it still cannot clip. */
function axisCeiling(weights: Record<string, number>): number {
  const peak = Math.max(0, ...weightFactors.map((factor) => weights[factor.id] ?? 0));
  return Math.max(50, Math.ceil(peak / 10) * 10);
}

export function WeightsRadar({ weights }: { weights: Record<string, number> }) {
  const data = useMemo(
    () =>
      weightFactors.map((factor) => ({
        factor: factor.name,
        weight: weights[factor.id] ?? 0,
      })),
    [weights]
  );

  // Nivo writes these straight into SVG paint attributes, so they are resolved to real values here
  // rather than passed through as var(...) references — and re-resolved when the theme changes,
  // which a plain read on mount would miss.
  const palette = useTokenColors({
    shape: ['--brand-orange', '#FE630C'],
    grid: ['--border', '#E4E7EC'],
    label: ['--text-secondary', '#475467'],
    muted: ['--text-muted', '#667085'],
    dotBorder: ['--surface-0', '#FFFFFF'],
  });

  return (
    <div style={{ height: 260 }} aria-hidden="true">
      <ResponsiveRadar
        data={data}
        keys={['weight']}
        indexBy="factor"
        maxValue={axisCeiling(weights)}
        margin={{ top: 34, right: 62, bottom: 26, left: 62 }}
        gridShape="linear"
        gridLevels={4}
        curve="linearClosed"
        colors={[palette.shape]}
        fillOpacity={0.18}
        borderWidth={2}
        borderColor={palette.shape}
        dotSize={7}
        dotColor={palette.shape}
        dotBorderWidth={2}
        dotBorderColor={palette.dotBorder}
        enableDotLabel={false}
        isInteractive={false}
        motionConfig="stiff"
        theme={{
          text: { fontFamily: 'Inter, sans-serif', fontSize: 11, fill: palette.label },
          grid: { line: { stroke: palette.grid, strokeWidth: 1 } },
          axis: { ticks: { text: { fill: palette.muted, fontSize: 10 } } },
        }}
      />
    </div>
  );
}
