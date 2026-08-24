import * as admin from 'firebase-admin';
import { signState } from './oauthState';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { encryptToken, decryptToken } from './tokenCrypto';
import {
  buildRollingUtcDayWindow,
  DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS,
} from './syncPolicy';

let _db: Firestore | null = null;

const TIKTOK_API_BASE = 'https://business-api.tiktok.com';
const TIKTOK_API_VERSION = 'v1.3';
const TIKTOK_AUTH_URL = `${TIKTOK_API_BASE}/portal/auth`;
const TIKTOK_TOKEN_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/access_token/`;
const TIKTOK_REFRESH_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/refresh_token/`;
const TIKTOK_ADVERTISER_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/oauth2/advertiser/get/`;
const TIKTOK_REPORT_URL = `${TIKTOK_API_BASE}/open_api/${TIKTOK_API_VERSION}/report/integrated/get/`;
const TIKTOK_HISTORY_YEARS = 3;

const BASE_REPORT_METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'conversion'];
// BASIC report rejects `conversion_value`/`purchase_value`; `total_purchase_value` is the
// accepted revenue field the row parser reads first.
const VALUE_REPORT_METRICS = ['total_purchase_value'];

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

// TikTok app_id is a numeric string; the Marketing API's Go backend parses it with
// strconv.ParseInt and rejects anything non-integer (e.g. the "pending" placeholder set
// while the app awaits approval) with a confusing "invalid syntax" error on TikTok's own
// portal. Validate up front so we never send a user there with a malformed app_id.
function isValidTikTokAppId(appId: string): boolean {
  return /^\d+$/.test(appId);
}

export class TikTokNotConfiguredError extends Error {
  constructor(message = 'TikTok app is not configured (TIKTOK_APP_ID is missing or not a numeric app id).') {
    super(message);
    this.name = 'TikTokNotConfiguredError';
  }
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
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const since = y === sy && m === sm ? sinceStr : monthStart;
    const until = y === ey && m === em ? untilStr : monthEnd;
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
  if (!isValidTikTokAppId(appId)) {
    throw new TikTokNotConfiguredError();
  }
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
    state: signState(payload),
  });

  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

export async function handleTikTokCallback(
  code: string,
  redirectUri: string
): Promise<{ success: boolean; data?: TikTokCallbackData; error?: string }> {
  const { appId, secret } = getCredentials();
  if (!isValidTikTokAppId(appId) || !secret) {
    return { success: false, error: 'Missing or invalid TikTok app credentials' };
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

  // Token-exchange returns granted advertisers as `advertiser_ids`; advertiser/get only enriches
  // them with names. Read them here to diagnose and to fall back on if enrichment returns nothing.
  const rawAdvertiserIds = (tokenResult.data as Record<string, unknown>).advertiser_ids;
  const grantedAdvertiserIds = Array.isArray(rawAdvertiserIds)
    ? rawAdvertiserIds.map((x) => String(x).trim()).filter(Boolean)
    : [];

  // Log token-response SHAPE only (keys + presence/counts, never token material) so the
  // Marketing API flow's real fields are verifiable in logs.
  logger.info(
    `[TikTok] token response keys=${JSON.stringify(Object.keys(tokenResult.data))} ` +
      `hasAccess=${Boolean(tokenResult.data.access_token)} hasRefresh=${Boolean(tokenResult.data.refresh_token)} ` +
      `advertiserIds=${grantedAdvertiserIds.length}`
  );

  const accessToken = String(tokenResult.data.access_token || '').trim();
  const refreshToken = String(tokenResult.data.refresh_token || '').trim();
  const expiresIn = parseInteger(tokenResult.data.expires_in) || 86400;
  const refreshExpiresIn = parseInteger(tokenResult.data.refresh_token_expires_in) || 31536000;

  // Marketing API returns a long-lived access_token and (unlike Google) no refresh_token, like Meta:
  // require only the access token; keep refresh_token (when present) as an optional renewal path.
  if (!accessToken) {
    return { success: false, error: 'TikTok returned no access token' };
  }

  // Prefer named advertisers from advertiser/get; fall back to the granted token-response IDs if
  // enrichment yields nothing, so endpoint quirks don't block an authorized connection.
  let availableAccounts = await listAdvertisers(accessToken);
  if (availableAccounts.length === 0 && grantedAdvertiserIds.length > 0) {
    logger.warn(
      `[TikTok] advertiser/get returned no rows; falling back to ${grantedAdvertiserIds.length} advertiser_ids from token response`
    );
    availableAccounts = grantedAdvertiserIds.map((id) => ({ id, name: id }));
  }

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
    logger.error(`[TikTok] Token refresh failed: ${refreshResult.error || 'unknown error'}`, { alertKey: ALERT.tiktokSyncFailed });
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
  // The integrated report treats campaign_name as a metric, not a dimension (requesting it as a
  // dimension errors); dimensions group rows (campaign_id × day), the name rides in the metrics.
  const metricsWithName = metrics.includes('campaign_name') ? metrics : ['campaign_name', ...metrics];

  const params = new URLSearchParams({
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_CAMPAIGN',
    dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
    metrics: JSON.stringify(metricsWithName),
    start_date: since,
    end_date: until,
    page: String(page),
    page_size: '1000',
  });

  const res = await fetch(`${TIKTOK_REPORT_URL}?${params.toString()}`, {
    headers: {
      // TikTok Marketing API authenticates via the `Access-Token` header, not OAuth Bearer.
      'Access-Token': accessToken,
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

function recomputeTikTokCampaignFromDaily(campaign: AggregatedTikTokCampaign): void {
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let conversionValue = 0;
  let amountSpent = 0;

  for (const row of Object.values(campaign.dailyMetrics || {})) {
    impressions += parseInteger(row.impressions);
    clicks += parseInteger(row.clicks);
    conversions += parseFiniteNumber(row.conversions);
    conversionValue += parseFiniteNumber(row.conversion_value);
    amountSpent += parseFiniteNumber(row.amount_spent);
  }

  campaign.impressions = impressions;
  campaign.clicks = clicks;
  campaign.conversions = conversions;
  campaign.conversion_value = Math.round(conversionValue * 100) / 100;
  campaign.amount_spent = Math.round(amountSpent * 100) / 100;
  campaign.ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  campaign.roas = amountSpent > 0 ? conversionValue / amountSpent : 0;
}

export async function fetchTikTokCampaigns(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.tiktok;

  if (!connector?.connected) {
    return { success: false, imported: 0, error: 'TikTok not connected' };
  }

  const adAccountIds: string[] = connector.adAccountIds || [];
  if (adAccountIds.length === 0) {
    return { success: false, imported: 0, error: 'No TikTok advertiser selected' };
  }

  // Tokens are long-lived with no refresh_token (like Meta): use the stored access token directly,
  // refreshing only when a refresh token exists AND the access token is missing or expired.
  let accessToken = decryptToken(String(connector.accessToken || ''));
  const refreshTokenPlain = decryptToken(String(connector.refreshToken || ''));
  const accessExpired =
    typeof connector.expiresAt === 'number' && connector.expiresAt <= Date.now() + 60_000;

  let refreshed:
    | { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
    | null = null;
  if (refreshTokenPlain && (!accessToken || accessExpired)) {
    refreshed = await refreshTikTokAccessToken(refreshTokenPlain);
    if (refreshed) accessToken = refreshed.accessToken;
  }

  if (!accessToken) {
    return { success: false, imported: 0, error: 'TikTok token unavailable — reconnect required' };
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const historyStartYear = currentYear - TIKTOK_HISTORY_YEARS;
  // Auto-rebackfill when the window grows: the flag holds the oldest year already loaded.
  const historyLoaded =
    Boolean(connector.historyLoadedUntilYear) &&
    Number(connector.historyLoadedUntilYear) <= historyStartYear;
  const incrementalWindow = buildRollingUtcDayWindow(DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS, now);
  const sinceStr = historyLoaded ? incrementalWindow.since : `${historyStartYear}-01-01`;
  const untilStr = historyLoaded ? incrementalWindow.until : toYmd(now);

  let totalImported = 0;
  let usingValueMetrics = true;
  // Distinguishes a genuine fetch failure from a legitimately empty result (no spend / no
  // campaigns in the window) so the latter isn't surfaced to the UI as a red error.
  let anyReportError = false;

  for (const advertiserId of adAccountIds) {
    try {
      const monthRanges = generateMonthRanges(sinceStr, untilStr);
      const campaignMap = new Map<string, AggregatedTikTokCampaign>();

      for (const mr of monthRanges) {
        let page = 1;
        let totalPages = 1;

        do {
          const metrics = usingValueMetrics ? [...BASE_REPORT_METRICS, ...VALUE_REPORT_METRICS] : BASE_REPORT_METRICS;
          let pageResult = await fetchReportPage(advertiserId, accessToken, mr.since, mr.until, metrics, page);

          if (!pageResult.ok && usingValueMetrics) {
            logger.warn(
              `[TikTok] Report metrics fallback for advertiser ${advertiserId} (${mr.since}): ${pageResult.error}`
            );
            usingValueMetrics = false;
            pageResult = await fetchReportPage(advertiserId, accessToken, mr.since, mr.until, BASE_REPORT_METRICS, page);
          }

          if (!pageResult.ok) {
            logger.warnAlert(`[TikTok] Report fetch failed for advertiser ${advertiserId} (${mr.since}): ${pageResult.error}`, { alertKey: ALERT.tiktokSyncFailed });
            anyReportError = true;
            break;
          }

          totalPages = pageResult.totalPages || 1;
          for (const row of pageResult.rows) {
            const dims = (row.dimensions || row.dimension || {}) as Record<string, unknown>;
            const mets = (row.metrics || row.metric || row) as Record<string, unknown>;

            const campaignId = String(dims.campaign_id ?? row.campaign_id ?? '').trim();
            const campaignName = String(
              mets.campaign_name ?? dims.campaign_name ?? row.campaign_name ?? `Campaign ${campaignId}`
            ).trim();
            // PER-308: TikTok returns "YYYY-MM-DD 00:00:00" — keep plain YMD like every other connector.
            const statDay = String(dims.stat_time_day ?? row.stat_time_day ?? '').trim().slice(0, 10);
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

      const campaigns = Array.from(campaignMap.values());

      if (historyLoaded && campaigns.length > 0) {
        const refs = campaigns.map((campaign) => getDb().collection('campaigns').doc(campaign.id));
        const existingDocs = await getDb().getAll(...refs);
        const existingById = new Map<string, Record<string, unknown>>();
        for (const d of existingDocs) {
          if (d.exists) existingById.set(d.id, d.data() || {});
        }

        for (const campaign of campaigns) {
          const existing = existingById.get(campaign.id);
          if (!existing) continue;
          // PER-308: re-key stored history to plain YMD so old "… 00:00:00" keys heal on merge.
          const existingDaily = Object.fromEntries(
            Object.entries((existing.dailyMetrics || {}) as AggregatedTikTokCampaign['dailyMetrics'])
              .map(([day, row]) => [day.slice(0, 10), row])
          );
          campaign.dailyMetrics = {
            ...existingDaily,
            ...campaign.dailyMetrics,
          };
          campaign.start_date = String(existing.start_date || campaign.start_date);
          campaign.period = `${campaign.start_date} – ${untilStr}`;
        }
      }

      campaigns.map((campaign) => {
        recomputeTikTokCampaignFromDaily(campaign);
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
      anyReportError = true;
      logger.error(`[TikTok] Error for advertiser ${advertiserId}:`, { alertKey: ALERT.tiktokSyncFailed, err });
    }
  }

  // A sync that fetched cleanly but found nothing (empty account / no spend in the window) is
  // NOT a failure — only a genuine report-fetch error with zero imports counts as one.
  const syncFailed = totalImported === 0 && anyReportError;
  await getDb().collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'tiktok_api',
    status: syncFailed ? 'failed' : 'completed',
    imported: totalImported,
    failed: syncFailed ? 1 : 0,
    errors: syncFailed
      ? ['TikTok sync failed to fetch report data (check logs / permissions / advertiser access)']
      : [],
    createdAt: FieldValue.serverTimestamp(),
  });

  if (!syncFailed) {
    const tiktokPatch: Record<string, unknown> = {
      lastDataSyncAt: Date.now(),
      lastImportError: FieldValue.delete(),
      lastImportErrorAt: FieldValue.delete(),
    };
    // Advance the history watermark only when data actually landed.
    if (totalImported > 0) {
      tiktokPatch.historyLoadedUntilYear = historyLoaded
        ? Number(connector.historyLoadedUntilYear) || historyStartYear
        : historyStartYear;
    }
    // Persist rotated tokens only when a refresh actually happened (long-lived tokens won't refresh).
    if (refreshed) {
      tiktokPatch.accessToken = encryptToken(refreshed.accessToken);
      tiktokPatch.refreshToken = encryptToken(refreshed.refreshToken);
      tiktokPatch.expiresAt = Date.now() + refreshed.expiresIn * 1000;
      tiktokPatch.refreshExpiresAt = Date.now() + refreshed.refreshExpiresIn * 1000;
    }
    await getDb().doc(`connectors/${brandId}`).set({ tiktok: tiktokPatch }, { merge: true });
    return { success: true, imported: totalImported };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      tiktok: {
        lastImportError: 'TikTok: αποτυχία λήψης δεδομένων από το report API — δες τα Cloud Logs',
        lastImportErrorAt: Date.now(),
      },
    },
    { merge: true }
  );
  return {
    success: false,
    imported: 0,
    error: 'TikTok: αποτυχία λήψης δεδομένων από το report API — δες τα logs.',
  };
}
