/**
 * One-off bootstrap: writes the two Firestore docs the backend still depends on:
 *   - appConfig/notifications  → interest-lead recipient emails (Cloud Functions read via Admin SDK)
 *   - appConfig/superAdmins    → UID / email allowlist (Firestore rules + Cloud Functions + SPA)
 *
 * Other runtime values (app URL / functions region / signup mode) now live in
 * `.env` directly — no longer seeded here.
 *
 * Setup (one-time):
 *   1) Option A — gcloud Application Default Credentials (preferred when
 *      service-account keys are blocked by org policy):
 *        gcloud auth application-default login
 *      Sign in with a Google account that has Firebase admin on the target project.
 *   2) Option B — service-account key:
 *        Firebase Console → Project settings → Service accounts →
 *        "Generate new private key" → save as .tmp/service-account.json
 *
 *   3) cd .tmp && npm install (one-time)
 *   4) node .tmp/seed-runtime-config.mjs
 *
 * Safe to re-run — writes are merges.
 */
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Hardcoded so this script can NEVER write to production by accident.
const TARGET_PROJECT_ID = 'performanceplus-staging';

// ── Values to seed ──────────────────────────────────────────────────────────

const NOTIFICATIONS = {
  // Replaces functions env var INTEREST_LEAD_NOTIFY_EMAILS.
  // Read by Cloud Functions via Admin SDK. Client read blocked by firestore.rules.
  interestLeadNotifyEmails: [
    'makis@notthesame.gr',
    'dimitris@notthesame.gr',
    'eleana@notthesame.gr',
  ],
};

const SUPER_ADMINS = {
  uids: [
    'yPIEMSB1jXXxGX2hHCOvLYoJY7L2',
    'KApqDr7UlNa7TseQ25pakM8DRrd2',
    'BAi5ZTMwFdWFCUR6k3IZq8cjPfp2', // pragma: allowlist secret -- Firebase Auth UID (identifier, NOT a credential)
  ],
  emails: [
    'makis@notthesame.gr',
    'eleana@notthesame.gr',
    'notthesame.ads@gmail.com',
  ],
};

// ── Boilerplate ─────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = new URL('./service-account.json', import.meta.url);

if (getApps().length === 0) {
  if (existsSync(SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
    if (serviceAccount.project_id !== TARGET_PROJECT_ID) {
      console.error(`\n[ERROR] service-account.json belongs to project '${serviceAccount.project_id}', not '${TARGET_PROJECT_ID}'.`);
      process.exit(1);
    }
    initializeApp({ credential: cert(serviceAccount), projectId: TARGET_PROJECT_ID });
  } else {
    initializeApp({ credential: applicationDefault(), projectId: TARGET_PROJECT_ID });
  }
}
console.log(`Target project: ${TARGET_PROJECT_ID}`);

const db = getFirestore();

const stamp = {
  updatedAt: new Date().toISOString(),
  updatedBy: 'seed-runtime-config.mjs',
};

const notificationsDoc = { ...NOTIFICATIONS, ...stamp };
const superAdminsDoc = { ...SUPER_ADMINS, ...stamp };

console.log('\nWriting appConfig/notifications:');
console.log(JSON.stringify(notificationsDoc, null, 2));
console.log('\nWriting appConfig/superAdmins:');
console.log(JSON.stringify(superAdminsDoc, null, 2));

try {
  await db.doc('appConfig/notifications').set(notificationsDoc, { merge: true });
  await db.doc('appConfig/superAdmins').set(superAdminsDoc, { merge: true });
  console.log('\n[OK] appConfig/notifications and appConfig/superAdmins written successfully.');
  process.exit(0);
} catch (err) {
  console.error('\n[ERROR] Write failed:', err.message);
  process.exit(1);
}
