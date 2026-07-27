/** Grant super-admin Firestore access + brand membership for specific brands.
 * Usage: node scripts/grant-super-admin-access.mjs [serviceAccountKey.json] (else GOOGLE_APPLICATION_CREDENTIALS). */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'allone-9e685';
// Don't commit super-admin emails / brand ids; pass via env (comma-separated), e.g.
//   SUPER_ADMIN_EMAILS="a@x.com,b@y.com" SUPER_ADMIN_BRAND_IDS="brand1,brand2" node scripts/grant-super-admin-access.mjs
const EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const BRAND_IDS = (process.env.SUPER_ADMIN_BRAND_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  if (EMAILS.length === 0) {
    console.error('Set SUPER_ADMIN_EMAILS (comma-separated) before running this script.');
    process.exit(1);
  }
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
