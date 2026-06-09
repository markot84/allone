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
import { signState } from './oauthState';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { decryptToken } from './tokenCrypto';
import { safeFetch } from './urlValidator';
import {
  buildRollingUtcDayWindow,
  DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS,
} from './syncPolicy';

let _db: Firestore | null = null;

const META_HISTORY_YEARS = 3;

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
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const since = y === sy && m === sm ? sinceStr : monthStart;
    const until = y === ey && m === em ? untilStr : monthEnd;
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

/**
 * Attribution windows που ζητάμε από Meta για να υπολογιστούν ξεχωριστά counts/values
 * των purchase events ανά window. Ο χρήστης μπορεί να επιλέξει window στο UI.
 * Η `default` τιμή ("value") ήδη εξαρτάται από το account-level setting.
 */
const META_ATTRIBUTION_WINDOWS = ['1d_click', '7d_click', '28d_click', '1d_view', '7d_view', '28d_view'] as const;
type MetaAttribWindow = typeof META_ATTRIBUTION_WINDOWS[number];

const SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
].join(',');

function normalizeAdAccountId(accountId: string): string {
  const trimmed = String(accountId || '').trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

async function deleteStaleMetaCampaignDocsForAccounts(
  brandId: string,
  activeAccountIds: string[]
): Promise<number> {
  const prefixes = activeAccountIds.map((id) => `meta_${normalizeAdAccountId(id)}_`);
  if (prefixes.length === 0) return 0;

  const snap = await getDb()
    .collection('campaigns')
    .where('brandId', '==', brandId)
    .where('channel', '==', 'Meta')
    .get();

  let batch = getDb().batch();
  let ops = 0;
  let deleted = 0;
  for (const doc of snap.docs) {
    if (prefixes.some((prefix) => doc.id.startsWith(prefix))) continue;
    batch.delete(doc.ref);
    ops += 1;
    deleted += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = getDb().batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  if (deleted > 0) {
    logger.info(`[Meta] Deleted ${deleted} stale campaign docs for ${brandId}`);
  }
  return deleted;
}

function toYmd(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addDays(ymd: string, days: number): string {
  const d = fromYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

function isRetriableFirestoreWriteError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /DEADLINE_EXCEEDED|Transaction too big|Request payload size exceeds|exceeds the maximum allowed size|document too large|4 DEADLINE_EXCEEDED|Resource exhausted/i.test(
    msg
  );
}

/** Firestore doc ~1MB cap: keep recent days only + drop per-day action maps (totals stay on campaign). */
const MAX_DAILY_KEYS_PERSIST = 420;

const YMD_KEY = /^\d{4}-\d{2}-\d{2}$/;

function trimCampaignForFirestore(c: Record<string, unknown>): void {
  const dm = c.dailyMetrics as Record<string, unknown> | undefined;
  if (!dm || typeof dm !== 'object') return;
  delete dm[''];
  for (const k of Object.keys(dm)) {
    if (!YMD_KEY.test(k)) delete dm[k];
  }
  const keys = Object.keys(dm).sort();
  if (keys.length > MAX_DAILY_KEYS_PERSIST) {
    const drop = keys.length - MAX_DAILY_KEYS_PERSIST;
    for (let i = 0; i < drop; i++) delete dm[keys[i]];
  }
  for (const k of Object.keys(dm)) {
    const row = dm[k] as Record<string, unknown> | undefined;
    if (row && typeof row === 'object' && 'conversionActions' in row) {
      delete row.conversionActions;
    }
  }
}

/** Firestore rejects NaN/Infinity; normalize so writes never fail silently in batches. */
function fin(n: unknown): number {
  const x = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : 0;
}

/** Aligns with frontend roiUtils Meta purchase primary (`Purchase` ≈ Ads Manager, then Pixel). */
function metaPrimaryPurchaseFromCa(
  ca: Record<string, { conversions?: number; value?: number }> | undefined
): { conv: number; value: number } {
  if (!ca || typeof ca !== 'object') return { conv: 0, value: 0 };
  for (const label of ['Purchase', 'Purchase (Pixel)'] as const) {
    const a = ca[label];
    if (!a) continue;
    const conv = Number(a.conversions ?? 0);
    const val = Number(a.value ?? 0);
    if (conv > 0 || val > 0) return { conv, value: val };
  }
  return { conv: 0, value: 0 };
}

function sanitizeCampaignForFirestore(c: Record<string, any>): void {
  c.impressions = fin(c.impressions);
  c.clicks = fin(c.clicks);
  c.conversions = fin(c.conversions);
  c.conversion_value = fin(c.conversion_value);
  c.purchase_conversions = fin(c.purchase_conversions);
  c.purchase_conversion_value = fin(c.purchase_conversion_value);
  c.amount_spent = fin(c.amount_spent);
  c.reach = fin(c.reach);
  c.ctr = fin(c.ctr);
  c.roas = fin(c.roas);
  c.frequency = fin(c.frequency);
  if (c.brandId != null) c.brandId = String(c.brandId);

  const ca = c.conversionActions;
  if (ca && typeof ca === 'object') {
    for (const v of Object.values(ca) as { conversions?: unknown; value?: unknown }[]) {
      if (v && typeof v === 'object') {
        v.conversions = fin(v.conversions);
        v.value = fin(v.value);
      }
    }
  }

  const mw = c.metaWindows;
  if (mw && typeof mw === 'object') {
    for (const v of Object.values(mw) as { conversions?: unknown; value?: unknown }[]) {
      if (v && typeof v === 'object') {
        v.conversions = fin(v.conversions);
        v.value = fin(v.value);
      }
    }
  }

  const geo = c.geo;
  if (geo && typeof geo === 'object') {
    if (geo.byCountry && typeof geo.byCountry === 'object') {
      for (const v of Object.values(geo.byCountry) as Record<string, unknown>[]) {
        if (v && typeof v === 'object') {
          (v as any).impressions = fin((v as any).impressions);
          (v as any).clicks = fin((v as any).clicks);
          (v as any).conversions = fin((v as any).conversions);
          (v as any).conversion_value = fin((v as any).conversion_value);
          (v as any).amount_spent = fin((v as any).amount_spent);
        }
      }
    }
    if (geo.byCity && typeof geo.byCity === 'object') {
      for (const v of Object.values(geo.byCity) as Record<string, unknown>[]) {
        if (v && typeof v === 'object') {
          (v as any).impressions = fin((v as any).impressions);
          (v as any).clicks = fin((v as any).clicks);
          (v as any).conversions = fin((v as any).conversions);
          (v as any).conversion_value = fin((v as any).conversion_value);
          (v as any).amount_spent = fin((v as any).amount_spent);
        }
      }
    }
  }

  const dm = c.dailyMetrics;
  if (dm && typeof dm === 'object') {
    for (const row of Object.values(dm) as Record<string, unknown>[]) {
      if (!row || typeof row !== 'object') continue;
      (row as any).impressions = fin((row as any).impressions);
      (row as any).clicks = fin((row as any).clicks);
      (row as any).conversions = fin((row as any).conversions);
      (row as any).amount_spent = fin((row as any).amount_spent);
      (row as any).conversion_value = fin((row as any).conversion_value);
      (row as any).purchase_conversions = fin((row as any).purchase_conversions);
      (row as any).purchase_conversion_value = fin((row as any).purchase_conversion_value);
      (row as any).reach = fin((row as any).reach);
    }
  }
}

function recomputeMetaCampaignFromDaily(c: Record<string, any>): void {
  const daily = (c.dailyMetrics || {}) as Record<string, Record<string, unknown>>;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let conversionValue = 0;
  let amountSpent = 0;
  let reach = 0;
  let purchaseConversions = 0;
  let purchaseValue = 0;

  for (const row of Object.values(daily)) {
    impressions += fin(row.impressions);
    clicks += fin(row.clicks);
    conversions += fin(row.conversions);
    conversionValue += fin(row.conversion_value);
    amountSpent += fin(row.amount_spent);
    reach += fin(row.reach);
    purchaseConversions += fin(row.purchase_conversions);
    purchaseValue += fin(row.purchase_conversion_value);
  }

  c.impressions = impressions;
  c.clicks = clicks;
  c.conversions = conversions;
  c.conversion_value = Math.round(conversionValue * 100) / 100;
  c.amount_spent = Math.round(amountSpent * 100) / 100;
  c.reach = reach;
  c.purchase_conversions = Math.round(purchaseConversions * 100) / 100;
  c.purchase_conversion_value = Math.round(purchaseValue * 100) / 100;
  c.ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  c.roas = amountSpent > 0 ? purchaseValue / amountSpent : 0;
  c.frequency = reach > 0 ? impressions / reach : 0;
}

function mergeMetricMap(
  older: Record<string, { conversions?: number; value?: number }> | undefined,
  newer: Record<string, { conversions?: number; value?: number }> | undefined
): Record<string, { conversions: number; value: number }> {
  const out: Record<string, { conversions: number; value: number }> = {};
  for (const source of [older, newer]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (!out[key]) out[key] = { conversions: 0, value: 0 };
      out[key].conversions += fin(value?.conversions);
      out[key].value += fin(value?.value);
    }
  }
  return out;
}

async function commitCampaignSliceAdaptive(campaigns: any[]): Promise<void> {
  if (campaigns.length === 0) return;
  const batch = getDb().batch();
  for (const campaign of campaigns) {
    const ref = getDb().collection('campaigns').doc(campaign.id);
    batch.set(ref, campaign, { merge: true });
  }
  try {
    await batch.commit();
  } catch (err) {
    if (campaigns.length > 1 && isRetriableFirestoreWriteError(err)) {
      const mid = Math.floor(campaigns.length / 2);
      const left = campaigns.slice(0, mid);
      const right = campaigns.slice(mid);
      logger.warn(
        `[Meta] Batch write retry via split (${campaigns.length} -> ${left.length}+${right.length})`
      );
      await commitCampaignSliceAdaptive(left);
      await commitCampaignSliceAdaptive(right);
      return;
    }
    throw err;
  }
}

/** Last resort: one doc per commit (avoids huge multi-doc batch payloads). */
async function commitCampaignsOneByOne(campaigns: any[]): Promise<void> {
  for (const campaign of campaigns) {
    const ref = getDb().collection('campaigns').doc(campaign.id);
    await ref.set(campaign, { merge: true });
  }
}

function getCredentials() {
  return {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
  };
}

/**
 * Generate the OAuth consent URL for Meta
 */
export function getMetaAuthUrl(
  brandId: string,
  redirectUri: string,
  returnOrigin?: string,
  oauthInitiatedByUid?: string
): string {
  const { appId } = getCredentials();
  const statePayload: Record<string, string> = { brandId, provider: 'meta', redirectUri };
  if (returnOrigin?.trim()) statePayload.returnOrigin = returnOrigin.trim();
  if (oauthInitiatedByUid?.trim()) statePayload.oauthInitiatedByUid = oauthInitiatedByUid.trim();
  const state = signState(statePayload);

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

    if (adAccounts.length === 0) {
      return {
        success: false,
        error:
          'Δεν βρέθηκαν ενεργοί διαφημιστικοί λογαριασμοί. Έλεγξε ότι ο Facebook χρήστης έχει πρόσβαση σε Ad Account (Business Manager / διαφημιστικό) και ότι το app έχει ads_read.',
      };
    }

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
          availableAccounts: FieldValue.delete(),
          oauthInitiatedByUid: FieldValue.delete(),
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

  await deleteStaleMetaCampaignDocsForAccounts(brandId, adAccountIds);

  let totalImported = 0;
  const accessToken = decryptToken(connector.accessToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Meta token unavailable — reconnect required' };
  }
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  /** Μετά το history import: rolling ~πέντε εβδομάδες (όχι μόνο χθες/σήμερα). */
  const incrementalWindow = buildRollingUtcDayWindow(DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS, now);
  const today = toYmd(now);
  const currentYearStart = `${currentYear}-01-01`;
  const historyStartYear = currentYear - META_HISTORY_YEARS;
  const historyStart = `${historyStartYear}-01-01`;
  const historyEnd = `${currentYear - 1}-12-31`;
  // Auto-rebackfill: το flag κρατάει τον παλαιότερο χρόνο που έχει φορτωθεί.
  // Αν αυξήσουμε το META_HISTORY_YEARS, ξανατραβάμε το ιστορικό για να καλύψουμε τα νέα παλαιότερα έτη.
  const historyLoaded =
    Boolean(connector.historyLoadedUntilYear) &&
    Number(connector.historyLoadedUntilYear) <= historyStartYear;

  const syncWindows: Array<{ since: string; until: string; tag: 'history' | 'current' }> = [];
  if (!historyLoaded) {
    syncWindows.push({ since: historyStart, until: historyEnd, tag: 'history' });
  }
  syncWindows.push({
    since: historyLoaded ? incrementalWindow.since : currentYearStart,
    until: historyLoaded ? incrementalWindow.until : today,
    tag: 'current',
  });

  logger.info(
    `[Meta] Sync windows for ${brandId}: ${syncWindows
      .map((w) => `${w.tag}:${w.since}->${w.until}`)
      .join(', ')}`
  );

  for (const accountId of adAccountIds) {
    try {
      const actAccountId = normalizeAdAccountId(accountId);

      // One API call per calendar month (keeps responses bounded; avoids long sync timeouts).
      // time_increment=1 returns one row per campaign per day; use API date_start (do not override).
      const allRows: any[] = [];
      const monthRanges: Array<{ since: string; until: string }> = [];
      for (const w of syncWindows) {
        monthRanges.push(...generateMonthRanges(w.since, w.until));
      }
      const insightsFields = ['campaign_name','campaign_id','impressions','clicks','spend','actions','action_values','reach','frequency'].join(',');
      const attribWindowsParam = META_ATTRIBUTION_WINDOWS.join(',');

      logger.info(`[Meta] Fetching ${monthRanges.length} months (daily breakdown) for ${accountId}...`);

      for (const mr of monthRanges) {
        try {
          const monthParams = new URLSearchParams({
            fields: insightsFields,
            time_range: JSON.stringify({ since: mr.since, until: mr.until }),
            level: 'campaign',
            time_increment: '1',
            limit: '500',
            action_attribution_windows: attribWindowsParam,
            access_token: accessToken,
          });
          let monthUrl: string | null = `${META_GRAPH_URL}/${actAccountId}/insights?${monthParams}`;
          let monthPageCount = 0;
          const MAX_PAGES = 200;
          while (monthUrl && monthPageCount < MAX_PAGES) {
            // SEC-L8: monthUrl is reassigned to the response's paging.next each iteration —
            // safeFetch blocks a next-page URL that points at an internal/private address.
            const monthRes: Response = await safeFetch(monthUrl);
            if (!monthRes.ok) {
              if (monthPageCount === 0) {
                logger.warn(`[Meta] Month ${mr.since} failed for ${accountId}: ${await monthRes.text()}`);
              }
              break;
            }
            const monthData: any = await monthRes.json();
            for (const row of (monthData.data || [])) {
              allRows.push(row);
            }
            monthUrl = monthData.paging?.next || null;
            monthPageCount++;
          }
          if (monthUrl && monthPageCount >= MAX_PAGES) {
            logger.warn(`[Meta] Month ${mr.since} hit page cap (${MAX_PAGES}) for ${accountId}; some rows may be missing`);
          }
        } catch (e) {
          logger.warn(`[Meta] Per-month call failed for ${mr.since}: ${e}`);
        }
      }

      logger.info(`[Meta] Fetched ${allRows.length} total rows across ${monthRanges.length} months for ${actAccountId}`);

      // ── Geographic breakdown (country-level) ────────────────────────────
      // Δεύτερο call χωρίς time_increment (aggregate ανά χώρα για ολόκληρο το εύρος history+current).
      const geoByCampaign = new Map<string, Record<string, {
        impressions: number; clicks: number; conversions: number;
        conversion_value: number; amount_spent: number;
      }>>();
      try {
        for (const w of syncWindows) {
          const geoParams = new URLSearchParams({
            fields: ['campaign_id','impressions','clicks','spend','actions','action_values'].join(','),
            time_range: JSON.stringify({ since: w.since, until: w.until }),
            level: 'campaign',
            breakdowns: 'country',
            limit: '500',
            action_attribution_windows: attribWindowsParam,
            access_token: accessToken,
          });
          let geoUrl: string | null = `${META_GRAPH_URL}/${actAccountId}/insights?${geoParams}`;
          let geoPages = 0;
          while (geoUrl && geoPages < 100) {
            const geoRes: Response = await safeFetch(geoUrl); // SEC-L8: paging.next follow
            if (!geoRes.ok) {
              logger.warn(`[Meta] Geo breakdown failed (${w.tag}) for ${actAccountId}: ${await geoRes.text()}`);
              break;
            }
            const geoData: any = await geoRes.json();
            for (const row of (geoData.data || [])) {
              const cid = String(row.campaign_id || '');
              const country = String(row.country || '').toUpperCase();
              if (!cid || !country) continue;
              const imp = parseInt(row.impressions || '0', 10);
              const clk = parseInt(row.clicks || '0', 10);
              const spd = parseFloat(row.spend || '0');
              // Purchase conversions/value (ίδια προτεραιότητα με insights: purchase πριν pixel)
              let convs = 0;
              let convVal = 0;
              const actions = row.actions || [];
              const av = row.action_values || [];
              for (const t of ['purchase', 'offsite_conversion.fb_pixel_purchase']) {
                const a = actions.find((x: any) => x.action_type === t);
                if (!a) continue;
                const cv = parseFloat(a.value || '0');
                if (cv <= 0) continue;
                const v = av.find((x: any) => x.action_type === t);
                convs = cv;
                convVal = parseFloat(v?.value || '0');
                break;
              }
              const perCampaign = geoByCampaign.get(cid) || {};
              const entry = perCampaign[country] || {
                impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, amount_spent: 0,
              };
              entry.impressions += imp;
              entry.clicks += clk;
              entry.conversions += convs;
              entry.conversion_value += convVal;
              entry.amount_spent += spd;
              perCampaign[country] = entry;
              geoByCampaign.set(cid, perCampaign);
            }
            geoUrl = geoData.paging?.next || null;
            geoPages++;
          }
        }
        logger.info(`[Meta] Geo breakdown aggregated for ${geoByCampaign.size} campaigns`);
      } catch (e) {
        logger.warn(`[Meta] Geo breakdown call failed: ${e}`);
      }

      // ── Geographic sub-country: country + region (Meta naming: «region» ≈ περιοχή, όχι πάντα πόλη) ──
      const geoCityByCampaign = new Map<string, Record<string, {
        impressions: number; clicks: number; conversions: number;
        conversion_value: number; amount_spent: number;
      }>>();
      try {
        for (const w of syncWindows) {
          const regParams = new URLSearchParams({
            fields: ['campaign_id', 'impressions', 'clicks', 'spend', 'actions', 'action_values'].join(','),
            time_range: JSON.stringify({ since: w.since, until: w.until }),
            level: 'campaign',
            breakdowns: 'country,region',
            limit: '500',
            action_attribution_windows: attribWindowsParam,
            access_token: accessToken,
          });
          let regUrl: string | null = `${META_GRAPH_URL}/${actAccountId}/insights?${regParams}`;
          let regPages = 0;
          while (regUrl && regPages < 100) {
            const regRes: Response = await safeFetch(regUrl); // SEC-L8: paging.next follow
            if (!regRes.ok) {
              logger.warn(`[Meta] Geo country+region breakdown failed (${w.tag}) for ${actAccountId}: ${await regRes.text()}`);
              break;
            }
            const regData: any = await regRes.json();
            for (const row of (regData.data || [])) {
              const cid = String(row.campaign_id || '');
              const country = String(row.country || '').trim().toUpperCase();
              const region = String(row.region || '').trim();
              if (!cid || !country || !region) continue;
              const locKey = `${country}|${region}`;
              const imp = parseInt(row.impressions || '0', 10);
              const clk = parseInt(row.clicks || '0', 10);
              const spd = parseFloat(row.spend || '0');
              let convs = 0;
              let convVal = 0;
              const actions = row.actions || [];
              const av = row.action_values || [];
              for (const t of ['purchase', 'offsite_conversion.fb_pixel_purchase']) {
                const a = actions.find((x: any) => x.action_type === t);
                if (!a) continue;
                const cv = parseFloat(a.value || '0');
                if (cv <= 0) continue;
                const v = av.find((x: any) => x.action_type === t);
                convs = cv;
                convVal = parseFloat(v?.value || '0');
                break;
              }
              const perCampaign = geoCityByCampaign.get(cid) || {};
              const entry = perCampaign[locKey] || {
                impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, amount_spent: 0,
              };
              entry.impressions += imp;
              entry.clicks += clk;
              entry.conversions += convs;
              entry.conversion_value += convVal;
              entry.amount_spent += spd;
              perCampaign[locKey] = entry;
              geoCityByCampaign.set(cid, perCampaign);
            }
            regUrl = regData.paging?.next || null;
            regPages++;
          }
        }
        logger.info(`[Meta] Country+region geo aggregated for ${geoCityByCampaign.size} campaigns`);
      } catch (e) {
        logger.warn(`[Meta] Geo country+region breakdown failed: ${e}`);
      }

      // Fetch campaign statuses (effective_status) from the Campaigns API
      const campaignStatusMap = new Map<string, string>();
      const campaignNameMap = new Map<string, string>();
      try {
        let statusUrl: string | null = `${META_GRAPH_URL}/${actAccountId}/campaigns?fields=id,name,effective_status&limit=500&access_token=${accessToken}`;
        while (statusUrl) {
          const statusRes: Response = await safeFetch(statusUrl); // SEC-L8: paging.next follow
          if (!statusRes.ok) break;
          const statusData: any = await statusRes.json();
          for (const c of (statusData.data || [])) {
            if (c.id && c.effective_status) {
              campaignStatusMap.set(c.id, c.effective_status.toLowerCase());
            }
            if (c.id && c.name) campaignNameMap.set(c.id, c.name);
          }
          statusUrl = statusData.paging?.next || null;
        }
        logger.info(`[Meta] Fetched statuses for ${campaignStatusMap.size} campaigns in ${actAccountId}`);
      } catch (e) {
        logger.warn(`[Meta] Failed to fetch campaign statuses for ${actAccountId}: ${e}`);
      }

      // Fallback: if monthly daily insights returned empty, fetch a compact account-level snapshot.
      if (allRows.length === 0) {
        try {
          const fallbackParams = new URLSearchParams({
            fields: insightsFields,
            time_range: JSON.stringify({
              since: historyLoaded ? incrementalWindow.since : currentYearStart,
              until: historyLoaded ? incrementalWindow.until : today,
            }),
            level: 'campaign',
            limit: '500',
            action_attribution_windows: attribWindowsParam,
            access_token: accessToken,
          });
          let fallbackUrl: string | null = `${META_GRAPH_URL}/${actAccountId}/insights?${fallbackParams}`;
          let pageCount = 0;
          while (fallbackUrl && pageCount < 100) {
            const fallbackRes: Response = await safeFetch(fallbackUrl); // SEC-L8: paging.next follow
            if (!fallbackRes.ok) {
              logger.warn(`[Meta] Fallback insights failed for ${actAccountId}: ${await fallbackRes.text()}`);
              break;
            }
            const fallbackData: any = await fallbackRes.json();
            for (const row of (fallbackData.data || [])) allRows.push(row);
            fallbackUrl = fallbackData.paging?.next || null;
            pageCount++;
          }
          logger.info(`[Meta] Fallback fetched ${allRows.length} rows for ${actAccountId}`);
        } catch (e) {
          logger.warn(`[Meta] Fallback call failed for ${actAccountId}: ${e}`);
        }
      }

      // Aggregate per campaign; dailyMetrics keyed by date_start (YYYY-MM-DD) from daily insights
      const campaignMap = new Map<string, any>();

      for (const row of allRows) {
        const rawId = row.campaign_id;
        const campaignId = rawId != null && rawId !== '' ? String(rawId) : '';
        const campaignName =
          row.campaign_name || campaignNameMap.get(campaignId) || (campaignId ? `Campaign ${campaignId}` : '');
        const rowDate: string = row.date_start || '';
        if (!campaignId) continue;

        // Use only pixel-tracked and standard purchase events.
        // omni_purchase is excluded because it includes Meta-modeled (estimated) conversions
        // that massively inflate counts — e.g. 1600% click-to-conversion on Advantage+ campaigns.
        const actions = row.actions || [];
        const actionValues = row.action_values || [];
        /** Standard `purchase` first — same priority as metaPrimaryPurchaseFromCa / Ads Manager totals. */
        const purchaseTypes = ['purchase', 'offsite_conversion.fb_pixel_purchase'];
        let rowConversions = 0;
        let rowConvValue = 0;
        // Purchase counts/value ανά attribution window (default + 6 επιλογές)
        const rowWindowPurchases: Record<string, { conversions: number; value: number }> = {};
        for (const t of purchaseTypes) {
          const a = actions.find((x: any) => x.action_type === t);
          if (!a) continue;
          const cv = parseFloat(a.value || '0');
          if (cv <= 0) continue;
          const av = actionValues.find((x: any) => x.action_type === t);
          rowConversions = cv;
          rowConvValue = parseFloat(av?.value || '0');
          // Per-window: Meta επιστρέφει π.χ. a['1d_click'] = "3", av['1d_click'] = "45.00"
          for (const win of META_ATTRIBUTION_WINDOWS) {
            const cw = parseFloat(a[win] || '0');
            const vw = parseFloat(av?.[win] || '0');
            if (cw > 0 || vw > 0) {
              rowWindowPurchases[win] = { conversions: cw, value: vw };
            }
          }
          break;
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
          // Skip modeled/broad attribution metrics — they inflate counts and double-count with pixel events.
          if (aType === 'omni_purchase' || aType === 'offsite_conversion.purchase' || aType === 'onsite_conversion.purchase') continue;
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
          id: `meta_${actAccountId}_${campaignId}`,
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
          start_date: historyStart,
          end_date: today,
          period: `${historyStart} – ${today}`,
          dailyMetrics: {} as Record<string, any>,
          conversionActions: {} as Record<string, { conversions: number; value: number }>,
          // Purchase metrics ανά Meta attribution window (π.χ. '1d_click', '7d_click', '28d_click', ...)
          metaWindows: {} as Record<MetaAttribWindow, { conversions: number; value: number }>,
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

        // Merge per-window purchases
        for (const [win, vals] of Object.entries(rowWindowPurchases)) {
          if (!existing.metaWindows[win]) existing.metaWindows[win] = { conversions: 0, value: 0 };
          existing.metaWindows[win].conversions += vals.conversions;
          existing.metaWindows[win].value += vals.value;
        }

        // One entry per calendar day per campaign. Fallback insights (χωρίς time_increment) εξακολουθούν να έχουν date_start — χωρίς daily ο χάρτης ROAS καταλήγει σε τζίρο μόνο σε μία μέρα + μηδενικά αλλού.
        if (rowDate && /^\d{4}-\d{2}-\d{2}$/.test(rowDate)) {
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

      // If insights still returned no rows, at least sync campaign shells from Campaigns API
      // so users can verify connection/account selection in UI.
      if (campaignMap.size === 0 && campaignStatusMap.size > 0) {
        for (const [campaignId, status] of campaignStatusMap.entries()) {
          const normalizedStatus = status === 'active' ? 'active'
            : status === 'paused' ? 'paused'
            : (status === 'archived' || status === 'deleted') ? 'completed'
            : status;
          campaignMap.set(campaignId, {
            id: `meta_${actAccountId}_${campaignId}`,
            name: campaignNameMap.get(campaignId) || `Campaign ${campaignId}`,
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
            start_date: historyStart,
            end_date: today,
            period: `${historyStart} – ${today}`,
            dailyMetrics: {},
            conversionActions: {},
            brandId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        logger.info(`[Meta] Imported campaign shells (${campaignMap.size}) from campaign list for ${actAccountId}`);
      }

      const allCampaigns = Array.from(campaignMap.values());

      // IMPORTANT:
      // Historical load writes a complete window. Incremental load reads only the existing campaign docs,
      // merges yesterday/today dailyMetrics, then recomputes totals from the merged map.
      if (historyLoaded && allCampaigns.length > 0) {
        const refs = allCampaigns.map((c) => getDb().collection('campaigns').doc(c.id));
        const existingDocs = await getDb().getAll(...refs);
        const existingById = new Map<string, any>();
        for (const d of existingDocs) {
          if (d.exists) existingById.set(d.id, d.data());
        }

        for (const c of allCampaigns) {
          const existing = existingById.get(c.id);
          if (!existing) continue;
          c.dailyMetrics = {
            ...(existing.dailyMetrics || {}),
            ...(c.dailyMetrics || {}),
          };
          c.start_date = existing.start_date || c.start_date;
          c.period = `${c.start_date} – ${today}`;
          c.conversionActions = mergeMetricMap(existing.conversionActions, c.conversionActions);
          c.metaWindows = mergeMetricMap(existing.metaWindows, c.metaWindows);
          if (existing.geo) c.geo = existing.geo;
        }
      }

      // Attach geo breakdown per-campaign (μόνο για όσες έχουν δεδομένα)
      for (const c of allCampaigns) {
        if (historyLoaded) continue;
        const short = String(c.id).startsWith('meta_') ? String(c.id).split('_').pop() : String(c.id);
        const g = geoByCampaign.get(short || '');
        const gc = geoCityByCampaign.get(short || '');
        const geoPayload: { byCountry?: Record<string, Record<string, number>>; byCity?: Record<string, Record<string, number>> } = {};
        if (g) {
          const rounded: Record<string, Record<string, number>> = {};
          for (const [country, m] of Object.entries(g)) {
            rounded[country] = {
              impressions: Math.round(m.impressions),
              clicks: Math.round(m.clicks),
              conversions: Math.round(m.conversions * 100) / 100,
              conversion_value: Math.round(m.conversion_value * 100) / 100,
              amount_spent: Math.round(m.amount_spent * 100) / 100,
            };
          }
          geoPayload.byCountry = rounded;
        }
        if (gc) {
          const roundedCity: Record<string, Record<string, number>> = {};
          for (const [loc, m] of Object.entries(gc)) {
            roundedCity[loc] = {
              impressions: Math.round(m.impressions),
              clicks: Math.round(m.clicks),
              conversions: Math.round(m.conversions * 100) / 100,
              conversion_value: Math.round(m.conversion_value * 100) / 100,
              amount_spent: Math.round(m.amount_spent * 100) / 100,
            };
          }
          geoPayload.byCity = roundedCity;
        }
        if (Object.keys(geoPayload).length > 0) (c as any).geo = geoPayload;
      }

      // Purchase/Sales (Meta): primary Purchase row — same idea as Google PURCHASE category
      for (const c of allCampaigns) {
        const p = metaPrimaryPurchaseFromCa(c.conversionActions);
        c.purchase_conversions = p.conv;
        c.purchase_conversion_value = Math.round(p.value * 100) / 100;
        c.roas = c.amount_spent > 0 ? c.purchase_conversion_value / c.amount_spent : 0;
        c.ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
        c.frequency = c.reach > 0 ? c.impressions / c.reach : 0;
        const dm = c.dailyMetrics as Record<string, Record<string, unknown>> | undefined;
        if (dm && typeof dm === 'object') {
          for (const row of Object.values(dm)) {
            if (!row || typeof row !== 'object') continue;
            const caDay = row.conversionActions as
              | Record<string, { conversions?: number; value?: number }>
              | undefined;
            const pd = metaPrimaryPurchaseFromCa(caDay);
            row.purchase_conversions = pd.conv;
            row.purchase_conversion_value = Math.round(pd.value * 100) / 100;
          }
        }
        if (historyLoaded) recomputeMetaCampaignFromDaily(c);
      }

      // Shrink payloads: full daily + per-day conversionActions can exceed 1MB/doc or stall batch.commit.
      for (const c of allCampaigns) trimCampaignForFirestore(c);
      for (const c of allCampaigns) sanitizeCampaignForFirestore(c);

      logger.info(`[Meta] Persisting ${allCampaigns.length} campaign docs for ${actAccountId}`);

      // Small batches + brief pause reduces Firestore deadline pressure on large accounts.
      const CHUNK = 4;
      try {
        for (let i = 0; i < allCampaigns.length; i += CHUNK) {
          const chunk = allCampaigns.slice(i, i + CHUNK);
          await commitCampaignSliceAdaptive(chunk);
          await new Promise((r) => setTimeout(r, 80));
        }
      } catch (writeErr) {
        logger.warn(
          `[Meta] Batched writes failed for ${actAccountId}, falling back to sequential single-doc writes:`,
          writeErr
        );
        try {
          await commitCampaignsOneByOne(allCampaigns);
        } catch (seqErr) {
          logger.error(`[Meta] Sequential writes also failed for ${actAccountId}:`, seqErr);
          throw seqErr;
        }
      }

      if (allCampaigns.length > 0) {
        totalImported += allCampaigns.length;
        logger.info(`[Meta] Imported ${allCampaigns.length} campaigns for account ${actAccountId}`);
      }
    } catch (err) {
      logger.error(`[Meta] Error for account ${accountId}:`, err);
    }
  }

  const importStatus = totalImported > 0 ? 'completed' : 'failed';
  await getDb().collection('import_jobs').add({
    brandId,
    type: 'campaigns',
    source: 'meta_api',
    status: importStatus,
    imported: totalImported,
    failed: totalImported > 0 ? 0 : 1,
    errors: totalImported > 0 ? [] : ['Meta sync produced no campaign writes (check logs / Firestore limits)'],
    createdAt: FieldValue.serverTimestamp(),
  });

  if (totalImported > 0) {
    await getDb().doc(`connectors/${brandId}`).set(
      {
        meta: {
          lastDataSyncAt: Date.now(),
          historyLoadedUntilYear: historyLoaded
            ? Number(connector.historyLoadedUntilYear) || historyStartYear
            : historyStartYear,
          lastImportError: FieldValue.delete(),
        },
      },
      { merge: true }
    );
    return { success: true, imported: totalImported };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      meta: {
        lastImportError: 'Meta: 0 campaigns written — see import_jobs and Cloud Logs',
        lastImportErrorAt: Date.now(),
      },
    },
    { merge: true }
  );
  return { success: false, imported: 0, error: 'Meta sync completed with 0 campaigns imported' };
}
