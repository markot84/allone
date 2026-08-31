/**
 * One chart look for the whole app.
 *
 * The dashboard hand-draws its charts, because at that size the axes and the frame had been removed
 * and a library only gets in the way. Everywhere else the charts are real charts — tooltips,
 * legends, brushes, stacked series — so Recharts and Nivo stay, and this module is what makes them
 * look like they belong to the same board: mono tick labels, one horizontal hairline grid, a white
 * tooltip with a navy-100 edge, and a categorical palette that comes from the tokens rather than
 * from a hex map at the top of each page.
 *
 * Why the values are read from the DOM instead of passed as `var(--x)`:
 * Recharts renders SVG, and `var()` does not resolve inside `url(#gradient)` stops, `fill` on some
 * primitives, or anything Recharts hands to its own colour maths. So the palette is resolved once
 * off `:root` — the same trick `useAccentColor` already uses — and cached. Tokens stay the source
 * of truth; this is only the reader.
 */

/** Fallbacks match `tokens.css` exactly; they are used before the stylesheet is applied (SSR/tests). */
const FALLBACK: Record<string, string> = {
  '--orange-500': '#FE630C',
  '--orange-700': '#B24508',
  '--orange-100': '#FFD8C2',
  '--sky-500': '#005ECD',
  '--sky-100': '#BFD7F2',
  '--navy-500': '#204892',
  '--navy-100': '#C7D1E4',
  '--navy-50': '#E9EDF4',
  '--gold-500': '#FEC405',
  '--gold-700': '#B28904',
  '--success': '#49B275',
  '--success-700': '#327C51',
  '--danger': '#DF5A4D',
  '--danger-700': '#BD4D41',
  '--warning': '#E99848',
  '--border': '#E4E7EC',
  '--surface-0': '#FFFFFF',
  '--surface-1': '#FAFBFC',
  '--surface-2': '#F2F4F7',
  '--text-primary': '#20293A',
  '--text-secondary': '#475467',
  '--text-muted': '#667085',
  '--seg-champions': '#49B275',
  '--seg-loyal': '#005ECD',
  '--seg-potential': '#7663DD',
  '--seg-at-risk': '#B28904',
  '--seg-hibernating': '#6B87B9',
  '--seg-lost': '#667085',
};

const cache = new Map<string, string>();

/** Literal value of a design token, for the places SVG cannot take `var()`. */
export function token(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const fallback = FALLBACK[name] ?? '#667085';
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolved = value || fallback;
  cache.set(name, resolved);
  return resolved;
}

/** Drop the cache when the theme changes under us (accent profile switch, future dark mode). */
export function resetChartTheme(): void {
  cache.clear();
}

/**
 * One colour per RFM segment, for the whole app.
 *
 * Ten segments is more than any palette should be asked to keep distinct, and the previous table
 * answered that by inventing ten hues — a #C026D3 magenta, a #84CC16 lime — none of which existed
 * anywhere else in the product. Every entry below is an existing token instead, chosen so that the
 * segments a reader compares most often are furthest apart:
 *
 *   - the two healthy segments are the two greens (dark = Champions, bright = New)
 *   - the two dormant ones are the two greys (cooler = Hibernating, neutral = Lost)
 *   - the two that need action are red (Can't Lose Them) and orange (Needing Attention)
 *   - Loyal keeps sky and Potential keeps the categorical purple, which is what the dashboard's
 *     share bar and the segment migration sankey already use
 *
 * Keys are matched loosely (id, id with underscores, name, apostrophes stripped), because the
 * segments arrive from three producers — the orders engine, the importer and the RFM aggregator —
 * and they do not agree on casing or punctuation.
 */
export const SEGMENT_COLOR_TOKENS: Record<string, string> = {
  champions: '--success-700',
  loyal: '--seg-loyal',
  loyal_customers: '--seg-loyal',
  potential: '--seg-potential',
  potential_loyalists: '--seg-potential',
  promising: '--seg-potential',
  at_risk: '--seg-at-risk',
  hibernating: '--seg-hibernating',
  lost: '--seg-lost',
  new_customers: '--seg-champions',
  recent_customers: '--gold-500',
  cant_lose_them: '--danger-700',
  "can't_lose_them": '--danger-700',
  customers_needing_attention: '--orange-500',
};


export const MONO_STACK = "'JetBrains Mono', monospace";

/**
 * The categorical ramp.
 *
 * Six steps, in the order a reader should meet them: the primary measure is orange, the thing it is
 * compared against is sky, and the rest are the remaining brand colours plus the two categorical
 * hues the tokens already carry. No seventh colour is invented — past six the ramp cycles, which is
 * the honest signal that a chart is carrying more series than a reader can hold anyway.
 */
const SERIES_TOKENS = [
  '--orange-500',
  '--sky-500',
  '--navy-500',
  '--gold-700',
  '--seg-potential',
  '--success-700',
] as const;

export function seriesColor(index: number): string {
  return token(SERIES_TOKENS[((index % SERIES_TOKENS.length) + SERIES_TOKENS.length) % SERIES_TOKENS.length]);
}

export function seriesPalette(): string[] {
  return SERIES_TOKENS.map((t) => token(t));
}

