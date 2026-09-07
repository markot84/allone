/**
 * Read-only probe: what would a customer-list export contain, per writer?
 *   node scripts/diagnose-segment-customers.mjs <brand-substring> [projectId]
 * Prints, for every `segment_customers` writer (source) of the brand, the distinct customers per
 * segment id — i.e. the row counts an export scoped to that writer produces — and the union the
 * unscoped read used to export. Uses Application Default Credentials.
 */
import admin from 'firebase-admin';

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-segment-customers.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) => String(d.get('name') || d.id).toLowerCase().includes(brandFilter.toLowerCase()));
if (matched.length === 0) {
  console.log('no brand matches', brandFilter);
  process.exit(0);
}

for (const b of matched) {
  console.log(`\n##### brand ${b.id}  name=${b.get('name')}`);
  const snap = await db.collection('segment_customers').where('brandId', '==', b.id).get();
  console.log(`segment_customers docs: ${snap.size}`);

  /** source -> segmentId -> Set(customerId) */
  const perWriter = new Map();
  /** segmentId -> Set(customerId) across every writer (what the unscoped export produced) */
  const union = new Map();
  const names = new Map();
  for (const doc of snap.docs) {
    const d = doc.data();
    const source = d.source ?? '(no source: manual import)';
    const segId = d.segmentId ?? '?';
    if (d.segmentName) names.set(segId, d.segmentName);
    const rows = Array.isArray(d.customers) ? d.customers : [];
    if (!perWriter.has(source)) perWriter.set(source, new Map());
    const bySeg = perWriter.get(source);
    if (!bySeg.has(segId)) bySeg.set(segId, new Set());
    if (!union.has(segId)) union.set(segId, new Set());
    for (const c of rows) {
      const id = String(c.customerId ?? '');
      if (!id) continue;
      bySeg.get(segId).add(id);
      union.get(segId).add(id);
    }
  }

  for (const [source, bySeg] of perWriter) {
    let total = 0;
    console.log(`\n-- writer ${source}`);
    for (const [segId, ids] of [...bySeg].sort((a, b) => b[1].size - a[1].size)) {
      total += ids.size;
      console.log(`   ${(names.get(segId) ?? segId).padEnd(28)} ${String(ids.size).padStart(7)}   (${segId})`);
    }
    console.log(`   ${'TOTAL'.padEnd(28)} ${String(total).padStart(7)}`);
  }

  let unionTotal = 0;
  console.log('\n-- union across writers (the unscoped read)');
  for (const [segId, ids] of [...union].sort((a, b) => b[1].size - a[1].size)) {
    unionTotal += ids.size;
    console.log(`   ${(names.get(segId) ?? segId).padEnd(28)} ${String(ids.size).padStart(7)}`);
  }
  console.log(`   ${'TOTAL'.padEnd(28)} ${String(unionTotal).padStart(7)}`);
}
