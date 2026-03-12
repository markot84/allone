/**
 * Google Ads API Connector
 *
 * Flow:
 * 1. User clicks "Connect Google Ads" → redirected to Google OAuth
 * 2. Google redirects back with auth code → exchanged for refresh_token
 * 3. Tokens stored in Firestore (connectors/{brandId}/google_ads)
 * 4. Scheduled function uses refresh_token to pull campaign data daily
 *
 * Required secrets (set via Firebase env config):
 * - GOOGLE_ADS_CLIENT_ID
 * - GOOGLE_ADS_CLIENT_SECRET
 * - GOOGLE_ADS_DEVELOPER_TOKEN
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

function getDb() {
  return admin.firestore();
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
  };
}

/**
 * Generate the OAuth consent URL for Google Ads
 */
export function getGoogleAdsAuthUrl(brandId: string, redirectUri: string): string {
  const { clientId } = getCredentials();
  const state = Buffer.from(JSON.stringify({ brandId, provider: 'google_ads' })).toString('base64url');

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
 * Exchange authorization code for tokens and store them
 */
export async function handleGoogleAdsCallback(
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
      logger.error('[GoogleAds] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json();

    // Get customer accounts accessible with this token
    const customers = await listAccessibleCustomers(tokens.access_token);

    await getDb().doc(`connectors/${brandId}`).set(
      {
        google_ads: {
          connected: true,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          customerIds: customers,
          connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    logger.info(`[GoogleAds] Connected for brand ${brandId}, ${customers.length} customer accounts`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[GoogleAds] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * List accessible Google Ads customer accounts
 */
async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const { developerToken } = getCredentials();
  try {
    const res = await fetch(`${GOOGLE_ADS_BASE_URL}/customers:listAccessibleCustomers`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
    });

    if (!res.ok) {
      logger.warn('[GoogleAds] listAccessibleCustomers failed:', res.status);
      return [];
    }

    const data = await res.json();
    return (data.resourceNames || []).map((rn: string) => rn.replace('customers/', ''));
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
 * Fetch campaign performance data from Google Ads API
 */
export async function fetchGoogleAdsCampaigns(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const { developerToken } = getCredentials();

  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.google_ads;

  if (!connector?.connected || !connector?.refreshToken) {
    return { success: false, imported: 0, error: 'Google Ads not connected' };
  }

  const accessToken = await refreshAccessToken(connector.refreshToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Failed to refresh token' };
  }

  const customerIds: string[] = connector.customerIds || [];
  if (customerIds.length === 0) {
    return { success: false, imported: 0, error: 'No customer accounts found' };
  }

  let totalImported = 0;

  for (const customerId of customerIds) {
    try {
      const query = `
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
          metrics.conversions_value,
          segments.date
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `;

      const res = await fetch(
        `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:searchStream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'Content-Type': 'application/json',
            'login-customer-id': customerId,
          },
          body: JSON.stringify({ query }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[GoogleAds] Query failed for ${customerId}:`, errText);
        continue;
      }

      const results = await res.json();
      const campaignMap = new Map<string, any>();

      for (const batch of results) {
        for (const row of batch.results || []) {
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
            period: 'Last 30 days',
            brandId,
          };

          existing.impressions += parseInt(row.metrics?.impressions || '0', 10);
          existing.clicks += parseInt(row.metrics?.clicks || '0', 10);
          existing.conversions += parseFloat(row.metrics?.conversions || '0');
          existing.amount_spent += parseInt(row.metrics?.cost_micros || '0', 10) / 1_000_000;
          existing.conversion_value += parseFloat(row.metrics?.conversions_value || '0');

          campaignMap.set(campaignId, existing);
        }
      }

      // Calculate CTR and ROAS, then write to Firestore
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
        campaign.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const ref = getDb().collection('campaigns').doc(campaign.id);
        batch.set(ref, campaign, { merge: true });
        count++;
      }

      if (count > 0) {
        await batch.commit();
        totalImported += count;
        logger.info(`[GoogleAds] Imported ${count} campaigns for customer ${customerId}`);
      }
    } catch (err) {
      logger.error(`[GoogleAds] Error for customer ${customerId}:`, err);
    }
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, imported: totalImported };
}
