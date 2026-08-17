import { describe, expect, it } from 'vitest';
import { collectConnectorSyncErrors } from './useConnectorSyncErrors';

const NOW = 1_800_000_000_000;
const ts = (msAgo: number) => ({ toDate: () => new Date(NOW - msAgo) });

describe('collectConnectorSyncErrors (PER-194)', () => {
  it('returns fresh errors of connected connectors only', () => {
    const out = collectConnectorSyncErrors(
      {
        google_ads: { connected: true, lastSyncError: 'HTTP 400', lastSyncErrorAt: ts(3600_000) },
        meta: { connected: false, lastSyncError: 'ignored — disconnected' },
        megaventory: { connected: true },
        softone: { connected: true, lastSyncError: '   ' },
        opencart: { connected: true, lastSyncError: 'page cap (12000+ products) — run sync again' },
      },
      NOW
    );
    expect(out).toEqual([{ id: 'google_ads', name: 'Google Ads', error: 'HTTP 400' }]);
  });

  it('drops stale errors (>48h) but keeps errors without a timestamp', () => {
    const out = collectConnectorSyncErrors(
      {
        ga4: { connected: true, lastSyncError: 'stale', lastSyncErrorAt: ts(72 * 3600_000) },
        magento: { connected: true, lastSyncError: 'no timestamp' },
      },
      NOW
    );
    expect(out).toEqual([{ id: 'magento', name: 'Magento', error: 'no timestamp' }]);
  });
});
