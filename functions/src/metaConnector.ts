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
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore | null = null;

function getDb(): Firestore {
  if (!_db) {
    _db = admin.firestore();
  }
  return _db;
}

export function setDb(db: Firestore) {
  _db = db;
}

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';
const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';

const SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
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
  const state = Buffer.from(JSON.stringify({ brandId, provider: 'meta', redirectUri })).toString('base64url');

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  return `${META_AUTH_URL}?${params.toString()}`;
}

export interface AdAccount { id: string; name: string; }

export interface MetaCallbackData {
  accessToken: string;
  expiresIn: number;
  availableAccounts: AdAccount[];
  needsSelection: boolean;
}

/**
 * Exchange authorization code for tokens and return data (caller handles Firestore write)
 */
export async function handleMetaCallback(
  code: string,
  redirectUri: string
): Promise<{ success: boolean; data?: MetaCallbackData; error?: string }> {
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

    // Step 3: Get all accessible ad accounts
    const adAccounts = await listAdAccounts(longToken);
    logger.info(`[Meta] Got ${adAccounts.length} ad accounts`);

    return {
      success: true,
      data: {
        accessToken: longToken,
        expiresIn: expires_in || 5184000,
        availableAccounts: adAccounts,
        needsSelection: adAccounts.length > 1,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Meta] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Confirm the selected ad account for this brand
 */
export async function selectMetaAccount(
  brandId: string,
  accountId: string,
  accountName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getDb().doc(`connectors/${brandId}`).set(
      {
        meta: {
          connected: true,
          pendingAccountSelection: false,
          adAccountIds: [accountId],
          adAccountNames: [accountName],
        },
      },
      { merge: true }
    );
    logger.info(`[Meta] Account selected for brand ${brandId}: ${accountId}`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
    logger.info('[Meta] listAdAccounts raw:', JSON.stringify(data.data?.slice(0, 3)));
    return (data.data || [])
      .filter((a: any) => Number(a.account_status) !== 2) // exclude disabled (status=2); accept all others
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
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
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
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const sinceStr = since.toISOString().split('T')[0];
      const untilStr = new Date().toISOString().split('T')[0];

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
        time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
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
      const batch = getDb().batch();
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
          period: 'Last 365 days',
          brandId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        const ref = getDb().collection('campaigns').doc(campaign.id);
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
  await getDb().collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'meta_api',
    status: 'completed',
    imported: totalImported,
    failed: 0,
    errors: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, imported: totalImported };
}
