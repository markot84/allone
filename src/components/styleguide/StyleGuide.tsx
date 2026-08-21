import { useMemo, useState } from 'react';
import { WeightsRadar } from '../strategy/WeightsRadar';
import { VelocitySpark } from '../common/VelocitySpark';
import { SegmentTreemap } from '../rfm/SegmentTreemap';
import { SegmentMigrationSankey } from '../rfm/SegmentMigrationSankey';
import { BriefingNarrative } from '../dashboard/BriefingNarrative';
import { EnterpriseBadge } from '../common/EnterpriseBadge';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { KPICard } from '../common/KPICard';
import { ProgressBar } from '../common/ProgressBar';
import {
  AxisTicks,
  LegendKey,
  MONO,
  MetricSpark,
  MetricTile,
  PillButton,
  SignalCard,
  SignalCardHeader,
  SignalChip,
  SignalSkeleton,
} from '../signal';
import { channelColor, seriesPalette } from '../../styles/chartTheme';
import type { BriefingData } from '../../services/morningBriefing';
import { contrastOnWhite } from '../../utils/color';
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
  { token: '--success', note: 'fill only — 2.3:1 on white' },
  { token: '--warning' },
  { token: '--danger', note: 'fill only — 3.4:1 on white' },
  { token: '--info', note: 'resolves to sky' },
  { token: '--success-700', note: 'the "+8,4%" figure — AA on white' },
  { token: '--danger-700', note: 'the "−3,8%" figure — AA on white' },
  { token: '--danger-600', note: 'critical severity text' },
  { token: '--sky-badge-bg', note: 'info badge fill' },
];

const SEGMENTS: Swatch[] = [
  { token: '--seg-champions' },
  { token: '--seg-loyal' },
  { token: '--seg-potential' },
  { token: '--seg-at-risk' },
  { token: '--seg-hibernating', note: 'was falling through to --seg-lost' },
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
  // The neutrals were never measured in colors.md; they are text just as much as the brand colours.
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  // The delta figures beside every metric. The base --success / --danger are here to show why the
  // 700 steps had to exist at all.
  '--success',
  '--success-700',
  '--danger',
  '--danger-700',
  '--danger-600',
];

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
              /* The real rail classes, so hover, focus and the gold marker are the app's, not a
                 restatement of them. */
              className={`rail-nav-item${index === 0 ? ' rail-nav-item--current' : ''}${
                index === 1 ? ' nav-cascade-pulse' : ''
              }`}
              style={{ font: '500 13px "Plus Jakarta Sans", sans-serif', borderRadius: 9, padding: '7px 10px' }}
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

/**
 * The Signal Board vocabulary, drawn with the real components.
 *
 * Every page of the app is built from these eight parts, so this is the block to check a new page
 * against: if a page invents a ninth, either the vocabulary is missing something or the page is.
 */
function VocabularyPreview() {
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      <SignalCard style={{ gap: 16 }}>
        <SignalCardHeader eyebrow="Card header" title="Eyebrow, then title" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <MetricTile label="Τζίρος" value="€243,2K" note="+8,4%" noteDirection="up" />
          <MetricTile label="Δαπάνη" value="€81,7K" note="+12,1%" noteDirection="down" />
          <MetricTile label="ROAS" value="3,20×" note="σταθερό" noteDirection="flat" />
        </div>
        <MetricSpark values={[12, 18, 15, 24, 21, 30, 27, 36]} />
        <AxisTicks ticks={['1 Αυγ', '8 Αυγ', '15 Αυγ', '20 Αυγ']} />
      </SignalCard>

      <SignalCard accent="var(--danger-600)" style={{ gap: 14 }}>
        <SignalCardHeader eyebrow="Accent edge" title="A card that carries a decision" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SignalChip tone="var(--danger-600)" background="var(--danger-light)">Κρίσιμο</SignalChip>
          <SignalChip tone="var(--orange-700)" background="var(--warning-light)">Προσοχή</SignalChip>
          <SignalChip tone="var(--sky-700)" background="var(--sky-badge-bg)">Πληροφορία</SignalChip>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PillButton active tone="var(--orange-700)">Εφαρμογή</PillButton>
          <PillButton>Αναβολή</PillButton>
          <PillButton disabled>Απορρίφθηκε</PillButton>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          <LegendKey color="var(--orange-500)">Τζίρος</LegendKey>
          <LegendKey color="var(--sky-500)" shape="block">Δαπάνη</LegendKey>
        </div>
      </SignalCard>

      <SignalCard style={{ gap: 14 }}>
        <SignalCardHeader eyebrow="Loading" title="Skeletons carry the real dimensions" />
        <SignalSkeleton height={44} />
        <SignalSkeleton height={16} width="60%" />
        <SignalSkeleton height={16} width="40%" />
      </SignalCard>
    </div>
  );
}

