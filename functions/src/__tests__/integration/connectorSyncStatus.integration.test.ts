/** PER-288: lastSyncError set/clear shape on connectors/{brandId} against the Firestore emulator. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';

import { persistConnectorSyncError, CONNECTOR_DOC_KEY } from '../../connectorSyncStatus';

const BRAND = 'sync-status-test-brand';
let db: admin.firestore.Firestore;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-test' });
  db = admin.firestore();
});

beforeEach(async () => {
  await db.doc(`connectors/${BRAND}`).set({
    google_ads: { connected: true, customerId: '123' },
  });
});

describe('persistConnectorSyncError', () => {
  it('sets lastSyncError without clobbering sibling connector fields', async () => {
    await persistConnectorSyncError(BRAND, 'google_ads', 'HTTP 400: bad geo query');
    const d = (await db.doc(`connectors/${BRAND}`).get()).data()!;
    expect(d.google_ads.lastSyncError).toBe('HTTP 400: bad geo query');
    expect(d.google_ads.lastSyncErrorAt).toBeTruthy();
    expect(d.google_ads.connected).toBe(true);
    expect(d.google_ads.customerId).toBe('123');
  });

  it('clears lastSyncError on success', async () => {
    await persistConnectorSyncError(BRAND, 'google_ads', 'boom');
    await persistConnectorSyncError(BRAND, 'google_ads', null);
    const d = (await db.doc(`connectors/${BRAND}`).get()).data()!;
    expect(d.google_ads.lastSyncError).toBeUndefined();
    expect(d.google_ads.lastSyncErrorAt).toBeUndefined();
    expect(d.google_ads.connected).toBe(true);
  });

  it('truncates long errors to 500 chars', async () => {
    await persistConnectorSyncError(BRAND, 'meta', 'x'.repeat(2000));
    const d = (await db.doc(`connectors/${BRAND}`).get()).data()!;
    expect(d.meta.lastSyncError).toHaveLength(500);
  });

  it('label map covers all 14 nightly-wave connectors', () => {
    expect(Object.keys(CONNECTOR_DOC_KEY)).toHaveLength(14);
    expect(CONNECTOR_DOC_KEY['Epsilon Net']).toBe('epsilon_net');
  });
});
