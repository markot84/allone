import type { BriefingData } from './morningBriefing';
import { isSectionHidden } from '../config/modules';
import type { Campaign, RFMSegment } from '../types';

/**
 * Turning the briefing paragraph into navigation.
 *
 * The brief asks for the narrative to arrive from the generation layer already tokenised. It does
 * not, and asking the model for tokens would be the wrong fix: it would be free to attribute a
 * number to whatever source it liked, and a popover that confidently cites the wrong source is
 * worse than no popover.
 *
 * So the tokens are derived here instead, by matching the text against the very data the prompt was
 * built from. A number is only clickable if it equals a value we actually hold, and the popover
 * shows that value's real source. A number the model invented matches nothing and stays plain text
 * — the failure mode is silence, not a lie. Same for entities: only names present in the data are
 * linked.
 */

export type BriefingToken =
  | { kind: 'text'; value: string }
  | {
      kind: 'metric';
      value: string;
      /** What the number is, in the reader's language. */
      label: string;
      /** Where it came from — connector, module or computation. */
      source: string;
      /** Change against the comparable previous window, when one exists. */
      delta?: number;
      section?: string;
      hashQuery?: string;
    }
  | { kind: 'entity'; value: string; label: string; section: string; hashQuery?: string };

interface KnownMetric {
  value: number;
  label: string;
  source: string;
  delta?: number;
  section?: string;
  hashQuery?: string;
  /** Percentages and ratios are small numbers where a 0.5% tolerance is far too tight. */
  scale: 'absolute' | 'small';
}

interface TokenizeContext {
  segments?: RFMSegment[];
  campaigns?: Campaign[];
  platforms?: string[];
}

/** A section only becomes a link target if this build still has it. */
function routable(section: string | undefined): string | undefined {
  return section && !isSectionHidden(section) ? section : undefined;
}

