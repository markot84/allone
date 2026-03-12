/**
 * Meta (Facebook/Instagram) Marketing API Connector
 *
 * Flow:
 * 1. User clicks "Connect Meta" → redirected to Facebook Login
 * 2. Facebook redirects back with auth code → exchanged for long-lived token
 * 3. Token stored in Firestore (connectors/{brandId}/meta)
 * 4. Scheduled function uses token to pull campaign insights daily
 *
 * Required secrets:
 * - META_APP_ID
 * - META_APP_SECRET
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';
const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';

const SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
  'read_insights',
].join(',');

function getCredentials() {
  return {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
  };
}

/**
 * Generate the OAuth consent URL for Meta
 */
export function getMetaAuthUrl(brandId: string, redirectUri: string): string {
  const { appId } = getCredentials();
  const state = Buffer.from(JSON.stringify({ brandId, provider: 'meta' })).toString('base64url');

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  return `${META_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for long-lived token and store it
 */
export async function handleMetaCallback(
  code: string,
  brandId: string,
  redirectUri: string
): Promise<{ success: boolean; error?: string }> {
  const { appId, appSecret } = getCredentials();

  try {
    // Step 1: Exchange code for short-lived token
    const tokenRes = await fetch(
      `${META_GRAPH_URL}/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        })
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error('[Meta] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${tokenRes.status}` };
    }

    const { access_token: shortToken } = await tokenRes.json();

    // Step 2: Exchange for long-lived token (~60 days)
    const longRes = await fetch(
      `${META_GRAPH_URL}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        })
    );

    if (!longRes.ok) {
      logger.error('[Meta] Long-lived token exchange failed:', longRes.status);
      return { success: false, error: 'Failed to get long-lived token' };
    }

    const { access_token: longToken, expires_in } = await longRes.json();

    // Step 3: Get ad accounts
    const adAccounts = await listAdAccounts(longToken);

    // Step 4: Store in Firestore
    await db.doc(`connectors/${brandId}`).set(
      {
        meta: {
          connected: true,
          accessToken: longToken,
          expiresAt: Date.now() + (expires_in || 5184000) * 1000,
          adAccountIds: adAccounts.map((a) => a.id),
          adAccountNames: adAccounts.map((a) => a.name),
          connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    logger.info(`[Meta] Connected for brand ${brandId}, ${adAccounts.length} ad accounts`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Meta] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * List ad accounts accessible with the token
 */
async function listAdAccounts(accessToken: string): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch(
      `${META_GRAPH_URL}/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`
    );

    if (!res.ok) return [];

    const data = await res.json();
    return (data.data || [])
      .filter((a: any) => a.account_status === 1) // only active accounts
      .map((a: any) => ({ id: a.id, name: a.name || a.id }));
  } catch {
    return [];
  }
}

/**
 * Fetch campaign insights from Meta Marketing API
 */
export async function fetchMetaCampaigns(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.meta;

  if (!connector?.connected || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Meta not connected' };
  }

  // Check token expiry
  if (connector.expiresAt && connector.expiresAt < Date.now()) {
    return { success: false, imported: 0, error: 'Meta token expired — reconnect required' };
  }

  const adAccountIds: string[] = connector.adAccountIds || [];
  if (adAccountIds.length === 0) {
    return { success: false, imported: 0, error: 'No ad accounts found' };
  }

  let totalImported = 0;
  const accessToken = connector.accessToken;

  for (const accountId of adAccountIds) {
    try {
      const params = new URLSearchParams({
        fields: [
          'campaign_name',
          'campaign_id',
          'impressions',
          'clicks',
          'ctr',
          'spend',
          'actions',
          'action_values',
          'reach',
          'frequency',
        ].join(','),
        date_preset: 'last_30d',
        level: 'campaign',
        access_token: accessToken,
      });

      const res = await fetch(`${META_GRAPH_URL}/${accountId}/insights?${params}`);

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[Meta] Insights failed for ${accountId}:`, errText);
        continue;
      }

      const data = await res.json();
      const batch = db.batch();
      let count = 0;

      for (const row of data.data || []) {
        const campaignId = row.campaign_id;
        const campaignName = row.campaign_name;
        if (!campaignId || !campaignName) continue;

        // Extract purchase/conversion actions
        const purchases = (row.actions || []).find(
          (a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
        );
        const purchaseValue = (row.action_values || []).find(
          (a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase'
        );

        const conversions = parseFloat(purchases?.value || '0');
        const conversionValue = parseFloat(purchaseValue?.value || '0');
        const spend = parseFloat(row.spend || '0');

        const campaign = {
          id: `meta_${accountId}_${campaignId}`,
          name: campaignName,
          channel: 'Meta',
          status: 'active',
          impressions: parseInt(row.impressions || '0', 10),
          clicks: parseInt(row.clicks || '0', 10),
          ctr: parseFloat((row.ctr || '0').replace('%', '')),
          conversions,
          amount_spent: Math.round(spend * 100) / 100,
          roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
          reach: parseInt(row.reach || '0', 10),
          frequency: parseFloat(row.frequency || '0'),
          period: 'Last 30 days',
          brandId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const ref = db.collection('campaigns').doc(campaign.id);
        batch.set(ref, campaign, { merge: true });
        count++;
      }

      if (count > 0) {
        await batch.commit();
        totalImported += count;
        logger.info(`[Meta] Imported ${count} campaigns for account ${accountId}`);
      }
    } catch (err) {
      logger.error(`[Meta] Error for account ${accountId}:`, err);
    }
  }

  // Log import
  await db.collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'meta_api',
    status: 'completed',
    imported: totalImported,
    failed: 0,
    errors: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, imported: totalImported };
}
