export const SUPER_ADMIN_EMAILS: readonly string[] = [
  'makis@notthesame.gr',
  'eleana@notthesame.gr',
  'notthesame.ads@gmail.com',
];

/** Υποστήριξη χρηστών / εφαρμογής (Auth, SuperAdmin, Help, νομικά) */
export const SUPPORT_EMAIL = 'noreply@performanceplus.gr';

/** Marketing landing: φόρμες επικοινωνίας (mailto — και οι δύο παραλήπτες) */
/** Φόρμες επικοινωνίας (mailto) — δεν εμφανίζονται διευθύνσεις στη σελίδα */
export const MARKETING_CONTACT_MAILTO = 'makis@notthesame.gr,dimitris@notthesame.gr';

export const APP_NAME = 'Performance+';

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
