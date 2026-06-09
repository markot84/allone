/** Default when state has no returnOrigin (legacy OAuth links). */
export const DEFAULT_OAUTH_APP_ORIGIN = 'https://www.performanceplus.gr';

// SEC-L6: pin the post-OAuth redirect to THIS project's own Firebase hosts rather than any
// *.web.app / *.firebaseapp.com (which made every Firebase project's host a valid open-redirect
// target). GCLOUD_PROJECT is set by the Functions runtime; empty in unit tests → only the
// performanceplus.gr / localhost branches apply, which is safe.
const PROJECT_ID = (process.env.GCLOUD_PROJECT || '').toLowerCase();
const ALLOWED_FIREBASE_HOSTS = new Set(
  PROJECT_ID ? [`${PROJECT_ID}.web.app`, `${PROJECT_ID}.firebaseapp.com`] : []
);

/**
 * Safe redirect target after OAuth. Prevents open redirects while allowing production/staging domains.
 */
export function sanitizeOAuthReturnOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_OAUTH_APP_ORIGIN;
  try {
    const s = raw.trim();
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_OAUTH_APP_ORIGIN;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost')) return u.origin;
    if (ALLOWED_FIREBASE_HOSTS.has(h)) return u.origin;
    if (h === 'performanceplus.gr' || h.endsWith('.performanceplus.gr')) return u.origin;
    return DEFAULT_OAUTH_APP_ORIGIN;
  } catch {
    return DEFAULT_OAUTH_APP_ORIGIN;
  }
}
