// Signup policy from `VITE_PUBLIC_SIGNUP_MODE` (build-time). `invite_only` (default): signup only
// via invite link (`returnUrl` contains `/invite/`); `open`: anyone (staging / bootstrap).
export type PublicSignupMode = 'invite_only' | 'open';

export function getPublicSignupMode(): PublicSignupMode {
  const v = (import.meta.env.VITE_PUBLIC_SIGNUP_MODE as string | undefined)?.trim();
  return v === 'open' ? 'open' : 'invite_only';
}

/** Whether the post-login returnUrl points to an invite-acceptance page. */
export function isInviteReturnUrl(returnUrl: string | null | undefined): boolean {
  if (!returnUrl || typeof returnUrl !== 'string') return false;
  try {
    const path = returnUrl.startsWith('http') ? new URL(returnUrl).pathname : returnUrl;
    return path.includes('/invite/');
  } catch {
    return returnUrl.includes('/invite/');
  }
}
