/**
 * Upload a local image as a brand logo to Firebase Storage and set brands/{id}.logoUrl.
 * Auth: service account key (arg) or Application Default Credentials.
 *
 * Usage: node scripts/upload-brand-logo.mjs <localImagePath> --brand=sportflow-demo [serviceAccountKey.json]
 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'allone-9e685';
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const positional = args.filter((a) => !a.startsWith('--'));
const localPath = positional[0];
const keyPath = positional[1] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const BRAND_ID = (flags.brand || 'sportflow-demo').toString();

if (!localPath || !existsSync(localPath)) {
  console.error('Provide a valid local image path as the first argument.');
  process.exit(1);
}

initializeApp(
  keyPath ? { credential: cert(keyPath), projectId: PROJECT_ID, storageBucket: BUCKET } : { credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET }
);
const db = getFirestore();
const bucket = getStorage().bucket();

(async () => {
  const ext = (basename(localPath).split('.').pop() || 'png').toLowerCase();
  const contentType = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const destination = `brands/${BRAND_ID}/assets/logo/${Date.now()}-${basename(localPath).replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const token = randomUUID();

  await bucket.upload(localPath, {
    destination,
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });

  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`;
  await db.doc(`brands/${BRAND_ID}`).set({ logoUrl: url, assets: { logo: url }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  console.log('✓ Uploaded:', destination);
  console.log('✓ brands/' + BRAND_ID + '.logoUrl set');
  console.log(url);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
