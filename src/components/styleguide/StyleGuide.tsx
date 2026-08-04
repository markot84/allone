import { useState } from 'react';
import { WeightsRadar } from '../strategy/WeightsRadar';

/**
 * /styleguide — the consistency checkpoint every redesign phase is measured against.
 *
 * Values are read from the live computed styles rather than written into this file, so the page
 * proves the tokens actually resolve instead of restating them. Contrast is computed with the real
 * WCAG formula for the same reason: colors.md fixes where each colour is allowed based on measured
 * ratios, and that constraint should be verifiable here rather than taken on trust.
 */

type Swatch = { token: string; note?: string };

const BRAND: Swatch[] = [
  { token: '--brand-navy', note: 'dominant — text, headings, branding' },
  { token: '--brand-orange', note: 'the only primary-action colour' },
  { token: '--brand-gold', note: 'badge background only, never text' },
  { token: '--brand-sky', note: 'links, secondary CTA, info' },
];

const SCALES: { name: string; tokens: string[] }[] = [
  { name: 'Navy', tokens: ['--navy-900', '--navy-700', '--navy-500', '--navy-100', '--navy-50'] },
  { name: 'Orange', tokens: ['--orange-700', '--orange-600', '--orange-500', '--orange-100', '--orange-50'] },
  { name: 'Gold', tokens: ['--gold-700', '--gold-500', '--gold-100', '--gold-50'] },
  { name: 'Sky', tokens: ['--sky-700', '--sky-500', '--sky-100', '--sky-50'] },
];

const NEUTRALS: Swatch[] = [
  { token: '--surface-0', note: 'app background' },
  { token: '--surface-1', note: 'cards' },
  { token: '--surface-2', note: 'hover / deeper layer' },
  { token: '--border' },
  { token: '--text-primary' },
  { token: '--text-secondary' },
  { token: '--text-muted' },
  { token: '--text-heading', note: 'resolves to navy' },
];

const SEMANTIC: Swatch[] = [
  { token: '--success' },
  { token: '--warning' },
  { token: '--danger' },
  { token: '--info', note: 'resolves to sky' },
];

const SEGMENTS: Swatch[] = [
  { token: '--seg-champions' },
  { token: '--seg-loyal' },
  { token: '--seg-potential' },
  { token: '--seg-at-risk' },
  { token: '--seg-lost' },
];

/** Tokens whose accessible use is constrained; checked live against white. */
const TEXT_ON_WHITE = [
  '--brand-navy',
  '--sky-500',
  '--orange-700',
  '--orange-600',
  '--orange-500',
  '--gold-500',
  // The chrome is white now, so its text colours are measured on the same ground as everything else.
  '--chrome-fg',
  '--chrome-fg-muted',
  '--chrome-fg-subtle',
];

