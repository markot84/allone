export const SUPER_ADMIN_EMAILS: readonly string[] = [
  'makis@notthesame.gr',
  'eleana@notthesame.gr',
  'notthesame.ads@gmail.com',
];

/** Βασικό email επικοινωνίας (UI, υποστήριξη, νομικά) — συμβατό με αποστολή από noreply@ */
export const SUPPORT_EMAIL = 'noreply@performanceplus.gr';

export const APP_NAME = 'Performance+';

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
