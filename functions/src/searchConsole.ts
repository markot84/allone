/**
 * Google Search Console connector
 *
 * Primary source for organic search terms shown on the GA4 page.
 * Uses Google OAuth with read-only Search Console scope and stores
 * site-level query rows for client-side date filtering.
 */

import * as admin from 'firebase-admin';
import { signState } from './oauthState';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { decryptToken, encryptToken } from './tokenCrypto';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SEARCH_CONSOLE_API = 'https://www.googleapis.com/webmasters/v3';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    clientId: raw(process.env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: raw(process.env.GOOGLE_ADS_CLIENT_SECRET),
  };
}

export interface SearchConsoleSite {
  id: string;
  name: string;
}

type SearchQueryRow = {
  date: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type SearchConsolePayload = {
  siteUrl: string;
  siteName: string;
  queryRows: SearchQueryRow[];
  dateRange: { start: string; end: string };
};

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function compactSiteLabel(siteUrl: string): string {
  const normalized = siteUrl.trim();
  if (!normalized) return '';
  if (normalized.startsWith('sc-domain:')) return normalized;
  return normalized.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function explainGoogleTokenError(status: number, rawText: string): string {
  try {
    const j = JSON.parse(rawText) as { error?: string; error_description?: string };
    if (j.error === 'invalid_grant') {
      return `Token refresh failed: ${status}. Το refresh token δεν είναι πλέον έγκυρο. Αποσυνδέστε το Search Console και συνδέστε το ξανά από Συνδέσεις.`;
    }
    if (j.error === 'invalid_client') {
      return `Token refresh failed: ${status}. Έλεγξε ότι τα GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET ταιριάζουν με το OAuth Client στο Google Cloud Console.`;
    }
    if (j.error_description) return `Token refresh failed: ${status} - ${j.error_description}`;
  } catch {
    /* not json */
  }
  const slice = rawText.replace(/\s+/g, ' ').trim().slice(0, 200);
  return slice ? `Token refresh failed: ${status} - ${slice}` : `Token refresh failed: ${status}`;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Search Console: λείπουν GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET.');
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
    logger.error(`[SearchConsole] Token refresh HTTP ${res.status}:`, { alertKey: ALERT.searchConsoleSyncFailed, body: rawText.slice(0, 500) });
    throw new Error(explainGoogleTokenError(res.status, rawText));
  }

  const data = JSON.parse(rawText) as { access_token?: string };
  if (!data.access_token) throw new Error('Token refresh failed: no access_token in response');
  return data.access_token;
}

function explainSearchConsoleError(status: number, body: string): string {
  if (status === 403) {
    return 'Search Console API not enabled or no access. Enable "Google Search Console API" in Cloud Console and verify the site in Search Console.';
  }
  if (status === 404) {
    return 'Το επιλεγμένο Search Console property δεν βρέθηκε ή δεν είναι προσβάσιμο από τον συγκεκριμένο Google λογαριασμό.';
  }
  const slice = body.replace(/\s+/g, ' ').trim().slice(0, 220);
  return `Search Console API error: ${status}${slice ? ` - ${slice}` : ''}`;
}

export function getSearchConsoleAuthUrl(
  brandId: string,
  redirectUri: string,
  returnOrigin?: string,
  oauthInitiatedByUid?: string
): string {
  const { clientId } = getCredentials();
  const payload: Record<string, string> = { brandId, provider: 'search_console', redirectUri };
  if (returnOrigin?.trim()) payload.returnOrigin = returnOrigin.trim();
  if (oauthInitiatedByUid?.trim()) payload.oauthInitiatedByUid = oauthInitiatedByUid.trim();
  const state = signState(payload);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const res = await fetch(`${SEARCH_CONSOLE_API}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const raw = await res.text();
  if (!res.ok) {
    logger.error(`[SearchConsole] Sites listing failed: ${res.status}`, { alertKey: ALERT.searchConsoleSyncFailed, body: raw.slice(0, 300) });
    throw new Error(explainSearchConsoleError(res.status, raw));
  }

  const data = raw ? (JSON.parse(raw) as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }) : {};
  const sites: SearchConsoleSite[] = [];
  for (const site of data.siteEntry || []) {
    const siteUrl = String(site.siteUrl || '').trim();
    const permissionLevel = String(site.permissionLevel || '').trim();
    if (!siteUrl || permissionLevel === 'siteUnverifiedUser') continue;
    sites.push({
      id: siteUrl,
      name: compactSiteLabel(siteUrl) || siteUrl,
    });
  }
  return sites;
}

export async function handleSearchConsoleCallback(
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
      logger.error('[SearchConsole] Token exchange failed:', { alertKey: ALERT.searchConsoleSyncFailed, err });
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    const accessToken = tokens.access_token || '';
    const refreshToken = tokens.refresh_token || '';
    if (!accessToken || !refreshToken) {
      return { success: false, error: 'Search Console OAuth δεν επέστρεψε access/refresh token. Δοκιμάστε ξανά τη σύνδεση.' };
    }

    const docRef = getDb().doc(`connectors/${brandId}`);
    await docRef.set(
      {
        search_console: {
          refreshToken: encryptToken(refreshToken),
          accessToken: encryptToken(accessToken),
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          connectedAt: FieldValue.serverTimestamp(),
          oauthInitiatedByUid: FieldValue.delete(),
        },
      },
      { merge: true }
    );

    const sites = await listSearchConsoleSites(accessToken);
    if (sites.length === 0) {
      return {
        success: false,
        error: 'Δεν βρέθηκαν Search Console properties στον λογαριαριασμό σας. Βεβαιωθείτε ότι το site είναι verified στο Google Search Console.',
      };
    }

    if (sites.length === 1) {
      await docRef.set(
        {
          search_console: {
            connected: true,
            refreshToken: encryptToken(refreshToken),
            accessToken: encryptToken(accessToken),
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            siteUrl: sites[0].id,
            siteName: sites[0].name,
            connectedAt: FieldValue.serverTimestamp(),
            oauthInitiatedByUid: FieldValue.delete(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    await docRef.set(
      {
        search_console: {
          connected: false,
          refreshToken: encryptToken(refreshToken),
          accessToken: encryptToken(accessToken),
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: sites.map((site) => ({ id: site.id, name: site.name })),
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
    logger.error('[SearchConsole] Callback error:', { alertKey: ALERT.searchConsoleSyncFailed, err });
    return { success: false, error: msg };
  }
}

async function fetchSearchConsoleRows(accessToken: string, siteUrl: string, startDate: string, endDate: string): Promise<SearchQueryRow[]> {
  const rows: SearchQueryRow[] = [];
  const sitePath = encodeURIComponent(siteUrl);
  // Pagination: η GSC API επιστρέφει μέγιστο 25.000 rows ανά request. Για 3ετές ιστορικό
  // με χιλιάδες queries χρειάζεται multi-page fetch με startRow offset.
  const pageSize = 25000;
  const maxPages = 20; // ασφαλιστικό όριο: 500k rows

  for (let page = 0; page < maxPages; page++) {
    const startRow = page * pageSize;
    const res = await fetch(`${SEARCH_CONSOLE_API}/sites/${sitePath}/searchAnalytics/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['date', 'query'],
        type: 'web',
        rowLimit: pageSize,
        startRow,
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      logger.error(`[SearchConsole] Query failed (page ${page}, status ${res.status})`, { alertKey: ALERT.searchConsoleSyncFailed, body: raw.slice(0, 300) });
      throw new Error(explainSearchConsoleError(res.status, raw));
    }

    const data = raw ? (JSON.parse(raw) as { rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }) : {};
    const pageRows = data.rows || [];
    for (const row of pageRows) {
      const date = String(row.keys?.[0] || '').trim();
      const query = String(row.keys?.[1] || '').trim();
      if (!date || !query) continue;
      rows.push({
        date,
        query,
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
      });
    }

    // Λιγότερες από pageSize → φτάσαμε στο τέλος.
    if (pageRows.length < pageSize) break;
  }

  logger.info(`[SearchConsole] Fetched ${rows.length} rows for ${siteUrl} (${startDate} → ${endDate})`);
  return rows;
}

