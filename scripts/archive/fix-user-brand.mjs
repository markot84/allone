/**
 * Fix user profile: add brandId to brandIds so user sees brand data.
 * For users who were invited before the ensureProfile race fix.
 *
 * Usage: node scripts/fix-user-brand.mjs <email> <brandId> [path/to/serviceAccountKey.json]
 * Example: node scripts/fix-user-brand.mjs eleana@notthesame.gr airblock
 *
 * Note: brandId is case-sensitive. Use lowercase (e.g. airblock not Airblock).
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

async function main() {
  const [email, brandId, keyPath] = process.argv.slice(2);
  if (!email || !brandId) {
    console.error('Usage: node scripts/fix-user-brand.mjs <email> <brandId> [path/to/serviceAccountKey.json]');
    console.error('Example: node scripts/fix-user-brand.mjs eleana@notthesame.gr airblock');
    process.exit(1);
  }

  const credPath = keyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS or pass key path as 3rd arg');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(credPath) });
  const auth = getAuth(app);
  const db = getFirestore(app);

  // 1. Get user by email
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    console.error('User not found:', email, e.message);
    process.exit(1);
  }

  const uid = user.uid;
  console.log('Found user:', uid, email);

  // 2. Verify brand exists and show product/segment counts
  const brandRef = db.collection('brands').doc(brandId);
  const brandSnap = await brandRef.get();
  if (!brandSnap.exists) {
    // Try case-insensitive lookup
    const brandsSnap = await db.collection('brands').get();
    const matches = brandsSnap.docs.filter((d) => d.id.toLowerCase() === brandId.toLowerCase());
    if (matches.length > 0) {
      console.log('Brand id is case-sensitive. Use:', matches[0].id);
    }
    console.error('Brand not found:', brandId);
    process.exit(1);
  }

  const productsSnap = await db.collection('products').where('brandId', '==', brandId).get();
  const segmentsSnap = await db.collection('segments').where('brandId', '==', brandId).get();
  console.log('Brand', brandId, 'has', productsSnap.size, 'products,', segmentsSnap.size, 'segments');

  // 3. Get current profile
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const data = userSnap.exists ? userSnap.data() : {};
  const brandIds = data.brandIds || [];

  if (brandIds.includes(brandId)) {
    console.log('User already has brand', brandId, 'in brandIds.');
    if (productsSnap.size === 0 && segmentsSnap.size === 0) {
      console.log('No products/segments for this brand – data may be under different brandId.');
    }
    process.exit(0);
  }

  // 4. Add brand and update
  const newBrandIds = [...brandIds, brandId];
  await userRef.set(
    {
      brandIds: newBrandIds,
      defaultBrandId: data.defaultBrandId || brandId,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  console.log('Updated user profile. Added brand', brandId, 'to brandIds.');
  console.log('User should refresh the app to see brand data.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
