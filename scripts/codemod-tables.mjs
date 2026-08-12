#!/usr/bin/env node
/**
 * Give the tables one look.
 *
 * Two mechanical changes:
 *
 *  1. Every `<table>` gets the `data-table` class, which carries the header treatment, row
 *     separation and hover from tokens.css. Existing Tailwind classes on a table keep winning
 *     wherever they disagree — this only fills in what was never decided.
 *
 *  2. The five greys used for row hover and the three used for header fills become tokens. They all
 *     meant the same thing; they just got typed differently in 34 places.
 *
 * Run: node scripts/codemod-tables.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const dry = process.argv.includes('--dry');

/** Every grey used for "this row is under the cursor". */
const HOVER_GREYS = ['#F5F5F5', '#F9FAFB', '#FAFAFA', '#F3F4F6', '#E5E5E5', '#FAFBFC'];

/** Every grey used to fill a table header. */
const HEADER_GREYS = ['#F9FAFB', '#FAFAFA', '#FAFBFC'];

const files = execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => !/\.test\./.test(f));

let tagged = 0;
let hovers = 0;
let headers = 0;
const touched = [];

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  // 1. Tag every <table>, whether or not it already has a className.
  after = after.replace(/<table\b([^>]*?)(\/?)>/g, (tag, attrs, selfClose) => {
    if (/\bdata-table\b/.test(attrs)) return tag;
    tagged++;
    if (/className="/.test(attrs)) {
      return `<table${attrs.replace(/className="/, 'className="data-table ')}${selfClose}>`;
    }
    return `<table className="data-table"${attrs}${selfClose}>`;
  });

  // 2. Row hover greys → the one hover token.
  for (const grey of HOVER_GREYS) {
    const re = new RegExp(`hover:bg-\\[${grey}\\]`, 'gi');
    const hits = after.match(re);
    if (hits) {
      hovers += hits.length;
      after = after.replace(re, 'hover:bg-[var(--surface-2)]');
    }
  }

  // 3. Header fills → the card surface, since the header now separates by a rule, not a fill.
  //    Scoped to <thead> so an unrelated element using the same grey is left alone.
  after = after.replace(/<thead\b[^>]*>/g, (tag) => {
    let next = tag;
    for (const grey of HEADER_GREYS) {
      const re = new RegExp(`bg-\\[${grey}\\]`, 'gi');
      if (re.test(next)) {
        next = next.replace(re, 'bg-[var(--card-bg)]');
        headers++;
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
  `${dry ? '[dry] ' : ''}tables tagged: ${tagged}, row hovers: ${hovers}, header fills: ${headers}, files: ${touched.length}`
);
for (const f of touched) console.log('  ' + f);
