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

// ── Target project selection ────────────────────────────────────────────────
// Defaults to staging so a prod write is ALWAYS a conscious, explicit choice:
//   node seed-runtime-config.mjs                       → staging (default)
//   node seed-runtime-config.mjs --project production  → production
// Aliases mirror .firebaserc. The service-account guard below additionally
// refuses to run if the credential's project_id doesn't match the target.
const PROJECT_IDS = {
  staging: 'performanceplus-staging',
  production: 'performance-plus-4a5b2',
};

function resolveTargetProjectId(argv) {
  let sel;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-P') sel = argv[++i];
    else if (a.startsWith('--project=')) sel = a.slice('--project='.length);
    else if (!a.startsWith('-') && sel === undefined) sel = a;
  }
  if (sel === undefined) return PROJECT_IDS.staging; // safe default
  const key = sel.toLowerCase();
  if (key in PROJECT_IDS) return PROJECT_IDS[key];
  if (Object.values(PROJECT_IDS).includes(sel)) return sel; // raw project id
  console.error(`\n[ERROR] Unknown --project '${sel}'. Use one of: ${Object.keys(PROJECT_IDS).join(', ')}.`);
  process.exit(1);
}

const TARGET_PROJECT_ID = resolveTargetProjectId(process.argv.slice(2));

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
const TARGET_ENV = TARGET_PROJECT_ID === PROJECT_IDS.production ? 'PRODUCTION' : 'STAGING';
console.log(`\n========================================`);
console.log(`  Target: ${TARGET_ENV}  (${TARGET_PROJECT_ID})`);
console.log(`========================================`);

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
