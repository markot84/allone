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

/**
 * Generate array of { since, until } for each calendar month in the range.
 * Uses string manipulation to avoid timezone issues.
 */
function generateMonthRanges(sinceStr: string, untilStr: string): Array<{ since: string; until: string }> {
  const ranges: Array<{ since: string; until: string }> = [];
  const [sy, sm] = sinceStr.split('-').map(Number);
  const [ey, em] = untilStr.split('-').map(Number);

  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const since = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
    const until = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    ranges.push({ since, until });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return ranges;
}

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

  // Delete existing Meta campaigns before re-importing to avoid stale data
  const existingSnap = await getDb().collection('campaigns')
    .where('brandId', '==', brandId)
    .where('channel', '==', 'Meta')
    .get();
  if (!existingSnap.empty) {
    const delBatch = getDb().batch();
    existingSnap.docs.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();
    logger.info(`[Meta] Deleted ${existingSnap.size} stale Meta campaigns for brand ${brandId} before re-import`);
  }

  let totalImported = 0;
  const accessToken = connector.accessToken;

  for (const accountId of adAccountIds) {
    try {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 3);
      const sinceStr = since.toISOString().split('T')[0];
      const untilStr = new Date().toISOString().split('T')[0];

      // Fetch data per-month (individual API call per calendar month).
      // time_increment=monthly is unreliable (some accounts silently ignore it),
      // so we make explicit per-month calls for accurate date-range filtering.
      const allRows: any[] = [];
      const usedFallback = false;
      const monthRanges = generateMonthRanges(sinceStr, untilStr);
      const insightsFields = ['campaign_name','campaign_id','impressions','clicks','spend','actions','action_values','reach','frequency'].join(',');

      logger.info(`[Meta] Fetching ${monthRanges.length} months of data for ${accountId}...`);

      for (const mr of monthRanges) {
        try {
          const monthParams = new URLSearchParams({
            fields: insightsFields,
            time_range: JSON.stringify({ since: mr.since, until: mr.until }),
            level: 'campaign',
            limit: '500',
            access_token: accessToken,
          });
          let monthUrl: string | null = `${META_GRAPH_URL}/${accountId}/insights?${monthParams}`;
          let monthPageCount = 0;
          while (monthUrl && monthPageCount < 5) {
            const monthRes: Response = await fetch(monthUrl);
            if (!monthRes.ok) {
              if (monthPageCount === 0) {
                logger.warn(`[Meta] Month ${mr.since} failed for ${accountId}: ${await monthRes.text()}`);
              }
              break;
            }
            const monthData: any = await monthRes.json();
            for (const row of (monthData.data || [])) {
              row.date_start = mr.since;
              allRows.push(row);
            }
            monthUrl = monthData.paging?.next || null;
            monthPageCount++;
          }
        } catch (e) {
          logger.warn(`[Meta] Per-month call failed for ${mr.since}: ${e}`);
        }
      }

      logger.info(`[Meta] Fetched ${allRows.length} total rows across ${monthRanges.length} months for ${accountId}`);

      // Fetch campaign statuses (effective_status) from the Campaigns API
      const campaignStatusMap = new Map<string, string>();
      try {
        let statusUrl: string | null = `${META_GRAPH_URL}/${accountId}/campaigns?fields=id,effective_status&limit=500&access_token=${accessToken}`;
        while (statusUrl) {
          const statusRes: Response = await fetch(statusUrl);
          if (!statusRes.ok) break;
          const statusData: any = await statusRes.json();
          for (const c of (statusData.data || [])) {
            if (c.id && c.effective_status) {
              campaignStatusMap.set(c.id, c.effective_status.toLowerCase());
            }
          }
          statusUrl = statusData.paging?.next || null;
        }
        logger.info(`[Meta] Fetched statuses for ${campaignStatusMap.size} campaigns in ${accountId}`);
      } catch (e) {
        logger.warn(`[Meta] Failed to fetch campaign statuses for ${accountId}: ${e}`);
      }

      // Aggregate monthly rows per campaign, building dailyMetrics map (keyed by month start date)
      const campaignMap = new Map<string, any>();

      for (const row of allRows) {
        const campaignId = row.campaign_id;
        const campaignName = row.campaign_name;
        const rowDate: string = row.date_start || '';
        if (!campaignId || !campaignName) continue;

        // Prefer pixel purchase, then omni/catalog purchase types (Advantage+ often uses omni_purchase).
        const actions = row.actions || [];
        const actionValues = row.action_values || [];
        const purchaseTypes = [
          'offsite_conversion.fb_pixel_purchase',
          'omni_purchase',
          'purchase',
          'offsite_conversion.purchase',
          'onsite_conversion.purchase',
        ];
        let rowConversions = 0;
        let rowConvValue = 0;
        for (const t of purchaseTypes) {
          const a = actions.find((x: any) => x.action_type === t);
          if (!a) continue;
          const cv = parseFloat(a.value || '0');
          if (cv <= 0) continue;
          const av = actionValues.find((x: any) => x.action_type === t);
          rowConversions = cv;
          rowConvValue = parseFloat(av?.value || '0');
          break;
        }
        if (rowConversions === 0) {
          const pixelPurchase = actions.find((x: any) => x.action_type === 'offsite_conversion.fb_pixel_purchase');
          const stdPurchase = actions.find((x: any) => x.action_type === 'purchase');
          const primaryPurchase = pixelPurchase || stdPurchase;
          const pixelPurchaseVal = actionValues.find((x: any) => x.action_type === 'offsite_conversion.fb_pixel_purchase');
          const stdPurchaseVal = actionValues.find((x: any) => x.action_type === 'purchase');
          const primaryPurchaseVal = pixelPurchaseVal || stdPurchaseVal;
          rowConversions = parseFloat(primaryPurchase?.value || '0');
          rowConvValue = parseFloat(primaryPurchaseVal?.value || '0');
        }
        const rowSpend = parseFloat(row.spend || '0');
        const rowImpressions = parseInt(row.impressions || '0', 10);
        const rowClicks = parseInt(row.clicks || '0', 10);

        // Build per-action-type breakdown from this row
        const rowActions: Record<string, { conversions: number; value: number }> = {};
        const actionValueMap: Record<string, number> = {};
        for (const av of (row.action_values || [])) {
          if (av.action_type && av.value) actionValueMap[av.action_type] = parseFloat(av.value);
        }
        for (const action of (row.actions || [])) {
          if (!action.action_type || !action.value) continue;
          const aType = action.action_type as string;
          // Normalize action type names for readability
          let label = aType;
          // Keep pixel vs API/app purchases separate to avoid double-counting
          if (aType === 'offsite_conversion.fb_pixel_purchase') label = 'Purchase (Pixel)';
          else if (aType === 'purchase') label = 'Purchase';
          else if (aType === 'offsite_conversion.fb_pixel_lead' || aType === 'lead') label = 'Lead';
          else if (aType === 'offsite_conversion.fb_pixel_add_to_cart' || aType === 'add_to_cart') label = 'Add to Cart';
          else if (aType === 'offsite_conversion.fb_pixel_initiate_checkout' || aType === 'initiate_checkout') label = 'Initiate Checkout';
          else if (aType === 'offsite_conversion.fb_pixel_view_content' || aType === 'view_content') label = 'View Content';
          else if (aType === 'offsite_conversion.fb_pixel_complete_registration' || aType === 'complete_registration') label = 'Complete Registration';
          else if (aType === 'link_click') label = 'Link Click';
          else if (aType === 'landing_page_view') label = 'Landing Page View';
          else if (aType === 'page_engagement') label = 'Page Engagement';
          else if (aType === 'post_engagement') label = 'Post Engagement';
          else if (aType === 'video_view') label = 'Video View';
          else if (aType.startsWith('offsite_conversion.')) label = aType.replace('offsite_conversion.fb_pixel_', '');

          const convCount = parseFloat(action.value);
          if (!rowActions[label]) rowActions[label] = { conversions: 0, value: 0 };
          rowActions[label].conversions += convCount;
          rowActions[label].value += actionValueMap[aType] || 0;
        }

        const metaStatus = campaignStatusMap.get(campaignId) || 'active';
        const normalizedStatus = metaStatus === 'active' ? 'active'
          : metaStatus === 'paused' ? 'paused'
          : (metaStatus === 'archived' || metaStatus === 'deleted') ? 'completed'
          : metaStatus;
        const existing = campaignMap.get(campaignId) || {
          id: `meta_${accountId}_${campaignId}`,
          name: campaignName,
          channel: 'Meta',
          status: normalizedStatus,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversion_value: 0,
          amount_spent: 0,
          ctr: 0,
          roas: 0,
          reach: 0,
          frequency: 0,
          start_date: sinceStr,
          end_date: untilStr,
          period: `${sinceStr} – ${untilStr}`,
          dailyMetrics: {} as Record<string, any>,
          conversionActions: {} as Record<string, { conversions: number; value: number }>,
          brandId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        existing.impressions += rowImpressions;
        existing.clicks += rowClicks;
        existing.conversions += rowConversions;
        existing.conversion_value += rowConvValue;
        existing.amount_spent += rowSpend;
        existing.reach += parseInt(row.reach || '0', 10);

        // Merge per-action breakdown
        for (const [label, vals] of Object.entries(rowActions)) {
          const v = vals as { conversions: number; value: number };
          if (!existing.conversionActions[label]) existing.conversionActions[label] = { conversions: 0, value: 0 };
          existing.conversionActions[label].conversions += v.conversions;
          existing.conversionActions[label].value += v.value;
        }

        // Only store dailyMetrics for monthly-granularity rows (not aggregated fallback)
        // Monthly rows have date_start on the 1st of each month; fallback aggregated rows
        // have date_start = range start (e.g., "2023-03-26") which would break date filtering.
        if (rowDate && !usedFallback) {
          existing.dailyMetrics[rowDate] = {
            impressions: rowImpressions,
            clicks: rowClicks,
            conversions: rowConversions,
            amount_spent: rowSpend,
            conversion_value: rowConvValue,
            conversionActions: rowActions,
          };
        }

        campaignMap.set(campaignId, existing);
      }

      const allCampaigns = Array.from(campaignMap.values());

      // Firestore: max 500 ops/batch and ~10MB payload — large dailyMetrics docs need modest chunks
      const CHUNK = 100;
      for (let i = 0; i < allCampaigns.length; i += CHUNK) {
        const chunk = allCampaigns.slice(i, i + CHUNK);
        const batch = getDb().batch();
        for (const campaign of chunk) {
          const ref = getDb().collection('campaigns').doc(campaign.id);
          batch.set(ref, campaign, { merge: true });
        }
        await batch.commit();
      }

      if (allCampaigns.length > 0) {
        totalImported += allCampaigns.length;
        logger.info(`[Meta] Imported ${allCampaigns.length} campaigns for account ${accountId}`);
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
