import { FirestoreService } from './firestore';
import { logAndNotify } from './coordination';
import { auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../config/firebase';
import type { Invite, BrandDepartment } from '../types';

const INVITE_EXPIRY_DAYS = 7;

function generateToken(): string {
  return crypto.randomUUID?.() ?? `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function createInvite(
  brandId: string,
  email: string,
  role: string,
  createdBy: string,
  department: BrandDepartment = 'other'
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
    department,
    token,
    expiresAt: expiresAt.toISOString(),
    createdBy,
  };
  await FirestoreService.setDocument('invites', inviteId, invite);
  return { token, inviteId };
}

// The invite doc id is deterministically derived from the token (see createInvite).
// We read by id rather than querying `where('token','==')` because firestore.rules
// denies `list` on /invites (anti-enumeration) while allowing single-doc `get`.
function inviteIdForToken(token: string): string {
  return `inv_${token.replace(/-/g, '_')}`;
}

export async function getInviteByToken(token: string): Promise<(Invite & { brand?: { name: string } }) | null> {
  const invite = await FirestoreService.getDocument<Invite>('invites', inviteIdForToken(token));
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

/**
 * Accept an invite. The actual join (member doc + user profile + consuming the
 * invite) happens SERVER-SIDE in the `acceptInvite` Cloud Function via the Admin
 * SDK — the client can no longer self-create a member doc with an arbitrary role
 * (firestore.rules locks `members` create + `invites` write down). The invite's
 * role is pinned server-side; the caller cannot choose it.
 */
export async function acceptInvite(token: string, userId: string): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not authenticated');

  const url = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/acceptInvite`;
  const appCheck = await getAppCheckHeader();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...appCheck,
    },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; brandId?: string; error?: string };
  if (!res.ok || !json.ok || !json.brandId) {
    throw new Error(json.error || 'Invite acceptance failed');
  }
  const brandId = json.brandId;

  // Best-effort in-app "member joined" notification (the caller is now a member,
  // so the writes pass the rules). Failure here must not fail the acceptance.
  try {
    const profile = await FirestoreService.getDocument<{ displayName?: string }>('users', userId);
    const displayName = profile?.displayName ?? '';
    await logAndNotify(
      brandId,
      userId,
      displayName || 'Νέο μέλος',
      'member_joined',
      'member',
      userId,
      `${displayName || 'Νέος χρήστης'} εντάχθηκε στην ομάδα`,
      'Νέο μέλος',
      `${displayName || 'Νέος χρήστης'} εντάχθηκε στην ομάδα`
    );
  } catch {
    /* notification is best-effort */
  }
}
