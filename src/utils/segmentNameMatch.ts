/** Matching AI-written segment names to real RFM segments.
 *
 * The model names segments in its own words — «Customers Needing Attention» for a segment the
 * app calls «Need Attention», «Can't Lose Them» with either apostrophe. Exact string equality
 * silently drops those, which is how a five-segment strategy exported four.
 *
 * Two passes, deliberately: every exact match is claimed first, then the leftovers are matched
 * loosely against what remains. Fuzzy-matching greedily would let «Potential Loyalists» claim
 * «Loyal Customers» before that segment had a chance to match itself.
 */

/** Words that carry no identity on their own — every second segment is "customers something". */
const GENERIC_TOKENS = new Set([
  'customer',
  'customers',
  'segment',
  'segments',
  'group',
  'πελατης',
  'πελατες',
  'πελατων',
  'τμημα',
]);

/** Lowercased, accent-stripped, punctuation-free — apostrophes included, straight or curly. */
export function normalizeSegmentName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function coreTokens(name: string): string[] {
  const tokens = normalizeSegmentName(name).split(' ').filter(Boolean);
  const core = tokens.filter((t) => !GENERIC_TOKENS.has(t));
  // A name made entirely of generic words keeps them; dropping everything would match everything.
  return core.length > 0 ? core : tokens;
}

/** Same word in another form: a shared prefix, but only a short tail apart — "need"/"needing",
 * "champion"/"champions". The tail limit is what stops "loyal" claiming "loyalists", which is a
 * different segment entirely and would export the wrong customers. */
const MAX_INFLECTION_TAIL = 3;

function tokensAlign(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 4) return false;
  if (longer.length - shorter.length > MAX_INFLECTION_TAIL) return false;
  return longer.startsWith(shorter);
}

/** A rename, not a coincidence: every core token of each name finds a partner in the other. */
function namesDescribeSameSegment(a: string, b: string): boolean {
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  return (
    ta.every((t) => tb.some((o) => tokensAlign(t, o))) &&
    tb.every((t) => ta.some((o) => tokensAlign(t, o)))
  );
}

/** Resolves AI-written names to real segments, preserving the order the names were given in.
 * Each segment is returned at most once; a name that matches nothing is dropped. */
export function matchSegmentsByName<T extends { name: string }>(names: string[], pool: T[]): T[] {
  const remaining = [...pool];
  const resolved = new Map<number, T>();

  const claim = (index: number, segment: T) => {
    resolved.set(index, segment);
    remaining.splice(remaining.indexOf(segment), 1);
  };

  names.forEach((name, index) => {
    const normalized = normalizeSegmentName(name);
    const exact = remaining.find((s) => normalizeSegmentName(s.name) === normalized);
    if (exact) claim(index, exact);
  });

  names.forEach((name, index) => {
    if (resolved.has(index)) return;
    const near = remaining.find((s) => namesDescribeSameSegment(name, s.name));
    if (near) claim(index, near);
  });

  return names.map((_, index) => resolved.get(index)).filter((s): s is T => s != null);
}

/** Single-name lookup on top of the same rules. */
export function matchSegmentByName<T extends { name: string }>(name: string, pool: T[]): T | null {
  return matchSegmentsByName([name], pool)[0] ?? null;
}

/** Identity of a segment SET, independent of order and spelling — so a recommendation can
 * record which segments it was built against and be told when that set has changed underneath
 * it. The RFM writer that produced «Customers Needing Attention» was later replaced by one that
 * produces «At Risk»; the strategy kept naming the vanished segment for months, with nothing to
 * say so. */
export function segmentSetSignature(segments: ReadonlyArray<{ name: string }>): string {
  return segments
    .map((s) => normalizeSegmentName(s.name))
    .filter(Boolean)
    .sort()
    .join('|');
}
