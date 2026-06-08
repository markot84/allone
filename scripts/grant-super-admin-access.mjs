/**
 * Grant super-admin Firestore access + brand membership for specific brands.
 *
 * Usage:
 *   node scripts/grant-super-admin-access.mjs [path/to/serviceAccountKey.json]
 *
 * Env: GOOGLE_APPLICATION_CREDENTIALS if key path omitted.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';
const EMAILS = ['tzavlop@gmail.com', 'george.meras@gmail.com'];
const BRAND_IDS = ['safeblock', 'airblock', 'e-tennis'];

async function main() {
  const keyPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const app = keyPath
    ? initializeApp({ credential: cert(keyPath), projectId: PROJECT_ID })
    : initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });

  const auth = getAuth(app);
  const db = getFirestore(app);

  const cfgRef = db.doc('appConfig/superAdmins');
  const cfgSnap = await cfgRef.get();
  const existingUids = new Set(cfgSnap.exists ? cfgSnap.data()?.uids ?? [] : []);

  for (const rawEmail of EMAILS) {
    const email = rawEmail.toLowerCase();
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      console.warn(`⚠ User not registered yet: ${email} — will get super admin on first login after deploy.`);
      continue;
    }

    const uid = user.uid;
    console.log(`\n→ ${email} (${uid})`);

    existingUids.add(uid);

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const brandIds = new Set(userSnap.exists ? userSnap.data()?.brandIds ?? [] : []);
    for (const brandId of BRAND_IDS) {
      brandIds.add(brandId);
    }
    await userRef.set(
      {
        email,
        brandIds: [...brandIds],
        defaultBrandId: userSnap.data()?.defaultBrandId || BRAND_IDS[0],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log('  users profile: brandIds updated');

    for (const brandId of BRAND_IDS) {
      const brandSnap = await db.doc(`brands/${brandId}`).get();
      if (!brandSnap.exists) {
        console.warn(`  ⚠ brand missing: ${brandId}`);
        continue;
      }
      await db.doc(`brands/${brandId}/members/${uid}`).set(
        {
          uid,
          email,
          role: 'admin',
          invitedBy: 'grant-super-admin-access.mjs',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`  member: ${brandId} (admin)`);
    }
  }

  await cfgRef.set(
    {
      uids: [...existingUids],
      emails: EMAILS,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`\n✓ appConfig/superAdmins: ${existingUids.size} UID(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
