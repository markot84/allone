/** Shared Firestore helpers for ERP connectors (SoftOne, Epsilon Net, Entersoft). */

import { type Firestore, FieldValue } from 'firebase-admin/firestore';

/** Firestore document IDs cannot contain `/`. */
export function sanitizeFirestoreDocId(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) s = '_';
  s = s.replace(/\//g, '_').replace(/\\/g, '_');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '_');
  if (s === '.' || s === '..') s = '_dot_';
  if (s.length > 1500) s = s.slice(0, 1500);
  return s;
}

/** Canonical `suppliers` doc id: brand-scoped + name-normalized so every writer
 * (MV normalizer, imports, UI) upserts the same doc. Keep in sync with src/utils/supplierDocId.ts. */
export function supplierDocId(brandId: string, name: string): string {
  const norm = String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('el-GR');
  return `sup_${brandId}_${norm}`.replace(/[/\\]/g, '_').slice(0, 900);
}

export function erpNum(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export function erpIsoDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Normalize base URL: trim, ensure scheme, optional trailing slash. */
export function normalizeHttpBase(url: string, trailingSlash: boolean): string {
  let s = String(url ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  s = s.replace(/\/+$/, '');
  return trailingSlash ? `${s}/` : s;
}

export async function erpWriteBatch(
  db: Firestore,
  collection: string,
  brandId: string,
  items: { id: string; data: Record<string, unknown> }[]
): Promise<void> {
  for (let i = 0; i < items.length; i += 500) {
    const batch = db.batch();
    const chunk = items.slice(i, i + 500);
    for (const it of chunk) {
      const docId = sanitizeFirestoreDocId(it.id);
      batch.set(
        db.collection(collection).doc(docId),
        { ...it.data, brandId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
  }
}
