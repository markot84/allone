/**
 * Removes **bold** wrappers from knowledgeBase.ts content (iterative, non-greedy pairs).
 * Run: node scripts/strip-knowledge-markdown.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '..', 'src', 'data', 'knowledgeBase.ts');

let s = fs.readFileSync(target, 'utf8');
const before = s.length;
let passes = 0;
let prev;
do {
  prev = s;
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  if (s !== prev) passes += 1;
} while (s !== prev);

fs.writeFileSync(target, s);
console.log(`strip-knowledge-markdown: ${passes} pass(es), ${before} → ${s.length} chars`);
