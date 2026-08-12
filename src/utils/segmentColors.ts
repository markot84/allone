import type { RFMSegment } from '../types';
import { readTokenColor } from './cssToken';

/**
 * The colour of an RFM segment, derived from its ROLE.
 *
 * Two things were wrong before.
 *
 * First, the map was keyed on ids like `champions`, but the ids the app actually receives are
 * brand-prefixed — `sportflow-demo_seg_champions`. Nothing matched, so every lookup fell through
 * to a grey default. The matcher now takes the role off the end of the id instead of demanding the
 * whole string.
 *
 * Second, and the reason the fall-through was never noticed: the chart did not call this function
 * at all. It read `segment.color`, a field written into Firestore by the seeding and import paths
 * (`#22C55E`, `#3B82F6`, `#8B5CF6`, `#06B6D4`, `#F59E0B`, `#EF4444` — Tailwind defaults). A
 * database field cannot follow a palette, which is how a data tool with four fixed brand colours
 * ended up with a ten-colour donut on its front page. Stored colour is now ignored.
 *
 * The ramp itself is ordinal rather than categorical — see the --seg-* block in tokens.css.
 */

/**
 * Canonical roles, in health order. Eight, not ten — see the --seg-* block in tokens.css for why
 * the palette cannot carry one distinguishable fill per segment, and which two roles therefore
 * cover more than one segment each.
 */
export type SegmentRole =
  | 'champions'
  | 'loyal'
  | 'potential'
  | 'new'
  | 'recent'
  | 'urgent'
  | 'at_risk'
  | 'lost';

const ROLE_TOKENS: Record<SegmentRole, { token: string; fallback: string }> = {
  champions: { token: '--seg-champions', fallback: '#0D804A' },
  loyal: { token: '--seg-loyal', fallback: '#005ECD' },
  potential: { token: '--seg-potential', fallback: '#7A5AF8' },
  new: { token: '--seg-new', fallback: '#003087' },
  recent: { token: '--seg-recent', fallback: '#6B87B9' },
  urgent: { token: '--seg-urgent', fallback: '#B24508' },
  at_risk: { token: '--seg-at-risk', fallback: '#B28904' },
  lost: { token: '--seg-lost', fallback: '#667085' }
};

/**
 * Every spelling seen across the seed script, the importer and the RFM service, mapped to a role.
 * Longer keys are matched first so `loyal_customers` cannot be swallowed by `loyal`.
 */
const ROLE_ALIASES: [string, SegmentRole][] = [
  ['customers_needing_attention', 'at_risk'],
  ['cant_lose_them', 'urgent'],
  ['recent_customers', 'recent'],
  ['loyal_customers', 'loyal'],
  ['potential_loyalist', 'potential'],
  ['new_customers', 'new'],
  ['about_to_sleep', 'at_risk'],
  ['need_attention', 'at_risk'],
  ['hibernating', 'lost'],
  ['promising', 'potential'],
  ['champions', 'champions'],
  ['champion', 'champions'],
  ['cant_lose', 'urgent'],
  ['at_risk', 'at_risk'],
  ['atrisk', 'at_risk'],
  ['potential', 'potential'],
  ['recent', 'recent'],
  ['dormant', 'lost'],
  ['inactive', 'lost'],
  ['loyal', 'loyal'],
  ['lost', 'lost'],
  ['new', 'new']
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/['’]/g, '').replace(/[\s-]+/g, '_');
}

/** Resolves a segment id or name to a role, tolerating brand prefixes and `seg_` infixes. */
export function getSegmentRole(segment: Pick<RFMSegment, 'id' | 'name'> | null | undefined): SegmentRole | null {
  if (!segment) return null;
  const haystack = `${normalise(segment.id ?? '')}|${normalise(segment.name ?? '')}`;
  for (const [alias, role] of ROLE_ALIASES) {
    if (haystack.includes(alias)) return role;
  }
  return null;
}

export function getSegmentColor(segment: RFMSegment | null | undefined): string {
  const role = getSegmentRole(segment);
  if (!role) return readTokenColor('--text-muted', '#667085');
  const { token, fallback } = ROLE_TOKENS[role];
  return readTokenColor(token, fallback);
}

/** For legends and any list that should read in health order rather than alphabetically. */
export const SEGMENT_ROLE_ORDER: SegmentRole[] = [
  'champions',
  'loyal',
  'potential',
  'new',
  'recent',
  'urgent',
  'at_risk',
  'lost'
];

export function compareSegmentsByHealth(
  a: Pick<RFMSegment, 'id' | 'name'>,
  b: Pick<RFMSegment, 'id' | 'name'>
): number {
  const ra = getSegmentRole(a);
  const rb = getSegmentRole(b);
  const ia = ra ? SEGMENT_ROLE_ORDER.indexOf(ra) : SEGMENT_ROLE_ORDER.length;
  const ib = rb ? SEGMENT_ROLE_ORDER.indexOf(rb) : SEGMENT_ROLE_ORDER.length;
  return ia - ib;
}

/**
 * Kept because the importer writes a colour per segment into Firestore and older documents already
 * carry one. It now resolves through the tokens rather than holding literals of its own.
 */
export const SEGMENT_COLORS: Record<string, string> = new Proxy(
  {},
  {
    get: (_t, key: string) => {
      const role = getSegmentRole({ id: key, name: key } as RFMSegment);
      if (!role) return undefined;
      const { token, fallback } = ROLE_TOKENS[role];
      return readTokenColor(token, fallback);
    }
  }
) as Record<string, string>;
