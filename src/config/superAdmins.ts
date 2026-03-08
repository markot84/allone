export const SUPER_ADMIN_EMAILS: readonly string[] = [
  'makis@notthesame.gr',
  'eleana@notthesame.gr',
  'notthesame.ads@gmail.com',
];

export const SUPPORT_EMAIL = 'support@notthesame.gr';

export const APP_NAME = 'Performance+';

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
