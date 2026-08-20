/** PER-192/PER-288 — persist per-connector nightly sync errors so the UI (ConnectorsPanel lastSyncError) can show them. */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';

/** Nightly-wave display label → connectors/{brandId} doc key. */
export const CONNECTOR_DOC_KEY: Record<string, string> = {
  'Google Ads': 'google_ads',
  Meta: 'meta',
  TikTok: 'tiktok',
  Merchant: 'merchant',
  GA4: 'ga4',
  'Search Console': 'search_console',
  Shopify: 'shopify',
  WooCommerce: 'woocommerce',
  OpenCart: 'opencart',
  Magento: 'magento',
  Megaventory: 'megaventory',
  SoftOne: 'softone',
  'Epsilon Net': 'epsilon_net',
  Entersoft: 'entersoft',
};

/** Set (error string) or clear (null) {key}.lastSyncError on the brand's connector doc. Non-fatal. */
export async function persistConnectorSyncError(brandId: string, key: string, error: string | null): Promise<void> {
  try {
    await admin.firestore().doc(`connectors/${brandId}`).set(
      {
        [key]: error
          ? { lastSyncError: error.slice(0, 500), lastSyncErrorAt: FieldValue.serverTimestamp() }
          : { lastSyncError: FieldValue.delete(), lastSyncErrorAt: FieldValue.delete() },
      },
      { merge: true }
    );
  } catch (e) {
    logger.warn(`[ScheduledSync] failed to persist lastSyncError for ${brandId}.${key}:`, { err: e });
  }
}
