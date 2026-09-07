/**
 * Read-only probe: what segment sources does a brand actually have on staging right now?
 *   node scripts/diagnose-rfm-sources.mjs <brand-substring> [projectId]
 * Prints the data_analysis_rfm aggregate (status, scopes, segment counts) and the imported
 * segments (brands/{id}/segments and any top-level segments keyed by brandId).
 * Uses Application Default Credentials (gcloud auth application-default login).
 */
import admin from 'firebase-admin';

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-rfm-sources.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

const fmt = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v);
const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) => {
  const n = String(d.get('name') || d.id).toLowerCase();
  return n.includes(brandFilter.toLowerCase());
});
if (matched.length === 0) {
  console.log('no brand matches', brandFilter);
  process.exit(0);
}

for (const b of matched) {
  console.log(`\n##### brand ${b.id}  name=${b.get('name')}`);

  const agg = await db.collection('data_analysis_rfm').doc(b.id).get();
  if (!agg.exists) {
    console.log('data_analysis_rfm: (no doc)');
  } else {
    const d = agg.data();
    console.log('data_analysis_rfm keys:', Object.keys(d).join(', '));
    for (const k of ['status', 'version', 'updatedAt', 'computedAt', 'startedAt', 'finishedAt', 'error', 'source', 'dataSource']) {
      if (d[k] !== undefined) console.log(`  ${k}:`, fmt(d[k]));
    }
    const scopes = d.scopes || {};
    for (const [scopeName, scope] of Object.entries(scopes)) {
      const segs = Array.isArray(scope?.segments) ? scope.segments : [];
      console.log(`  scope "${scopeName}": canCompute=${scope?.canCompute} totalCustomers=${scope?.totalCustomers} segments=${segs.length}`);
      for (const s of segs) {
        console.log(`     - ${s.name}: customers=${s.customerCount ?? s.count ?? s.customers?.length} revenueShare=${s.revenueShare ?? s.revenuePercent ?? ''}`);
      }
    }
    if (Array.isArray(d.segments)) {
      console.log(`  top-level segments=${d.segments.length}`);
      for (const s of d.segments) console.log(`     - ${s.name}: ${s.customerCount ?? s.count}`);
    }
  }

  const subs = await b.ref.listCollections();
  console.log('brand subcollections:', subs.map((c) => c.id).join(', ') || '(none)');
  for (const c of subs) {
    if (!/segment/i.test(c.id)) continue;
    const snap = await c.get();
    console.log(`  ${c.id}: ${snap.size} docs`);
    for (const doc of snap.docs) {
      const s = doc.data();
      console.log(`     - ${s.name ?? doc.id}: customers=${s.customerCount ?? s.count ?? (Array.isArray(s.customers) ? s.customers.length : '?')} source=${s.source ?? ''} updatedAt=${fmt(s.updatedAt)}`);
    }
  }

  const top = await db.collection('segments').where('brandId', '==', b.id).get().catch(() => null);
  if (top && top.size) {
    console.log(`top-level segments (brandId==${b.id}): ${top.size} docs`);
    for (const doc of top.docs) {
      const s = doc.data();
      console.log(`     - ${s.name ?? doc.id}: customers=${s.customerCount ?? s.count ?? (Array.isArray(s.customers) ? s.customers.length : '?')} source=${s.source ?? ''} updatedAt=${fmt(s.updatedAt)}`);
    }
  }
}
