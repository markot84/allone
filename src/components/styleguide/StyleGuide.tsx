import { useMemo, useState } from 'react';
import { WeightsRadar } from '../strategy/WeightsRadar';
import { VelocitySpark } from '../common/VelocitySpark';
import { SegmentTreemap } from '../rfm/SegmentTreemap';
import { SegmentMigrationSankey } from '../rfm/SegmentMigrationSankey';
import { BriefingNarrative } from '../dashboard/BriefingNarrative';
import { EnterpriseBadge } from '../common/EnterpriseBadge';
import { SpotlightGrid } from '../common/SpotlightGrid';
import { HeroKPICard } from '../common/HeroKPICard';
import { KPICard } from '../common/KPICard';
import type { BriefingData } from '../../services/morningBriefing';
import { contrastRatio } from '../../utils/color';
import { useTheme } from '../../hooks/useTheme';
import { readTokenColor } from '../../utils/cssToken';
import type { SegmentMigrationFlow } from '../../services/rfmFromOrders';
import type { Product, RFMSegment } from '../../types';

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
  { token: '--surface-0', note: 'cards — the raised surface' },
  { token: '--surface-1', note: 'app canvas, behind the cards' },
  { token: '--surface-2', note: 'hover / deeper layer' },
  { token: '--border' },
  { token: '--border-strong' },
  { token: '--text-primary' },
  { token: '--text-secondary' },
  { token: '--text-muted' },
  { token: '--text-heading', note: 'navy in the light theme, white in the cockpit' },
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

/** Tokens whose accessible use is constrained; checked live against the ACTIVE canvas. */
const CONSTRAINED_TEXT_TOKENS = [
  '--brand-navy',
  '--sky-500',
  '--orange-700',
  '--orange-600',
  '--orange-500',
  '--gold-500',
  // The neutrals were never measured in colors.md; they are text just as much as the brand colours.
  '--text-primary',
  '--text-secondary',
  '--text-muted',
];

/** What a measured ratio permits, per colors.md §3. */
function verdict(ratio: number): { label: string; token: string } {
  if (ratio >= 4.5) return { label: 'AA — any text', token: '--success' };
  if (ratio >= 3) return { label: 'Large text / icons only', token: '--warning' };
  return { label: 'Never as text', token: '--danger' };
}

/**
 * Live token values.
 *
 * These used to be read once on mount, on the reasoning that a stylesheet does not change after it
 * is parsed. Switching themes changes what the same token resolves to, so a one-shot read leaves
 * this page asserting the previous theme's numbers — the one failure mode a consistency checkpoint
 * cannot have. Re-reading on `theme` is what keeps the page a measurement rather than a record.
 */
