/**
 * Read-only probe: how much does `useProcurement()` pull for a brand?
 *   node scripts/diagnose-procurement-size.mjs <brand-substring> [projectId]
 *
 * `useProductSource` calls `useProcurement()` unconditionally — even on pages that disable the
 * product query — so every one of these collections is downloaded on mount. Prints the doc count
 * per sheet and a sampled average doc size, to size the payload. Uses Application Default Credentials.
 */
import admin from 'firebase-admin';

const COLLECTIONS = [
  'procurement_inventory',
  'procurement_costing',
  'procurement_item_evaluation',
  'procurement_customer_evaluation',
  'procurement_pricing_policy',
  'procurement_fiscal_year',
  'procurement_statistics',
];

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-procurement-size.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) =>
  String(d.get('name') || d.id).toLowerCase().includes(brandFilter.toLowerCase())
);
if (matched.length === 0) {
  console.log('no brand matches', brandFilter);
  process.exit(0);
}

for (const b of matched) {
  console.log(`\n##### brand ${b.id}  name=${b.get('name')}  project=${projectId}`);
  let totalDocs = 0;
  let totalBytes = 0;
  for (const coll of COLLECTIONS) {
    const q = db.collection(coll).where('brandId', '==', b.id);
    const n = (await q.count().get()).data().count;
    let avg = 0;
    if (n > 0) {
      const sample = await q.limit(5).get();
      const bytes = sample.docs.reduce((sum, d) => sum + Buffer.byteLength(JSON.stringify(d.data()), 'utf8'), 0);
      avg = Math.round(bytes / sample.size);
    }
    totalDocs += n;
    totalBytes += n * avg;
    console.log(`${coll.padEnd(36)} docs=${String(n).padStart(7)}  avg=${String(avg).padStart(5)}B  ~${(n * avg / 1048576).toFixed(1)}MB`);
  }
  console.log(`TOTAL: ${totalDocs} docs, ~${(totalBytes / 1048576).toFixed(1)} MB downloaded per mount`);
}

process.exit(0);
