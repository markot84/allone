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

function generateMonthRanges(sinceStr: string, untilStr: string): Array<{ since: string; until: string }> {
  const ranges: Array<{ since: string; until: string }> = [];
  const [sy, sm] = sinceStr.split('-').map(Number);
  const [ey, em] = untilStr.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const since = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const until = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    ranges.push({ since, until });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return ranges;
}

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const GOOGLE_ADS_API_VERSION = 'v22';
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_ADS_HISTORY_YEARS = 2;

const SCOPES = ['https://www.googleapis.com/auth/adwords'];

/**
 * REST JSON uses camelCase; some fields may be missing. If primary conversions are 0,
 * fall back to all_conversions / all_conversions_value (common when attribution uses "all conv." reporting).
 */
function parseCampaignDayMetrics(m: Record<string, unknown> | undefined | null): {
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  cost_micros: number;
} {
  if (!m || typeof m !== 'object') {
    return { impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, cost_micros: 0 };
  }
  const x = m as Record<string, any>;
  const impressions = parseInt(String(x.impressions ?? '0'), 10) || 0;
  const clicks = parseInt(String(x.clicks ?? '0'), 10) || 0;
  const costMicros = parseInt(String(x.costMicros ?? x.cost_micros ?? '0'), 10) || 0;
  let conversions = parseFloat(String(x.conversions ?? '0'));
  let conversionValue = parseFloat(String(x.conversionsValue ?? x.conversions_value ?? '0'));
  if (!Number.isFinite(conversions)) conversions = 0;
  if (!Number.isFinite(conversionValue)) conversionValue = 0;
  const allConv = parseFloat(String(x.allConversions ?? x.all_conversions ?? '0'));
  const allVal = parseFloat(String(x.allConversionsValue ?? x.all_conversions_value ?? '0'));
  if (conversions === 0 && Number.isFinite(allConv) && allConv > 0) conversions = allConv;
  if (conversionValue === 0 && Number.isFinite(allVal) && allVal > 0) conversionValue = allVal;
  return { impressions, clicks, conversions, conversion_value: conversionValue, cost_micros: costMicros };
}

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    clientId: raw(process.env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: raw(process.env.GOOGLE_ADS_CLIENT_SECRET),
    developerToken: raw(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    loginCustomerId: raw(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, ''),
  };
}

export interface GoogleAdsCustomer {
  id: string;
  name: string;
  resourceName: string;
}

function normalizeCustomerId(id: string): string {
  return String(id).replace(/-/g, '').trim();
}

