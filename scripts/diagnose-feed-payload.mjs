/**
 * Read-only probe: how many bytes does Channel Activation pull for the in-stock feed and its
 * Magento enrichment?
 *   node scripts/diagnose-feed-payload.mjs <brand-substring> [projectId]
 * Uses Application Default Credentials.
 */
import admin from 'firebase-admin';

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-feed-payload.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;

const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) =>
  String(d.get('name') || d.id).toLowerCase().includes(brandFilter.toLowerCase())
);

for (const b of matched) {
  console.log(`\n##### brand ${b.id}  name=${b.get('name')}`);

  const pi = (await db.doc(`product_intelligence/${b.id}`).get()).data() || {};
  const pages = pi.pagesByBucket || {};
  const inStock = ['healthy', 'low', 'dead', 'excess'];
  let feedProducts = 0;
  let feedBytes = 0;
  for (const bucket of inStock) {
    const count = pages[bucket] ?? 0;
    if (!count) continue;
    const first = await db.doc(`product_intelligence_pages/${b.id}_${bucket}_1`).get();
    const rows = first.exists ? (first.get('products') || []).length : 0;
    const bytes = first.exists ? size(first.data()) : 0;
    feedProducts += rows * count;
    feedBytes += bytes * count;
    console.log(`bucket ${bucket.padEnd(8)} pages=${String(count).padStart(4)} rows/page=${rows} page=${(bytes / 1024).toFixed(0)}KB`);
  }
  console.log(`FEED: ~${feedProducts} products, ~${mb(feedBytes)} over ${inStock.reduce((s, k) => s + (pages[k] ?? 0), 0)} page reads`);

  const mag = await db.collection('magento_products').where('brandId', '==', b.id).limit(5).get();
  const magCount = (await db.collection('magento_products').where('brandId', '==', b.id).count().get()).data().count;
  const magAvg = mag.size ? Math.round(mag.docs.reduce((s, d) => s + size(d.data()), 0) / mag.size) : 0;
  console.log(`MAGENTO: ${magCount} docs, avg ${magAvg}B -> full read ~${mb(magCount * magAvg)}; feed-scoped (~${feedProducts} skus) ~${mb(feedProducts * magAvg)}`);
}

process.exit(0);
