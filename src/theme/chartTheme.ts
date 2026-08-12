import { useMemo } from 'react';
import { readTokenColor } from '../utils/cssToken';

/**
 * One chart look, resolved from the design tokens.
 *
 * Recharts writes paint values straight into SVG attributes, so it cannot resolve `var(--token)` —
 * which is how the app ended up with the colours hardcoded at every call site. The audit counted
 * 25 `CartesianGrid`s using five different greys (`#E5E5E5`, `#F3F4F6`, `#F0F0F0`, plus four with
 * no stroke at all, falling back to Recharts' `#ccc`), and axis ticks styled eight different ways.
 * None of it was a decision; it was whatever each screen happened to type.
 *
 * Everything here reads through `readTokenColor`, so a direction that changes `tokens.css` moves
 * the charts with it.
 */

export interface ChartTheme {
  /** Gridlines. Horizontal only by default — vertical rules compete with the data. */
  grid: { stroke: string; strokeDasharray: string; vertical: boolean };
  /** Axis ticks. `axisLine`/`tickLine` off: the gridline already marks the value. */
  axis: {
    tick: { fill: string; fontSize: number; fontFamily: string };
    tickLine: boolean;
    axisLine: boolean;
    stroke: string;
  };
  /** Passed to Recharts' own Tooltip when the custom one is overkill. */
  tooltipStyle: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    itemStyle: React.CSSProperties;
    cursor: { fill: string } | { stroke: string; strokeWidth: number };
  };
  /** The default series colour and its area gradient partner. */
  series: string;
  /** Ordered categorical scale for multi-series charts, drawn from the brand palette. */
  categorical: string[];
  /** Card background — needed for slice strokes, which must match what is behind the chart. */
  surface: string;
  text: string;
  textMuted: string;
}

export function useChartTheme(): ChartTheme {
  return useMemo(() => {
    const textMuted = readTokenColor('--text-muted', '#667085');
    const border = readTokenColor('--border', '#E4E7EC');
    const surface = readTokenColor('--card-bg', '#FFFFFF');
    const text = readTokenColor('--text-primary', '#101828');

    return {
      grid: { stroke: border, strokeDasharray: '2 4', vertical: false },
      axis: {
        tick: { fill: textMuted, fontSize: 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace' },
        tickLine: false,
        axisLine: false,
        stroke: border
      },
      tooltipStyle: {
        contentStyle: {
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: readTokenColor('--ui-radius-md', '8px'),
          boxShadow: '0 8px 16px -4px rgba(16, 24, 40, 0.10), 0 24px 48px -8px rgba(16, 24, 40, 0.16)',
          padding: '10px 12px',
          fontSize: 12
        },
        labelStyle: { color: textMuted, fontSize: 11, marginBottom: 4, fontWeight: 500 },
        itemStyle: { color: text, fontSize: 13, fontWeight: 600, padding: 0 },
        // A faint wash rather than Recharts' default grey block, which lands on top of the series.
        cursor: { fill: readTokenColor('--surface-2', '#F2F4F7') }
      },
      series: readTokenColor('--brand-orange', '#FE630C'),
      /*
       * Six steps, all existing tokens. Ordered so the first two — the ones most charts actually
       * use — are the strongest against the card, and so no two adjacent entries share a hue.
       */
      categorical: [
        readTokenColor('--sky-500', '#005ECD'),
        readTokenColor('--brand-orange', '#FE630C'),
        readTokenColor('--success-700', '#0D804A'),
        readTokenColor('--seg-potential', '#7A5AF8'),
        readTokenColor('--gold-700', '#B28904'),
        readTokenColor('--navy-500', '#003087')
      ],
      surface,
      text,
      textMuted
    };
    // Token values are fixed once the stylesheet is parsed; a direction change is a reload.
  }, []);
}
