/** Invite-only signup policy for the beforeUserCreated blocking gate — the client-side
 * check in AuthContext is advisory UX only; this is the enforcement point. */

export interface InviteLike {
  email?: string;
  usedAt?: string;
  expiresAt?: string;
}

export function isInvitePending(invite: InviteLike, now: Date = new Date()): boolean {
  if (invite.usedAt) return false;
  if (invite.expiresAt && new Date(invite.expiresAt) < now) return false;
  return true;
}

/** Signup is allowed when the deployment is in open mode, the email is a super admin,
 * or a pending invite exists — either addressed to this email or an open (unaddressed) one. */
export function signupAllowed(opts: {
  mode: string | undefined;
  email: string;
  superAdminEmails: Set<string>;
  matchingInvites: InviteLike[];
  openInvites: InviteLike[];
  now?: Date;
}): boolean {
  if (opts.mode === 'open') return true;
  const email = opts.email.trim().toLowerCase();
  if (email && opts.superAdminEmails.has(email)) return true;
  const now = opts.now ?? new Date();
  return [...opts.matchingInvites, ...opts.openInvites].some((i) => isInvitePending(i, now));
}
