/**
 * Read-only probe: what does ContactPigeon's campaign reporting export actually contain?
 *   CONNECTOR_TOKEN_KEY=… node scripts/probe-contactpigeon-campaigns.mjs <brandId> <date_after> <date_before> [projectId]
 *
 * ContactPigeon answered our integration request with a reporting endpoint on a different host
 * from the one the connector uses. This calls it ONCE to capture the column names, so the parser
 * is written against the real file instead of a guess.
 *
 * Prints the header row and two sample rows with values truncated. Never prints the API key or the
 * request URL — the key travels as a query parameter, so the URL itself is a secret.
 * Persists nothing.
 */
import admin from 'firebase-admin';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const [brandId, dateAfter, dateBefore, projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandId || !dateAfter || !dateBefore) {
  console.error('usage: node scripts/probe-contactpigeon-campaigns.mjs <brandId> <YYYY-MM-DD> <YYYY-MM-DD> [projectId]');
  process.exit(1);
}
if (!process.env.CONNECTOR_TOKEN_KEY) {
  console.error('CONNECTOR_TOKEN_KEY is not set — cannot decrypt the stored api_key.');
  process.exit(1);
}

const { decryptToken } = require('../functions/lib/tokenCrypto.js');

admin.initializeApp({ projectId });
const db = admin.firestore();

const conn = (await db.doc(`connectors/${brandId}`).get()).data()?.contact_pigeon;
if (!conn?.apiKey) {
  console.error(`No ContactPigeon api_key stored for ${brandId}`);
  process.exit(1);
}
const apiKey = decryptToken(conn.apiKey);
if (!apiKey) {
  console.error('Decryption produced an empty key — is CONNECTOR_TOKEN_KEY the right one?');
  process.exit(1);
}

const url =
  'https://gate.contactpigeon.com/api/sv/reporting/campaigns/' +
  `?api_key=${encodeURIComponent(apiKey)}` +
  `&date_after=${encodeURIComponent(dateAfter)}` +
  `&date_before=${encodeURIComponent(dateBefore)}` +
  '&f_mode=senddate&frep=yes&format=csv';

console.log(`Calling ContactPigeon reporting · brand=${brandId} · ${dateAfter} → ${dateBefore}`);

const res = await fetch(url, { method: 'GET' });
const body = await res.text();

console.log(`HTTP ${res.status} · content-type: ${res.headers.get('content-type') ?? '—'} · ${body.length} bytes\n`);

/** The key travels in the query string, and ContactPigeon names the generated export file after it —
 * a 404 body echoes it back. Nothing derived from the response is printed before passing through here. */
const redact = (text) => text.split(apiKey).join('«API_KEY»');

if (!res.ok) {
  console.log('Body (first 400 chars, redacted):');
  console.log(redact(body.slice(0, 400)));
  process.exit(0);
}

const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
if (lines.length === 0) {
  console.log('Empty body — no campaigns in this window?');
  process.exit(0);
}

/** Split a CSV line on commas outside quotes. */
function splitCsv(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const headers = splitCsv(lines[0]);
console.log(`ΣΤΗΛΕΣ (${headers.length}) — ${lines.length - 1} γραμμές δεδομένων\n`);
headers.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2)}. ${h.trim()}`));

const clip = (v) => {
  const s = redact(String(v ?? '').trim());
  return s.length > 34 ? `${s.slice(0, 34)}…` : s;
};

for (const line of lines.slice(1, 3)) {
  console.log('\n— δείγμα γραμμής —');
  const cells = splitCsv(line);
  headers.forEach((h, i) => {
    const v = clip(cells[i]);
    if (v !== '') console.log(`  ${h.trim().padEnd(30)} ${v}`);
  });
}

process.exit(0);
