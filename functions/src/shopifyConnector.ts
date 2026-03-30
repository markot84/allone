/**
 * Shopify Connector — Phase 1: Infrastructure Only
 *
 * Flow:
 * 1. User enters shop domain → redirected to Shopify OAuth
 * 2. Shopify redirects back with auth code → exchanged for permanent access token
 * 3. Token stored in Firestore (connectors/{brandId}.shopify)
 * 4. Data sync is stubbed — pending GDPR review
 *
 * Required secrets:
 * - SHOPIFY_API_KEY
 * - SHOPIFY_API_SECRET
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

const SHOPIFY_API_VERSION = '2024-01';

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    apiKey: raw(process.env.SHOPIFY_API_KEY),
    apiSecret: raw(process.env.SHOPIFY_API_SECRET),
  };
}

const SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_inventory',
].join(',');

/**
 * Generate the OAuth consent URL for Shopify
 */
export function getShopifyAuthUrl(
  brandId: string,
  shopDomain: string,
  redirectUri: string
): string {
  const { apiKey } = getCredentials();
  const normalizedDomain = normalizeShopDomain(shopDomain);

  const state = Buffer.from(
    JSON.stringify({ brandId, provider: 'shopify', redirectUri, shopDomain: normalizedDomain })
  ).toString('base64url');

  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${normalizedDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for a permanent access token
 */
export async function handleShopifyCallback(
  code: string,
  brandId: string,
  shopDomain: string
): Promise<{ success: boolean; error?: string }> {
  const { apiKey, apiSecret } = getCredentials();
  const normalizedDomain = normalizeShopDomain(shopDomain);

  try {
    const res = await fetch(
      `https://${normalizedDomain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: apiKey,
          client_secret: apiSecret,
          code,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      logger.error('[Shopify] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const data = await res.json();
    const accessToken: string = data.access_token;
    const scope: string = data.scope || '';

    // Fetch shop info for display
    let shopName = normalizedDomain;
    try {
      const shopRes = await fetch(
        `https://${normalizedDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        shopName = shopData.shop?.name || normalizedDomain;
      }
    } catch {
      logger.warn('[Shopify] Could not fetch shop name, using domain');
    }

    await getDb().doc(`connectors/${brandId}`).set(
      {
        shopify: {
          connected: true,
          shopDomain: normalizedDomain,
          shopName,
          accessToken,
          scope,
          connectedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    logger.info(`[Shopify] Connected brand ${brandId} to shop ${normalizedDomain}`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Shopify] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Fetch Shopify data — STUB (pending GDPR review)
 */
export async function fetchShopifyData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.shopify;

  if (!connector?.connected || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Shopify not connected' };
  }

  logger.info(`[Shopify] Sync requested for brand ${brandId} — stub only (GDPR pending)`);

  return {
    success: true,
    imported: 0,
    message: 'Shopify sync infrastructure ready. Data fetching will be enabled after GDPR review.',
  };
}

/**
 * Normalize shop domain to {store}.myshopify.com format
 */
function normalizeShopDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/\/+$/, '');
  if (!domain.includes('.')) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}
