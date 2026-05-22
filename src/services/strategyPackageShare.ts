import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface SharedPackageData {
  brandName?: string;
  strategyName: string;
  duration: string;
  weights: Record<string, number>;
  idealSegments: string[];
  goodSegments: string[];
  primaryChannels: string[];
  secondaryChannels: string[];
  budgetAllocation: Record<string, number>;
  rationale?: string;
  createdAt?: any;
  createdBy?: string;
}

export async function saveSharedPackage(data: SharedPackageData, uid: string | undefined): Promise<string> {
  // Firestore rule requires createdBy === request.auth.uid on shared_packages create.
  // Caller must pass the authenticated user's uid; anonymous shares are not allowed.
  if (!uid) throw new Error('saveSharedPackage requires an authenticated user uid');
  // Strip undefined fields — Firestore rejects them synchronously with an
  // "Unsupported field value: undefined" error.
  const payload: Record<string, unknown> = {
    createdAt: serverTimestamp(),
    createdBy: uid,
  };
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) payload[k] = v;
  }
  const ref = await addDoc(collection(db, 'shared_packages'), payload);
  return ref.id;
}

export async function getSharedPackage(id: string): Promise<SharedPackageData | null> {
  const snap = await getDoc(doc(db, 'shared_packages', id));
  if (!snap.exists()) return null;
  return snap.data() as SharedPackageData;
}