/** Επιστρέφει child λογαριασμούς κάτω από MCC (όχι manager leaf accounts). */
async function fetchManagedClients(accessToken: string, mccId: string): Promise<GoogleAdsCustomer[]> {
  const { developerToken } = getCredentials();
  const id = normalizeCustomerId(mccId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
    'login-customer-id': id,
  };
  try {
    const subRes = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${id}/googleAds:search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.id, customer_client.manager
                FROM customer_client
                WHERE customer_client.manager = false`,
      }),
    });
    if (!subRes.ok) {
      const errText = await subRes.text();
      logger.warn(`[GoogleAds] fetchManagedClients failed (${subRes.status}): ${errText.slice(0, 400)}`);
      return [];
    }
    const subData = await subRes.json();
    const rows = subData.results || [];
    const out: GoogleAdsCustomer[] = [];
    for (const row of rows) {
      const rawId = row.customerClient?.id ?? row.customerClient?.clientCustomer?.replace?.('customers/', '');
      const cid = rawId != null ? normalizeCustomerId(String(rawId)) : '';
      if (!cid || cid === id) continue;
      out.push({
        id: cid,
        name: row.customerClient?.descriptiveName || `Account ${cid}`,
        resourceName: row.customerClient?.clientCustomer || `customers/${cid}`,
      });
    }
    const seen = new Set<string>();
    return out.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  } catch (e) {
    logger.warn(`[GoogleAds] fetchManagedClients error: ${e}`);
    return [];
  }
}

async function fetchCustomerIsManager(accessToken: string, customerId: string): Promise<boolean> {
  const { developerToken } = getCredentials();
  const id = normalizeCustomerId(customerId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
    'login-customer-id': id,
  };
  try {
    const res = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${id}/googleAds:search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: 'SELECT customer.manager FROM customer LIMIT 1',
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const row = data.results?.[0];
    return Boolean(row?.customer?.manager);
  } catch {
    return false;
  }
}

/**
 * Generate the OAuth consent URL for Google Ads
 */
export function getGoogleAdsAuthUrl(brandId: string, redirectUri: string, returnOrigin?: string): string {
  const { clientId } = getCredentials();
  const payload: Record<string, string> = { brandId, provider: 'google_ads', redirectUri };
  if (returnOrigin?.trim()) payload.returnOrigin = returnOrigin.trim();
  const state = Buffer.from(JSON.stringify(payload)).toString('base64url');

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

  logger.info(`[GoogleAds] DIAG listAccessible — loginCustomerId="${loginCustomerId}" devToken="${developerToken.slice(0,6)}..." rawEnv="${(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').slice(0,30)}"`);

  try {
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
    const customerIds = [...new Set(resourceNames.map((rn: string) => normalizeCustomerId(rn.replace('customers/', ''))))];

    if (customerIds.length === 0) return [];

    // Fetch names via GAQL for each customer
    const customers: GoogleAdsCustomer[] = [];
    for (const cid of customerIds) {
      const cidNorm = normalizeCustomerId(cid);
      try {
        const loginForQuery =
          loginCustomerId && loginCustomerId !== cidNorm ? loginCustomerId : cidNorm;
        const infoRes = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${cidNorm}/googleAds:search`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json', 'login-customer-id': loginForQuery },
          body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }),
        });
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const row = infoData.results?.[0];
          customers.push({
            id: cidNorm,
            name: row?.customer?.descriptiveName || `Account ${cidNorm}`,
            resourceName: `customers/${cidNorm}`,
          });
        } else {
          customers.push({ id: cidNorm, name: `Account ${cidNorm}`, resourceName: `customers/${cidNorm}` });
        }
      } catch {
        customers.push({ id: cidNorm, name: `Account ${cidNorm}`, resourceName: `customers/${cidNorm}` });
      }
    }

    // Ένας προσβάσιμος λογαριασμός: αν είναι MCC, τράβα client λογαριασμούς (όχι μόνο όταν id === env MCC)
    if (customers.length === 1) {
      const sole = customers[0];
      const subs = await fetchManagedClients(accessToken, sole.id);
      if (subs.length > 0) {
        logger.info(`[GoogleAds] Single accessible node expanded to ${subs.length} client accounts under ${sole.id}`);
        return subs;
      }
      const isMgr = await fetchCustomerIsManager(accessToken, sole.id);
      if (isMgr) {
        logger.info(
          `[GoogleAds] Single account ${sole.id} is manager but no ENABLED client rows — manual Customer ID (sub-account)`
        );
        return [];
      }
      logger.info(`[GoogleAds] Single leaf account ${sole.id} — OK for auto-connect`);
      return customers;
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
    const errText = await res.text();
    logger.error(`[GoogleAds] Token refresh failed (${res.status}): ${errText.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  if (!data.access_token) {
    logger.error('[GoogleAds] Token refresh returned no access_token:', JSON.stringify(data).slice(0, 200));
    return null;
  }
  logger.info(`[GoogleAds] Token refresh OK — scope: ${data.scope || 'unknown'}`);
  return data.access_token;
}

/**
 * Fetch campaign performance data from Google Ads API.
 * Strategy:
 * - Previous 2 years load once (history)
 * - Current year loads on every sync
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

  const customerId: string = String(connector.customerId).replace(/-/g, '');

  if (loginCustomerId && customerId === loginCustomerId) {
    return { success: false, imported: 0, error: 'Ο Customer ID ταυτίζεται με τον MCC — χρησιμοποιήστε το ID του sub-account.' };
  }

  // Date window policy:
  // - First historical load: (currentYear-2)-01-01 -> today
  // - Subsequent syncs: currentYear-01-01 -> today
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const historyStartYear = currentYear - GOOGLE_ADS_HISTORY_YEARS;
  const historyLoaded = Boolean(connector.historyLoadedUntilYear);
  const sinceStr = historyLoaded
    ? `${currentYear}-01-01`
    : `${historyStartYear}-01-01`;
  const untilStr = now.toISOString().slice(0, 10);
  logger.info(
    `[GoogleAds] Sync window for ${brandId}: ${sinceStr} -> ${untilStr} (${historyLoaded ? 'current-year' : 'history+current'})`
  );

  // Note: ORDER BY on metrics with date segmentation causes UNIMPLEMENTED in some accounts.
  // segments.date must be in SELECT when used in WHERE with date range.
  const gaqlQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
      AND campaign.status != 'REMOVED'
  `;

  let totalImported = 0;

  // Helper: run a GAQL search with optional login-customer-id
  const searchUrl = `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`;
  const runQuery = async (query: string, loginId?: string): Promise<Response> => {
    const h: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (loginId) h['login-customer-id'] = loginId;
    return fetch(searchUrl, { method: 'POST', headers: h, body: JSON.stringify({ query }) });
  };

  logger.info(`[GoogleAds] Fetching campaigns — url=${searchUrl} loginCustomerId=${loginCustomerId} customerId=${customerId}`);

  try {
    // Always try MCC first, then without header, then self-reference
    const attempts: Array<string | undefined> = [];
    if (loginCustomerId && loginCustomerId !== customerId) attempts.push(loginCustomerId);
    attempts.push(undefined);
    if (loginCustomerId && loginCustomerId !== customerId) attempts.push(customerId);

    let workingLoginId: string | undefined;
    let found = false;
    for (const loginId of attempts) {
      // Use customer.id as probe — lighter and avoids resource-specific issues
      const testRes = await runQuery(
        'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1',
        loginId
      );
      if (testRes.ok) {
        workingLoginId = loginId;
        found = true;
        logger.info(`[GoogleAds] loginId "${loginId ?? 'none'}" works for ${customerId}`);
        break;
      }
      const errBody = await testRes.text();
      let parsedErr = errBody.slice(0, 800);
      try {
        const parsed = JSON.parse(errBody);
        const details = parsed?.error?.details || [];
        const gadsErr = details[0]?.errors?.[0];
        const fieldViolations = details[0]?.fieldViolations;
        const errCode = gadsErr?.errorCode ? JSON.stringify(gadsErr.errorCode) : '';
        const errMsg = gadsErr?.message || parsed?.error?.message || '';
        const fieldInfo = fieldViolations ? ` fields=${JSON.stringify(fieldViolations)}` : '';
        parsedErr = `${parsed?.error?.status || ''} ${errCode} ${errMsg}${fieldInfo}`.trim();
        logger.warn(`[GoogleAds] loginId "${loginId ?? 'none'}" full details: ${JSON.stringify(details).slice(0, 500)}`);
      } catch { /* keep raw */ }
      logger.warn(`[GoogleAds] loginId "${loginId ?? 'none'}" failed (${testRes.status}): ${parsedErr}`);
    }

    if (!found) {
      const lastErrMsg = `All ${attempts.length} login-customer-id attempts failed for customer ${customerId}`;
      logger.error(`[GoogleAds] ${lastErrMsg}`);
      return { success: false, imported: 0, error: `Google Ads: ${lastErrMsg}. Βεβαιωθείτε ότι ο λογαριασμός ${customerId} είναι προσβάσιμος μέσω του MCC.` };
    }

    const effectiveLoginId = workingLoginId;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (effectiveLoginId) headers['login-customer-id'] = effectiveLoginId;

    let nextPageToken: string | undefined;
    const campaignMap = new Map<string | number, any>();

    do {
      const body: Record<string, any> = { query: gaqlQuery };
      if (nextPageToken) body.pageToken = nextPageToken;

      const res = await fetch(
        `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const errText = await res.text();
        logger.error(`[GoogleAds] Query failed — status:${res.status} customerId:${customerId} loginId:${effectiveLoginId} devToken:${developerToken.slice(0,6)}*** body:${errText.slice(0, 500)}`);
        let detail = errText;
        try {
          const parsed = JSON.parse(errText);
          detail = parsed?.error?.message || parsed?.error?.details?.[0]?.errors?.[0]?.message || parsed?.error?.status || errText;
        } catch { /* keep raw text */ }
        return { success: false, imported: 0, error: `Google Ads ${res.status}: ${detail.slice(0, 300)}` };
      }

      const page = await res.json();
      nextPageToken = page.nextPageToken;

      for (const row of page.results || []) {
        const campaignId = row.campaign?.id;
        const campaignName = row.campaign?.name;
        const segDate = row.segments?.date || '';
        if (!campaignId || !campaignName) continue;

        const day = parseCampaignDayMetrics(row.metrics as Record<string, unknown> | undefined);
        const dayImpressions = day.impressions;
        const dayClicks = day.clicks;
        const dayConversions = day.conversions;
        const daySpent = day.cost_micros / 1_000_000;
        const dayConvValue = day.conversion_value;

        const existing = campaignMap.get(campaignId) || {
          id: `gads_${customerId}_${campaignId}`,
          name: campaignName,
          channel: 'Google Ads',
          status: (row.campaign?.status || 'ENABLED').toLowerCase(),
          advertising_channel_type: row.campaign?.advertisingChannelType || '',
          impressions: 0,
          clicks: 0,
          conversions: 0,
          amount_spent: 0,
          conversion_value: 0,
          ctr: 0,
          roas: 0,
          start_date: sinceStr,
          end_date: untilStr,
          period: `${sinceStr} – ${untilStr}`, // Last 3 years
          dailyMetrics: {} as Record<string, { impressions: number; clicks: number; conversions: number; amount_spent: number; conversion_value: number }>,
          brandId,
        };

        existing.impressions += dayImpressions;
        existing.clicks += dayClicks;
        existing.conversions += dayConversions;
        existing.amount_spent += daySpent;
        existing.conversion_value += dayConvValue;

        if (segDate) {
          const prev = existing.dailyMetrics[segDate] || { impressions: 0, clicks: 0, conversions: 0, amount_spent: 0, conversion_value: 0 };
          prev.impressions += dayImpressions;
          prev.clicks += dayClicks;
          prev.conversions += dayConversions;
          prev.amount_spent += daySpent;
          prev.conversion_value += dayConvValue;
          existing.dailyMetrics[segDate] = prev;
        }

        campaignMap.set(campaignId, existing);
      }
    } while (nextPageToken);

    // Second query: per-conversion-action **per calendar day** (same window as campaign daily metrics).
    // Never attach monthly totals to each day — that multiplies counts when summing a date range.
    const convActionMap = new Map<string, Record<string, { conversions: number; value: number }>>();

    try {
      const monthRanges = generateMonthRanges(sinceStr, untilStr);
      logger.info(`[GoogleAds] Fetching daily conversion actions (${monthRanges.length} month chunks)...`);

      for (const mr of monthRanges) {
        const caQuery = `
          SELECT campaign.id, segments.conversion_action_name, segments.date,
                 metrics.conversions, metrics.conversions_value
          FROM campaign
          WHERE segments.date BETWEEN '${mr.since}' AND '${mr.until}'
            AND campaign.status != 'REMOVED'
            AND metrics.conversions > 0
        `;

        try {
          let caNextToken: string | undefined;
          do {
            const caBody: Record<string, any> = { query: caQuery };
            if (caNextToken) caBody.pageToken = caNextToken;

            const caRes = await fetch(
              `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
              { method: 'POST', headers, body: JSON.stringify(caBody) }
            );

            if (!caRes.ok) {
              logger.warn(`[GoogleAds] Conv action query failed for ${mr.since} (${caRes.status})`);
              break;
            }

            const caPage = await caRes.json();
            caNextToken = caPage.nextPageToken;

            for (const row of caPage.results || []) {
              const cId = row.campaign?.id;
              const actionName = row.segments?.conversionActionName || 'Unknown';
              const segDate = row.segments?.date || '';
              const convs = parseFloat(row.metrics?.conversions || '0');
              const convVal = parseFloat(row.metrics?.conversionsValue || '0');
              if (!cId || convs === 0 || !segDate) continue;
              const docId = `gads_${customerId}_${cId}`;

              if (!convActionMap.has(docId)) convActionMap.set(docId, {});
              const totals = convActionMap.get(docId)!;
              if (!totals[actionName]) totals[actionName] = { conversions: 0, value: 0 };
              totals[actionName].conversions += convs;
              totals[actionName].value += convVal;

              const camp =
                campaignMap.get(cId) ??
                campaignMap.get(String(cId)) ??
                campaignMap.get(Number(cId));
              if (!camp) continue;
              const prev = camp.dailyMetrics[segDate] || {
                impressions: 0,
                clicks: 0,
                conversions: 0,
                amount_spent: 0,
                conversion_value: 0,
              };
              const caByDay =
                (prev as { conversionActions?: Record<string, { conversions: number; value: number }> })
                  .conversionActions || {};
              if (!caByDay[actionName]) caByDay[actionName] = { conversions: 0, value: 0 };
              caByDay[actionName].conversions += convs;
              caByDay[actionName].value += convVal;
              (prev as { conversionActions?: typeof caByDay }).conversionActions = caByDay;
              camp.dailyMetrics[segDate] = prev;
            }
          } while (caNextToken);
        } catch (e) {
          logger.warn(`[GoogleAds] Conv action query error for ${mr.since}:`, e);
        }
      }

      logger.info(`[GoogleAds] Fetched conversion actions for ${convActionMap.size} campaigns (daily per action)`);
    } catch (caErr) {
      logger.warn(`[GoogleAds] Conversion action query error, skipping:`, caErr);
    }

    // Firestore allows max 500 ops per batch but also ~10MB total payload per commit.
    // Campaign docs include multi-year dailyMetrics + nested conversionActions — one huge batch fails with
    // INVALID_ARGUMENT: Transaction too big.
    const prepared: any[] = [];
    for (const [, campaign] of campaignMap) {
      campaign.ctr = campaign.impressions > 0
        ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100
        : 0;
      campaign.roas = campaign.amount_spent > 0
        ? Math.round((campaign.conversion_value / campaign.amount_spent) * 100) / 100
        : 0;
      campaign.amount_spent = Math.round(campaign.amount_spent * 100) / 100;

      campaign.conversionActions = convActionMap.get(campaign.id) || {};

      campaign.createdAt = FieldValue.serverTimestamp();
      campaign.updatedAt = FieldValue.serverTimestamp();
      prepared.push(campaign);
    }

    // Merge existing daily metrics so historical years are loaded once and preserved.
    if (prepared.length > 0) {
      const refs = prepared.map((c) => getDb().collection('campaigns').doc(c.id));
      const existingDocs = await getDb().getAll(...refs);
      const existingById = new Map<string, any>();
      for (const d of existingDocs) {
        if (d.exists) existingById.set(d.id, d.data());
      }

      for (const campaign of prepared) {
        const existing = existingById.get(campaign.id);
        if (!existing) continue;

        const existingDaily = (existing.dailyMetrics || {}) as Record<string, any>;
        const incomingDaily = (campaign.dailyMetrics || {}) as Record<string, any>;
        const mergedDaily: Record<string, any> = { ...existingDaily, ...incomingDaily };
        campaign.dailyMetrics = mergedDaily;

        let impressions = 0;
        let clicks = 0;
        let conversions = 0;
        let amountSpent = 0;
        let convValue = 0;
        const mergedActions: Record<string, { conversions: number; value: number }> = {};

        for (const dm of Object.values(mergedDaily)) {
          const m = dm as any;
          impressions += Number(m.impressions || 0);
          clicks += Number(m.clicks || 0);
          conversions += Number(m.conversions || 0);
          amountSpent += Number(m.amount_spent || 0);
          convValue += Number(m.conversion_value || 0);
          const ca = (m.conversionActions || {}) as Record<string, { conversions: number; value: number }>;
          for (const [k, v] of Object.entries(ca)) {
            if (!mergedActions[k]) mergedActions[k] = { conversions: 0, value: 0 };
            mergedActions[k].conversions += Number(v.conversions || 0);
            mergedActions[k].value += Number(v.value || 0);
          }
        }

        campaign.impressions = impressions;
        campaign.clicks = clicks;
        campaign.conversions = conversions;
        campaign.amount_spent = Math.round(amountSpent * 100) / 100;
        campaign.conversion_value = convValue;
        campaign.ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
        campaign.roas = campaign.amount_spent > 0 ? Math.round((convValue / campaign.amount_spent) * 100) / 100 : 0;
        campaign.conversionActions = mergedActions;
        campaign.start_date = existing.start_date || `${historyStartYear}-01-01`;
        campaign.end_date = untilStr;
        campaign.period = `${campaign.start_date} – ${untilStr}`;
      }
    }

    const WRITE_CHUNK = 25;
    for (let i = 0; i < prepared.length; i += WRITE_CHUNK) {
      const slice = prepared.slice(i, i + WRITE_CHUNK);
      const batch = getDb().batch();
      for (const campaign of slice) {
        const ref = getDb().collection('campaigns').doc(campaign.id);
        batch.set(ref, campaign, { merge: true });
      }
      await batch.commit();
      logger.info(
        `[GoogleAds] Batch ${Math.floor(i / WRITE_CHUNK) + 1}: wrote ${slice.length} campaigns (customer ${customerId})`
      );
    }
    if (prepared.length > 0) {
      totalImported = prepared.length;
      logger.info(`[GoogleAds] Imported ${prepared.length} campaigns for customer ${customerId}`);
    }
    // Fetch search terms & keywords (non-blocking — failures don't block campaign sync)
    try {
      await fetchSearchTermsAndKeywords(brandId, customerId, headers);
    } catch (e) {
      logger.warn('[GoogleAds] Search terms/keywords fetch failed (non-blocking):', e);
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

  await getDb().doc(`connectors/${brandId}`).set(
    {
      google_ads: {
        lastDataSyncAt: Date.now(),
        historyLoadedUntilYear: connector.historyLoadedUntilYear || currentYear - 1,
      },
    },
    { merge: true }
  );

  return { success: true, imported: totalImported };
}

