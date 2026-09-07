/**
 * Read-only probe: what does Channel Activation have to load on mount for a brand?
 *   node scripts/diagnose-channel-activation-load.mjs <brand-substring> [projectId]
 *
 * The page reads one Product Intelligence aggregate doc and, only when that doc is missing or
 * carries no `pagesByBucket`, falls back to downloading the brand's whole `products` collection on
 * the main thread — the "Page Unresponsive" path. This prints which branch a brand takes and how
 * big the fallback would be. Uses Application Default Credentials.
 */
import admin from 'firebase-admin';

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-channel-activation-load.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

async function count(coll, brandId) {
  try {
    const snap = await db.collection(coll).where('brandId', '==', brandId).count().get();
    return snap.data().count;
  } catch (e) {
    return `ERR ${e.message}`;
  }
}

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

  const pi = await db.doc(`product_intelligence/${b.id}`).get();
  if (!pi.exists) {
    console.log('product_intelligence: MISSING  -> channelInsight.ready=false -> LOCAL CATALOG FALLBACK');
  } else {
    const d = pi.data() || {};
    const pages = d.pagesByBucket || null;
    console.log('product_intelligence: exists', JSON.stringify({
      status: d.status ?? null,
      totalCount: d.totalCount ?? null,
      pagesByBucket: pages,
      updatedAt: d.updatedAt ?? d.completedAt ?? null,
    }));
    console.log(pages ? 'ready=true  -> aggregate path (cheap)' : 'ready=FALSE -> LOCAL CATALOG FALLBACK');
  }

  console.log('products docs (fallback download):', await count('products', b.id));
  console.log('magento_products docs:', await count('magento_products', b.id));
  console.log('segment_customers docs:', await count('segment_customers', b.id));
  console.log('segments docs:', await count('segments', b.id));
  console.log('campaigns docs:', await count('campaigns', b.id));

  const da = await db.doc(`data_analysis_rfm/${b.id}`).get();
  if (da.exists) {
    const d = da.data() || {};
    const scopes = d.scopes || {};
    console.log('data_analysis_rfm:', JSON.stringify({
      status: d.status ?? null,
      syncVersion: d.syncVersion ?? null,
      scopes: Object.fromEntries(
        Object.entries(scopes).map(([k, v]) => [k, { canCompute: v?.canCompute, segments: v?.segments?.length, totalCustomers: v?.totalCustomers }])
      ),
    }));
  } else {
    console.log('data_analysis_rfm: MISSING');
  }
}

process.exit(0);
