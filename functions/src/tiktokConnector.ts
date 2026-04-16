import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore | null = null;

const TIKTOK_API_BASE = 'https://business-api.tiktok.com';
const TIKTOK_API_VERSION = 'v1.3';
const TIKTOK_AUTH_URL = `${TIKTOK_API_BASE}/portal/auth`;
const TIKTOK_TOKEN_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/access_token/`;
const TIKTOK_REFRESH_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/refresh_token/`;
const TIKTOK_ADVERTISER_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/advertiser/get/`;
const TIKTOK_REPORT_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/report/integrated/get/`;
const TIKTOK_HISTORY_YEARS = 2;

const BASE_REPORT_METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'conversion'];
const VALUE_REPORT_METRICS = ['conversion_value', 'total_purchase_value', 'purchase_value'];

type TikTokApiEnvelope<T> = {
  code?: number;
  message?: string;
  msg?: string;
  request_id?: string;
  data?: T;
};

export interface TikTokAdvertiser {
  id: string;
  name: string;
}

export interface TikTokCallbackData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  availableAccounts: TikTokAdvertiser[];
  needsSelection: boolean;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

export function setDb(db: Firestore) {
  _db = db;
}

function getCredentials() {
  return {
    appId: (process.env.TIKTOK_APP_ID || '').trim(),
    secret: (process.env.TIKTOK_APP_SECRET || '').trim(),
  };
}

function toYmd(d: Date): string {
  return d.toISOString().split('T')[0];
}

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
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return ranges;
}

function parseTikTokEnvelope<T>(payload: unknown): { ok: boolean; data?: T; error?: string } {
  const x = (payload || {}) as TikTokApiEnvelope<T>;
  const ok = x.code === 0 || x.code === undefined;
  return {
    ok,
    data: x.data,
    error: ok ? undefined : x.message || x.msg || `TikTok API error code ${String(x.code)}`,
  };
}

function parseFiniteNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function parseInteger(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

async function postTikTokOAuth(
  url: string,
  body: Record<string, string>
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const attempts: Array<{ headers: Record<string, string>; body: string }> = [
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    },
  ];

  let lastError = 'Unknown TikTok OAuth error';
  for (const attempt of attempts) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: attempt.headers,
        body: attempt.body,
      });
      const raw = (await res.text()) || '{}';
      let json: unknown = {};
      try {
        json = JSON.parse(raw);
      } catch {
        json = { message: raw };
      }
      const parsed = parseTikTokEnvelope<Record<string, unknown>>(json);
      if (res.ok && parsed.ok && parsed.data) {
        return { ok: true, data: parsed.data };
      }
      lastError = parsed.error || raw.slice(0, 300) || `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, error: lastError };
}

async function listAdvertisers(accessToken: string): Promise<TikTokAdvertiser[]> {
  const { appId, secret } = getCredentials();
  const params = new URLSearchParams({
    app_id: appId,
    secret,
    access_token: accessToken,
  });

  try {
    const res = await fetch(`${TIKTOK_ADVERTISER_URL}?${params.toString()}`);
    const raw = (await res.text()) || '{}';
    let json: unknown = {};
    try {
      json = JSON.parse(raw);
    } catch {
      json = { message: raw };
    }

    const parsed = parseTikTokEnvelope<Record<string, unknown>>(json);
    if (!res.ok || !parsed.ok || !parsed.data) {
      logger.warn(`[TikTok] advertiser/get failed: ${parsed.error || raw.slice(0, 300)}`);
      return [];
    }

    const list = (
      (parsed.data.list as unknown[]) ||
      (parsed.data.advertisers as unknown[]) ||
      []
    ) as Array<Record<string, unknown>>;

    return list
      .map((item) => {
        const id =
          String(item.advertiser_id ?? item.advertiserId ?? item.id ?? '').trim();
        const name =
          String(item.advertiser_name ?? item.advertiserName ?? item.name ?? id).trim();
        return id ? { id, name } : null;
      })
      .filter((x): x is TikTokAdvertiser => Boolean(x));
  } catch (err) {
    logger.warn(`[TikTok] advertiser/get error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function getTikTokAuthUrl(
  brandId: string,
  redirectUri: string,
  returnOrigin?: string,
  oauthInitiatedByUid?: string
): string {
  const { appId } = getCredentials();
  const payload: Record<string, string> = {
    brandId,
    provider: 'tiktok',
    redirectUri,
  };
  if (returnOrigin?.trim()) payload.returnOrigin = returnOrigin.trim();
  if (oauthInitiatedByUid?.trim()) payload.oauthInitiatedByUid = oauthInitiatedByUid.trim();

  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state: Buffer.from(JSON.stringify(payload)).toString('base64url'),
  });

  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