/**
 * Fetch search terms and keywords from Google Ads (last 90 days)
 */
async function fetchSearchTermsAndKeywords(
  brandId: string,
  customerId: string,
  headers: Record<string, string>
): Promise<void> {
  const db = getDb();
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const since = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

  // ── Search Terms ──
  const stQuery = `
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND metrics.impressions > 0
    ORDER BY metrics.impressions DESC
    LIMIT 500
  `;

  const searchTerms: any[] = [];
  try {
    let nextToken: string | undefined;
    do {
      const body: Record<string, any> = { query: stQuery };
      if (nextToken) body.pageToken = nextToken;

      const res = await fetch(
        `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        logger.warn(`[GoogleAds] Search terms query failed: ${res.status}`);
        break;
      }

      const page = await res.json();
      nextToken = page.nextPageToken;

      for (const row of page.results || []) {
        const term = row.searchTermView?.searchTerm;
        if (!term) continue;
        const costMicros = parseInt(row.metrics?.costMicros || '0');

        searchTerms.push({
          term,
          campaign: row.campaign?.name || '',
          adGroup: row.adGroup?.name || '',
          impressions: parseInt(row.metrics?.impressions || '0'),
          clicks: parseInt(row.metrics?.clicks || '0'),
          conversions: parseFloat(row.metrics?.conversions || '0'),
          cost: Math.round(costMicros / 10000) / 100,
          conversionValue: parseFloat(row.metrics?.conversionsValue || '0'),
        });
      }
    } while (nextToken);
  } catch (e) {
    logger.warn('[GoogleAds] Search terms fetch error:', e);
  }

  // ── Keywords ──
  const kwQuery = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      campaign.name,
      ad_group.name,
      ad_group_criterion.status,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.conversions_value
    FROM keyword_view
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.impressions DESC
    LIMIT 500
  `;

  const keywords: any[] = [];
  try {
    let nextToken: string | undefined;
    do {
      const body: Record<string, any> = { query: kwQuery };
      if (nextToken) body.pageToken = nextToken;

      const res = await fetch(
        `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        logger.warn(`[GoogleAds] Keywords query failed: ${res.status}`);
        break;
      }

      const page = await res.json();
      nextToken = page.nextPageToken;

      for (const row of page.results || []) {
        const text = row.adGroupCriterion?.keyword?.text;
        if (!text) continue;
        const costMicros = parseInt(row.metrics?.costMicros || '0');

        keywords.push({
          keyword: text,
          matchType: row.adGroupCriterion?.keyword?.matchType || '',
          qualityScore: row.adGroupCriterion?.qualityInfo?.qualityScore || null,
          campaign: row.campaign?.name || '',
          adGroup: row.adGroup?.name || '',
          status: row.adGroupCriterion?.status || '',
          impressions: parseInt(row.metrics?.impressions || '0'),
          clicks: parseInt(row.metrics?.clicks || '0'),
          conversions: parseFloat(row.metrics?.conversions || '0'),
          cost: Math.round(costMicros / 10000) / 100,
          conversionValue: parseFloat(row.metrics?.conversionsValue || '0'),
        });
      }
    } while (nextToken);
  } catch (e) {
    logger.warn('[GoogleAds] Keywords fetch error:', e);
  }

  // Save to Firestore
  const docRef = db.doc(`search_intelligence/${brandId}`);
  await docRef.set({
    searchTerms: searchTerms.slice(0, 500),
    keywords: keywords.slice(0, 500),
    syncedAt: FieldValue.serverTimestamp(),
    dateRange: { start: since, end: until },
  });

  logger.info(`[GoogleAds] Saved ${searchTerms.length} search terms + ${keywords.length} keywords for brand ${brandId}`);
}
