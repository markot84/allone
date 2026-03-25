/**
 * Google Merchant Center Connector
 *
 * Reuses Google OAuth (same client_id/secret as Google Ads) with
 * additional scope: https://www.googleapis.com/auth/content
 *
 * Fetches PriceCompetitivenessProductView to get benchmark prices
 * per GTIN, enabling SKU-level price comparison vs market.
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

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const MERCHANT_API_BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';

const SCOPES = [
  'https://www.googleapis.com/auth/content',
];

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    clientId: raw(process.env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: raw(process.env.GOOGLE_ADS_CLIENT_SECRET),
  };
}

export function getMerchantAuthUrl(brandId: string, redirectUri: string): string {
  const { clientId } = getCredentials();
  const state = Buffer.from(
    JSON.stringify({ brandId, provider: 'merchant', redirectUri })
  ).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function handleMerchantCallback(
  code: string,
  brandId: string,
  redirectUri: string
): Promise<{ success: boolean; error?: string }> {
  const { clientId, clientSecret } = getCredentials();

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error('[Merchant] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;

    const accounts = await listMerchantAccounts(accessToken);
    logger.info(`[Merchant] Found ${accounts.length} accounts for brand ${brandId}`);

    if (accounts.length === 0) {
      await getDb().doc(`connectors/${brandId}`).set(
        {
          merchant: {
            connected: false,
            refreshToken,
            accessToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            pendingAccountSelection: true,
            availableAccounts: [],
            connectedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    if (accounts.length === 1) {
      await getDb().doc(`connectors/${brandId}`).set(
        {
          merchant: {
            connected: true,
            refreshToken,
            accessToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            merchantId: accounts[0].id,
            merchantName: accounts[0].name,
            pendingAccountSelection: false,
            connectedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    await getDb().doc(`connectors/${brandId}`).set(
      {
        merchant: {
          connected: false,
          refreshToken,
          accessToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: accounts,
          connectedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Merchant] Callback error:', msg);
    return { success: false, error: msg };
  }
}

export async function selectMerchantAccount(
  brandId: string,
  merchantId: string,
  merchantName: string
): Promise<void> {
  await getDb().doc(`connectors/${brandId}`).set(
    {
      merchant: {
        connected: true,
        merchantId,
        merchantName,
        pendingAccountSelection: false,
        availableAccounts: FieldValue.delete(),
      },
    },
    { merge: true }
  );
  logger.info(`[Merchant] Account selected for brand ${brandId}: ${merchantId}`);
}

async function listMerchantAccounts(
  accessToken: string
): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch(`${MERCHANT_API_BASE}/accounts/authinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      logger.warn('[Merchant] authinfo failed:', res.status);
      return [];
    }

    const data = await res.json();
    const accountIds: { merchantId: string }[] = data.accountIdentifiers || [];

    const accounts: { id: string; name: string }[] = [];
    for (const entry of accountIds) {
      const mid = entry.merchantId;
      if (!mid) continue;
      try {
        const accRes = await fetch(`${MERCHANT_API_BASE}/${mid}/accounts/${mid}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (accRes.ok) {
          const accData = await accRes.json();
          accounts.push({ id: mid, name: accData.name || `Account ${mid}` });
        } else {
          accounts.push({ id: mid, name: `Account ${mid}` });
        }
      } catch {
        accounts.push({ id: mid, name: `Account ${mid}` });
      }
    }
    return accounts;
  } catch {
    return [];
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    logger.error(`[Merchant] Token refresh failed (${res.status})`);
    return null;
  }

  const data = await res.json();
  return data.access_token || null;
}

/**
 * Fetch price benchmarks from Google Merchant Center.
 * Uses the Content API reports endpoint with PriceCompetitivenessProductView.
 */
export async function fetchPriceBenchmarks(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.merchant;

  if (!connector?.connected || !connector?.refreshToken) {
    return { success: false, imported: 0, error: 'Merchant Center not connected' };
  }

  const merchantId = connector.merchantId;
  if (!merchantId) {
    return { success: false, imported: 0, error: 'No Merchant Center account selected' };
  }

  const accessToken = await refreshAccessToken(connector.refreshToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Failed to refresh token' };
  }

  try {
    const query = `
      SELECT
        product_view.id,
        product_view.title,
        product_view.gtin,
        product_view.price.amount_micros,
        product_view.price.currency_code,
        price_competitiveness.country_code,
        price_competitiveness.benchmark_price.amount_micros,
        price_competitiveness.benchmark_price.currency_code
      FROM PriceCompetitivenessProductView
    `;

    const url = `${MERCHANT_API_BASE}/${merchantId}/reports/search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`[Merchant] Reports query failed (${res.status}): ${errText.slice(0, 500)}`);
      return { success: false, imported: 0, error: `Merchant API ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const results = data.results || [];
    logger.info(`[Merchant] Got ${results.length} price benchmark rows for ${merchantId}`);

    if (results.length === 0) {
      return { success: true, imported: 0 };
    }

    const batch = getDb().batch();
    let count = 0;

    for (const row of results) {
      const productId = row.productView?.id;
      const gtin = row.productView?.gtin;
      if (!productId) continue;

      const yourPriceMicros = parseInt(row.productView?.price?.amountMicros || '0', 10);
      const benchmarkMicros = parseInt(row.priceCompetitiveness?.benchmarkPrice?.amountMicros || '0', 10);
      const yourPrice = yourPriceMicros / 1_000_000;
      const benchmarkPrice = benchmarkMicros / 1_000_000;
      const priceDiff = benchmarkPrice > 0
        ? Math.round(((yourPrice - benchmarkPrice) / benchmarkPrice) * 1000) / 10
        : 0;

      const docId = productId.replace(/[/\\:]/g, '_');
      const ref = getDb()
        .collection('price_benchmarks')
        .doc(brandId)
        .collection('skus')
        .doc(docId);

      batch.set(ref, {
        productId,
        title: row.productView?.title || '',
        gtin: gtin || '',
        yourPrice,
        benchmarkPrice,
        priceDiff,
        currency: row.productView?.price?.currencyCode || 'EUR',
        country: row.priceCompetitiveness?.countryCode || 'GR',
        updatedAt: new Date().toISOString(),
      });
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }

    logger.info(`[Merchant] Imported ${count} price benchmarks for brand ${brandId}`);

    await getDb().collection('import_jobs').add({
      brandId,
      type: 'price_benchmarks',
      source: 'merchant_center_api',
      status: 'completed',
      imported: count,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, imported: count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Merchant] Error:`, msg);
    return { success: false, imported: 0, error: msg };
  }
}
