/**
 * Public-facing branding / contact constants. These are intentionally shown
 * to end users (legal pages, marketing landing, help section, admin UI), so
 * they remain in source — moving them to Firestore would gain nothing.
 *
 * The super-admin allowlist (UIDs + emails) that was previously here has
 * moved to Firestore at `appConfig/superAdmins` and is read via
 * `services/appConfig.ts → loadSuperAdmins()`.
 */

/** Υποστήριξη χρηστών / εφαρμογής (Auth, SuperAdmin, Help, νομικά) */
export const SUPPORT_EMAIL = 'noreply@performanceplus.gr';

/** Marketing landing: φόρμες επικοινωνίας (mailto) — δεν εμφανίζονται διευθύνσεις στη σελίδα */
export const MARKETING_CONTACT_MAILTO = 'makis@notthesame.gr,dimitris@notthesame.gr';

export const APP_NAME = 'Performance+';