/**
 * A segment's colour from its id alone.
 *
 * `utils/segmentColors.ts` is the entry point when you hold a whole `RFMSegment` — it also matches
 * on the name, which the three segment producers spell differently. This one is for charts that
 * carry only the id.
 */
export function segmentColor(id: string): string {
  return token(SEGMENT_COLOR_TOKENS[id] ?? SEGMENT_COLOR_TOKENS[id.toLowerCase().replace(/[\s-]+/g, '_')] ?? '--seg-lost');
}

/**
 * GA4 default channel groups.
 *
 * The pairs matter more than the individual hues: paid and organic of the same medium sit a step
 * apart on one ramp, so "paid search vs organic search" reads as a comparison rather than as two
 * unrelated colours. Everything unrecognised falls to muted grey, which is also what GA4's own
 * `(Other)` deserves.
 */
const CHANNEL_TOKENS: Record<string, string> = {
  'Organic Search': '--success-700',
  'Paid Search': '--sky-500',
  'Organic Social': '--seg-champions',
  'Paid Social': '--seg-potential',
  Direct: '--navy-500',
  Email: '--orange-700',
  Referral: '--gold-700',
  Display: '--orange-500',
  'Cross-network': '--seg-hibernating',
  Affiliates: '--navy-100',
  'Paid Other': '--warning',
  Social: '--seg-potential',
  Unassigned: '--text-muted',
  '(Other)': '--text-muted',
  'Λοιπά κανάλια': '--text-muted',
};

export function channelColor(channel: string): string {
  return token(CHANNEL_TOKENS[channel] ?? '--text-muted');
}

/** Positive / negative, for bars and areas that carry a direction. */
export function deltaFill(positive: boolean): string {
  return token(positive ? '--success-700' : '--danger-700');
}

/* ── Recharts prop bundles ──────────────────────────────────────────────────────────────────── */

/** Axis ticks are measurements, so they are mono — the same rule the rest of the board follows. */
export function tickStyle(): { fontFamily: string; fontSize: number; fill: string } {
  return { fontFamily: MONO_STACK, fontSize: 10, fill: token('--text-muted') };
}

/**
 * `<XAxis {...axisProps()} />` — no axis line, no tick marks, mono labels.
 *
 * `minTickGap` is not decoration: mono digits are wider than the proportional ones these charts
 * were laid out with, so Recharts' default spacing packs `08-01 08-02 08-03` into each other at the
 * dense end of a daily series. 24px is the smallest gap at which a `MM-DD` label stays separate.
 */
export function axisProps() {
  return {
    tick: tickStyle(),
    tickLine: false,
    axisLine: false,
    stroke: token('--border'),
    minTickGap: 24,
    interval: 'preserveStartEnd' as const,
  } as const;
}

/**
 * `<CartesianGrid {...gridProps()} />` — horizontal hairlines only.
 *
 * Vertical grid lines are furniture: the x axis is already labelled, and a full mesh turns a chart
 * into graph paper. Same three-hairline discipline the dashboard's SVG charts use.
 */
export function gridProps() {
  return {
    strokeDasharray: '0',
    stroke: token('--border'),
    vertical: false,
  } as const;
}

/** `<Tooltip {...tooltipProps()} />` — white card, navy-100 edge, mono figures. */
export function tooltipProps() {
  return {
    contentStyle: {
      background: token('--surface-0'),
      border: `1px solid ${token('--navy-100')}`,
      borderRadius: 10,
      boxShadow: '0 4px 8px -2px rgba(16,24,40,0.08), 0 12px 24px -4px rgba(16,24,40,0.10)',
      fontFamily: MONO_STACK,
      fontSize: 11.5,
      color: token('--text-primary'),
      padding: '10px 12px',
    },
    labelStyle: {
      fontFamily: MONO_STACK,
      fontSize: 10,
      letterSpacing: '0.1em',
      textTransform: 'uppercase' as const,
      color: token('--text-muted'),
      marginBottom: 4,
    },
    itemStyle: { fontFamily: MONO_STACK, fontSize: 11.5, padding: 0 },
    cursor: { fill: token('--surface-2') },
  };
}

/** `<Legend {...legendProps()} />` — mono caps, matching `LegendKey` in the Signal vocabulary. */
export function legendProps() {
  return {
    wrapperStyle: {
      fontFamily: MONO_STACK,
      fontSize: 10.5,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: token('--text-muted'),
    },
    iconType: 'square' as const,
    iconSize: 10,
  };
}

/** Nivo takes a plain array; same ramp, so a treemap and a bar chart agree on what "loyal" is. */
export function nivoTheme() {
  return {
    background: 'transparent',
    text: { fontFamily: MONO_STACK, fontSize: 10, fill: token('--text-muted') },
    axis: {
      ticks: { text: { fontFamily: MONO_STACK, fontSize: 10, fill: token('--text-muted') } },
      legend: { text: { fontFamily: MONO_STACK, fontSize: 10, fill: token('--text-secondary') } },
      domain: { line: { stroke: token('--border') } },
    },
    grid: { line: { stroke: token('--border'), strokeWidth: 1 } },
    tooltip: {
      container: {
        background: token('--surface-0'),
        border: `1px solid ${token('--navy-100')}`,
        borderRadius: 10,
        fontFamily: MONO_STACK,
        fontSize: 11.5,
        color: token('--text-primary'),
      },
    },
  };
}
