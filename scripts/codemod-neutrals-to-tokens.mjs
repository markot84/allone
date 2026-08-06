#!/usr/bin/env node
/**
 * One-shot codemod: hardcoded neutral hexes → semantic tokens.
 *
 * The v2 palette landed as tokens, but ~4.200 literal colours predate it and were never migrated.
 * That was tolerable while there was one theme. It is not tolerable with two: a literal `#1A1A1A`
 * stays black on a navy canvas, so the cockpit theme is only possible once these say what they MEAN
 * rather than what they looked like.
 *
 * 258 distinct hexes appear in `src/`, but the 23 below account for roughly three quarters of all
 * occurrences and every one of them is a neutral used in exactly one role — greys are text, the
 * #E5-#D0 band is borders, the #F3-#FA band is filled surfaces. That consistency is what makes this
 * mechanical instead of a judgement call per call site.
 *
 * The replacement is a plain textual substitution because every syntax the codebase uses for colour
 * accepts `var()` in the same position:
 *
 *     className="text-[#9CA3AF]"        → className="text-[var(--text-muted)]"
 *     style={{ border: '1px solid #E5E7EB' }} → '1px solid var(--border)'
 *     <CartesianGrid stroke="#E5E5E5" /> → stroke="var(--border)"
 *
 * Run: node scripts/codemod-neutrals-to-tokens.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const DRY = process.argv.includes('--dry');

/**
 * hex → token. Grouped by the role the hex actually plays at its call sites, which was established
 * by reading the surrounding 26 characters of all 4.219 occurrences, not assumed from the value.
 */
const MAP = {
  // Text. Four near-identical near-blacks and four near-identical greys, collapsed onto the two
  // steps the token scale already defines. `#9CA3AF` is the notable one: at 2.51:1 on white it was
  // failing WCAG at 476 call sites, and folding it into `--text-muted` (4.97:1) fixes all of them.
  '#1a1a1a': '--text-primary',
  '#111827': '--text-primary',
  '#1f2328': '--text-primary',
  '#24292f': '--text-primary',
  '#4a4a4a': '--text-secondary',
  '#374151': '--text-secondary',
  '#4b5563': '--text-secondary',
  '#6b7280': '--text-muted',
  '#9ca3af': '--text-muted',
  '#78716c': '--text-muted',
  '#57606a': '--text-muted',

  // Borders and dividers.
  '#e5e5e5': '--border',
  '#e5e7eb': '--border',
  '#d0d7de': '--border',
  '#eef0f3': '--border',
  '#f0f0f0': '--border',
  '#d1d5db': '--border-strong',

  // Filled surfaces: the card-ish tier and the hover/inset tier.
  '#fafafa': '--surface-1',
  '#f9fafb': '--surface-1',
  '#f5f5f5': '--surface-2',
  '#f3f4f6': '--surface-2',
};

/**
 * Left alone on purpose.
 *
 *   reportExport.ts — jsPDF draws to a PDF, which has no CSS and no cascade. `var(--border)` there
 *                     is not a colour, it is a string the renderer silently ignores.
 *   color.ts        — parses hex into channels; a `var()` has no channels.
 *   accentTheme.ts  — the hexes are swatch DATA shown in a picker, not applied colour.
 *   *.test.*        — left so that any assertion on an old value FAILS loudly and points at a call
 *                     site this codemod got wrong, rather than being quietly rewritten to agree.
 */
const SKIP = [
  'services/reportExport.ts',
  'utils/color.ts',
  'theme/accentTheme.ts',
];
const isSkipped = (rel) => SKIP.some((s) => rel === s) || /\.test\.[tj]sx?$/.test(rel);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|css)$/.test(entry)) yield full;
  }
}

// `\b` after the hex stops `#E5E5E5` from matching inside the 8-digit `#E5E5E5FF`; the leading
// `(?<!\w)` does the same on the other side for things like `id="a#fafafa"`.
const PATTERNS = Object.entries(MAP).map(([hex, token]) => [
  new RegExp(`(?<![\\w#])${hex}\\b`, 'gi'),
  `var(${token})`,
]);

let filesChanged = 0;
let totalReplaced = 0;
const perToken = {};

for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (isSkipped(rel)) continue;
  // tokens.css is where the values are DEFINED; rewriting it would make every token self-referential.
  if (rel === 'styles/tokens.css') continue;

  const before = readFileSync(file, 'utf8');
  let after = before;
  let fileCount = 0;

  for (const [pattern, replacement] of PATTERNS) {
    after = after.replace(pattern, () => {
      fileCount += 1;
      perToken[replacement] = (perToken[replacement] ?? 0) + 1;
      return replacement;
    });
  }

  if (fileCount > 0) {
    filesChanged += 1;
    totalReplaced += fileCount;
    if (!DRY) writeFileSync(file, after);
  }
}

console.log(`${DRY ? '[dry run] ' : ''}${totalReplaced} replacements across ${filesChanged} files\n`);
for (const [token, count] of Object.entries(perToken).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${token}`);
}
