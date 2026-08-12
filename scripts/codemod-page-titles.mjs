#!/usr/bin/env node
/**
 * PageHeader accepts `title` as a ReactNode, so every page typed its own heading. The audit found
 * 38 of them: mostly the same string, but already drifted across h1/h2/h3 and three different
 * hardcoded greys for the subtitle underneath.
 *
 * This converts the ones that are unambiguous — a heading element whose only child is plain text —
 * into `title="…"`, which PageHeader now renders as a single `.page-title`. Titles containing JSX
 * (an icon, a badge, an interpolated brand name) are left alone: they are a judgement call, not a
 * mechanical one, and getting them wrong is worse than leaving them.
 *
 * Run: node scripts/codemod-page-titles.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const dry = process.argv.includes('--dry');

// The heading class strings observed in the codebase. Anything else is not touched.
const KNOWN_CLASSES = [
  'text-xl font-bold text-\\[var\\(--text-heading\\)\\] sm:text-2xl',
  'text-xl font-bold text-\\[var\\(--text-heading\\)\\] sm:text-2xl leading-tight',
  'text-xl font-bold tracking-tight text-\\[var\\(--text-heading\\)\\] sm:text-2xl',
  'text-xl font-bold text-\\[var\\(--text-heading\\)\\]',
  'text-lg font-bold text-\\[var\\(--text-heading\\)\\] sm:text-xl',
  'text-lg font-bold text-\\[var\\(--text-heading\\)\\]'
];

// Plain text only: no `<` (nested element) and no `{` (interpolation).
const titlePattern = new RegExp(
  `title=\\{<(h[123]) className="(?:${KNOWN_CLASSES.join('|')})">([^<{]+)</\\1>\\}`,
  'g'
);

// The subtitle's three greys, all standing for --text-secondary.
const SUBTITLE_GREYS = [/text-\[#4A4A4A\]/g, /text-\[#4A5568\]/g];

const files = execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8' }).trim().split('\n');

let titlesChanged = 0;
let greysChanged = 0;
const touched = [];

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before.replace(titlePattern, (_m, _tag, text) => {
    titlesChanged++;
    // Escape only what would break the JSX string attribute.
    return `title="${text.trim().replace(/"/g, '&quot;')}"`;
  });

  for (const grey of SUBTITLE_GREYS) {
    after = after.replace(grey, () => {
      greysChanged++;
      return 'text-[var(--text-secondary)]';
    });
  }

  if (after !== before) {
    touched.push(file);
    if (!dry) writeFileSync(file, after);
  }
}

console.log(`${dry ? '[dry] ' : ''}titles: ${titlesChanged}, subtitle greys: ${greysChanged}, files: ${touched.length}`);
for (const f of touched) console.log('  ' + f);
