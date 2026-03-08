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

export async function saveSharedPackage(data: SharedPackageData, userId?: string): Promise<string> {
  const ref = await addDoc(collection(db, 'shared_packages'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: userId || 'anonymous',
  });
  return ref.id;
}

export async function getSharedPackage(id: string): Promise<SharedPackageData | null> {
  const snap = await getDoc(doc(db, 'shared_packages', id));
  if (!snap.exists()) return null;
  return snap.data() as SharedPackageData;
}
