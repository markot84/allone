/**
 * SEC-L6 — sanitizeOAuthReturnOrigin must pin the post-OAuth redirect to THIS project's own
 * Firebase hosts (built from GCLOUD_PROJECT) + performanceplus.gr, instead of accepting any
 * *.web.app / *.firebaseapp.com (which made every Firebase project an open-redirect target).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeOAuthReturnOrigin, DEFAULT_OAUTH_APP_ORIGIN } from '../../oauthRedirect';

const PROJECT = process.env.GCLOUD_PROJECT;

describe('sanitizeOAuthReturnOrigin (SEC-L6)', () => {
  it("allows THIS project's own *.web.app host", () => {
    expect(PROJECT).toBeTruthy();
    const own = `https://${PROJECT}.web.app`;
    expect(sanitizeOAuthReturnOrigin(own)).toBe(own);
  });

  it('rejects a FOREIGN *.web.app project host → default', () => {
    expect(sanitizeOAuthReturnOrigin('https://some-other-project.web.app')).toBe(DEFAULT_OAUTH_APP_ORIGIN);
  });

  it('rejects a foreign *.firebaseapp.com host → default', () => {
    expect(sanitizeOAuthReturnOrigin('https://evil-project.firebaseapp.com')).toBe(DEFAULT_OAUTH_APP_ORIGIN);
  });

  it('allows performanceplus.gr and its subdomains', () => {
    expect(sanitizeOAuthReturnOrigin('https://performanceplus.gr')).toBe('https://performanceplus.gr');
    expect(sanitizeOAuthReturnOrigin('https://app.performanceplus.gr')).toBe('https://app.performanceplus.gr');
  });

  it('rejects a non-http(s) scheme → default', () => {
    expect(sanitizeOAuthReturnOrigin('javascript:alert(1)')).toBe(DEFAULT_OAUTH_APP_ORIGIN);
  });

  it('falls back to default for empty / non-string input', () => {
    expect(sanitizeOAuthReturnOrigin('')).toBe(DEFAULT_OAUTH_APP_ORIGIN);
    expect(sanitizeOAuthReturnOrigin(undefined)).toBe(DEFAULT_OAUTH_APP_ORIGIN);
    expect(sanitizeOAuthReturnOrigin(null)).toBe(DEFAULT_OAUTH_APP_ORIGIN);
  });
});
