/**
 * Create (or reset) a dedicated email/password account for UI work.
 *
 * Google sign-in cannot be driven from a headless browser — the OAuth consent screen needs a real
 * interaction — and nobody should be automating against a personal Google account anyway. This
 * makes a throwaway account instead, scoped to the demo brand.
 *
 * The password is generated here and printed ONCE. It is never written to a file and must not be
 * committed. Re-run to rotate it.
 *
 * Usage: node scripts/create-ui-test-user.mjs [email]
 *        (uses GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC)
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'allone-9e685';
const email = (process.argv[2] || 'ui-test@allone.dev').toLowerCase();

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth(app);

// URL-safe, no ambiguous characters to mistype when it is pasted back into a login form.
const password = randomBytes(18).toString('base64url');

let user;
try {
  user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password, emailVerified: true, disabled: false });
  console.log(`updated existing user ${email}`);
} catch {
  user = await auth.createUser({ email, password, emailVerified: true, displayName: 'UI test' });
  console.log(`created user ${email}`);
}

console.log(`uid:      ${user.uid}`);
console.log(`email:    ${email}`);
console.log(`password: ${password}`);
console.log('\nNext: grant it the demo brand —');
console.log(`  SUPER_ADMIN_EMAILS="${email}" SUPER_ADMIN_BRAND_IDS="sportflow-demo" node scripts/grant-super-admin-access.mjs`);
process.exit(0);
