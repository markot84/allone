/**
 * WooCommerce Connector — Phase 1: Infrastructure Only
 *
 * Flow:
 * 1. User enters Store URL + Consumer Key + Consumer Secret
 * 2. We validate with a test API call (GET /wp-json/wc/v3/system_status)
 * 3. Credentials stored in Firestore (connectors/{brandId}.woocommerce)
 * 4. Data sync is stubbed — pending GDPR review
 *
 * No OAuth redirect needed — WooCommerce uses REST API keys.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

/**
 * Validate WooCommerce credentials and save them
 */
export async function saveWooCredentials(
  brandId: string,
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ success: boolean; shopName?: string; error?: string }> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  const testResult = await testWooConnection(normalizedUrl, consumerKey, consumerSecret);

  if (!testResult.success) {
    return { success: false, error: testResult.error };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      woocommerce: {
        connected: true,
        storeUrl: normalizedUrl,
        shopName: testResult.shopName || normalizedUrl,
        wooVersion: testResult.version || '',
        consumerKey,
        consumerSecret,
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[WooCommerce] Connected brand ${brandId} to store ${normalizedUrl}`);
  return { success: true, shopName: testResult.shopName };
}

/**
 * Test WooCommerce REST API connection
 */
export async function testWooConnection(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ success: boolean; shopName?: string; version?: string; error?: string }> {
  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const endpoint = `${storeUrl}/wp-json/wc/v3/system_status`;

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: 'Invalid credentials (Consumer Key or Secret)' };
      }
      if (res.status === 404) {
        return { success: false, error: 'WooCommerce REST API not found. Verify the store URL and that WooCommerce is installed.' };
      }
      const errText = await res.text();
      return { success: false, error: `Connection failed (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const environment = data.environment || {};
    const shopName = environment.site_title || environment.home_url || storeUrl;
    const version = data.version || environment.version || '';

    logger.info(`[WooCommerce] Connection test OK — shop: ${shopName}, WC version: ${version}`);
    return { success: true, shopName, version };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[WooCommerce] Connection test failed:', msg);
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { success: false, error: 'Store URL not reachable. Check the domain.' };
    }
    return { success: false, error: msg };
  }
}

/**
 * Fetch WooCommerce data — STUB (pending GDPR review)
 */
export async function fetchWooCommerceData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.woocommerce;

  if (!connector?.connected || !connector?.consumerKey) {
    return { success: false, imported: 0, error: 'WooCommerce not connected' };
  }

  logger.info(`[WooCommerce] Sync requested for brand ${brandId} — stub only (GDPR pending)`);

  return {
    success: true,
    imported: 0,
    message: 'WooCommerce sync infrastructure ready. Data fetching will be enabled after GDPR review.',
  };
}

/**
 * Normalize store URL to https://domain format
 */
function normalizeStoreUrl(input: string): string {
  let url = input.trim();
  url = url.replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url;
}