function metricsFrom(data: BriefingData): KnownMetric[] {
  const out: KnownMetric[] = [];
  const push = (metric: KnownMetric | null) => {
    if (metric && Number.isFinite(metric.value) && metric.value !== 0) out.push(metric);
  };

  const rev = data.revenue;
  push({ value: rev.storeRevenue, label: 'Έσοδα ηλεκτρονικού καταστήματος', source: 'Παραγγελίες e-shop', section: 'ecommerce', scale: 'absolute' });
  push({ value: rev.totalOrganic, label: 'Οργανικά έσοδα', source: 'Εισαγωγή δεδομένων / ERP', section: 'ecommerce', scale: 'absolute' });
  push({ value: rev.totalCampaignRevenue, label: 'Έσοδα από καμπάνιες', source: 'Καμπάνιες (attributed)', section: 'campaigns', scale: 'absolute' });
  push({ value: rev.totalSpend, label: 'Διαφημιστική δαπάνη', source: 'Καμπάνιες', section: 'campaigns', scale: 'absolute' });
  push({ value: rev.orderCount, label: 'Παραγγελίες', source: 'Παραγγελίες e-shop', section: 'ecommerce', scale: 'absolute' });
  push({ value: rev.aov, label: 'Μέση αξία παραγγελίας', source: 'Έσοδα ÷ παραγγελίες', section: 'ecommerce', scale: 'absolute' });
  push({ value: rev.campaignCount, label: 'Ενεργές καμπάνιες', source: 'Καμπάνιες', section: 'campaigns', scale: 'absolute' });
  push({ value: rev.roas, label: 'Απόδοση διαφημιστικής δαπάνης', source: 'Έσοδα καμπανιών ÷ δαπάνη', section: 'campaigns', scale: 'small' });
  push({ value: rev.trueRoas, label: 'Συνολική απόδοση δαπάνης', source: 'Συνολικά έσοδα ÷ διαφημιστική δαπάνη', section: 'campaigns', scale: 'small' });

  const inv = data.inventory;
  push({ value: inv.totalProducts, label: 'Προϊόντα στον κατάλογο', source: 'Product Intelligence', section: 'products', scale: 'absolute' });
  push({ value: inv.deadStock, label: 'Προϊόντα σε νεκρό απόθεμα', source: 'Product Intelligence', section: 'products', hashQuery: 'stock=dead', scale: 'absolute' });
  push({ value: inv.deadStockValue, label: 'Αξία νεκρού αποθέματος', source: 'Product Intelligence', section: 'products', hashQuery: 'stock=dead', scale: 'absolute' });
  push({ value: inv.lowStock, label: 'Προϊόντα σε χαμηλό απόθεμα', source: 'Product Intelligence', section: 'products', hashQuery: 'stock=low', scale: 'absolute' });
  push({ value: inv.excessStock, label: 'Προϊόντα σε πλεόνασμα', source: 'Product Intelligence', section: 'products', hashQuery: 'stock=excess', scale: 'absolute' });

  const seg = data.segments;
  push({ value: seg.totalCustomers, label: 'Πελάτες στην ανάλυση', source: 'Data Analysis (RFM)', section: 'rfm', scale: 'absolute' });
  push({ value: seg.total, label: 'Segments', source: 'Data Analysis (RFM)', section: 'rfm', scale: 'absolute' });
  push({ value: seg.atRiskPct, label: 'Πελάτες σε κίνδυνο', source: 'Data Analysis (RFM)', section: 'rfm', scale: 'small' });
  push({ value: seg.championsPct, label: 'Champions', source: 'Data Analysis (RFM)', section: 'rfm', scale: 'small' });
  if (seg.topSegment) {
    push({ value: seg.topSegment.pct, label: `Μερίδιο «${seg.topSegment.name}»`, source: 'Data Analysis (RFM)', section: 'rfm', scale: 'small' });
  }

  if (data.ga4) {
    const change = data.ga4.weeklyChange;
    push({ value: data.ga4.sessions, label: 'Επισκέψεις', source: 'Google Analytics 4', delta: change?.sessions ?? undefined, section: 'analytics', scale: 'absolute' });
    push({ value: data.ga4.users, label: 'Χρήστες', source: 'Google Analytics 4', delta: change?.users ?? undefined, section: 'analytics', scale: 'absolute' });
    push({ value: data.ga4.newUsers, label: 'Νέοι χρήστες', source: 'Google Analytics 4', section: 'analytics', scale: 'absolute' });
    push({ value: data.ga4.conversions, label: 'Μετατροπές', source: 'Google Analytics 4', delta: change?.conversions ?? undefined, section: 'analytics', scale: 'absolute' });
    push({ value: data.ga4.bounceRate, label: 'Ποσοστό εγκατάλειψης', source: 'Google Analytics 4', section: 'analytics', scale: 'small' });
  }

  push({ value: data.alerts.count, label: 'Ενεργές ειδοποιήσεις', source: 'Automations', scale: 'absolute' });
  push({ value: data.alerts.critical, label: 'Κρίσιμες ειδοποιήσεις', source: 'Automations', scale: 'absolute' });

  if (data.campaigns.topPerformer) {
    push({ value: data.campaigns.topPerformer.roas, label: `Απόδοση «${data.campaigns.topPerformer.name}»`, source: 'Καμπάνιες', section: 'campaigns', scale: 'small' });
  }
  if (data.campaigns.worstPerformer) {
    push({ value: data.campaigns.worstPerformer.roas, label: `Απόδοση «${data.campaigns.worstPerformer.name}»`, source: 'Καμπάνιες', section: 'campaigns', scale: 'small' });
    push({ value: data.campaigns.worstPerformer.spend, label: `Δαπάνη «${data.campaigns.worstPerformer.name}»`, source: 'Καμπάνιες', section: 'campaigns', scale: 'absolute' });
  }

  return out;
}

/**
 * Greek numerals: `1.234,5` is one thousand two hundred thirty four and a half. English-style
 * `1,234.5` reaches the same value the other way round, and the model produces both.
 */
export function parseGreekNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');

  let normalised = cleaned;
  if (hasDot && hasComma) {
    // Whichever appears last is the decimal separator.
    normalised =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const tail = cleaned.slice(cleaned.lastIndexOf(',') + 1);
    normalised = tail.length === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (hasDot) {
    const tail = cleaned.slice(cleaned.lastIndexOf('.') + 1);
    // `1.234` is a thousand here, not one and a bit — unless the tail is not a group of three.
    normalised = tail.length === 3 && /^\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, '') : cleaned;
  }
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

function matches(parsed: number, metric: KnownMetric): boolean {
  // A whole-number quantity — 5 campaigns, 320 dead SKUs — is never written with a decimal. Without
  // this, "4,7×" lands inside the ±0.5 window around a count of 5 and drags an unrelated metric in.
  if (metric.scale === 'absolute' && Number.isInteger(metric.value) && !Number.isInteger(parsed)) {
    return false;
  }
  const tolerance =
    metric.scale === 'small'
      ? Math.max(0.06, Math.abs(metric.value) * 0.02)
      : Math.max(0.5, Math.abs(metric.value) * 0.006);
  return Math.abs(parsed - metric.value) <= tolerance;
}

type Span = { start: number; end: number; token: BriefingToken };

/** Numbers, with the currency or percent sign they wear, so the highlight reads as one thing. */
const NUMBER_RE = /(€\s?)?\d[\d.,]*(\s?(?:€|%|×|x))?/gi;

