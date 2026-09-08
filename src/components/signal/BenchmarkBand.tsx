import { motion, useReducedMotion } from 'framer-motion';
import { MONO } from './SignalBoard';
import type { BenchmarkDistribution } from '../../types';
import { BENCHMARK_QUARTILE_LABELS, quartileOf, type BenchmarkQuartile } from '../../config/benchmarks';
import { formatNumber } from '../../utils/format';

/**
 * The Benchmark Band — where one of our numbers sits inside the spread of everyone else's.
 *
 * The board already has a vocabulary for "here is a measurement" (`MetricTile`) and for "here is a
 * measurement over time" (the charts). It had nothing for "here is a measurement against its
 * peers", which is the only thing this report says. A bar chart of anonymous shops would be
 * unreadable and would invite the reader to count them; a single "vs median" delta throws away the
 * spread, which is where the answer usually is — being 8% under a median that spans 3x is a
 * different situation from being 8% under a tight one.
 *
 * So: the interquartile range as a filled box, the median as a line in it, and our own value as a
 * marker. The shape is legible at a glance and it is honest about how wide the middle of the trade
 * actually is.
 *
 * It is deliberately not interactive. Everything it knows is printed next to it rather than hidden
 * behind a hover, because a comparison a keyboard user cannot reach is not a comparison, and
 * because these are the numbers people read out loud to a customer.
 */

const QUARTILE_TONES: Record<BenchmarkQuartile, { background: string; color: string }> = {
  // Gold is a badge background and never text, so the label on it is navy.
  top: { background: 'var(--gold-100)', color: 'var(--navy-900)' },
  'upper-mid': { background: 'var(--sky-50)', color: 'var(--sky-700)' },
  'lower-mid': { background: 'var(--surface-2)', color: 'var(--text-secondary)' },
  bottom: { background: 'var(--danger-light)', color: 'var(--danger-700)' },
};

const TRACK_HEIGHT = 10;

/** The plotted domain always contains both the box and our marker, padded so a value sitting on
 *  p25 does not render flush against the edge and read as off-scale. */
function domainOf(spread: BenchmarkDistribution, value: number | null) {
  const lo = Math.min(spread.p25, value ?? spread.p25);
  const hi = Math.max(spread.p75, value ?? spread.p75);
  const span = hi - lo;
  const pad = span > 0 ? span * 0.2 : Math.max(Math.abs(hi), 1) * 0.2;
  return { min: lo - pad, max: hi + pad };
}

