/**
 * Google Analytics 4 (GA4) Connector
 *
 * Reuses Google OAuth (same client_id/secret as Google Ads) with
 * scope: https://www.googleapis.com/auth/analytics.readonly
 *
 * Fetches GA4 property data: sessions, users, pageviews, events,
 * conversions, bounce rate, etc.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';

/**
 * Normalize GA4 Default Channel Group labels so session vs first-user reports merge reliably.
 * GA may return "(direct)", Greek labels, or "(not set)" vs "Unassigned" — align to a canonical key.
 */
function normalizeDefaultChannelGroup(name: string): string {
  let s = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === 'not set' || s === 'unassigned') return 'unassigned';
  return s;
}

/**
 * Map localized GA4 Default Channel Group labels (e.g. Greek UI) to one canonical key for matching
 * across session vs first-user reports when GA returns different languages per query.
 */
const CHANNEL_LABEL_CANONICAL: Record<string, string> = {
  // Greek (normalized lowercase) -> English canonical
  'οργανική αναζήτηση': 'organic search',
  'πληρωμένη αναζήτηση': 'paid search',
  'άμεση': 'direct',
  'παραπομπή': 'referral',
  'οργανικά κοινωνικά δίκτυα': 'organic social',
  'πληρωμένα κοινωνικά δίκτυα': 'paid social',
  'ηλεκτρονικό ταχυδρομείο': 'email',
  'οθόνη': 'display',
  'αμειβόμενη αναζήτηση': 'paid search',
  'άλλο πληρωμένο': 'paid other',
  'διασταυρούμενο δίκτυο': 'cross-network',
  'μη αντιστοιχισμένο': 'unassigned',
  'αταξινόμητο': 'unassigned',
  'πληρωμένες αγορές': 'paid shopping',
  'οργανικές αγορές': 'organic shopping',
  'πληρωμένο βίντεο': 'paid video',
  'οργανικό βίντεο': 'organic video',
};

function canonicalChannelComparable(name: string): string {
  const n = normalizeDefaultChannelGroup(name);
  return CHANNEL_LABEL_CANONICAL[n] ?? n;
}

/** True if GA4 default channel group row counts as organic (Search, Social, Shopping, Video, …). */
function isOrganicDefaultChannelGroup(raw: string): boolean {
  return canonicalChannelComparable(raw).includes('organic');
}

/** Map acquisition-channel row onto a session-channel row (exact normalized match, then loose substring match). */
function pickTrafficChannelForNu(rawNuChannel: string, trafficKeys: string[]): string | null {
  const n = canonicalChannelComparable(rawNuChannel);
  for (const ch of trafficKeys) {
    if (canonicalChannelComparable(ch) === n) return ch;
  }
  const nPlain = normalizeDefaultChannelGroup(rawNuChannel);
  for (const ch of trafficKeys) {
    if (normalizeDefaultChannelGroup(ch) === nPlain) return ch;
  }
  for (const ch of trafficKeys) {
    const tn = normalizeDefaultChannelGroup(ch);
    if (tn.length >= 5 && nPlain.length >= 5 && (nPlain.includes(tn) || tn.includes(nPlain))) return ch;
  }
  return null;
}

/** Distribute total new users across session channels by session share (last resort when labels never match). */
function applyProportionalNewUsers(
  trafficSources: Record<string, { sessions: number; newUsers: number }>,
  totalNu: number
): void {
  const keys = Object.keys(trafficSources);
  const totalSessions = keys.reduce((a, k) => a + (trafficSources[k].sessions || 0), 0);
  if (totalSessions <= 0 || totalNu <= 0 || keys.length === 0) return;
  let allocated = 0;
  const sorted = [...keys].sort((a, b) => trafficSources[b].sessions - trafficSources[a].sessions);
  sorted.forEach((ch, i) => {
    if (i === sorted.length - 1) {
      trafficSources[ch].newUsers = Math.max(0, totalNu - allocated);
    } else {
      const n = Math.round((totalNu * trafficSources[ch].sessions) / totalSessions);
      trafficSources[ch].newUsers = n;
      allocated += n;
    }
  });
  logger.warn(
    `[GA4] New users: applied session-proportional split (${totalNu} total) — channel labels did not match acquisition report`
  );
}

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
];

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    clientId: raw(process.env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: raw(process.env.GOOGLE_ADS_CLIENT_SECRET),
  };
}

export interface GA4Property {
  id: string;
  name: string;
}

