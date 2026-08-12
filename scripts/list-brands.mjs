/** Read-only: list brands, and the RFM segment ids each one actually produces.
 * Usage: node scripts/list-brands.mjs   (uses GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC) */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || 'allone-9e685' });
const db = getFirestore(app);

for (const d of (await db.collection('brands').get()).docs) {
  console.log(`\n=== ${d.id}  name="${d.data().name ?? '?'}" ===`);
  const seg = await d.ref.collection('aggregates').doc('segments').get();
  if (!seg.exists) { console.log('  (no segments aggregate)'); continue; }
  const v = seg.data();
  // `segments` is a map keyed by segment id on some brands and an array on others.
  const raw = v.segments ?? {};
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, s]) => ({ id, ...(s ?? {}) }));
  console.log(`  totalCustomers=${v.totalCustomers}  segments=${list.length}`);
  for (const s of list) {
    console.log(`    id=${String(s.id).padEnd(30)} name="${s.name ?? ''}" count=${s.count ?? s.customers ?? '?'} color=${s.color ?? '-'}`);
  }
}
process.exit(0);
