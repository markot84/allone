import admin from 'firebase-admin';

const brandId = process.argv[2] || 'e-tennis';

admin.initializeApp({ projectId: 'performance-plus-4a5b2' });
const db = admin.firestore();

console.log(`=== products coverage for brand "${brandId}" ===\n`);

const snap = await db.collection('products').where('brandId', '==', brandId).get();
console.log(`Total products docs: ${snap.size}\n`);

const bySource = new Map();
for (const doc of snap.docs) {
  const d = doc.data();
  const source = String(d.source || '(none)');
  const cat = String(d.category ?? '').trim();
  const hasCat = cat !== '' && cat !== '-';
  let s = bySource.get(source);
  if (!s) {
    s = { total: 0, withCat: 0, withoutCat: 0, cats: new Set(), samplesWith: [], samplesWithout: [] };
    bySource.set(source, s);
  }
  s.total += 1;
  if (hasCat) {
    s.withCat += 1;
    s.cats.add(cat);
    if (s.samplesWith.length < 4) s.samplesWith.push({ sku: d.sku, category: cat, name: String(d.name || '').slice(0, 40) });
  } else {
    s.withoutCat += 1;
    if (s.samplesWithout.length < 4) s.samplesWithout.push({ sku: d.sku, name: String(d.name || '').slice(0, 40) });
  }
}

for (const [source, s] of bySource) {
  console.log(`── source: ${source}`);
  console.log(`   total=${s.total}  withCategory=${s.withCat}  withoutCategory=${s.withoutCat}  distinctCategories=${s.cats.size}`);
  if (s.samplesWith.length) console.log('   sample WITH category:', JSON.stringify(s.samplesWith));
  if (s.samplesWithout.length) console.log('   sample WITHOUT category:', JSON.stringify(s.samplesWithout));
  if (s.cats.size) console.log('   categories (first 15):', [...s.cats].slice(0, 15));
  console.log('');
}

// Procurement signals (custom report subset that the marketing plan currently uses)
const sig = await db.collection('procurement_inventory').where('brandId', '==', brandId).count().get().catch((e) => ({ data: () => ({ count: `ERR ${e.message}` }) }));
console.log(`procurement_inventory rows (custom report): ${sig.data().count}`);

process.exit(0);