function toRgb(value: string): [number, number, number] | null {
  const hex = value.trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(hex);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastOnWhite(value: string): number | null {
  const rgb = toRgb(value);
  if (!rgb) return null;
  return (1.05) / (relativeLuminance(rgb) + 0.05);
}

/** What a measured ratio permits, per colors.md §3. */
function verdict(ratio: number): { label: string; token: string } {
  if (ratio >= 4.5) return { label: 'AA — any text', token: '--success' };
  if (ratio >= 3) return { label: 'Large text / icons only', token: '--warning' };
  return { label: 'Never as text', token: '--danger' };
}

/** Token values are fixed once the stylesheet is parsed, so they are read once on mount. */
function useTokenValues(tokens: string[]): Record<string, string> {
  const [values] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(tokens.map((token) => [token, styles.getPropertyValue(token).trim()]));
  });
  return values;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2
        style={{
          font: '600 20px/1.3 "Plus Jakarta Sans", sans-serif',
          color: 'var(--text-heading)',
          margin: '0 0 4px',
        }}
      >
        {title}
      </h2>
      {description && (
        <p style={{ font: '400 14px/1.6 Inter, sans-serif', color: 'var(--text-secondary)', margin: '0 0 16px', maxWidth: '68ch' }}>
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function SwatchGrid({ items }: { items: Swatch[] }) {
  const values = useTokenValues(items.map((i) => i.token));
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
      {items.map(({ token, note }) => (
        <div
          key={token}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface-1)',
          }}
        >
          <div style={{ height: 56, background: `var(${token})`, borderBottom: '1px solid var(--border)' }} />
          <div style={{ padding: '10px 12px' }}>
            <code style={{ font: '500 12px/1.4 "JetBrains Mono", monospace', color: 'var(--text-primary)' }}>{token}</code>
            <div
              data-numeric
              style={{ font: '400 12px/1.5 "JetBrains Mono", monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}
            >
              {values[token] || '—'}
            </div>
            {note && (
              <div style={{ font: '400 12px/1.45 Inter, sans-serif', color: 'var(--text-secondary)', marginTop: 4 }}>{note}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContrastTable() {
  const values = useTokenValues(TEXT_ON_WHITE);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
        <thead>
          <tr>
            {['Token', 'Value', 'On white', 'Permitted for'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  font: '600 12px/1.4 Inter, sans-serif',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TEXT_ON_WHITE.map((token) => {
            const value = values[token] || '';
            const ratio = contrastOnWhite(value);
            const v = ratio ? verdict(ratio) : null;
            return (
              <tr key={token}>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ font: '600 15px/1.4 Inter, sans-serif', color: `var(${token})` }}>Aa</span>{' '}
                  <code style={{ font: '400 12px/1.4 "JetBrains Mono", monospace', color: 'var(--text-primary)' }}>{token}</code>
                </td>
                <td
                  data-numeric
                  style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', font: '400 12px "JetBrains Mono", monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}
                >
                  {value || '—'}
                </td>
                <td
                  data-numeric
                  style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', font: '500 13px "JetBrains Mono", monospace', color: 'var(--text-primary)' }}
                >
                  {ratio ? `${ratio.toFixed(2)}:1` : '—'}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  {v && (
                    <span style={{ font: '500 12px/1.4 Inter, sans-serif', color: `var(${v.token})` }}>{v.label}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MOTION: Swatch[] = [
  { token: '--dur-state', note: 'hover, focus, toggle, tab switch' },
  { token: '--dur-reorder', note: 'lists, tables, rankings' },
  { token: '--dur-reveal', note: 'charts entering the viewport — once only' },
  { token: '--ease-out', note: 'the only easing curve' },
];

/** Motion tokens are durations, not colours, so they get values and a live sample instead of a swatch. */
function MotionTable() {
  const values = useTokenValues(MOTION.map((m) => m.token));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {MOTION.map(({ token, note }) => (
        <div
          key={token}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 12,
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface-1)',
          }}
        >
          <code style={{ font: '500 12px "JetBrains Mono", monospace', color: 'var(--text-primary)', minWidth: 118 }}>{token}</code>
          <span data-numeric style={{ font: '400 12px "JetBrains Mono", monospace', color: 'var(--text-muted)', minWidth: 190 }}>
            {values[token] || '—'}
          </span>
          <span style={{ font: '400 13px Inter, sans-serif', color: 'var(--text-secondary)' }}>{note}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The chrome tokens in the arrangement they are actually used in.
 *
 * A stand-in for the header and sidebar, not the real AppShell — it exists so the combination can
 * be judged (and its contrast measured) without an authenticated session. If AppShell's chrome
 * changes, change this with it.
 */
function ChromePreview() {
  const items = ['Dashboard', 'Data Analysis', 'Campaigns', 'Product Intelligence'];
  // The pulse runs once and stops, as it must — remounting the item is what replays it for review.
  const [pulseRun, setPulseRun] = useState(0);
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--chrome-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid var(--chrome-border)',
        }}
      >
        <span
          style={{
            font: '600 13px Inter, sans-serif',
            color: 'var(--surface-0)',
            background: '#111827',
            borderRadius: 999,
            padding: '5px 12px',
          }}
        >
          Performance+
        </span>
        <span style={{ font: '400 13px Inter, sans-serif', color: 'var(--chrome-fg)' }}>Brand switcher</span>
        <span style={{ font: '400 12px Inter, sans-serif', color: 'var(--chrome-fg-subtle)', marginLeft: 'auto' }}>
          notifications · account
        </span>
        <button
          type="button"
          onClick={() => setPulseRun((run) => run + 1)}
          style={{
            font: '500 12px Inter, sans-serif',
            color: 'var(--sky-500)',
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Replay cascade
        </button>
      </div>
      <div style={{ display: 'flex', minHeight: 190 }}>
        <nav
          style={{
            width: 210,
            borderRight: '1px solid var(--chrome-border)',
            padding: '12px 10px',
            display: 'grid',
            gap: 2,
            alignContent: 'start',
          }}
        >
          <span
            style={{
              font: '600 10px Inter, sans-serif',
              color: 'var(--chrome-fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              padding: '4px 8px',
            }}
          >
            Market &amp; Data
          </span>
          {items.map((label, index) => (
            <span
              key={index === 1 ? `${label}-${pulseRun}` : label}
              className={index === 1 ? 'nav-cascade-pulse' : undefined}
              style={{
                font: '500 13px Inter, sans-serif',
                color: index === 0 ? 'var(--chrome-fg)' : 'var(--chrome-fg-muted)',
                background: index === 0 ? 'var(--chrome-control-hover)' : 'transparent',
                borderRadius: 6,
                padding: '7px 10px',
              }}
            >
              {label}
            </span>
          ))}
        </nav>
        <div style={{ flex: 1, background: 'var(--app-canvas-bg)', padding: 16 }}>
          <div
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              borderRadius: 10,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: '400 13px Inter, sans-serif',
              color: 'var(--text-muted)',
            }}
          >
            canvas
          </div>
        </div>
      </div>
    </div>
  );
}

/** Presets that make the silhouette obviously different, so the radar can be judged at a glance. */
const RADAR_PRESETS: { label: string; weights: Record<string, number> }[] = [
  { label: 'Ισορροπημένη', weights: { profit: 20, stock: 20, strategic: 20, revenue: 20, fit: 20 } },
  { label: 'Κερδοφορία', weights: { profit: 60, stock: 10, strategic: 10, revenue: 15, fit: 5 } },
  { label: 'Απόθεμα', weights: { profit: 10, stock: 55, strategic: 10, revenue: 10, fit: 15 } },
  { label: 'Συνάφεια', weights: { profit: 10, stock: 10, strategic: 15, revenue: 15, fit: 50 } },
];

function RadarDemo() {
  const [preset, setPreset] = useState(0);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)', padding: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {RADAR_PRESETS.map((option, index) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setPreset(index)}
            style={{
              font: '500 12px Inter, sans-serif',
              color: index === preset ? 'var(--surface-0)' : 'var(--text-secondary)',
              background: index === preset ? 'var(--orange-700)' : 'var(--surface-0)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '6px 12px',
              cursor: 'pointer',
              transition: 'background var(--dur-state) var(--ease-out)',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <WeightsRadar weights={RADAR_PRESETS[preset].weights} />
    </div>
  );
}

export function StyleGuide() {
  return (
    <div style={{ background: 'var(--surface-0)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 96px' }}>
        <header style={{ marginBottom: 40 }}>
          <h1 style={{ font: '700 32px/1.2 "Plus Jakarta Sans", sans-serif', color: 'var(--text-heading)', margin: '0 0 8px' }}>
            Performance+ — Design System v2
          </h1>
          <p style={{ font: '400 15px/1.65 Inter, sans-serif', color: 'var(--text-secondary)', margin: 0, maxWidth: '70ch' }}>
            Every value below is read from the live computed styles, and every contrast ratio is
            computed with the WCAG formula on this page. If a token is edited in{' '}
            <code style={{ font: '400 13px "JetBrains Mono", monospace', color: 'var(--text-primary)' }}>src/styles/tokens.css</code>,
            this page changes with it — that is what makes it a checkpoint rather than documentation.
          </p>
        </header>

        <Section
          title="Brand"
          description="Sampled from the logo and fixed. They are not used in equal measure: navy dominates, orange marks the single action, sky and gold are accents."
        >
          <SwatchGrid items={BRAND} />
        </Section>

        <Section
          title="Contrast — measured, not assumed"
          description="This is the constraint that decides where each colour may appear. Orange and gold fail for body text on white; that is why an orange text token exists separately from the orange background token."
        >
          <ContrastTable />
        </Section>

        <Section title="Scales" description="Tints and shades computed by mixing with white and black. Reach for one of these before introducing a new hex.">
          {SCALES.map((scale) => (
            <div key={scale.name} style={{ marginBottom: 20 }}>
              <h3 style={{ font: '600 13px/1.4 Inter, sans-serif', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                {scale.name}
              </h3>
              <SwatchGrid items={scale.tokens.map((token) => ({ token }))} />
            </div>
          ))}
        </Section>

        <Section title="Neutrals" description="Deliberately not navy-tinted: dense data would tire the eye if every neutral carried the brand hue.">
          <SwatchGrid items={NEUTRALS} />
        </Section>

        <Section title="Semantic" description="Kept away from orange and gold so a red error is never mistaken for an active CTA.">
          <SwatchGrid items={SEMANTIC} />
        </Section>

        <Section title="RFM segments">
          <SwatchGrid items={SEGMENTS} />
        </Section>

        <Section title="Action colours in context" description="Orange is the only primary action. Gold carries navy on top of it, never the reverse.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <button
              type="button"
              style={{
                font: '600 14px Inter, sans-serif',
                color: 'var(--surface-0)',
                background: 'var(--orange-700)',
                border: 'none',
                borderRadius: 8,
                padding: '10px 18px',
                cursor: 'pointer',
                transition: `background var(--dur-state) var(--ease-out)`,
              }}
            >
              Primary action
            </button>
            <button
              type="button"
              style={{
                font: '600 14px Inter, sans-serif',
                color: 'var(--sky-500)',
                background: 'var(--surface-0)',
                border: '1px solid var(--sky-100)',
                borderRadius: 8,
                padding: '10px 18px',
                cursor: 'pointer',
                transition: `border-color var(--dur-state) var(--ease-out)`,
              }}
            >
              Secondary
            </button>
            <span
              style={{
                font: '600 12px Inter, sans-serif',
                color: 'var(--navy-500)',
                background: 'var(--gold-500)',
                borderRadius: 999,
                padding: '5px 12px',
              }}
            >
              Navy on gold — 7.40:1
            </span>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{ font: '500 14px Inter, sans-serif', color: 'var(--sky-500)' }}
            >
              A link
            </a>
          </div>
        </Section>

        <Section
          title="App chrome"
          description="Header and sidebar, light. The old chrome was a dark bar carrying white text at a dozen opacities; those are roles now, so switching back is a change to one token block rather than another sweep. The second nav item shows the cascade pulse."
        >
          <ChromePreview />
          <div style={{ marginTop: 16 }}>
            <SwatchGrid
              items={[
                { token: '--chrome-bg' },
                { token: '--chrome-border' },
                { token: '--chrome-fg' },
                { token: '--chrome-fg-muted' },
                { token: '--chrome-fg-subtle' },
                { token: '--chrome-control-bg' },
                { token: '--chrome-control-hover' },
              ]}
            />
          </div>
        </Section>

        <Section
          title="Strategy silhouette"
          description="One orange outline rather than five coloured series: the point is to recognise a single shape at a glance. The factor colours below it live on the sliders, where telling the five apart is what matters. Switch preset to see the transition."
        >
          <RadarDemo />
          <div style={{ marginTop: 16 }}>
            <SwatchGrid
              items={[
                { token: '--factor-profit', note: 'Κερδοφορία' },
                { token: '--factor-stock', note: 'Βελτιστοποίηση αποθέματος' },
                { token: '--factor-strategic', note: 'Στρατηγική προτεραιότητα' },
                { token: '--factor-revenue', note: 'Στόχος εσόδων' },
                { token: '--factor-fit', note: 'Συνάφεια πελάτη' },
              ]}
            />
          </div>
        </Section>

        <Section title="Typography" description="Display in Plus Jakarta Sans, body in Inter, every number in JetBrains Mono with tabular figures.">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ font: '700 30px/1.2 "Plus Jakarta Sans", sans-serif', color: 'var(--text-heading)' }}>Display 700 — headings</div>
            <div style={{ font: '600 20px/1.3 "Plus Jakarta Sans", sans-serif', color: 'var(--text-heading)' }}>Display 600 — section titles</div>
            <div style={{ font: '400 15px/1.65 Inter, sans-serif', color: 'var(--text-primary)' }}>
              Body 400 in Inter — the reading weight for everything that is not a number or a heading.
            </div>
            <div style={{ font: '500 14px/1.5 Inter, sans-serif', color: 'var(--text-secondary)' }}>UI 500 — labels, controls, table headers.</div>
            <div>
              <div style={{ font: '400 12px Inter, sans-serif', color: 'var(--text-muted)', marginBottom: 4 }}>
                Tabular figures — these two rows must align exactly, and the digits must not shift as values update:
              </div>
              <div className="metric" style={{ font: '500 22px "JetBrains Mono", monospace', color: 'var(--text-primary)' }}>€ 1.111.111,11</div>
              <div className="metric" style={{ font: '500 22px "JetBrains Mono", monospace', color: 'var(--text-primary)' }}>€ 8.888.888,88</div>
            </div>
          </div>
        </Section>

        <Section title="Motion" description="Three durations exist. Anything that does not fit one of them does not go in. All of them collapse under prefers-reduced-motion.">
          <MotionTable />
        </Section>
      </div>
    </div>
  );
}