export function BenchmarkBand({
  label,
  question,
  definition,
  value,
  spread,
  format,
  goodWhenRising,
  revealDelay = 0,
}: {
  label: string;
  question?: string;
  definition?: string;
  /** Our value. `null` when this brand abstains from the metric — e.g. no 24 months of history for
   *  a year-on-year figure. The cohort spread is still worth showing. */
  value: number | null;
  /** `null` when fewer than the k-anonymity floor of shops could contribute this metric. */
  spread: BenchmarkDistribution | null;
  format: (value: number) => string;
  goodWhenRising: boolean;
  revealDelay?: number;
}) {
  const reduceMotion = useReducedMotion();
  const quartile = value !== null && spread ? quartileOf(value, spread, goodWhenRising) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* Wraps at 375px so the verdict badge drops to its own line instead of squeezing the label
          into a two-word column. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
          {question && (
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{question}</span>
          )}
        </div>
        {quartile && (
          <span
            style={{
              ...QUARTILE_TONES[quartile],
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '5px 9px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {BENCHMARK_QUARTILE_LABELS[quartile]}
          </span>
        )}
      </div>

      {spread ? (
        <BandTrack
          value={value}
          spread={spread}
          format={format}
          label={label}
          quartile={quartile}
          reduceMotion={Boolean(reduceMotion)}
          revealDelay={revealDelay}
        />
      ) : (
        <SuppressedTrack />
      )}

      {definition && (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>{definition}</span>
      )}
    </div>
  );
}

function BandTrack({
  value,
  spread,
  format,
  label,
  quartile,
  reduceMotion,
  revealDelay,
}: {
  value: number | null;
  spread: BenchmarkDistribution;
  format: (value: number) => string;
  label: string;
  quartile: BenchmarkQuartile | null;
  reduceMotion: boolean;
  revealDelay: number;
}) {
  const { min, max } = domainOf(spread, value);
  const positionOf = (v: number) => ((v - min) / (max - min)) * 100;
  const boxLeft = positionOf(spread.p25);
  const boxWidth = positionOf(spread.p75) - boxLeft;

  /** The whole meaning of the graphic in one sentence, for anyone who cannot see it. */
  const description =
    value !== null
      ? `${label}: εμείς ${format(value)}. Διάμεσος κλάδου ${format(spread.p50)}, μέσο 50% από ${format(spread.p25)} έως ${format(spread.p75)} σε ${formatNumber(spread.n)} καταστήματα. ${quartile ? BENCHMARK_QUARTILE_LABELS[quartile] : ''}`
      : `${label}: διάμεσος κλάδου ${format(spread.p50)}, μέσο 50% από ${format(spread.p25)} έως ${format(spread.p75)} σε ${formatNumber(spread.n)} καταστήματα. Δεν υπάρχει δική μας τιμή για αυτή τη μετρική.`;

  // 450ms, once, on first paint — the reveal that makes the box read as a range rather than a bar.
  const reveal = reduceMotion
    ? { initial: false as const, animate: {} }
    : {
        initial: { opacity: 0, scaleX: 0.7 },
        animate: { opacity: 1, scaleX: 1 },
        transition: { duration: 0.45, delay: revealDelay, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <div role="img" aria-label={description} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', height: TRACK_HEIGHT + 16, minWidth: 0 }}>
        {/* The full plotted range. Thin, so the box reads as the subject and this as the context. */}
        <div
          style={{
            position: 'absolute',
            top: 8 + (TRACK_HEIGHT - 2) / 2,
            left: 0,
            right: 0,
            height: 2,
            borderRadius: 1,
            background: 'var(--navy-100)',
          }}
        />
        {/* Interquartile range — the middle half of the trade. */}
        <motion.div
          {...reveal}
          style={{
            position: 'absolute',
            top: 8,
            left: `${boxLeft}%`,
            width: `${boxWidth}%`,
            height: TRACK_HEIGHT,
            borderRadius: 5,
            background: 'var(--sky-100)',
            transformOrigin: 'center',
          }}
        />
        {/* Median. */}
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: `${positionOf(spread.p50)}%`,
            width: 2,
            height: TRACK_HEIGHT + 8,
            marginLeft: -1,
            borderRadius: 1,
            background: 'var(--sky-700)',
          }}
        />
        {value !== null && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? {} : { opacity: 1 }}
            transition={reduceMotion ? undefined : { duration: 0.45, delay: revealDelay + 0.12, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: 'absolute',
              top: 8 + TRACK_HEIGHT / 2,
              left: `${positionOf(value)}%`,
              width: 14,
              height: 14,
              marginLeft: -7,
              marginTop: -7,
              borderRadius: 999,
              background: 'var(--orange-500)',
              border: '2.5px solid var(--surface-0)',
              boxShadow: '0 1px 4px rgba(16,24,40,0.28)',
            }}
          />
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '4px 14px',
          fontFamily: MONO,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value !== null ? (
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--orange-700)' }}>{format(value)} εμείς</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>χωρίς δική μας τιμή</span>
        )}
        <span style={{ color: 'var(--sky-700)' }}>{format(spread.p50)} διάμεσος</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {format(spread.p25)} – {format(spread.p75)} μέσο 50%
        </span>
        <span style={{ color: 'var(--text-muted)' }}>n={formatNumber(spread.n)}</span>
      </div>
    </div>
  );
}

/** A metric that fewer than the floor of shops could contribute. Saying so is the point: an empty
 *  band would read as a zero, and a hidden one would leave the reader wondering what is missing. */
function SuppressedTrack() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: TRACK_HEIGHT + 16,
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px dashed var(--border)',
        background: 'var(--surface-1)',
        fontSize: 12,
        color: 'var(--text-secondary)',
      }}
    >
      Δεν υπάρχουν αρκετά καταστήματα σε αυτή τη σύγκριση για να δημοσιευθεί νούμερο.
    </div>
  );
}
