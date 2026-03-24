/**
 * Google Ads API Connector
 *
 * Flow:
 * 1. User clicks "Connect Google Ads" → redirected to Google OAuth
 * 2. Google redirects back with auth code → exchanged for refresh_token
 * 3. Tokens stored in Firestore (connectors/{brandId})
 * 4. Scheduled function uses refresh_token to pull campaign data daily
 *
 * Required secrets:
 * - GOOGLE_ADS_CLIENT_ID
 * - GOOGLE_ADS_CLIENT_SECRET
 * - GOOGLE_ADS_DEVELOPER_TOKEN
 * - GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC)
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

const GOOGLE_ADS_API_VERSION = 'v18';
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = ['https://www.googleapis.com/auth/adwords'];

function getCredentials() {
  return {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
  };
}

export interface GoogleAdsCustomer {
  id: string;
  name: string;
  resourceName: string;
}

/**
 * Generate the OAuth consent URL for Google Ads
 */
export function getGoogleAdsAuthUrl(brandId: string, redirectUri: string): string {
  const { clientId } = getCredentials();
  const state = Buffer.from(JSON.stringify({ brandId, provider: 'google_ads', redirectUri })).toString('base64url');

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

/**
 * Exchange authorization code for tokens and list accessible accounts
 */
export async function handleGoogleAdsCallback(
  code: string,
  brandId: string,
  redirectUri: string
): Promise<{ success: boolean; needsSelection?: boolean; availableAccounts?: GoogleAdsCustomer[]; accessToken?: string; refreshToken?: string; error?: string }> {
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
      logger.error('[GoogleAds] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;

    // List accessible customer accounts
    const customers = await listAccessibleCustomers(accessToken);
    logger.info(`[GoogleAds] Found ${customers.length} customers for brand ${brandId}`);

    if (customers.length === 0) {
      // Store tokens anyway — user will enter Customer ID manually
      await getDb().doc(`connectors/${brandId}`).set(
        {
          google_ads: {
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
      return { success: true, needsSelection: true, availableAccounts: [] };
    }

    if (customers.length === 1) {
      // Auto-select single account
      const customer = customers[0];
      await getDb().doc(`connectors/${brandId}`).set(
        {
          google_ads: {
            connected: true,
            refreshToken,
            accessToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            customerId: customer.id,
            customerName: customer.name,
            pendingAccountSelection: false,
            connectedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      logger.info(`[GoogleAds] Auto-connected brand ${brandId} to account ${customer.id}`);
      return { success: true };
    }

    // Multiple accounts — store tokens + pending flag, return accounts list
    await getDb().doc(`connectors/${brandId}`).set(
      {
        google_ads: {
          connected: false,
          refreshToken,
          accessToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: customers,
          connectedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    return { success: true, needsSelection: true, availableAccounts: customers, accessToken, refreshToken };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[GoogleAds] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Select a specific Google Ads customer account for a brand
 */
export async function selectGoogleAdsAccount(brandId: string, customerId: string, customerName: string): Promise<void> {
  await getDb().doc(`connectors/${brandId}`).set(
    {
      google_ads: {
        connected: true,
        customerId,
        customerName,
        pendingAccountSelection: false,
        availableAccounts: FieldValue.delete(),
      },
    },
    { merge: true }
  );
  logger.info(`[GoogleAds] Account selected for brand ${brandId}: ${customerId}`);
}

/**
 * List accessible Google Ads customer accounts with names
 */
async function listAccessibleCustomers(accessToken: string): Promise<GoogleAdsCustomer[]> {
  const { developerToken, loginCustomerId } = getCredentials();

  try {
    // Get resource names
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    const res = await fetch(`${GOOGLE_ADS_BASE_URL}/customers:listAccessibleCustomers`, { headers });

    if (!res.ok) {
      logger.warn('[GoogleAds] listAccessibleCustomers failed:', res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const resourceNames: string[] = data.resourceNames || [];
    const customerIds = resourceNames.map((rn: string) => rn.replace('customers/', ''));

    if (customerIds.length === 0) return [];

    // Fetch names via GAQL for each customer
    const customers: GoogleAdsCustomer[] = [];
    for (const cid of customerIds) {
      try {
        const infoRes = await fetch(
          `${GOOGLE_ADS_BASE_URL}/customers/${cid}/googleAds:search`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'login-customer-id': loginCustomerId || cid },
            body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }),
          }
        );
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const row = infoData.results?.[0];
          customers.push({
            id: cid,
            name: row?.customer?.descriptiveName || `Account ${cid}`,
            resourceName: `customers/${cid}`,
          });
        } else {
          customers.push({ id: cid, name: `Account ${cid}`, resourceName: `customers/${cid}` });
        }
      } catch {
        customers.push({ id: cid, name: `Account ${cid}`, resourceName: `customers/${cid}` });
      }
    }

    return customers;
  } catch {
    return [];
  }
}

/**
 * Refresh the access token using the stored refresh token
 */
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
    logger.error('[GoogleAds] Token refresh failed:', res.status);
    return null;
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Fetch campaign performance data from Google Ads API (last 365 days)
 */
export async function fetchGoogleAdsCampaigns(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const { developerToken, loginCustomerId } = getCredentials();

  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.google_ads;

  if (!connector?.connected || !connector?.refreshToken) {
    return { success: false, imported: 0, error: 'Google Ads not connected' };
  }

  if (!connector?.customerId) {
    return { success: false, imported: 0, error: 'No customer account selected' };
  }

  const accessToken = await refreshAccessToken(connector.refreshToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Failed to refresh token' };
  }

  const customerId: string = connector.customerId;

  // Build last 365 days date range
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 365);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = now.toISOString().slice(0, 10);

  const gaqlQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.conversions,
      metrics.cost_micros,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  let totalImported = 0;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
      'login-customer-id': loginCustomerId || customerId,
    };

    let nextPageToken: string | undefined;
    const campaignMap = new Map<string, any>();

    do {
      const body: Record<string, any> = { query: gaqlQuery, pageSize: 1000 };
      if (nextPageToken) body.pageToken = nextPageToken;

      const res = await fetch(
        `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[GoogleAds] Query failed for ${customerId} (${res.status}):`, errText);
        let detail = errText;
        try {
          const parsed = JSON.parse(errText);
          detail = parsed?.error?.message || parsed?.error?.status || errText;
        } catch { /* keep raw text */ }
        return { success: false, imported: 0, error: `Google Ads ${res.status}: ${detail.slice(0, 200)}` };
      }

      const page = await res.json();
      nextPageToken = page.nextPageToken;

      for (const row of page.results || []) {
        const campaignId = row.campaign?.id;
        const campaignName = row.campaign?.name;
        if (!campaignId || !campaignName) continue;

        const existing = campaignMap.get(campaignId) || {
          id: `gads_${customerId}_${campaignId}`,
          name: campaignName,
          channel: 'Google Ads',
          status: (row.campaign?.status || 'ENABLED').toLowerCase(),
          impressions: 0,
          clicks: 0,
          conversions: 0,
          amount_spent: 0,
          conversion_value: 0,
          ctr: 0,
          roas: 0,
          period: 'Last 365 days',
          brandId,
        };

        existing.impressions += parseInt(row.metrics?.impressions || '0', 10);
        existing.clicks += parseInt(row.metrics?.clicks || '0', 10);
        existing.conversions += parseFloat(row.metrics?.conversions || '0');
        existing.amount_spent += parseInt(row.metrics?.costMicros || '0', 10) / 1_000_000;
        existing.conversion_value += parseFloat(row.metrics?.conversionsValue || '0');

        campaignMap.set(campaignId, existing);
      }
    } while (nextPageToken);

    const batch = getDb().batch();
    let count = 0;

    for (const [, campaign] of campaignMap) {
      campaign.ctr = campaign.impressions > 0
        ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100
        : 0;
      campaign.roas = campaign.amount_spent > 0
        ? Math.round((campaign.conversion_value / campaign.amount_spent) * 100) / 100
        : 0;
      campaign.amount_spent = Math.round(campaign.amount_spent * 100) / 100;
      campaign.createdAt = FieldValue.serverTimestamp();
      campaign.updatedAt = FieldValue.serverTimestamp();

      const ref = getDb().collection('campaigns').doc(campaign.id);
      batch.set(ref, campaign, { merge: true });
      count++;
    }

    if (count > 0) {
      await batch.commit();
      totalImported = count;
      logger.info(`[GoogleAds] Imported ${count} campaigns for customer ${customerId}`);
    }
  } catch (err) {
    logger.error(`[GoogleAds] Error for customer ${customerId}:`, err);
    return { success: false, imported: 0, error: String(err) };
  }

  // Log import
  await getDb().collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'google_ads_api',
    status: 'completed',
    imported: totalImported,
    failed: 0,
    errors: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, imported: totalImported };
}
