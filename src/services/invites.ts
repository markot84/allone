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
  const invite = {
    id: inviteId,
    brandId,
    email: email.trim() ? email.trim().toLowerCase() : '',
    role,
    token,
    expiresAt: expiresAt.toISOString(),
    createdBy,
  };
  await FirestoreService.setDocument('invites', inviteId, invite);
  return { token, inviteId };
}

export async function getInviteByToken(token: string): Promise<(Invite & { brand?: { name: string } }) | null> {
  const invites = await FirestoreService.getDocuments<Invite>('invites', [where('token', '==', token)], null);
  const invite = invites[0];
  if (!invite) return null;
  if (invite.usedAt) return null;
  const expiresAt = new Date(invite.expiresAt);
  if (expiresAt < new Date()) return null;
  let brand: { name: string } | null = null;
  try {
    brand = await FirestoreService.getDocument<{ name: string }>('brands', invite.brandId);
  } catch {
    // Brand read may fail when unauthenticated ( Firestore rules require auth for brands)
  }
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
    // Use setDocument with merge - creates profile if new user, merges if exists
    await FirestoreService.setDocument('users', userId, {
      id: userId,
      brandIds: [...brandIds, invite.brandId],
      defaultBrandId: profile?.defaultBrandId || invite.brandId,
    } as Record<string, unknown>);
  }

  await FirestoreService.updateDocument('invites', invite.id, {
    usedAt: new Date().toISOString(),
  });
}
