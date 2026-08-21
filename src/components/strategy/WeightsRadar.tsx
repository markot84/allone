import { useMemo } from 'react';
import { ResponsiveRadar } from '@nivo/radar';
import { weightFactors } from '../../data';
import { readTokenColor } from '../../utils/cssToken';

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

/**
 * Axis labels are a one-word name, not the factor's full title.
 *
 * "Βελτιστοποίηση αποθέματος" and "Στρατηγική προτεραιότητα" do not fit either side of a 260px
 * radar — Nivo clipped them, so three of the five axes read as "Βελτιστοπ" / "ια πελάτη". The
 * sliders directly below carry the full names; up here the label only has to say which axis this
 * is, and every one of these is the noun the slider's name is built on.
 */
const SHORT_LABEL: Record<string, string> = {
  profit: 'Κέρδος',
  stock: 'Απόθεμα',
  strategic: 'Στρατηγική',
  revenue: 'Έσοδα',
  fit: 'Συνάφεια',
};


export function WeightsRadar({ weights }: { weights: Record<string, number> }) {
  const data = useMemo(
    () =>
      weightFactors.map((factor) => ({
        factor: SHORT_LABEL[factor.id] ?? factor.name.split(' ')[0],
        weight: weights[factor.id] ?? 0,
      })),
    [weights]
  );

  // Nivo writes these straight into SVG paint attributes, so they are resolved to real values here
  // rather than passed through as var(...) references.
  const palette = useMemo(
    () => ({
      shape: readTokenColor('--brand-orange', '#FE630C'),
      grid: readTokenColor('--border', 'var(--border)'),
      label: readTokenColor('--text-secondary', 'var(--text-secondary)'),
      muted: readTokenColor('--text-muted', 'var(--text-muted)'),
    }),
    []
  );

  return (
    <div style={{ height: 260 }} aria-hidden="true">
      <ResponsiveRadar
        data={data}
        keys={['weight']}
        indexBy="factor"
        maxValue={axisCeiling(weights)}
        margin={{ top: 34, right: 72, bottom: 30, left: 72 }}
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
        dotBorderColor={readTokenColor('--surface-0', 'var(--surface-0)')}
        enableDotLabel={false}
        isInteractive={false}
        motionConfig="stiff"
        theme={{
          text: { fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: palette.label },
          grid: { line: { stroke: palette.grid, strokeWidth: 1 } },
          axis: { ticks: { text: { fill: palette.muted, fontSize: 10 } } },
        }}
      />
    </div>
  );
}
