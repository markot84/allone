/**
 * Πολιτική εγγραφής νέων λογαριασμών.
 *
 * - `invite_only` (default): δημόσια εγγραφή email/κωδικό και νέοι χρήστες Google
 *   μόνο όταν η ροή ξεκινά από σύνδεσμο πρόσκλησης (`returnUrl` περιέχει `/invite/`).
 * - `open`: παλιά συμπεριφορά — οποιοσδήποτε μπορεί να κάνει εγγραφή (staging / bootstrap).
 *
 * Source: `VITE_PUBLIC_SIGNUP_MODE` env var (build-time, baked into the bundle).
 */
export type PublicSignupMode = 'invite_only' | 'open';

export function getPublicSignupMode(): PublicSignupMode {
  const v = (import.meta.env.VITE_PUBLIC_SIGNUP_MODE as string | undefined)?.trim();
  return v === 'open' ? 'open' : 'invite_only';
}

/** Αν το returnUrl μετά το login οδηγεί σε σελίδα αποδοχής πρόσκλησης. */
export function isInviteReturnUrl(returnUrl: string | null | undefined): boolean {
  if (!returnUrl || typeof returnUrl !== 'string') return false;
  try {
    const path = returnUrl.startsWith('http') ? new URL(returnUrl).pathname : returnUrl;
    return path.includes('/invite/');
  } catch {
    return returnUrl.includes('/invite/');
  }
}
