import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'performance-plus-4a5b2' });
const db = admin.firestore();

const brands = await db.collection('brands').get();
console.log('=== BRANDS (step) ===');
for (const d of brands.docs) {
  const data = d.data();
  const name = String(data.name || data.displayName || '');
  if (name.toLowerCase().includes('step')) console.log(d.id, name);
}

const connectors = await db.collection('connectors').get();
for (const d of connectors.docs) {
  const oc = d.data()?.opencart;
  if (!oc?.connected && !(oc?.lastSyncProducts > 0)) continue;
  const brandId = d.id;
  console.log('\n=== CONNECTOR', brandId, '===');
  console.log(JSON.stringify({
    storeUrl: oc.storeUrl,
    connected: oc.connected,
    lastSyncProducts: oc.lastSyncProducts,
    lastSyncAt: oc.lastSyncAt,
    lastSyncStatus: oc.lastSyncStatus,
    lastProductsSyncAt: oc.lastProductsSyncAt,
    productsSyncPageCursor: oc.productsSyncPageCursor,
  }, null, 2));

  const pi = await db.doc(`product_intelligence/${brandId}`).get();
  if (pi.exists) {
    const p = pi.data();
    console.log('PI:', JSON.stringify({
      status: p.status,
      totalCount: p.totalCount,
      sourceLabel: p.sourceLabel,
      sourceRowsRead: p.sourceRowsRead,
      error: p.error,
      computedAt: p.computedAt?.toDate?.()?.toISOString?.(),
    }, null, 2));
  } else {
    console.log('PI: MISSING');
  }

  try {
    const countSnap = await db.collection('opencart_products').where('brandId', '==', brandId).count().get();
    console.log('opencart_products count (brandId):', countSnap.data().count);
  } catch (e) {
    console.log('count query error:', e.message);
  }

  const sample = await db.collection('opencart_products').where('brandId', '==', brandId).limit(2).get();
  console.log('sample query size:', sample.size);
  for (const doc of sample.docs) {
    const row = doc.data();
    console.log('sample doc', doc.id, { sku: row.sku, model: row.model, productId: row.productId, brandId: row.brandId, name: String(row.name || '').slice(0, 40) });
  }

  // Test orderBy documentId query used by aggregator
  try {
    const q = await db.collection('opencart_products').where('brandId', '==', brandId).orderBy(admin.firestore.FieldPath.documentId()).limit(5).get();
    console.log('brandId+orderBy(docId) query:', q.size);
  } catch (e) {
    console.log('brandId+orderBy(docId) FAILED:', e.message);
  }
}

process.exit(0);
