import { where } from 'firebase/firestore';
import { FirestoreService } from './firestore';
import type { Invite } from '../types';

const INVITE_EXPIRY_DAYS = 7;

function generateToken(): string {
  return crypto.randomUUID?.() ?? `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function createInvite(
  brandId: string,
  email: string,
  role: string,
  createdBy: string
): Promise<{ token: string; inviteId: string }> {
  const token = generateToken();
  const inviteId = `inv_${token.replace(/-/g, '_')}`;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
  const invite: Omit<Invite, 'id'> = {
    brandId,
    email: email.trim() ? email.trim().toLowerCase() : '',
    role,
    token,
    expiresAt: expiresAt.toISOString(),
    usedAt: undefined,
    createdBy,
  };
  await FirestoreService.setDocument('invites', inviteId, { ...invite, id: inviteId });
  return { token, inviteId };
}

export async function getInviteByToken(token: string): Promise<(Invite & { brand?: { name: string } }) | null> {
  const invites = await FirestoreService.getDocuments<Invite>('invites', [where('token', '==', token)], null);
  const invite = invites[0];
  if (!invite) return null;
  if (invite.usedAt) return null;
  const expiresAt = new Date(invite.expiresAt);
  if (expiresAt < new Date()) return null;
  const brand = await FirestoreService.getDocument<{ name: string }>('brands', invite.brandId);
  return { ...invite, brand: brand ?? undefined };
}

export async function acceptInvite(token: string, userId: string): Promise<void> {
  const invites = await FirestoreService.getDocuments<Invite>('invites', [where('token', '==', token)], null);
  const invite = invites[0];
  if (!invite) throw new Error('Invite not found');
  if (invite.usedAt) throw new Error('Invite already used');
  const expiresAt = new Date(invite.expiresAt);
  if (expiresAt < new Date()) throw new Error('Invite expired');

  const profile = await FirestoreService.getDocument<{ brandIds?: string[]; defaultBrandId?: string }>('users', userId);
  const brandIds = profile?.brandIds ?? [];
  if (!brandIds.includes(invite.brandId)) {
    await FirestoreService.updateDocument('users', userId, {
      brandIds: [...brandIds, invite.brandId],
      defaultBrandId: profile?.defaultBrandId || invite.brandId,
    });
  }

  await FirestoreService.updateDocument('invites', invite.id, {
    usedAt: new Date().toISOString(),
  });
}
