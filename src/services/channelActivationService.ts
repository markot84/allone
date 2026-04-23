import { collection, getDocs, query, where, doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface ChannelActivationStatus {
  id: string;
  brandId: string;
  strategyId: string;
  channel: string;
  status: 'pending' | 'in_progress' | 'done';
  note: string;
  /** Συμμετέχει ή όχι το κανάλι στην ενεργή καμπάνια. Αν undefined, default true. */
  included?: boolean;
  updatedAt: string;
  updatedBy: string;
}

export async function getChannelActivations(brandId: string): Promise<ChannelActivationStatus[]> {
  const q = query(collection(db, 'channel_activations'), where('brandId', '==', brandId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ChannelActivationStatus));
}

export async function saveChannelActivation(data: ChannelActivationStatus): Promise<void> {
  await setDoc(doc(db, 'channel_activations', data.id), data);
}