export async function handleTikTokCallback(
  code: string,
  redirectUri: string
): Promise<{ success: boolean; data?: TikTokCallbackData; error?: string }> {
  const { appId, secret } = getCredentials();
  if (!appId || !secret) {
    return { success: false, error: 'Missing TikTok app credentials' };
  }

  const tokenResult = await postTikTokOAuth(TIKTOK_TOKEN_URL, {
    app_id: appId,
    secret,
    auth_code: code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  if (!tokenResult.ok || !tokenResult.data) {
    return { success: false, error: tokenResult.error || 'TikTok token exchange failed' };
  }

  const accessToken = String(tokenResult.data.access_token || '').trim();
  const refreshToken = String(tokenResult.data.refresh_token || '').trim();
  const expiresIn = parseInteger(tokenResult.data.expires_in) || 86400;
  const refreshExpiresIn = parseInteger(tokenResult.data.refresh_token_expires_in) || 31536000;

  if (!accessToken || !refreshToken) {
    return { success: false, error: 'TikTok returned incomplete OAuth tokens' };
  }

  const availableAccounts = await listAdvertisers(accessToken);
  if (availableAccounts.length === 0) {
    return {
      success: false,
      error:
        'Δεν βρέθηκαν advertiser accounts στο TikTok Ads. Έλεγξε ότι ο χρήστης έχει πρόσβαση σε TikTok Ads advertiser και ότι το app έχει εγκριθεί για Marketing API.',
    };
  }

  return {
    success: true,
    data: {
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn,
      availableAccounts,
      needsSelection: availableAccounts.length > 1,
    },
  };
}

export async function selectTikTokAccount(
  brandId: string,
  advertiserId: string,
  advertiserName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getDb().doc(`connectors/${brandId}`).set(
      {
        tiktok: {
          connected: true,
          pendingAccountSelection: false,
          adAccountIds: [advertiserId],
          adAccountNames: [advertiserName],
          availableAccounts: FieldValue.delete(),
          oauthInitiatedByUid: FieldValue.delete(),
        },
      },
      { merge: true }
    );
    logger.info(`[TikTok] Advertiser selected for brand ${brandId}: ${advertiserId}`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

async function refreshTikTokAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number } | null> {
  const { appId, secret } = getCredentials();
  const refreshResult = await postTikTokOAuth(TIKTOK_REFRESH_URL, {
    app_id: appId,
    secret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  if (!refreshResult.ok || !refreshResult.data) {
    logger.error(`[TikTok] Token refresh failed: ${refreshResult.error || 'unknown error'}`);
    return null;
  }

  const accessToken = String(refreshResult.data.access_token || '').trim();
  const nextRefreshToken = String(refreshResult.data.refresh_token || refreshToken).trim();
  const expiresIn = parseInteger(refreshResult.data.expires_in) || 86400;
  const refreshExpiresIn = parseInteger(refreshResult.data.refresh_token_expires_in) || 31536000;

  if (!accessToken || !nextRefreshToken) return null;
  return { accessToken, refreshToken: nextRefreshToken, expiresIn, refreshExpiresIn };
}

async function fetchReportPage(
  advertiserId: string,
  accessToken: string,
  since: string,
  until: string,
  metrics: string[],
  page: number
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>>; totalPages: number; error?: string }> {
  const params = new URLSearchParams({
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id', 'campaign_name', 'stat_time_day']),
    metrics: JSON.stringify(metrics),
    start_date: since,
    end_date: until,
    page: String(page),
    page_size: '1000',
  });

  const res = await fetch(`${TIKTOK_REPORT_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const raw = (await res.text()) || '{}';
  let json: unknown = {};
  try {
    json = JSON.parse(raw);
  } catch {
    json = { message: raw };
  }

  const parsed = parseTikTokEnvelope<Record<string, unknown>>(json);
  if (!res.ok || !parsed.ok || !parsed.data) {
    return { ok: false, rows: [], totalPages: 0, error: parsed.error || raw.slice(0, 300) };
  }

  const list = (
    (parsed.data.list as unknown[]) ||
    (parsed.data.rows as unknown[]) ||
    []
  ) as Array<Record<string, unknown>>;

  const pageInfo = (parsed.data.page_info || parsed.data.pageInfo || {}) as Record<string, unknown>;
  const totalPages =
    parseInteger(pageInfo.total_page) ||
    parseInteger(pageInfo.totalPage) ||
    1;

  return { ok: true, rows: list, totalPages };
}

type AggregatedTikTokCampaign = {
  id: string;
  name: string;
  channel: 'TikTok';
  status: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  amount_spent: number;
  ctr: number;
  roas: number;
  start_date: string;
  end_date: string;
  period: string;
  dailyMetrics: Record<string, {
    impressions: number;
    clicks: number;
    conversions: number;
    amount_spent: number;
    conversion_value: number;
  }>;
  brandId: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export async function fetchTikTokCampaigns(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.tiktok;

  if (!connector?.connected || !connector?.refreshToken) {
    return { success: false, imported: 0, error: 'TikTok not connected' };
  }

  const adAccountIds: string[] = connector.adAccountIds || [];
  if (adAccountIds.length === 0) {
    return { success: false, imported: 0, error: 'No TikTok advertiser selected' };
  }

  const refreshed = await refreshTikTokAccessToken(String(connector.refreshToken));
  if (!refreshed) {
    return { success: false, imported: 0, error: 'Failed to refresh TikTok access token' };
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const historyLoaded = Boolean(connector.historyLoadedUntilYear);
  const sinceStr = historyLoaded ? `${currentYear}-01-01` : `${currentYear - TIKTOK_HISTORY_YEARS}-01-01`;
  const untilStr = toYmd(now);

  let totalImported = 0;
  let usingValueMetrics = true;

  for (const advertiserId of adAccountIds) {
    try {
      const monthRanges = generateMonthRanges(sinceStr, untilStr);
      const campaignMap = new Map<string, AggregatedTikTokCampaign>();

      for (const mr of monthRanges) {
        let page = 1;
        let totalPages = 1;

        do {
          const metrics = usingValueMetrics ? [...BASE_REPORT_METRICS, ...VALUE_REPORT_METRICS] : BASE_REPORT_METRICS;
          let pageResult = await fetchReportPage(advertiserId, refreshed.accessToken, mr.since, mr.until, metrics, page);

          if (!pageResult.ok && usingValueMetrics) {
            logger.warn(
              `[TikTok] Report metrics fallback for advertiser ${advertiserId} (${mr.since}): ${pageResult.error}`
            );
            usingValueMetrics = false;
            pageResult = await fetchReportPage(advertiserId, refreshed.accessToken, mr.since, mr.until, BASE_REPORT_METRICS, page);
          }

          if (!pageResult.ok) {
            logger.warn(`[TikTok] Report fetch failed for advertiser ${advertiserId} (${mr.since}): ${pageResult.error}`);
            break;
          }

          totalPages = pageResult.totalPages || 1;
          for (const row of pageResult.rows) {
            const dims = (row.dimensions || row.dimension || {}) as Record<string, unknown>;
            const mets = (row.metrics || row.metric || row) as Record<string, unknown>;

            const campaignId = String(dims.campaign_id ?? row.campaign_id ?? '').trim();
            const campaignName = String(dims.campaign_name ?? row.campaign_name ?? `Campaign ${campaignId}`).trim();
            const statDay = String(dims.stat_time_day ?? row.stat_time_day ?? '').trim();
            if (!campaignId || !statDay) continue;

            const spend = parseFiniteNumber(mets.spend ?? row.spend);
            const impressions = parseInteger(mets.impressions ?? row.impressions);
            const clicks = parseInteger(mets.clicks ?? row.clicks);
            const conversions = parseFiniteNumber(mets.conversion ?? mets.conversions ?? row.conversion ?? row.conversions);
            const conversionValue = parseFiniteNumber(
              mets.total_purchase_value ??
              mets.purchase_value ??
              mets.conversion_value ??
              row.total_purchase_value ??
              row.purchase_value ??
              row.conversion_value
            );

            const existing = campaignMap.get(campaignId) || {
              id: `tiktok_${advertiserId}_${campaignId}`,
              name: campaignName,
              channel: 'TikTok' as const,
              status: 'active',
              impressions: 0,
              clicks: 0,
              conversions: 0,
              conversion_value: 0,
              amount_spent: 0,
              ctr: 0,
              roas: 0,
              start_date: sinceStr,
              end_date: untilStr,
              period: `${sinceStr} – ${untilStr}`,
              dailyMetrics: {},
              brandId,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            };

            existing.impressions += impressions;
            existing.clicks += clicks;
            existing.conversions += conversions;
            existing.conversion_value += conversionValue;
            existing.amount_spent += spend;
            existing.dailyMetrics[statDay] = {
              impressions,
              clicks,
              conversions,
              amount_spent: spend,
              conversion_value: conversionValue,
            };

            campaignMap.set(campaignId, existing);
          }

          page++;
        } while (page <= totalPages);
      }

      const campaigns = Array.from(campaignMap.values()).map((campaign) => {
        campaign.ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
        campaign.roas = campaign.amount_spent > 0 ? campaign.conversion_value / campaign.amount_spent : 0;
        campaign.updatedAt = FieldValue.serverTimestamp();
        return campaign;
      });

      if (campaigns.length === 0) continue;

      const batchSize = 100;
      for (let i = 0; i < campaigns.length; i += batchSize) {
        const batch = getDb().batch();
        const slice = campaigns.slice(i, i + batchSize);
        for (const campaign of slice) {
          batch.set(getDb().collection('campaigns').doc(campaign.id), campaign, { merge: true });
        }
        await batch.commit();
      }

      totalImported += campaigns.length;
      logger.info(`[TikTok] Imported ${campaigns.length} campaigns for advertiser ${advertiserId}`);
    } catch (err) {
      logger.error(`[TikTok] Error for advertiser ${advertiserId}:`, err);
    }
  }

  const importStatus = totalImported > 0 ? 'completed' : 'failed';
  await getDb().collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'tiktok_api',
    status: importStatus,
    imported: totalImported,
    failed: totalImported > 0 ? 0 : 1,
    errors: totalImported > 0 ? [] : ['TikTok sync produced no campaign writes (check logs / permissions / advertiser access)'],
    createdAt: FieldValue.serverTimestamp(),
  });

  if (totalImported > 0) {
    await getDb().doc(`connectors/${brandId}`).set(
      {
        tiktok: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
          refreshExpiresAt: Date.now() + refreshed.refreshExpiresIn * 1000,
          lastDataSyncAt: Date.now(),
          historyLoadedUntilYear: connector.historyLoadedUntilYear || currentYear - 1,
          lastImportError: FieldValue.delete(),
          lastImportErrorAt: FieldValue.delete(),
        },
      },
      { merge: true }
    );
    return { success: true, imported: totalImported };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      tiktok: {
        lastImportError: 'TikTok: 0 campaigns written — see import_jobs and Cloud Logs',
        lastImportErrorAt: Date.now(),
      },
    },
    { merge: true }
  );
  return { success: false, imported: 0, error: 'TikTok sync completed with 0 campaigns imported' };
}
