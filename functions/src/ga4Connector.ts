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

/**
 * Generate the OAuth consent URL for GA4
 */
export function getGA4AuthUrl(brandId: string, redirectUri: string, returnOrigin?: string): string {
  const { clientId } = getCredentials();
  const payload: Record<string, string> = { brandId, provider: 'ga4', redirectUri };
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
 * Exchange auth code for tokens and list GA4 properties
 */
export async function handleGA4Callback(
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
          refreshToken,
          accessToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          connectedAt: FieldValue.serverTimestamp(),
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
            refreshToken,
            accessToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            propertyId: properties[0].id,
            propertyName: properties[0].name,
            connectedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    // Multiple properties — let user pick
    await getDb().doc(`connectors/${brandId}`).set(
      {
        ga4: {
          connected: false,
          refreshToken,
          accessToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: properties.map((p) => ({ id: p.id, name: p.name })),
          connectedAt: FieldValue.serverTimestamp(),
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

/**
 * Refresh the access token
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getCredentials();

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

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
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
    const accessToken = await refreshAccessToken(conn.refreshToken);
    const propertyId = conn.propertyId;

    // Fetch last 90 days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Main metrics report
    const reportBody = {
      dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' },
        { name: 'eventCount' },
      ],
    };

    const reportRes = await fetch(
      `${GA4_DATA_API}/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(reportBody),
      }
    );

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
      };
    }

    // Traffic source breakdown (session-scoped channel).
    // Do not request `newUsers` with `sessionDefaultChannelGroup` — often incompatible or all zeros.
    // New users by acquisition channel: `firstUserDefaultChannelGroup` + `newUsers`, merged below (normalized keys).
    const sourceBody = {
      dateRanges: [{ startDate: formatDate(startDate), endDate: formatDate(endDate) }],
      dimensions: [
        { name: 'sessionDefaultChannelGroup' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
    };

    let trafficSources: Record<string, any> = {};
    try {
      const srcRes = await fetch(
        `${GA4_DATA_API}/properties/${propertyId}:runReport`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(sourceBody),
        }
      );

      if (srcRes.ok) {
        const srcData = await srcRes.json();
        for (const row of srcData.rows || []) {
          const channel = row.dimensionValues?.[0]?.value || 'Unknown';
          const vals = row.metricValues || [];
          trafficSources[channel] = {
            sessions: parseInt(vals[0]?.value || '0', 10),
            users: parseInt(vals[1]?.value || '0', 10),
            conversions: parseInt(vals[2]?.value || '0', 10),
            totalRevenue: parseFloat(vals[3]?.value || '0') || 0,
            newUsers: 0,
          };
        }
      }
    } catch (e) {
      logger.warn('[GA4] Traffic sources query failed:', e);
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

        for (const ch of trafficKeys) {
          trafficSources[ch].newUsers = 0;
        }

        for (const row of nuData.rows || []) {
          const rawChannel = row.dimensionValues?.[0]?.value || 'Unknown';
          const nu = parseInt(row.metricValues?.[0]?.value || '0', 10);
          totalNuReport += nu;
          const match = pickTrafficChannelForNu(rawChannel, trafficKeys);
          if (match) {
            trafficSources[match].newUsers += nu;
            mergedNu += nu;
          }
        }

        if (totalNuReport > 0 && mergedNu === 0) {
          applyProportionalNewUsers(trafficSources, totalNuReport);
        } else if (totalNuReport > 0 && mergedNu > 0 && mergedNu < totalNuReport) {
          logger.warn(
            `[GA4] New users: matched ${mergedNu}/${totalNuReport} — some acquisition rows had no session channel (locale or extra channel)`
          );
        }
      } else {
        const errText = await nuRes.text();
        logger.warn(`[GA4] New users by channel report failed: ${nuRes.status}`, errText.slice(0, 400));
      }
    } catch (e) {
      logger.warn('[GA4] New users by channel query failed:', e);
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

    // Save to Firestore
    const docRef = db.doc(`ga4_data/${brandId}`);
    await docRef.set({
      propertyId,
      propertyName: conn.propertyName || '',
      dailyMetrics,
      trafficSources,
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