/** The shared primitives, which are the same vocabulary wearing their old API. */
function PrimitivesPreview() {
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      <KPICard
        kpi={{
          label: 'Συνολικά έσοδα',
          value: '€243,2K',
          change: 8.4,
          changeLabel: 'vs προηγ. μήνα',
          sparklineData: [18, 22, 19, 27, 24, 33, 30, 41],
        }}
      />
      <KPICard
        kpi={{
          label: 'Marketing expenses',
          value: '€81,7K',
          change: 12.1,
          trend: 'down',
          changeLabel: 'vs προηγ. μήνα',
          subtext: 'σε 4 πλατφόρμες',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" size="sm">Primary</Button>
          <Button variant="secondary" size="sm">Secondary</Button>
          <Button variant="danger" size="sm">Danger</Button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge variant="success">Ενεργό</Badge>
          <Badge variant="warning">Εκκρεμεί</Badge>
          <Badge variant="danger">Σφάλμα</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="orange">Mark</Badge>
          <Badge variant="gold">Highlight</Badge>
        </div>
        <ProgressBar value={68} showLabel />
      </div>
    </div>
  );
}

/** The categorical ramp Recharts and Nivo both read, resolved live from `chartTheme`. */
function ChartPalettePreview() {
  const series = seriesPalette();
  const channels = ['Organic Search', 'Paid Search', 'Organic Social', 'Paid Social', 'Direct', 'Email', 'Referral', '(Other)'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {series.map((color, i) => (
          <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 6, background: color, display: 'block' }} />
            <code style={{ font: `400 11px ${MONO}`, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {i}. {color}
            </code>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {channels.map((channel) => (
          <LegendKey key={channel} color={channelColor(channel)} shape="block">
            {channel}
          </LegendKey>
        ))}
      </div>
    </div>
  );
}

/** The table treatment every page's data grid inherits from one class. */
function DataTablePreview() {
  const rows = [
    { channel: 'Organic Search', sessions: 6421, revenue: '€84.210', share: '38,4%' },
    { channel: 'Paid Search', sessions: 3187, revenue: '€61.940', share: '19,1%' },
    { channel: 'Direct', sessions: 2760, revenue: '€44.330', share: '16,5%' },
    { channel: 'Paid Social', sessions: 1902, revenue: '€28.070', share: '11,4%' },
  ];
  return (
    <div style={{ border: '1px solid var(--navy-100)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface-0)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Κανάλι</th>
              <th className="text-right">Sessions</th>
              <th className="text-right">Έσοδα</th>
              <th className="text-right">Μερίδιο</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.channel}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: channelColor(row.channel) }} />
                    {row.channel}
                  </span>
                </td>
                <td className="text-right">{row.sessions.toLocaleString('el-GR')}</td>
                <td className="text-right">{row.revenue}</td>
                <td className="text-right">{row.share}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StyleGuide() {
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
            {/* The real component, not a mock — this is the app's one highlight badge, and until
                now it ran on an off-palette purple→blue gradient. */}
            <EnterpriseBadge inline />
          </div>
        </Section>

        <Section
          title="Signal Board vocabulary"
          description="Every card in the app is one of these: a white panel, an eyebrow over a title, a labelled figure, a chip, a pill, a legend key, an axis row or a skeleton. Two typefaces do the work — Plus Jakarta Sans for prose, JetBrains Mono for anything that is a measurement or a label about one. If it is set in mono, it is data."
        >
          <VocabularyPreview />
        </Section>

        <Section
          title="Shared primitives"
          description="Card, CardHeader, KPICard, PageHeader, Button, Badge and ProgressBar are the vocabulary wearing their original API, so a page that has not been touched yet still inherits the board. The entrance animation each card used to carry is gone: motion is concentrated, not sprinkled."
        >
          <PrimitivesPreview />
        </Section>

        <Section
          title="Data tables"
          description="One class, `.data-table`, carries every grid in the app: mono uppercase headers, token hairlines, and mono tabular figures in every right-aligned cell — because a right-aligned cell here is always a measurement. Wide tables scroll inside their own container rather than pushing the page sideways."
        >
          <DataTablePreview />
        </Section>

        <Section
          title="Chart palette"
          description="One ramp for every chart in the app, read from the tokens by src/styles/chartTheme.ts. Six steps, in the order a reader meets them — the primary measure orange, what it is compared against sky — then it cycles, because a chart carrying a seventh series has a bigger problem than colour. GA4's channel groups pair paid and organic of the same medium a step apart on the ramp."
        >
          <ChartPalettePreview />
        </Section>

        <Section
          title="Command palette"
          description="⌘K / Ctrl+K, from anywhere. Navigation only: it jumps to a section, a SKU or a segment. Changing a strategy scenario is left out on purpose — it saves the active strategy and triggers AI generation, which needs the confirmation the Configurator gives it, not a keystroke."
        >
          <PalettePreview />
        </Section>

        <Section
          title="App chrome"
          description="A navy rail and a navy top bar — a deliberate departure from §6, which rules navy out as a large surface. That rule still holds for the canvas: the page behind the cards stays --surface-2 and no content surface is navy. Everything navy here is chrome, and it is one token block, so reverting it is twelve lines rather than another sweep of AppShell. The active item inverts to a white wash with navy text and a gold marker down its leading edge — gold as a marker, never as text. The second nav item shows the cascade pulse."
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
                { token: '--chrome-active-bg', note: 'active item inverts' },
                { token: '--chrome-active-fg' },
                { token: '--chrome-active-marker', note: 'gold, as a marker' },
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
