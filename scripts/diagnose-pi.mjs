import admin from 'firebase-admin';

const brandFilter = (process.argv[2] || 'tennis').toLowerCase();

admin.initializeApp({ projectId: 'allone-9e685' });
const db = admin.firestore();

const brands = await db.collection('brands').get();
console.log(`=== BRANDS matching "${brandFilter}" ===`);
const brandIds = [];
for (const d of brands.docs) {
  const data = d.data();
  const name = String(data.name || data.displayName || '');
  if (name.toLowerCase().includes(brandFilter) || d.id.toLowerCase().includes(brandFilter)) {
    console.log(d.id, name);
    brandIds.push(d.id);
  }
}

async function countQuery(coll, brandId, extraWhere = []) {
  try {
    let q = db.collection(coll).where('brandId', '==', brandId);
    for (const [field, op, val] of extraWhere) {
      q = q.where(field, op, val);
    }
    const snap = await q.count().get();
    return snap.data().count;
  } catch (e) {
    return `ERR: ${e.message}`;
  }
}

for (const brandId of brandIds) {
  const conn = (await db.doc(`connectors/${brandId}`).get()).data() || {};
  const mv = conn.megaventory || {};
  const pi = await db.doc(`product_intelligence/${brandId}`).get();

  console.log(`\n=== ${brandId} ===`);
  console.log('Megaventory connector:', JSON.stringify({
    connected: mv.connected,
    lastSyncProducts: mv.lastSyncProducts,
    lastSyncAt: mv.lastSyncAt?.toDate?.()?.toISOString?.(),
    lastReferenceSyncAt: mv.lastReferenceSyncAt?.toDate?.()?.toISOString?.(),
    lastSyncStatus: mv.lastSyncStatus,
    lastSyncError: mv.lastSyncError,
    customReportId: mv.customReportId,
    customReportEnabled: mv.customReportEnabled,
  }, null, 2));

  if (pi.exists) {
    const p = pi.data();
    console.log('PI aggregate:', JSON.stringify({
      status: p.status,
      totalCount: p.totalCount,
      sourceLabel: p.sourceLabel,
      sourceRowsRead: p.sourceRowsRead,
      megaventoryApiRowsRead: p.megaventoryApiRowsRead,
      megaventoryRowsRead: p.megaventoryRowsRead,
      erpOnlyProducts: p.erpOnlyProducts,
      stockOverlaysApplied: p.stockOverlaysApplied,
      error: p.error,
      computedAt: p.computedAt?.toDate?.()?.toISOString?.(),
      summary: p.summary,
    }, null, 2));
  } else {
    console.log('PI: MISSING');
  }

  const counts = {
    megaventory_products: await countQuery('megaventory_products', brandId),
    megaventory_stock: await countQuery('megaventory_stock', brandId),
    megaventory_custom_report_rows: await countQuery('megaventory_custom_report_rows', brandId),
    products_megaventory_custom_report: await countQuery('products', brandId, [['source', '==', 'megaventory_custom_report']]),
    products_megaventory_api_catalog: await countQuery('products', brandId, [['source', '==', 'megaventory_api_catalog']]),
  };
  console.log('Firestore counts:', counts);

  const mvSample = await db.collection('megaventory_products').where('brandId', '==', brandId).limit(2).get();
  for (const doc of mvSample.docs) {
    const row = doc.data();
    console.log('mv product sample', doc.id, {
      sku: row.sku,
      productId: row.productId,
      name: String(row.name || '').slice(0, 50),
    });
  }

  const jobs = await db
    .collection('import_jobs')
    .where('brandId', '==', brandId)
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get()
    .catch(() => null);
  if (jobs?.size) {
    console.log('Recent import_jobs:');
    for (const j of jobs.docs) {
      const d = j.data();
      if (!String(d.connector || d.source || '').toLowerCase().includes('mega') && d.type !== 'megaventory') {
        const src = String(d.connector || d.source || d.type || '');
        if (!src.toLowerCase().includes('megaventory') && !src.toLowerCase().includes('mv')) continue;
      }
      console.log(' -', j.id, {
        status: d.status,
        connector: d.connector || d.type,
        imported: d.imported ?? d.recordsImported,
        products: d.products,
        customReportRows: d.customReportRows,
        apiCatalogGapFill: d.apiCatalogGapFill,
        error: d.error || d.errors,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.(),
      });
    }
  }
}

process.exit(0);
