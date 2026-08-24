import { SERVER_TRIGGERS } from '../../serverAlerts';

const evaluate = SERVER_TRIGGERS.sync_failure_alert.evaluate;

describe('sync_failure_alert (PER-193)', () => {
  it('fires only for connected connectors with lastSyncError', () => {
    const alert = evaluate(0, null, null, null, {
      meta: { connected: true, lastSyncError: 'Meta token expired — reconnect required' },
      ga4: { connected: false, lastSyncError: 'GA4 not connected' },
      megaventory: { connected: true },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe('critical');
    expect(alert!.title).toBe('Αποτυχία συγχρονισμού: Meta');
    expect(alert!.description).toBe('Meta: Η σύνδεση έληξε — χρειάζεται επανασύνδεση');
    expect(alert!.data.failing).toEqual([{ id: 'meta', label: 'Meta', error: 'Meta token expired — reconnect required' }]);
  });

  it('returns null when no connected connector has an error', () => {
    expect(evaluate(0, null, null, null, { meta: { connected: true } })).toBeNull();
    expect(evaluate(0, null, null, null, null)).toBeNull();
  });
});
