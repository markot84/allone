/**
 * Migration: Add brandId to existing products/segments and create Legacy brand.
 * Run once before/after multi-brand deploy.
 *
 * Usage:
 *   1. npm install firebase-admin
 *   2. Get service account key from Firebase Console → Project Settings → Service Accounts
 *   3. node scripts/migrate-add-brandid.mjs [path/to/serviceAccountKey.json]
 *   4. Or set GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const LEGACY_BRAND_ID = 'legacy';

async function main() {
  const keyPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('Usage: node scripts/migrate-add-brandid.mjs [path/to/serviceAccountKey.json]');
    console.error('Or set GOOGLE_APPLICATION_CREDENTIALS');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(keyPath) });
  const db = getFirestore(app);

  console.log('Migration: Add brandId to existing docs...');

  // 1. Create Legacy brand
  const brandsRef = db.collection('brands');
  const legacyRef = brandsRef.doc(LEGACY_BRAND_ID);
  const legacySnap = await legacyRef.get();
  if (!legacySnap.exists) {
    await legacyRef.set({
      id: LEGACY_BRAND_ID,
      name: 'Legacy',
      type: 'B2C',
      createdAt: new Date().toISOString(),
      createdBy: 'migration',
    });
    console.log('Created Legacy brand');
  } else {
    console.log('Legacy brand already exists');
  }

  const BATCH_SIZE = 500;

  // 2. Migrate products without brandId
  const productsSnap = await db.collection('products').get();
  const productDocs = productsSnap.docs.filter((d) => !d.data().brandId);
  for (let i = 0; i < productDocs.length; i += BATCH_SIZE) {
    const chunk = productDocs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((doc) => batch.update(doc.ref, { brandId: LEGACY_BRAND_ID }));
    await batch.commit();
  }
  if (productDocs.length > 0) console.log(`Updated ${productDocs.length} products with brandId`);
  else console.log('No products to migrate');

  // 3. Migrate segments without brandId
  const segmentsSnap = await db.collection('segments').get();
  const segmentDocs = segmentsSnap.docs.filter((d) => !d.data().brandId);
  for (let i = 0; i < segmentDocs.length; i += BATCH_SIZE) {
    const chunk = segmentDocs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((doc) => batch.update(doc.ref, { brandId: LEGACY_BRAND_ID }));
    await batch.commit();
  }
  if (segmentDocs.length > 0) console.log(`Updated ${segmentDocs.length} segments with brandId`);
  else console.log('No segments to migrate');

  // 4. Add Legacy to all users who don't have it
  const usersSnap = await db.collection('users').get();
  let userCount = 0;
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const brandIds = data.brandIds || [];
    if (!brandIds.includes(LEGACY_BRAND_ID)) {
      await doc.ref.update({
        brandIds: [...brandIds, LEGACY_BRAND_ID],
        defaultBrandId: data.defaultBrandId || LEGACY_BRAND_ID,
      });
      userCount++;
    }
  }
  if (userCount > 0) {
    console.log(`Added Legacy brand to ${userCount} users`);
  }

  console.log('Migration complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