type GA4OrganicFallbackRow = {
  date: string;
  path: string;
  sessions: number;
  users: number;
  conversions: number;
};

/**
 * Generate the OAuth consent URL for GA4
 */
export function getGA4AuthUrl(
  brandId: string,
  redirectUri: string,
  returnOrigin?: string,
  /** Firebase Auth uid of the admin who clicked Connect — stored with pending picker so other users never see their list. */
  oauthInitiatedByUid?: string
): string {
  const { clientId } = getCredentials();
  const payload: Record<string, string> = { brandId, provider: 'ga4', redirectUri };
  if (returnOrigin?.trim()) payload.returnOrigin = returnOrigin.trim();
  if (oauthInitiatedByUid?.trim()) payload.oauthInitiatedByUid = oauthInitiatedByUid.trim();
  const state = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Force Google account chooser so a new Performance+ user is not tied to the previous browser Google session.
    prompt: 'select_account consent',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange auth code for tokens and list GA4 properties
 */
export async function handleGA4Callback(
  code: string,
  brandId: string,
  redirectUri: string,
  oauthInitiatedByUid?: string
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
      logger.error('[GA4] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;
    logger.info(`[GA4] Token exchange OK for brand ${brandId}`);

    // Save tokens first (even before property listing) so we can retry later
    await getDb().doc(`connectors/${brandId}`).set(
      {
        ga4: {
          refreshToken: encryptToken(refreshToken),
          accessToken: encryptToken(accessToken),
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          connectedAt: FieldValue.serverTimestamp(),
          oauthInitiatedByUid: FieldValue.delete(),
        },
      },
      { merge: true }
    );

    let properties: GA4Property[];
    try {
      properties = await listGA4Properties(accessToken);
    } catch (listErr) {
      const msg = listErr instanceof Error ? listErr.message : String(listErr);
      logger.error(`[GA4] Property listing failed: ${msg}`);
      return { success: false, error: msg };
    }

    if (properties.length === 0) {
      logger.warn(`[GA4] No GA4 properties found for brand ${brandId}`);
      return {
        success: false,
        error: 'Δεν βρέθηκαν GA4 properties στον λογαριασμό σας. Βεβαιωθείτε ότι έχετε GA4 property.',
      };
    }

    if (properties.length === 1) {
      await getDb().doc(`connectors/${brandId}`).set(
        {
          ga4: {
            connected: true,
            refreshToken: encryptToken(refreshToken),
            accessToken: encryptToken(accessToken),
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            propertyId: properties[0].id,
            propertyName: properties[0].name,
            connectedAt: FieldValue.serverTimestamp(),
            oauthInitiatedByUid: FieldValue.delete(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    // Multiple properties — let user pick (scoped to whoever started OAuth)
    await getDb().doc(`connectors/${brandId}`).set(
      {
        ga4: {
          connected: false,
          refreshToken: encryptToken(refreshToken),
          accessToken: encryptToken(accessToken),
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: properties.map((p) => ({ id: p.id, name: p.name })),
          connectedAt: FieldValue.serverTimestamp(),
          ...(oauthInitiatedByUid?.trim()
            ? { oauthInitiatedByUid: oauthInitiatedByUid.trim() }
            : { oauthInitiatedByUid: FieldValue.delete() }),
        },
      },
      { merge: true }
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[GA4] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * List all GA4 properties accessible with the token.
 * Throws on API errors so caller can surface them to the user.
 */
async function listGA4Properties(accessToken: string): Promise<GA4Property[]> {
  const res = await fetch(`${GA4_ADMIN_API}/accountSummaries?pageSize=200`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`[GA4] Account summaries failed: ${res.status}`, body);
    throw new Error(
      res.status === 403
        ? 'GA4 Admin API not enabled or no access. Enable "Google Analytics Admin API" in Cloud Console → APIs & Services → Library.'
        : `GA4 Admin API error: ${res.status} — ${body.slice(0, 200)}`
    );
  }

  const data = await res.json();
  const properties: GA4Property[] = [];

  for (const summary of data.accountSummaries || []) {
    for (const prop of summary.propertySummaries || []) {
      const id = prop.property?.replace('properties/', '') || '';
      if (id) {
        properties.push({
          id,
          name: prop.displayName || `Property ${id}`,
        });
      }
    }
  }

  logger.info(`[GA4] Found ${properties.length} properties`);
  return properties;
}

/** Parse Google OAuth token error body for clearer operator-facing messages. */
function explainGoogleTokenError(status: number, rawText: string): string {
  try {
    const j = JSON.parse(rawText) as { error?: string; error_description?: string };
    if (j.error === 'invalid_grant') {
      return `Token refresh failed: ${status}. Το refresh token δεν είναι πλέον έγκυρο (ληγμένο, ανακλημένο ή μετά από αλλαγή κωδικού Google). Αποσυνδέστε το GA4 και συνδέστε το ξανά από Συνδέσεις.`;
    }
    if (j.error === 'invalid_client') {
      return `Token refresh failed: ${status}. Έλεγξε ότι τα GOOGLE_ADS_CLIENT_ID και GOOGLE_ADS_CLIENT_SECRET στο Cloud Functions (secrets) ταιριάζουν με το ίδιο OAuth 2.0 Client στο Google Cloud Console.`;
    }
    if (j.error_description) {
      return `Token refresh failed: ${status} — ${j.error_description}`;
    }
  } catch {
    /* not JSON */
  }
  const slice = rawText.replace(/\s+/g, ' ').trim().slice(0, 200);
  return slice ? `Token refresh failed: ${status} — ${slice}` : `Token refresh failed: ${status}`;
}

/**
 * Refresh the access token
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error(
      'GA4: λείπουν GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET (χρησιμοποιούνται και για GA4 OAuth).'
    );
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    logger.error(`[GA4] Token refresh HTTP ${res.status}:`, rawText.slice(0, 500));
    throw new Error(explainGoogleTokenError(res.status, rawText));
  }

  let data: { access_token?: string };
  try {
    data = JSON.parse(rawText) as { access_token?: string };
  } catch {
    throw new Error('Token refresh failed: invalid JSON response from Google');
  }
  if (!data.access_token) {
    logger.error('[GA4] Token refresh: missing access_token in body:', rawText.slice(0, 300));
    throw new Error('Token refresh failed: no access_token in response');
  }
  return data.access_token;
}

/**
 * Fetch GA4 analytics data and store in Firestore
 */
export async function fetchGA4Data(
  brandId: string
): Promise<{ success: boolean; imported: number; error?: string }> {
  const db = getDb();
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const conn = connDoc.data()?.ga4;

  if (!conn?.connected || !conn?.refreshToken || !conn?.propertyId) {
    return { success: false, imported: 0, error: 'GA4 not connected or no property selected' };
  }

  try {
    const refreshTokenPlain = decryptToken(conn.refreshToken);
    if (!refreshTokenPlain) {
      return { success: false, imported: 0, error: 'GA4 token unavailable — reconnect required' };
    }
    const accessToken = await refreshAccessToken(refreshTokenPlain);
    const propertyId = conn.propertyId;

    // Fetch last 3 years of data (GA4 free tier default retention is 14 months — older data
    // returns empty, no error). Daily aggregates fit comfortably in Firestore docs (~150 bytes × 1095 = 165KB).
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);

    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Main metrics report (optional addToCarts for ecommerce / cart activity)
    const dateRangeMain = { startDate: formatDate(startDate), endDate: formatDate(endDate) };
    const baseMetrics = [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'conversions' },
      { name: 'eventCount' },
    ];
    const reportBodyWithCarts = {
      dateRanges: [dateRangeMain],
      dimensions: [{ name: 'date' }],
      metrics: [...baseMetrics, { name: 'addToCarts' }],
    };

    let reportRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(reportBodyWithCarts),
    });

    let includeAddToCarts = reportRes.ok;
    if (!reportRes.ok) {
      const errTxt = await reportRes.text();
      logger.warn(`[GA4] Daily report with addToCarts failed (${reportRes.status}), retry without: ${errTxt.slice(0, 200)}`);
      reportRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          dateRanges: [dateRangeMain],
          dimensions: [{ name: 'date' }],
          metrics: baseMetrics,
        }),
      });
      includeAddToCarts = false;
    }

    if (!reportRes.ok) {
      const err = await reportRes.text();
      logger.error(`[GA4] Report failed: ${reportRes.status}`, err);
      return { success: false, imported: 0, error: `GA4 API error: ${reportRes.status}` };
    }

    const reportData = await reportRes.json();
    const dailyMetrics: Record<string, any> = {};

    for (const row of reportData.rows || []) {
      const date = row.dimensionValues?.[0]?.value; // "20260313" format
      if (!date) continue;
      const formattedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      const vals = row.metricValues || [];

      dailyMetrics[formattedDate] = {
        sessions: parseInt(vals[0]?.value || '0'),
        totalUsers: parseInt(vals[1]?.value || '0'),
        newUsers: parseInt(vals[2]?.value || '0'),
        pageViews: parseInt(vals[3]?.value || '0'),
        bounceRate: parseFloat(vals[4]?.value || '0'),
        avgSessionDuration: parseFloat(vals[5]?.value || '0'),
        conversions: parseInt(vals[6]?.value || '0'),
        eventCount: parseInt(vals[7]?.value || '0'),
        addToCarts: includeAddToCarts ? parseInt(vals[8]?.value || '0', 10) || 0 : 0,
      };
    }

    // Traffic source breakdown.
    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Map sessionSource + sessionMedium to GA4-like default channel group labels. */
    function channelFromSourceMedium(source: string, medium: string): string {
      const s = source.toLowerCase().trim();
      const m = medium.toLowerCase().trim();
      if (s === '(direct)' && (m === '(none)' || m === '(not set)')) return 'Direct';
      if (m === 'organic') {
        if (/google|bing|yahoo|duckduckgo|baidu|yandex|naver/.test(s)) return 'Organic Search';
        if (/facebook|instagram|twitter|tiktok|linkedin|pinterest/.test(s)) return 'Organic Social';
        return 'Organic Search';
      }
      if (m === 'cpc' || m === 'ppc' || m === 'paid') {
        if (/facebook|instagram|meta/.test(s)) return 'Paid Social';
        if (/google|bing/.test(s)) return 'Paid Search';
        return 'Paid Search';
      }
      if (m === 'display') return 'Display';
      if (m === 'email' || m === 'e-mail' || m === 'mail') return 'Email';
      if (m === 'referral') return 'Referral';
      if (m === 'affiliate') return 'Affiliates';
      if (m === 'social') {
        if (/facebook|instagram|meta/.test(s)) return 'Paid Social';
        return 'Organic Social';
      }
      return 'Referral';
    }

    function parseTrafficRows(
      rows: any[],
      dimCount: number,
      valIdxSessions: number,
      valIdxUsers: number,
      valIdxNewUsers: number | null,
      valIdxConversions: number,
      valIdxPurchaseRev: number | null,
      valIdxTotalRev: number | null,
      useChannelDimension: boolean,
    ): Record<string, any> {
      const out: Record<string, any> = {};
      for (const row of rows) {
        const dims = row.dimensionValues || [];
        const vals = row.metricValues || [];
        const channel = useChannelDimension
          ? (dims[0]?.value || 'Unknown')
          : channelFromSourceMedium(dims[0]?.value || '', dims[1]?.value || '');

        const sessions = parseInt(vals[valIdxSessions]?.value || '0', 10);
        const users = parseInt(vals[valIdxUsers]?.value || '0', 10);
        const newUsers = valIdxNewUsers != null ? (parseInt(vals[valIdxNewUsers]?.value || '0', 10) || 0) : 0;
        const conversions = parseInt(vals[valIdxConversions]?.value || '0', 10);
        const pr = valIdxPurchaseRev != null ? (parseFloat(vals[valIdxPurchaseRev]?.value || '0') || 0) : 0;
        const tr = valIdxTotalRev != null ? (parseFloat(vals[valIdxTotalRev]?.value || '0') || 0) : 0;
        const revenue = Math.max(pr, tr);

        if (!out[channel]) {
          out[channel] = { sessions: 0, users: 0, newUsers: 0, conversions: 0, totalRevenue: 0 };
        }
        out[channel].sessions += sessions;
        out[channel].users += users;
        out[channel].newUsers += newUsers;
        out[channel].conversions += conversions;
        // ΣΗΜΑΝΤΙΚΟ: άθροιση και όχι max — στο source/medium fallback πολλαπλά rows αντιστοιχούν σε ίδιο channel.
        // Στο sessionDefaultChannelGroup έχουμε μία γραμμή ανά channel οπότε άθροιση == max.
        out[channel].totalRevenue += revenue;
      }
      return out;
    }

    let trafficSources: Record<string, any> = {};
    try {
      const dateRange = { startDate: formatDate(startDate), endDate: formatDate(endDate) };

      // ── Attempt A: sessionDefaultChannelGroup with revenue metrics ──
      // Metrics order: [0]sessions [1]totalUsers [2]newUsers [3]conversions [4]purchaseRevenue [5]totalRevenue
      let usedChannelDimension = true;
      let channelRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          languageCode: 'en',
          dateRanges: [dateRange],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'newUsers' },
            { name: 'conversions' },
            { name: 'purchaseRevenue' },
            { name: 'totalRevenue' },
          ],
        }),
      });

      // 400 → some metric unsupported, retry minimal (no revenue)
      // Metrics order: [0]sessions [1]totalUsers [2]newUsers [3]conversions
      if (!channelRes.ok && channelRes.status === 400) {
        const e400 = await channelRes.text();
        logger.warn(`[GA4] channelGroup full rejected (400): ${e400.slice(0, 200)}`);
        channelRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            languageCode: 'en',
            dateRanges: [dateRange],
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'conversions' }],
          }),
        });
      }

      if (channelRes.ok) {
        const d = await channelRes.json();
        const hasRevenue = (d.rows?.[0]?.metricValues?.length ?? 0) >= 6;
        // indices: sessions=0, users=1, newUsers=2, conversions=3, purchaseRev=4, totalRev=5
        trafficSources = parseTrafficRows(d.rows || [], 1, 0, 1, 2, 3, hasRevenue ? 4 : null, hasRevenue ? 5 : null, true);
        logger.info(`[GA4] Channel group report: ${Object.keys(trafficSources).length} channels`);
      } else {
        // ── Attempt B: sessionDefaultChannelGroup failed → fallback source/medium ──
        const errTxt = await channelRes.text();
        logger.warn(`[GA4] channelGroup failed (${channelRes.status}), falling back to source/medium: ${errTxt.slice(0, 200)}`);
        usedChannelDimension = false;

        if (channelRes.status === 429) await sleep(3000);
        else await sleep(500);

        // Attempt B: Metrics order: [0]sessions [1]totalUsers [2]newUsers [3]conversions [4]purchaseRevenue [5]totalRevenue
        const smRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            dateRanges: [dateRange],
            dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
            metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'conversions' }, { name: 'purchaseRevenue' }, { name: 'totalRevenue' }],
            limit: '100',
          }),
        });

        if (smRes.ok) {
          const sd = await smRes.json();
          trafficSources = parseTrafficRows(sd.rows || [], 2, 0, 1, 2, 3, 4, 5, false);
          logger.info(`[GA4] source/medium fallback: ${Object.keys(trafficSources).length} channels derived`);
        } else {
          const smErr = await smRes.text();
          logger.warn(`[GA4] source/medium also failed (${smRes.status}): ${smErr.slice(0, 200)}`);

          // ── Attempt C: absolute minimum — sessionMedium only ──
          await sleep(1000);
          const medRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              dateRanges: [dateRange],
              dimensions: [{ name: 'sessionMedium' }],
              metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }],
              limit: '50',
            }),
          });
          if (medRes.ok) {
            const md = await medRes.json();
            for (const row of md.rows || []) {
              const medium = (row.dimensionValues?.[0]?.value || '(none)').toLowerCase();
              let channel = 'Referral';
              if (medium === '(none)' || medium === '') channel = 'Direct';
              else if (medium === 'organic') channel = 'Organic Search';
              else if (medium === 'cpc' || medium === 'ppc') channel = 'Paid Search';
              else if (medium === 'email' || medium === 'e-mail') channel = 'Email';
              else if (medium === 'display') channel = 'Display';
              const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
              const users = parseInt(row.metricValues?.[1]?.value || '0', 10);
              const newUsers = parseInt(row.metricValues?.[2]?.value || '0', 10);
              if (!trafficSources[channel]) {
                trafficSources[channel] = { sessions: 0, users: 0, newUsers: 0, conversions: 0, totalRevenue: 0 };
              }
              trafficSources[channel].sessions += sessions;
              trafficSources[channel].users += users;
              trafficSources[channel].newUsers += newUsers;
            }
            logger.info(`[GA4] sessionMedium last-resort: ${Object.keys(trafficSources).length} channels`);
          } else {
            const medErr = await medRes.text();
            logger.error(`[GA4] All channel attempts failed. Last error (${medRes.status}): ${medErr.slice(0, 300)}`);
          }
        }
      }
      void usedChannelDimension;
    } catch (e) {
      logger.warn('[GA4] Traffic sources query failed:', e);
    }

    /**
     * Many properties send purchase `value` on the event but return 0 for purchaseRevenue/totalRevenue
     * on sessionDefaultChannelGroup alone. Sum eventValue for purchase-like events per channel.
     */
    try {
      const purchaseByChannelBody = {
        languageCode: 'en',
        dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'eventValue' }, { name: 'purchaseRevenue' }],
        dimensionFilter: {
          orGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'purchase' },
                },
              },
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'ecommerce_purchase' },
                },
              },
            ],
          },
        },
      };

      let purRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(purchaseByChannelBody),
      });

      if (!purRes.ok && purRes.status === 400) {
        const errTxt = await purRes.text();
        logger.warn(
          `[GA4] Purchase-by-channel (eventValue+purchaseRevenue) rejected, retry eventValue only: ${errTxt.slice(0, 300)}`
        );
        purRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...purchaseByChannelBody,
            metrics: [{ name: 'eventValue' }],
          }),
        });
      }

      if (purRes.ok) {
        const purData = await purRes.json();
        let mergedRev = 0;
        for (const row of purData.rows || []) {
          const channel = row.dimensionValues?.[0]?.value || 'Unknown';
          const vals = row.metricValues || [];
          const eventVal = parseFloat(vals[0]?.value || '0') || 0;
          const pr = vals[1] != null ? parseFloat(vals[1]?.value || '0') || 0 : 0;
          const extra = Math.max(eventVal, pr);
          if (extra <= 0) continue;
          mergedRev += extra;
          if (!trafficSources[channel]) {
            trafficSources[channel] = {
              sessions: 0,
              users: 0,
              conversions: 0,
              newUsers: 0,
              totalRevenue: extra,
            };
          } else {
            const prev = typeof trafficSources[channel].totalRevenue === 'number' ? trafficSources[channel].totalRevenue : 0;
            trafficSources[channel].totalRevenue = Math.max(prev, extra);
          }
        }
        if (mergedRev > 0) {
          logger.info(`[GA4] Merged purchase/ecommerce_purchase revenue by channel: total extra=${mergedRev}`);
        }
      } else {
        const t = await purRes.text();
        logger.warn(`[GA4] Purchase-by-channel report failed: ${purRes.status}`, t.slice(0, 400));
      }
    } catch (e) {
      logger.warn('[GA4] Purchase-by-channel merge failed:', e);
    }

    // New users per acquisition channel — merge onto session-channel rows (same labels via languageCode + fuzzy match)
    try {
      const nuBody = {
        languageCode: 'en',
        dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
        dimensions: [{ name: 'firstUserDefaultChannelGroup' }],
        metrics: [{ name: 'newUsers' }],
      };
      const nuRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(nuBody),
      });
      if (nuRes.ok) {
        const nuData = await nuRes.json();
        const trafficKeys = Object.keys(trafficSources);
        let totalNuReport = 0;
        let mergedNu = 0;
        const acquisitionByChannel: Record<string, number> = {};

        for (const row of nuData.rows || []) {
          const rawChannel = row.dimensionValues?.[0]?.value || 'Unknown';
          const nu = parseInt(row.metricValues?.[0]?.value || '0', 10);
          totalNuReport += nu;
          const match = pickTrafficChannelForNu(rawChannel, trafficKeys);
          if (match) {
            acquisitionByChannel[match] = (acquisitionByChannel[match] || 0) + nu;
            mergedNu += nu;
          }
        }

        // Only override inline newUsers if the acquisition report matched channels successfully.
        // This avoids zeroing out inline newUsers when the report fails to match.
        if (mergedNu > 0) {
          for (const ch of trafficKeys) {
            trafficSources[ch].newUsers = acquisitionByChannel[ch] ?? 0;
          }
          if (mergedNu < totalNuReport) {
            logger.warn(
              `[GA4] New users (acquisition): matched ${mergedNu}/${totalNuReport} — some rows had no session channel match`
            );
          }
        } else if (totalNuReport > 0) {
          // Acquisition report returned data but no channel matched — check inline totals
          const inlineTotal = trafficKeys.reduce((s, k) => s + (trafficSources[k].newUsers || 0), 0);
          if (inlineTotal === 0) {
            applyProportionalNewUsers(trafficSources, totalNuReport);
          } else {
            logger.info(`[GA4] New users: keeping inline newUsers (${inlineTotal}) — acquisition channels did not match session channels`);
          }
        }
      } else {
        const errText = await nuRes.text();
        logger.warn(`[GA4] New users by channel report failed: ${nuRes.status}`, errText.slice(0, 400));
      }
    } catch (e) {
      logger.warn('[GA4] New users by channel query failed:', e);
    }

    // Daily organic revenue (sessionDefaultChannelGroup rows whose canonical label includes "organic") — ROI revenue trend.
    let organicRevenueByDay: Record<string, number> = {};
    try {
      const dateRangeOr = { startDate: formatDate(startDate), endDate: formatDate(endDate) };
      const orgDailyBody = {
        languageCode: 'en',
        dateRanges: [dateRangeOr],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'totalRevenue' }],
        limit: '250000',
      };
      let orgDailyRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(orgDailyBody),
      });
      if (!orgDailyRes.ok && orgDailyRes.status === 400) {
        const e400 = await orgDailyRes.text();
        logger.warn(`[GA4] daily organic totalRevenue rejected (400), retry purchaseRevenue: ${e400.slice(0, 200)}`);
        orgDailyRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...orgDailyBody,
            metrics: [{ name: 'purchaseRevenue' }],
          }),
        });
      }
      if (orgDailyRes.ok) {
        const od = await orgDailyRes.json();
        for (const row of od.rows || []) {
          const dateRaw = row.dimensionValues?.[0]?.value;
          const ch = row.dimensionValues?.[1]?.value || '';
          if (!dateRaw || !isOrganicDefaultChannelGroup(ch)) continue;
          const formattedDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
          const rev = parseFloat(row.metricValues?.[0]?.value || '0') || 0;
          if (rev <= 0) continue;
          organicRevenueByDay[formattedDate] = (organicRevenueByDay[formattedDate] || 0) + rev;
        }
        const sumOd = Object.values(organicRevenueByDay).reduce((a, b) => a + b, 0);
        logger.info(
          `[GA4] organicRevenueByDay: ${Object.keys(organicRevenueByDay).length} days with rows, revenue sum=${sumOd.toFixed(2)}`
        );
      } else {
        const txt = await orgDailyRes.text();
        logger.warn(`[GA4] daily organic by channel failed (${orgDailyRes.status}): ${txt.slice(0, 400)}`);
      }
    } catch (e) {
      logger.warn('[GA4] organicRevenueByDay query failed:', e);
    }

    let organicSearchFallbackRows: GA4OrganicFallbackRow[] = [];
    try {
      const fallbackBaseBody = {
        languageCode: 'en',
        dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: {
              matchType: 'EXACT',
              value: 'Organic Search',
            },
          },
        },
        limit: '50000',
      };

      let fallbackRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...fallbackBaseBody,
          dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        }),
      });

      let labelField: 'landingPagePlusQueryString' | 'pagePath' = 'landingPagePlusQueryString';
      if (!fallbackRes.ok && fallbackRes.status === 400) {
        const err400 = await fallbackRes.text();
        logger.warn(`[GA4] organic landing pages (landingPagePlusQueryString) rejected: ${err400.slice(0, 220)}`);
        labelField = 'pagePath';
        fallbackRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...fallbackBaseBody,
            dimensions: [{ name: 'date' }, { name: 'pagePath' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          }),
        });
      }

      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        organicSearchFallbackRows = (fallbackData.rows || [])
          .map((row: any) => {
            const dateRaw = row.dimensionValues?.[0]?.value || '';
            const label = String(row.dimensionValues?.[1]?.value || '').trim();
            if (!dateRaw || !label || label === '(not set)') return null;
            return {
              date: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`,
              path: label,
              sessions: parseInt(row.metricValues?.[0]?.value || '0', 10),
              users: parseInt(row.metricValues?.[1]?.value || '0', 10),
              conversions: parseInt(row.metricValues?.[2]?.value || '0', 10),
            };
          })
          .filter((row: GA4OrganicFallbackRow | null): row is GA4OrganicFallbackRow => Boolean(row));
        logger.info(
          `[GA4] organicSearchFallbackRows (${labelField}): ${organicSearchFallbackRows.length} rows`
        );
      } else {
        const fallbackErr = await fallbackRes.text();
        logger.warn(`[GA4] organic landing page fallback failed (${fallbackRes.status}): ${fallbackErr.slice(0, 300)}`);
      }
    } catch (e) {
      logger.warn('[GA4] organicSearchFallbackRows query failed:', e);
    }

    // Top pages
    const pagesBody = {
      dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'newUsers' },
        { name: 'bounceRate' },
      ],
      limit: '50',
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    };

    let topPages: Array<any> = [];
    try {
      const pageRes = await fetch(
        `${GA4_DATA_API}/properties/${propertyId}:runReport`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(pagesBody),
        }
      );

      if (pageRes.ok) {
        const pageData = await pageRes.json();
        topPages = (pageData.rows || []).map((row: any) => ({
          path: row.dimensionValues?.[0]?.value || '/',
          pageViews: parseInt(row.metricValues?.[0]?.value || '0'),
          sessions: parseInt(row.metricValues?.[1]?.value || '0'),
          newUsers: parseInt(row.metricValues?.[2]?.value || '0'),
          bounceRate: parseFloat(row.metricValues?.[3]?.value || '0'),
        }));
      }
    } catch (e) {
      logger.warn('[GA4] Top pages query failed:', e);
    }

    /** Ημερομηνία × κανάλι → metrics (για φίλτρο ημερολογίου στο Web Analytics). */
    const dailyTrafficByChannel: Record<
      string,
      Record<
        string,
        { sessions: number; users: number; newUsers: number; conversions: number; totalRevenue: number }
      >
    > = {};
    try {
      const dr = { startDate: formatDate(startDate), endDate: formatDate(endDate) };
      const authH = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };
      let dcBody: Record<string, unknown> = {
        languageCode: 'en',
        dateRanges: [dr],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'conversions' },
          { name: 'totalRevenue' },
        ],
        limit: '250000',
      };
      let dcRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: authH,
        body: JSON.stringify(dcBody),
      });
      let revenueIdx: number | null = 4;
      if (!dcRes.ok && dcRes.status === 400) {
        const t = await dcRes.text();
        logger.warn(`[GA4] dailyTrafficByChannel (with revenue) rejected, retry without: ${t.slice(0, 200)}`);
        dcBody = {
          languageCode: 'en',
          dateRanges: [dr],
          dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'newUsers' },
            { name: 'conversions' },
          ],
          limit: '250000',
        };
        revenueIdx = null;
        dcRes = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
          method: 'POST',
          headers: authH,
          body: JSON.stringify(dcBody),
        });
      }
      if (dcRes.ok) {
        const dj = await dcRes.json();
        for (const row of dj.rows || []) {
          const dateRaw = row.dimensionValues?.[0]?.value || '';
          const ch = row.dimensionValues?.[1]?.value || 'Unknown';
          const ymd =
            dateRaw.length === 8
              ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
              : '';
          if (!ymd) continue;
          const vals = row.metricValues || [];
          const sessions = parseInt(vals[0]?.value || '0', 10);
          const users = parseInt(vals[1]?.value || '0', 10);
          const newUsers = parseInt(vals[2]?.value || '0', 10);
          const conversions = parseInt(vals[3]?.value || '0', 10);
          const totalRevenue =
            revenueIdx != null ? parseFloat(vals[revenueIdx]?.value || '0') || 0 : 0;
          if (!dailyTrafficByChannel[ymd]) dailyTrafficByChannel[ymd] = {};
          if (!dailyTrafficByChannel[ymd][ch]) {
            dailyTrafficByChannel[ymd][ch] = {
              sessions: 0,
              users: 0,
              newUsers: 0,
              conversions: 0,
              totalRevenue: 0,
            };
          }
          const cell = dailyTrafficByChannel[ymd][ch];
          cell.sessions += sessions;
          cell.users += users;
          cell.newUsers += newUsers;
          cell.conversions += conversions;
          cell.totalRevenue += totalRevenue;
        }
        logger.info(`[GA4] dailyTrafficByChannel: ${Object.keys(dailyTrafficByChannel).length} days`);
      } else {
        const err = await dcRes.text();
        logger.warn(`[GA4] dailyTrafficByChannel failed (${dcRes.status}): ${err.slice(0, 300)}`);
      }
    } catch (e) {
      logger.warn('[GA4] dailyTrafficByChannel exception:', e);
    }

    // Save to Firestore
    const docRef = db.doc(`ga4_data/${brandId}`);
    await docRef.set({
      propertyId,
      propertyName: conn.propertyName || '',
      dailyMetrics,
      trafficSources,
      dailyTrafficByChannel,
      organicRevenueByDay,
      organicSearchFallbackRows,
      topPages,
      syncedAt: FieldValue.serverTimestamp(),
      dateRange: {
        start: formatDate(startDate),
        end: formatDate(endDate),
      },
    });

    const dayCount = Object.keys(dailyMetrics).length;

    // Log import_jobs so "Τελευταίο sync" shows in UI
    await db.collection('import_jobs').add({
      brandId,
      type: 'analytics',
      source: 'ga4_api',
      status: 'completed',
      imported: dayCount,
      trafficChannels: Object.keys(trafficSources).length,
      topPagesCount: topPages.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[GA4] Saved ${dayCount} days of data for brand ${brandId}`);
    return { success: true, imported: dayCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[GA4] fetchGA4Data error:', msg);
    return { success: false, imported: 0, error: msg };
  }
}