function metricSpans(text: string, metrics: KnownMetric[]): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const digits = raw.replace(/[^\d.,]/g, '');
    const parsed = parseGreekNumber(digits);
    if (parsed === null) continue;

    // A bare single digit is far more likely to be prose ("2 φορές", "3 προτεραιότητες") than a
    // metric that happens to equal it, and a confidently wrong popover is the one outcome worth
    // avoiding. A decimal, a percent or a ratio marker is enough evidence that it is a figure.
    if (parsed < 10 && !/[.,]/.test(digits) && !/[×x%]/i.test(raw)) continue;

    const hits = metrics.filter((metric) => matches(parsed, metric));
    // Two different quantities that happen to share a value cannot be told apart, and guessing
    // would put a wrong source in a popover. Silence is the correct answer.
    if (hits.length !== 1) continue;

    const metric = hits[0];
    spans.push({
      start: index,
      end: index + raw.length,
      token: {
        kind: 'metric',
        value: raw.trim(),
        label: metric.label,
        source: metric.source,
        delta: metric.delta,
        section: routable(metric.section),
        hashQuery: metric.hashQuery,
      },
    });
  }
  return spans;
}

function entitySpans(text: string, data: BriefingData, context: TokenizeContext): Span[] {
  const known: { name: string; label: string; section: string; hashQuery?: string }[] = [];
  const add = (name: string | undefined | null, label: string, section: string, hashQuery?: string) => {
    const trimmed = name?.trim();
    // Very short names produce accidental matches inside ordinary words.
    if (!trimmed || trimmed.length < 4) return;
    if (!routable(section)) return;
    known.push({ name: trimmed, label, section, hashQuery });
  };

  for (const segment of context.segments ?? []) add(segment.name, 'Segment πελατών', 'rfm');
  if (data.segments.topSegment) add(data.segments.topSegment.name, 'Segment πελατών', 'rfm');
  for (const campaign of context.campaigns ?? []) add(campaign.name, 'Καμπάνια', 'campaigns');
  add(data.campaigns.topPerformer?.name, 'Καμπάνια', 'campaigns');
  add(data.campaigns.worstPerformer?.name, 'Καμπάνια', 'campaigns');
  for (const name of data.inventory.lowStockTopNames) {
    add(name, 'Προϊόν', 'products', `q=${encodeURIComponent(name)}`);
  }
  for (const platform of context.platforms ?? []) add(platform, 'Κανάλι πώλησης', 'ecommerce');

  // Longest first: "At Risk Customers" should win over "At Risk".
  known.sort((a, b) => b.name.length - a.name.length);

  const spans: Span[] = [];
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  for (const entity of known) {
    const needle = entity.name.toLowerCase();
    if (seen.has(needle)) continue;
    seen.add(needle);
    let from = 0;
    for (;;) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      spans.push({
        start: index,
        end: index + entity.name.length,
        token: {
          kind: 'entity',
          value: text.slice(index, index + entity.name.length),
          label: entity.label,
          section: entity.section,
          hashQuery: entity.hashQuery,
        },
      });
      from = index + entity.name.length;
    }
  }
  return spans;
}

export function tokenizeBriefing(
  narrative: string,
  data: BriefingData,
  context: TokenizeContext = {}
): BriefingToken[] {
  if (!narrative) return [];

  const spans = [...entitySpans(narrative, data, context), ...metricSpans(narrative, data ? metricsFrom(data) : [])]
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const tokens: BriefingToken[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping match — the earlier, longer one already won
    if (span.start > cursor) tokens.push({ kind: 'text', value: narrative.slice(cursor, span.start) });
    tokens.push(span.token);
    cursor = span.end;
  }
  if (cursor < narrative.length) tokens.push({ kind: 'text', value: narrative.slice(cursor) });
  return tokens;
}

/**
 * Group tokens into sentences so the reveal can stagger by phrase rather than by word.
 *
 * Splitting on the sentence end inside text tokens keeps a metric and the words around it in the
 * same group — a number appearing a beat before its own sentence would read as a glitch.
 */
export function groupIntoSentences(tokens: BriefingToken[]): BriefingToken[][] {
  const groups: BriefingToken[][] = [];
  let current: BriefingToken[] = [];

  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };

  for (const token of tokens) {
    if (token.kind !== 'text') {
      current.push(token);
      continue;
    }
    // Keep the delimiter with the sentence it ends.
    const parts = token.value.split(/(?<=[.!;·])\s+/);
    parts.forEach((part, index) => {
      if (part) current.push({ kind: 'text', value: index === parts.length - 1 ? part : `${part} ` });
      if (index < parts.length - 1) flush();
    });
  }
  flush();
  return groups;
}
