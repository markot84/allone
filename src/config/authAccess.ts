/**
 * Πολιτική εγγραφής νέων λογαριασμών.
 *
 * - `invite_only` (default): δημόσια εγγραφή email/κωδικό και νέοι χρήστες Google
 *   μόνο όταν η ροή ξεκινά από σύνδεσμο πρόσκλησης (`returnUrl` περιέχει `/invite/`).
 * - `open`: παλιά συμπεριφορά — οποιοσδήποτε μπορεί να κάνει εγγραφή (staging / bootstrap).
 *
 * Η τιμή έρχεται από Firestore `appConfig/publicConfig.publicSignupMode`,
 * που φορτώνεται από το `services/appConfig.ts` στο app startup.
 */
import { getAppConfigSync, type PublicSignupMode } from '../services/appConfig';

export type { PublicSignupMode };

export function getPublicSignupMode(): PublicSignupMode {
  return getAppConfigSync().publicSignupMode;
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
