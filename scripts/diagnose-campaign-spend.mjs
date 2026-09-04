/**
 * Read-only: what the `campaigns` collection actually holds for a brand in a date window.
 *
 * Answers one question — does the Dashboard see €0 ad spend because the docs carry no daily
 * metrics for that window, or because something downstream drops them?
 *
 * Usage (STAGING is the default; pass a project id only if you really mean elsewhere):
 *   node scripts/diagnose-campaign-spend.mjs <brand-substring> <from:YYYY-MM-DD> <to:YYYY-MM-DD> [projectId]
 *
 * Example:
 *   node scripts/diagnose-campaign-spend.mjs tennis 2026-08-05 2026-09-03
 *
 * Needs the same credentials as scripts/diagnose-pi.mjs (application default credentials).
 * Writes nothing.
 */
import admin from 'firebase-admin';

const [brandFilter = '', from = '', to = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);

if (!brandFilter || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error('usage: node scripts/diagnose-campaign-spend.mjs <brand-substring> <from> <to> [projectId]');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();
console.log(`project=${projectId}  window=${from}..${to}\n`);

const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) => {
  const name = String(d.data().name || '');
  return name.toLowerCase().includes(brandFilter.toLowerCase()) || d.id.toLowerCase().includes(brandFilter.toLowerCase());
});

if (matched.length === 0) {
  console.log(`no brand matching "${brandFilter}"`);
  process.exit(0);
}

for (const brand of matched) {
  console.log(`=== ${brand.data().name || brand.id}  (${brand.id}) ===`);
  const snap = await db.collection('campaigns').where('brandId', '==', brand.id).get();
  console.log(`campaign docs: ${snap.size}`);

  let missingCreatedAt = 0;
  let withDaily = 0;
  let spendInWindow = 0;
  let daysInWindow = 0;
  let overallMin = null;
  let overallMax = null;
  const perChannel = {};

  for (const doc of snap.docs) {
    const c = doc.data();
    if (c.createdAt == null) missingCreatedAt += 1;
    const channel = c.channel || '(none)';
    perChannel[channel] = perChannel[channel] || { docs: 0, spend: 0, days: 0 };
    perChannel[channel].docs += 1;

    const dm = c.dailyMetrics;
    if (!dm || Object.keys(dm).length === 0) continue;
    withDaily += 1;
    const keys = Object.keys(dm).sort();
    if (overallMin === null || keys[0] < overallMin) overallMin = keys[0];
    if (overallMax === null || keys[keys.length - 1] > overallMax) overallMax = keys[keys.length - 1];

    for (const [day, m] of Object.entries(dm)) {
      if (day < from || day > to) continue;
      const spent = Number(m?.amount_spent) || 0;
      spendInWindow += spent;
      daysInWindow += 1;
      perChannel[channel].spend += spent;
      perChannel[channel].days += 1;
    }
  }

  console.log(`docs with dailyMetrics: ${withDaily}`);
  console.log(`docs missing createdAt: ${missingCreatedAt}  (orderBy('createdAt') silently drops these)`);
  console.log(`dailyMetrics key range across all docs: ${overallMin ?? '—'} .. ${overallMax ?? '—'}`);
  console.log(`daily rows inside the window: ${daysInWindow}`);
  console.log(`SUM amount_spent inside the window: ${spendInWindow.toFixed(2)}`);
  console.log('by channel:');
  for (const [ch, v] of Object.entries(perChannel)) {
    console.log(`  ${ch}: docs=${v.docs} daysInWindow=${v.days} spend=${v.spend.toFixed(2)}`);
  }
  console.log('');
}

process.exit(0);
