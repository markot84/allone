/** Default when state has no returnOrigin (legacy OAuth links). */
export const DEFAULT_OAUTH_APP_ORIGIN = 'https://www.performanceplus.gr';

// Pin post-OAuth redirect to THIS project's Firebase hosts only (not any *.web.app /
// *.firebaseapp.com). GCLOUD_PROJECT empty in unit tests → only performanceplus.gr / localhost.
const PROJECT_ID = (process.env.GCLOUD_PROJECT || '').toLowerCase();
const ALLOWED_FIREBASE_HOSTS = new Set(
  PROJECT_ID ? [`${PROJECT_ID}.web.app`, `${PROJECT_ID}.firebaseapp.com`] : []
);

/** Safe redirect target after OAuth. Prevents open redirects while allowing production/staging domains. */
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