export async function fetchSearchConsoleData(
  brandId: string
): Promise<{ success: boolean; imported: number; error?: string }> {
  const db = getDb();
  const connDoc = await db.doc(`connectors/${brandId}`).get();
  const conn = (connDoc.data() || {}).search_console as {
    connected?: boolean;
    refreshToken?: string;
    siteUrl?: string;
    siteName?: string;
  } | undefined;

  if (!conn?.connected || !conn?.refreshToken || !conn?.siteUrl) {
    return { success: false, imported: 0, error: 'Search Console not connected or no property selected' };
  }

  try {
    const refreshTokenPlain = decryptToken(conn.refreshToken);
    if (!refreshTokenPlain) {
      return { success: false, imported: 0, error: 'Search Console token unavailable - reconnect required' };
    }

    const accessToken = await refreshAccessToken(refreshTokenPlain);
    const endDateObj = new Date();
    const startDateObj = new Date();
    // Window: 1 έτος. Τραβάμε μόνο search terms (date+query) — δεν χρειαζόμαστε
    // μεγαλύτερο ιστορικό και κρατάμε χαμηλό το request payload / Firestore doc size.
    startDateObj.setUTCFullYear(startDateObj.getUTCFullYear() - 1);

    const startDate = formatDate(startDateObj);
    const endDate = formatDate(endDateObj);
    let queryRows = await fetchSearchConsoleRows(accessToken, conn.siteUrl, startDate, endDate);

    // Firestore doc limit: 1 MiB. Each queryRow serialises to ~100-140 bytes.
    // Cap to 8 000 highest-click rows to stay safely under 1MB.
    const MAX_SC_ROWS = 8_000;
    if (queryRows.length > MAX_SC_ROWS) {
      const originalCount = queryRows.length;
      queryRows.sort((a, b) => b.clicks - a.clicks);
      queryRows = queryRows.slice(0, MAX_SC_ROWS);
      logger.info(
        `[SearchConsole] Capped queryRows to ${MAX_SC_ROWS} (original ${originalCount}) for brand ${brandId}`
      );
    }

    const payload: SearchConsolePayload = {
      siteUrl: conn.siteUrl,
      siteName: conn.siteName || compactSiteLabel(conn.siteUrl),
      queryRows,
      dateRange: { start: startDate, end: endDate },
    };

    await db.doc(`search_console_data/${brandId}`).set({
      ...payload,
      syncedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('import_jobs').add({
      brandId,
      type: 'analytics',
      source: 'search_console_api',
      status: 'completed',
      imported: queryRows.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    // Update connector doc so the UI shows the last sync date
    await db.doc(`connectors/${brandId}`).set(
      { search_console: { lastSyncAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );

    return { success: true, imported: queryRows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[SearchConsole] fetchSearchConsoleData error:', { alertKey: ALERT.searchConsoleSyncFailed, err });
    return { success: false, imported: 0, error: msg };
  }
}
