/** getTikTokAuthUrl must refuse to build an OAuth URL with a non-numeric app_id.
 * TikTok's Marketing API portal parses app_id with strconv.ParseInt and rejects
 * placeholders like "pending" (set while the app awaits approval) with a confusing
 * "invalid syntax" error — so we fail fast here instead of bouncing the user there. */
import { describe, it, expect, afterEach } from 'vitest';
import { getTikTokAuthUrl, TikTokNotConfiguredError } from '../../tiktokConnector';

const REDIRECT = 'https://example.com/connectorCallback';

afterEach(() => {
  delete process.env.TIKTOK_APP_ID;
});

describe('getTikTokAuthUrl app_id validation', () => {
  it('builds a URL when app_id is a numeric string', () => {
    process.env.TIKTOK_APP_ID = '1234567890123456789';
    const url = getTikTokAuthUrl('brand-1', REDIRECT);
    expect(url).toContain('app_id=1234567890123456789');
    expect(url).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(url).toContain('state=');
  });

  it('throws for the "pending" placeholder', () => {
    process.env.TIKTOK_APP_ID = 'pending';
    expect(() => getTikTokAuthUrl('brand-1', REDIRECT)).toThrow(TikTokNotConfiguredError);
  });

  it('throws when app_id is missing', () => {
    delete process.env.TIKTOK_APP_ID;
    expect(() => getTikTokAuthUrl('brand-1', REDIRECT)).toThrow(TikTokNotConfiguredError);
  });

  it('throws for a non-numeric app_id', () => {
    process.env.TIKTOK_APP_ID = '123abc';
    expect(() => getTikTokAuthUrl('brand-1', REDIRECT)).toThrow(TikTokNotConfiguredError);
  });
});
