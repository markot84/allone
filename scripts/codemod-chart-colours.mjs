#!/usr/bin/env node
/**
 * Point the charts at the tokens.
 *
 * `var()` resolves in SVG presentation attributes — verified in Chromium for `stroke`, `fill` and
 * `stop-color` — so Recharts props can reference tokens directly and no hook is needed to theme a
 * chart's furniture. (The note in KPICard claiming otherwise predates this and is wrong for current
 * browsers; it only ever mattered for `url(#id)` fills, which are still ids, not colours.)
 *
 * Scope is deliberately narrow: gridline strokes and axis tick fills, which the audit found in 20
 * and 24 places using nine different literals between them. Tooltips are left alone — they carry
 * layout as well as colour and get the shared theme object as each screen is touched.
 *
 * Run: node scripts/codemod-chart-colours.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const dry = process.argv.includes('--dry');

/** Every grey these charts used for a gridline. All of them meant "the faintest possible rule". */
const GRID_GREYS = ['#E5E5E5', '#eef0f3', '#F0F0F0', '#F3F4F6', '#E5E7EB'];

/** Every grey used for an axis label. All of them meant "secondary text". */
const TICK_GREYS = ['#9CA3AF', '#57606a', '#4A4A4A', '#374151', '#6B7280', '#666666', '#888888'];

const files = execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => !/\.test\./.test(f));

let grids = 0;
let ticks = 0;
let dashes = 0;
const touched = [];

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  // Rewrite only inside a <CartesianGrid …> tag, so the same hex used elsewhere is untouched.
  after = after.replace(/<CartesianGrid\b[^>]*?\/?>/g, (tag) => {
    let next = tag;
    for (const grey of GRID_GREYS) {
      const re = new RegExp(`stroke="${grey}"`, 'gi');
      if (re.test(next)) {
        next = next.replace(re, 'stroke="var(--border)"');
        grids++;
      }
    }
    // One dash rhythm. "3 3" reads as a dotted box; "2 4" recedes behind the series.
    if (/strokeDasharray="3 3"/.test(next)) {
      next = next.replace(/strokeDasharray="3 3"/g, 'strokeDasharray="2 4"');
      dashes++;
    }
    // A grid with no stroke at all falls back to Recharts' #ccc, which is darker than the data.
    // A spread is skipped: it may already carry `stroke`, and adding one produces TS2783.
    if (!/stroke=/.test(next) && !/\{\.\.\./.test(next)) {
      next = next.replace(/<CartesianGrid\b/, '<CartesianGrid stroke="var(--border)"');
      grids++;
    }
    return next;
  });

  // Axis tick labels: `tick={{ fill: '#9CA3AF', fontSize: 11 }}` in either key order.
  after = after.replace(/tick=\{\{[^}]*\}\}/g, (expr) => {
    let next = expr;
    for (const grey of TICK_GREYS) {
      const re = new RegExp(`'${grey}'`, 'gi');
      if (re.test(next)) {
        next = next.replace(re, "'var(--text-muted)'");
        ticks++;
      }
    }
    return next;
  });

  if (after !== before) {
    touched.push(file);
    if (!dry) writeFileSync(file, after);
  }
}

console.log(
  `${dry ? '[dry] ' : ''}grid strokes: ${grids}, dash rhythms: ${dashes}, axis ticks: ${ticks}, files: ${touched.length}`
);
for (const f of touched) console.log('  ' + f);