function useTokenValues(tokens: string[]): Record<string, string> {
  const { theme } = useTheme();
  const key = tokens.join('|');
  return useMemo(() => {
    if (typeof window === 'undefined') return {};
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(key.split('|').map((token) => [token, styles.getPropertyValue(token).trim()]));
    // `theme` is the trigger, not an input: it is never read inside, but it is precisely what makes
    // getComputedStyle return different values, which is the one thing the linter cannot see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme]);
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
  const { theme } = useTheme();
  // `--surface-0` is the card surface in both themes — white in the light theme, so the numbers this
  // page has always reported are unchanged there, and navy in the cockpit.
  const values = useTokenValues([...CONSTRAINED_TEXT_TOKENS, '--surface-0']);
  const canvas = values['--surface-0'] || '#FFFFFF';
  const canvasLabel = theme === 'dark' ? 'On the cockpit canvas' : 'On white';

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
        <thead>
          <tr>
            {['Token', 'Value', canvasLabel, 'Permitted for'].map((h) => (
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
          {CONSTRAINED_TEXT_TOKENS.map((token) => {
            const value = values[token] || '';
            const ratio = contrastRatio(value, canvas);
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
            background: 'var(--navy-500)',
            borderRadius: 999,
            padding: '5px 12px',
          }}
        >
          allone
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

/**
 * The command palette's surface, as a still.
 *
 * The real one needs a signed-in brand for its product and segment search, so it cannot run on this
 * public page. This shows the styling it is judged on; keep the two in step.
 */
function PalettePreview() {
  const rows = [
    { icon: '⌗', label: 'Data Analysis', hint: 'Ενότητα' },
    { icon: '⌗', label: 'Product Intelligence', hint: 'Ενότητα', selected: true },
    { icon: '▤', label: 'Nike Air Zoom Pegasus 40', hint: 'NK-AZ-P40' },
  ];
  return (
    <div
      style={{
        background: 'color-mix(in srgb, var(--text-primary) 45%, transparent)',
        borderRadius: 12,
        padding: '28px 16px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(16,24,40,.24)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-muted)' }}>⌕</span>
          <span style={{ flex: 1, font: '400 15px Inter, sans-serif', color: 'var(--text-muted)' }}>
            Μετάβαση σε ενότητα, SKU ή segment…
          </span>
          <kbd style={{ font: '500 11px "JetBrains Mono", monospace', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px' }}>
            esc
          </kbd>
        </div>
        <div style={{ padding: 8 }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
                background: row.selected ? 'var(--surface-2)' : 'transparent',
                font: '400 14px Inter, sans-serif',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{row.icon}</span>
              <span style={{ flex: 1 }}>{row.label}</span>
              <span data-numeric style={{ font: '400 12px "JetBrains Mono", monospace', color: 'var(--text-muted)' }}>{row.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Enough of a briefing snapshot to show what becomes clickable and what deliberately does not. */
const DEMO_BRIEFING_DATA: BriefingData = {
  revenue: {
    totalOrganic: 4200, totalCampaignRevenue: 18500, storeRevenue: 32450, ecommerceSourceActive: true,
    trueRoas: 4.7, revenueGap: 0, orderCount: 214, aov: 151.6, totalSpend: 6900, roas: 2.68, campaignCount: 5,
  },
  dataQuality: {
    ecommerceLatestPositiveRevenueDay: null, ecommerceDaysSinceLatestRevenue: null,
    ecommerceAggregateSyncedHoursAgo: null, suspectedEcommerceSyncGap: false,
  },
  ga4: {
    sessions: 12800, users: 9400, newUsers: 6100, bounceRate: 41.2, conversions: 318,
    weeklyChange: { sessions: 12.4, users: null, conversions: -3.1 },
  },
  inventory: {
    totalProducts: 4500, deadStock: 320, lowStock: 88, excessStock: 140, deadStockValue: 27300,
    lowStockTopNames: ['Καφετιέρα Espresso Pro'],
  },
  segments: { total: 5, totalCustomers: 3450, atRiskPct: 22.4, championsPct: 11.8, topSegment: { name: 'Hibernating', pct: 30.2 } },
  campaigns: {
    topPerformer: { name: 'Black Friday Retargeting', roas: 6.2 },
    worstPerformer: { name: 'Generic Prospecting', roas: 0.8, spend: 1450 },
  },
  alerts: { count: 7, critical: 2, topAlerts: [] },
  brandName: 'Demo',
};

const DEMO_NARRATIVE =
  'Ο μήνας κλείνει με 32.450 € έσοδα από 214 παραγγελίες, με μέση αξία 151,6 €. ' +
  'Η διαφημιστική δαπάνη έφτασε τα 6.900 € και η συνολική απόδοση είναι 4,7×, κυρίως χάρη στην «Black Friday Retargeting». ' +
  'Στο απόθεμα, 320 προϊόντα παραμένουν νεκρά και δεσμεύουν 27.300 €, ενώ η Καφετιέρα Espresso Pro τελειώνει. ' +
  'Το Hibernating κρατά πλέον 30,2% του πελατολογίου και οι 12.800 επισκέψεις δεν μετατρέπονται ανάλογα. ' +
  'Ένα νούμερο που δεν προέρχεται από τα δεδομένα, όπως 99.999 €, μένει σκέτο κείμενο.';

function BriefingNarrativeDemo() {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)', padding: 16 }}>
      <BriefingNarrative narrative={DEMO_NARRATIVE} data={DEMO_BRIEFING_DATA} animate={false} />
    </div>
  );
}

/** Five segments whose customer count and revenue share deliberately disagree, so the treemap's
 *  two encodings can be told apart: Hibernating is the biggest tile and nearly the palest. */
const DEMO_SEGMENTS: RFMSegment[] = [
  { id: 'champions', name: 'Champions', rfm_score: '555', count: 420, percentage: 12, revenue_share: 41, color: 'var(--seg-champions)', description: '', icon: '' },
  { id: 'loyal', name: 'Loyal', rfm_score: '445', count: 690, percentage: 20, revenue_share: 27, color: 'var(--seg-loyal)', description: '', icon: '' },
  { id: 'potential', name: 'Potential', rfm_score: '345', count: 540, percentage: 16, revenue_share: 16, color: 'var(--seg-potential)', description: '', icon: '' },
  { id: 'at_risk', name: 'At Risk', rfm_score: '234', count: 780, percentage: 22, revenue_share: 12, color: 'var(--seg-at-risk)', description: '', icon: '' },
  { id: 'lost', name: 'Hibernating', rfm_score: '111', count: 1020, percentage: 30, revenue_share: 4, color: 'var(--seg-lost)', description: '', icon: '' },
];

const DEMO_FLOWS: SegmentMigrationFlow[] = [
  { from: 'champions', fromName: 'Champions', to: 'loyal', toName: 'Loyal', count: 48, percentage: 3.1 },
  { from: 'loyal', fromName: 'Loyal', to: 'at_risk', toName: 'At Risk', count: 96, percentage: 6.2 },
  { from: 'at_risk', fromName: 'At Risk', to: 'lost', toName: 'Hibernating', count: 134, percentage: 8.7 },
  { from: 'potential', fromName: 'Potential', to: 'champions', toName: 'Champions', count: 41, percentage: 2.6 },
  { from: 'lost', fromName: 'Hibernating', to: 'potential', toName: 'Potential', count: 27, percentage: 1.7 },
];

function SegmentTreemapDemo() {
  const [selected, setSelected] = useState<string | null>('champions');
  // The demo segments carry token references, which SVG paint attributes cannot resolve.
  const segments = useMemo(
    () => DEMO_SEGMENTS.map((s) => ({ ...s, color: readTokenColor(s.color.slice(4, -1), '#667085') })),
    []
  );
  return <SegmentTreemap segments={segments} selectedId={selected} onSelect={setSelected} animate />;
}

function SegmentMigrationSankeyDemo() {
  const colorById = useMemo(
    () => new Map(DEMO_SEGMENTS.map((s) => [s.id, readTokenColor(s.color.slice(4, -1), '#667085')])),
    []
  );
  return <SegmentMigrationSankey flows={DEMO_FLOWS} colorById={colorById} revealKey="styleguide-sankey" />;
}

/** The four shapes a row sparkline can take, so the colour rule is checkable at a glance. */
const VELOCITY_CASES: { label: string; hint: string; product: Product }[] = (() => {
  const base = {
    id: 'demo',
    name: 'Demo',
    sku: 'DEMO',
    category: '',
    margin_tier: 'high' as const,
    margin_percentage: 0,
    stock_level: 0,
    stock_capacity: 0,
    price: 0,
  };
  return [
    {
      label: 'Επιτάχυνση',
      hint: '0.5 → 1.0 → 3.0 /ημ.',
      product: { ...base, qty_sold_last_90d: 45, qty_sold_last_30d: 30, qty_sold_last_7d: 21 },
    },
    {
      label: 'Επιβράδυνση',
      hint: '3.0 → 1.0 → 0.14 /ημ.',
      product: { ...base, qty_sold_last_90d: 270, qty_sold_last_30d: 30, qty_sold_last_7d: 1 },
    },
    {
      label: 'Σταθερό',
      hint: '2.0 σε όλα τα παράθυρα',
      product: { ...base, qty_sold_last_90d: 180, qty_sold_last_30d: 60, qty_sold_last_7d: 14 },
    },
    {
      label: 'Χωρίς δεδομένα',
      hint: 'η στήλη κρύβεται όταν κανένα SKU δεν έχει δύο παράθυρα',
      product: { ...base },
    },
  ];
})();

function VelocitySparkDemo() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {VELOCITY_CASES.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface-1)',
          }}
        >
          <span style={{ font: '500 13px Inter, sans-serif', color: 'var(--text-primary)', minWidth: 140 }}>
            {row.label}
          </span>
          <VelocitySpark product={row.product} />
          <span style={{ font: '400 12px Inter, sans-serif', color: 'var(--text-muted)' }}>{row.hint}</span>
        </div>
      ))}
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
  const { theme } = useTheme();
  return (
    <div style={{ background: 'var(--surface-0)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 96px' }}>
        <header style={{ marginBottom: 40 }}>
          <h1 style={{ font: '700 32px/1.2 "Plus Jakarta Sans", sans-serif', color: 'var(--text-heading)', margin: '0 0 8px' }}>
            allone — Design System v2
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
          description={
            theme === 'dark'
              ? 'This is the constraint that decides where each colour may appear, and it is not a property of the colour — it is a property of the pair. Every verdict below inverts against the light theme: gold, barred from text at 1.60:1 on white, measures over 10:1 here, while navy stops being a text colour altogether.'
              : 'This is the constraint that decides where each colour may appear. Orange and gold fail for body text on white; that is why an orange text token exists separately from the orange background token.'
          }
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

        <Section
          title="Surfaces"
          description={
            theme === 'dark'
              ? 'Depth on a near-black canvas cannot come from a shadow — there is nothing for it to fall on. It comes from a lit hairline along the top edge instead, as though the light were above. Move the pointer across the row: one soft light travels over all three cards rather than each card highlighting itself, which is what makes the movement read as continuous.'
              : 'A card is a border, a small shadow and a hover. The lit top edge and the cursor spotlight are defined here too, but both resolve to transparent in this theme: a wash that soft is invisible on white, and forcing it up to where it would show only muddies the surface. Switch to the cockpit to see them.'
          }
        >
          <SpotlightGrid
            style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            {[
              { title: 'Static', note: 'No hover — most cards on a page are this.', interactive: false },
              { title: 'Interactive', note: 'Lifts 1px and deepens on hover and on keyboard focus.', interactive: true },
              { title: 'Interactive', note: 'Tab to this one: the hover state is not mouse-only.', interactive: true },
            ].map((card, index) => (
              <div
                key={index}
                className="surface"
                data-interactive={card.interactive ? 'true' : undefined}
                tabIndex={card.interactive ? 0 : undefined}
                style={{ padding: 20, cursor: card.interactive ? 'pointer' : 'default' }}
              >
                <div style={{ font: '600 15px Inter, sans-serif', color: 'var(--text-heading)' }}>{card.title}</div>
                <p style={{ font: '400 13px/1.5 Inter, sans-serif', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                  {card.note}
                </p>
              </div>
            ))}
          </SpotlightGrid>
        </Section>

        <Section
          title="Bento — one figure, not five equal ones"
          description="A row of identically sized KPI cards asserts that every number matters equally, so none of them does and the block is read left to right like a table. The hero takes roughly four times the area, its sparkline is the card's background rather than a strip under the number, and the figure counts up once per session — rare enough that it reads as a live measurement instead of a habit."
        >
          <SpotlightGrid className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-2">
            <HeroKPICard
              className="lg:col-span-2 lg:row-span-2"
              label="Σύνολο Εσόδων"
              value={148320}
              format={(v) => `€${Math.round(v).toLocaleString('el-GR')}`}
              countKey="styleguide-demo-revenue"
              change={12}
              changeLabel="vs προηγ. μήνα"
              trend="up"
              sparklineData={[38, 41, 39, 46, 52, 49, 58, 61, 57, 66, 71, 78]}
              tooltip="Demo figure — this page renders no live data."
            />
            <KPICard index={1} kpi={{ label: 'Marketing Expenses', value: '€24.1k', change: -4, changeLabel: 'vs προηγ. μήνα', trend: 'down', sparklineData: [22, 25, 24, 21, 20, 19] }} />
            <KPICard index={2} kpi={{ label: 'Μέσο Καλάθι (AOV)', value: '€68,4', change: 6, changeLabel: 'vs προηγ. μήνα', trend: 'up', sparklineData: [61, 63, 62, 65, 67, 68] }} />
          </SpotlightGrid>
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
            {/* The real component, not a mock — this is the app's one highlight badge, and until
                now it ran on an off-palette purple→blue gradient. */}
            <EnterpriseBadge inline />
          </div>
        </Section>

        <Section
          title="Command palette"
          description="⌘K / Ctrl+K, from anywhere. Navigation only: it jumps to a section, a SKU or a segment. Changing a strategy scenario is left out on purpose — it saves the active strategy and triggers AI generation, which needs the confirmation the Configurator gives it, not a keystroke."
        >
          <PalettePreview />
        </Section>

        <Section
          title="App chrome"
          description="Header and sidebar: white surface, navy text. §2 lists navigation among navy's roles and it was the last of the four still rendering neutral grey — but §6 rules navy out as a large surface, so navy arrives as the label and the wash behind the active item, never as a navy sidebar. Group labels stay neutral: they head the navigation rather than belonging to it. The second nav item shows the cascade pulse."
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

        <Section
          title="Briefing as navigation"
          description="Numbers and names in the morning briefing become interactive by being matched against the data the prompt was built from — never by asking the model to annotate itself, which would let it attribute a figure to whatever source it liked. Hover a number for its source; click a name to open its module. The last sentence contains a figure that is in no dataset, and it stays plain text. The reveal staggers by sentence, but only on the first read of the day."
        >
          <BriefingNarrativeDemo />
        </Section>

        <Section
          title="Segment mix"
          description="Area is customers, fill intensity is share of revenue — the two donuts this replaces made you hold one in your head while reading the other. Each segment keeps its own hue and is diluted toward white as its revenue share falls, so the identity survives the second encoding. Click a tile to select it."
        >
          <SegmentTreemapDemo />
        </Section>

        <Section
          title="Segment migration"
          description="Real customer movement, not a model: every customer's segment is re-derived at two points in the order history and the assignments are diffed. Left is who they were, right is who they are — two node sets, because Champions → At Risk and At Risk → Champions in the same window would be a cycle on shared nodes. Draws itself once, when it first scrolls into view."
        >
          <SegmentMigrationSankeyDemo />
        </Section>

        <Section
          title="Row trend"
          description="The Product Intelligence sparkline. Three points — average units/day over the last 90, 30 and 7 days — not daily history, because the catalogue stores no time series. Green for accelerating, red for slowing, muted grey for flat. A static SVG rather than a chart component: at 150 virtualized rows the ResizeObserver behind a Tremor spark chart is the most expensive thing on the page."
        >
          <VelocitySparkDemo />
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
