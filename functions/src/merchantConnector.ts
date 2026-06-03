/**
 * Google Merchant Center Connector
 *
 * Reuses Google OAuth (same client_id/secret as Google Ads) with
 * additional scope: https://www.googleapis.com/auth/content
 *
 * Fetches PriceCompetitivenessProductView to get benchmark prices
 * per GTIN, enabling SKU-level price comparison vs market.
 */

import * as admin from 'firebase-admin';
import { signState } from './oauthState';
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
const MERCHANT_API_BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';

const SCOPES = [
  'https://www.googleapis.com/auth/content',
];

/** True when Google returns placeholder labels instead of a real business name. */
function isGenericMerchantAccountName(name: string): boolean {
  const t = name.trim();
  if (!t) return true;
  if (/^account$/i.test(t)) return true;
  if (/^account\s+\d+$/i.test(t)) return true;
  return false;
}

/** Prefer API display name; if generic, use verified website hostname when available. */
function pickMerchantDisplayName(accData: Record<string, unknown>, mid: string): string {
  const raw = typeof accData.name === 'string' ? accData.name.trim() : '';
  if (!isGenericMerchantAccountName(raw)) return raw;

  const urlRaw = accData.websiteUrl;
  if (typeof urlRaw === 'string' && urlRaw.trim().length > 0) {
    try {
      const u = urlRaw.trim().startsWith('http') ? urlRaw.trim() : `https://${urlRaw.trim()}`;
      const host = new URL(u).hostname.replace(/^www\./i, '');
      if (host) return host;
    } catch {
      /* ignore invalid URL */
    }
  }

  return raw || `Merchant\u00A0${mid}`;
}

async function fetchMerchantAccountJson(
  merchantId: string,
  accessToken: string
): Promise<Record<string, unknown> | null> {
  try {
    const accRes = await fetch(`${MERCHANT_API_BASE}/${merchantId}/accounts/${merchantId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!accRes.ok) return null;
    return (await accRes.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolveMerchantSellerLabel(
  merchantId: string,
  accessToken: string,
  storedName: string
): Promise<string> {
  const accData = await fetchMerchantAccountJson(merchantId, accessToken);
  if (accData) {
    return pickMerchantDisplayName(accData, merchantId);
  }
  const t = storedName.trim();
  return t || `Merchant\u00A0${merchantId}`;
}

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    clientId: raw(process.env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: raw(process.env.GOOGLE_ADS_CLIENT_SECRET),
  };
}

export function getMerchantAuthUrl(
  brandId: string,
  redirectUri: string,
  returnOrigin?: string,
  oauthInitiatedByUid?: string
): string {
  const { clientId } = getCredentials();
  const payload: Record<string, string> = { brandId, provider: 'merchant', redirectUri };
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

export async function handleMerchantCallback(
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
      logger.error('[Merchant] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const tokens = await res.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;

    const accounts = await listMerchantAccounts(accessToken);
    logger.info(`[Merchant] Found ${accounts.length} accounts for brand ${brandId}`);

    const oauthUidPatch = oauthInitiatedByUid?.trim()
      ? { oauthInitiatedByUid: oauthInitiatedByUid.trim() }
      : { oauthInitiatedByUid: FieldValue.delete() };

    if (accounts.length === 0) {
      await getDb().doc(`connectors/${brandId}`).set(
        {
          merchant: {
            connected: false,
            refreshToken: encryptToken(refreshToken),
            accessToken: encryptToken(accessToken),
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            pendingAccountSelection: true,
            availableAccounts: [],
            connectedAt: FieldValue.serverTimestamp(),
            ...oauthUidPatch,
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    if (accounts.length === 1) {
      await getDb().doc(`connectors/${brandId}`).set(
        {
          merchant: {
            connected: true,
            refreshToken: encryptToken(refreshToken),
            accessToken: encryptToken(accessToken),
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            merchantId: accounts[0].id,
            merchantName: accounts[0].name,
            pendingAccountSelection: false,
            connectedAt: FieldValue.serverTimestamp(),
            oauthInitiatedByUid: FieldValue.delete(),
          },
        },
        { merge: true }
      );
      return { success: true };
    }

    await getDb().doc(`connectors/${brandId}`).set(
      {
        merchant: {
          connected: false,
          refreshToken: encryptToken(refreshToken),
          accessToken: encryptToken(accessToken),
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          pendingAccountSelection: true,
          availableAccounts: accounts,
          connectedAt: FieldValue.serverTimestamp(),
          ...oauthUidPatch,
        },
      },
      { merge: true }
    );
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Merchant] Callback error:', msg);
    return { success: false, error: msg };
  }
}

export async function selectMerchantAccount(
  brandId: string,
  merchantId: string,
  merchantName: string
): Promise<void> {
  await getDb().doc(`connectors/${brandId}`).set(
    {
      merchant: {
        connected: true,
        merchantId,
        merchantName,
        pendingAccountSelection: false,
        availableAccounts: FieldValue.delete(),
        oauthInitiatedByUid: FieldValue.delete(),
      },
    },
    { merge: true }
  );
  logger.info(`[Merchant] Account selected for brand ${brandId}: ${merchantId}`);
}

/**
 * Lists Merchant Center accounts the user may select.
 *
 * `accounts/authinfo` only returns **identifiers tied to the user** (standalone + samples of MCA
 * access) — not every sub-account under a Multi-Client Account. For each MCA (`aggregatorId`),
 * we paginate `GET /{mcaId}/accounts` so Performance+ shows the same breadth as the GMC switcher.
 */
async function listMerchantAccounts(
  accessToken: string
): Promise<{ id: string; name: string }[]> {
  const byId = new Map<string, { id: string; name: string }>();

  const fetchOneAccount = async (merchantId: string) => {
    if (byId.has(merchantId)) return;
    try {
      const accRes = await fetch(`${MERCHANT_API_BASE}/${merchantId}/accounts/${merchantId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (accRes.ok) {
        const accData = (await accRes.json()) as Record<string, unknown>;
        byId.set(merchantId, { id: merchantId, name: pickMerchantDisplayName(accData, merchantId) });
      } else {
        byId.set(merchantId, { id: merchantId, name: `Merchant\u00A0${merchantId}` });
      }
    } catch {
      byId.set(merchantId, { id: merchantId, name: `Merchant\u00A0${merchantId}` });
    }
  };

  let identifiers: { merchantId?: string; aggregatorId?: string }[] = [];
  try {
    const res = await fetch(`${MERCHANT_API_BASE}/accounts/authinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      logger.warn('[Merchant] authinfo failed:', res.status);
      return [];
    }

    const data = (await res.json()) as { accountIdentifiers?: typeof identifiers };
    identifiers = data.accountIdentifiers || [];
  } catch {
    return [];
  }

  const mcaIds = new Set<string>();
  for (const entry of identifiers) {
    if (entry.aggregatorId) mcaIds.add(String(entry.aggregatorId));
  }

  const MCA_PAGE = 250;
  const MAX_MCA_PAGES = 200;

  for (const mcaId of mcaIds) {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_MCA_PAGES; page++) {
      const url = new URL(`${MERCHANT_API_BASE}/${mcaId}/accounts`);
      url.searchParams.set('maxResults', String(MCA_PAGE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        logger.warn(`[Merchant] accounts.list MCA ${mcaId} HTTP ${res.status}`);
        break;
      }

      const listData = (await res.json()) as {
        resources?: Record<string, unknown>[];
        nextPageToken?: string;
      };

      for (const acc of listData.resources || []) {
        const raw = acc.id as string | number | undefined;
        const id = raw != null ? String(raw) : '';
        if (!id) continue;
        const name = pickMerchantDisplayName(acc, id);
        byId.set(id, { id, name });
      }

      pageToken = listData.nextPageToken;
      if (!pageToken) break;
    }
  }

  // Standalone merchants + any authinfo ID not returned by MCA list (permissions / edge cases)
  for (const entry of identifiers) {
    const mid = entry.merchantId != null && String(entry.merchantId).trim() !== ''
      ? String(entry.merchantId)
      : '';
    if (mid) await fetchOneAccount(mid);
  }

  const accounts = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'el', { sensitivity: 'base' })
  );

  logger.info(
    `[Merchant] listMerchantAccounts: ${identifiers.length} authinfo rows, ${mcaIds.size} MCA(s), ${accounts.length} account(s) total`
  );

  return accounts;
}

type RefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; httpStatus: number; googleError?: string; googleErrorDescription?: string; rawBody?: string };

async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
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

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    const googleError = typeof data.error === 'string' ? data.error : undefined;
    const googleErrorDescription =
      typeof data.error_description === 'string' ? data.error_description : undefined;
    logger.error(
      `[Merchant] Token refresh failed HTTP ${res.status} error=${googleError || 'n/a'}: ${text.slice(0, 800)}`
    );
    return {
      ok: false,
      httpStatus: res.status,
      googleError,
      googleErrorDescription,
      rawBody: text.slice(0, 500),
    };
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    logger.error('[Merchant] Token refresh OK but missing access_token in body');
    return { ok: false, httpStatus: res.status, rawBody: text.slice(0, 500) };
  }

  return { ok: true, accessToken };
}

/** Μήνυμα για UI όταν το refresh token δεν είναι πλέον έγκυρο. */
function merchantRefreshErrorMessage(ref: Extract<RefreshResult, { ok: false }>): string {
  const code = ref.googleError || '';
  if (code === 'invalid_grant') {
    return (
      'Η σύνδεση Google Merchant Center έληξε ή ανακλήθηκε. Στις Συνδέσεις: «Αποσύνδεση» στο Merchant Center και συνδέστε ξανά με Google (νέο OAuth).'
    );
  }
  if (code === 'invalid_client') {
    return (
      'Σφάλμα ρυθμίσεων OAuth (invalid_client). Έλεγξε ότι το Google Cloud OAuth client ταιριάζει με το Performance+ (ίδιο client ID/secret με Google Ads).'
    );
  }
  const hint = ref.googleErrorDescription
    ? ` (${ref.googleErrorDescription.slice(0, 120)})`
    : '';
  return `Αποτυχία ανανέωσης token Google${code ? `: ${code}` : ''}${hint}. Δοκίμασε αποσύνδεση και ξανά σύνδεση Merchant Center.`;
}

const REPORT_PAGE_SIZE = 5000;
/** Safety cap per report type — Merchant API allows up to 5000/page; we paginate until this total. */
const MAX_REPORT_ROWS = 25000;
/** Max SKU docs στη Firestore ανά sync — καλύπτει μεγάλους καταλόγους χωρίς unbounded writes. */
const MAX_SKU_DOCS_PER_SYNC = 20000;

/**
 * Paginated reports.search — uses max page size and tolerates alternate next-page field names.
 */
async function searchMerchantReports(
  merchantId: string,
  accessToken: string,
  query: string,
  label: string
): Promise<any[]> {
  const url = `${MERCHANT_API_BASE}/${merchantId}/reports/search`;
  const allRows: any[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    page += 1;
    const body: Record<string, unknown> = {
      query,
      pageSize: REPORT_PAGE_SIZE,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`[Merchant] reports.search failed [${label}] (${res.status}): ${errText.slice(0, 500)}`);
      throw new Error(`Merchant API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: Record<string, unknown> = await res.json();
    const results = (data.results as any[]) || [];
    allRows.push(...results);
    pageToken = (data.nextPageToken || data.next_page_token) as string | undefined;

    if (allRows.length >= MAX_REPORT_ROWS) {
      logger.warn(`[Merchant] [${label}] stopping at ${allRows.length} rows (cap ${MAX_REPORT_ROWS})`);
      break;
    }
    logger.info(`[Merchant] [${label}] page ${page}: +${results.length} rows (total ${allRows.length})`);
  } while (pageToken);

  return allRows;
}

function firstGtin(gtin: unknown): string {
  if (Array.isArray(gtin) && gtin.length > 0) return String(gtin[0]);
  if (typeof gtin === 'string' && gtin) return gtin;
  return '';
}

/** Reports API επιστρέφει συχνά camelCase, μερικές φορές snake_case — διαβάζουμε και τα δύο. */
function getProductView(row: any): Record<string, unknown> | null {
  const pv = row?.productView ?? row?.product_view;
  return pv && typeof pv === 'object' ? (pv as Record<string, unknown>) : null;
}

function getPriceCompetitiveness(row: any): Record<string, unknown> | null {
  const pc = row?.priceCompetitiveness ?? row?.price_competitiveness;
  return pc && typeof pc === 'object' ? (pc as Record<string, unknown>) : null;
}

function getPriceInsightsBlock(row: any): Record<string, unknown> | null {
  const pi = row?.priceInsights ?? row?.price_insights;
  return pi && typeof pi === 'object' ? (pi as Record<string, unknown>) : null;
}

/**
 * REST product id: `channel:contentLanguage:targetCountry:offerId` (offerId may contain `:`).
 * Reports can return the same offer with different `contentLanguage` (e.g. el vs en); full-string
 * equality then misses the join — we match on channel + country + offer tail instead.
 */
function productMergeKey(fullId: string): string {
  const s = String(fullId).trim();
  const parts = s.split(':');
  if (parts.length < 4) return s;
  const channel = parts[0];
  const country = parts[2];
  const offerRest = parts.slice(3).join(':');
  return `${channel}:${country}:${offerRest}`;
}

function microsFrom(obj: Record<string, unknown> | null | undefined, camel: string, snake: string): number {
  if (!obj) return 0;
  const v = obj[camel] ?? obj[snake];
  if (v == null) return 0;
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? parseInt(t, 10) || 0 : 0;
  }
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.round(v);
  return 0;
}

function strField(
  obj: Record<string, unknown> | null | undefined,
  camel: string,
  snake: string,
  fallback = ''
): string {
  if (!obj) return fallback;
  const v = obj[camel] ?? obj[snake];
  return v != null && v !== '' ? String(v) : fallback;
}

function countryCodeNorm(row: any): string {
  return strField(getPriceCompetitiveness(row), 'countryCode', 'country_code').toUpperCase();
}

/** Προτίμηση: GR/EL με benchmark > 0, αλλιώς οποιαδήποτε χώρα με benchmark, αλλιώς GR, αλλιώς πρώτη γραμμή. */
function pickPreferredCompetitivenessRow(arr: any[]): any {
  const bench = (r: any) =>
    microsFrom(getPriceCompetitiveness(r), 'benchmarkPriceMicros', 'benchmark_price_micros');
  const grLike = (r: any) => {
    const c = countryCodeNorm(r);
    return c === 'GR' || c === 'EL';
  };
  const grWithBench = arr.find((r) => grLike(r) && bench(r) > 0);
  if (grWithBench) return grWithBench;
  const anyWithBench = arr.find((r) => bench(r) > 0);
  if (anyWithBench) return anyWithBench;
  const grOnly = arr.find((r) => grLike(r));
  return grOnly ?? arr[0];
}

/** One competitiveness row per product (keyed by productMergeKey, not raw id). */
function groupCompetitivenessByProduct(rows: any[]): Map<string, any> {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const id = getProductView(row)?.id as string | undefined;
    if (!id) continue;
    const key = productMergeKey(id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const out = new Map<string, any>();
  for (const [key, arr] of groups) {
    out.set(key, pickPreferredCompetitivenessRow(arr));
  }
  return out;
}

/** Καθαρίζει όλα τα SKU docs πριν από πλήρη re-import μετά το sync. */
async function clearPriceBenchmarkSkus(brandId: string): Promise<void> {
  const col = getDb().collection('price_benchmarks').doc(brandId).collection('skus');
  const snap = await col.get();
  if (snap.empty) return;
  const BATCH = 450;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = getDb().batch();
    for (const d of docs.slice(i, i + BATCH)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }
  logger.info(`[Merchant] Cleared ${docs.length} prior benchmark SKU docs for brand ${brandId}`);
}

/**
 * Fetch price benchmarks from Google Merchant Center.
 * Αποθηκεύει όλα τα SKUs από ProductView (κατάλογος) + στοιχεία από PriceCompetitiveness όταν υπάρχουν.
 * Η στήλη benchmark μπορεί να είναι 0 όταν η Google δεν έχει ακόμη benchmark για την αγορά/SKU.
 */
export async function fetchPriceBenchmarks(brandId: string): Promise<{
  success: boolean;
  imported: number;
  /** Πόσα από τα `imported` έχουν benchmark τιμάς αγοράς > 0 */
  withMarketBenchmark?: number;
  error?: string;
}> {
  const connectorDoc = await getDb().doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.merchant;

  if (!connector?.connected || !connector?.refreshToken) {
    return { success: false, imported: 0, error: 'Merchant Center not connected' };
  }

  const merchantId = connector.merchantId;
  if (!merchantId) {
    return { success: false, imported: 0, error: 'No Merchant Center account selected' };
  }

  const refreshTokenPlain = decryptToken(connector.refreshToken);
  if (!refreshTokenPlain) {
    return { success: false, imported: 0, error: 'Merchant token unavailable — reconnect required' };
  }
  const tokenResult = await refreshAccessToken(refreshTokenPlain);
  if (!tokenResult.ok) {
    return {
      success: false,
      imported: 0,
      error: merchantRefreshErrorMessage(tokenResult),
    };
  }
  const accessToken = tokenResult.accessToken;

  try {
    const competitivenessQuery = `
      SELECT
        product_view.id,
        product_view.title,
        product_view.brand,
        product_view.price_micros,
        product_view.currency_code,
        price_competitiveness.country_code,
        price_competitiveness.benchmark_price_micros,
        price_competitiveness.benchmark_price_currency_code
      FROM PriceCompetitivenessProductView
    `;

    const productCatalogQuery = `
      SELECT
        product_view.id,
        product_view.title,
        product_view.brand,
        product_view.price_micros,
        product_view.currency_code,
        product_view.gtin
      FROM ProductView
    `;

    let compRows: any[] = [];
    try {
      compRows = await searchMerchantReports(merchantId, accessToken, competitivenessQuery, 'PriceCompetitiveness');
    } catch (e) {
      logger.warn('[Merchant] PriceCompetitiveness query failed:', e);
    }

    let catalogRows: any[] = [];
    try {
      catalogRows = await searchMerchantReports(merchantId, accessToken, productCatalogQuery, 'ProductView');
    } catch (e) {
      logger.warn('[Merchant] ProductView catalog query failed:', e);
    }

    logger.info(
      `[Merchant] Benchmarks: ${compRows.length} competitiveness rows, ${catalogRows.length} catalog rows (${merchantId})`
    );

    const compByProduct = groupCompetitivenessByProduct(compRows);

    type SkuDoc = {
      productId: string;
      title: string;
      brand: string;
      gtin: string;
      yourPrice: number;
      benchmarkPrice: number;
      priceDiff: number;
      currency: string;
      country: string;
      updatedAt: string;
    };

    const merged = new Map<string, SkuDoc>();

    const skuFromCompRow = (row: any): SkuDoc | null => {
      const pv = getProductView(row);
      const pc = getPriceCompetitiveness(row);
      const productId = pv?.id as string | undefined;
      if (!productId) return null;
      const yourPriceMicros = microsFrom(pv, 'priceMicros', 'price_micros');
      const benchmarkMicros = microsFrom(pc, 'benchmarkPriceMicros', 'benchmark_price_micros');
      const yourPrice = yourPriceMicros / 1_000_000;
      const benchmarkPrice = benchmarkMicros / 1_000_000;
      const priceDiff =
        benchmarkPrice > 0
          ? Math.round(((yourPrice - benchmarkPrice) / benchmarkPrice) * 1000) / 10
          : 0;
      return {
        productId,
        title: strField(pv, 'title', 'title'),
        brand: strField(pv, 'brand', 'brand'),
        gtin: firstGtin(pv?.gtin),
        yourPrice,
        benchmarkPrice,
        priceDiff,
        currency: strField(pv, 'currencyCode', 'currency_code', 'EUR'),
        country: strField(pc, 'countryCode', 'country_code', 'GR'),
        updatedAt: new Date().toISOString(),
      };
    };

    for (const row of catalogRows) {
      const pv = getProductView(row);
      const productId = pv?.id as string | undefined;
      if (!productId) continue;

      const comp = compByProduct.get(productMergeKey(productId));
      const yourPriceMicros = microsFrom(pv, 'priceMicros', 'price_micros');
      const yourPrice = yourPriceMicros / 1_000_000;

      if (comp) {
        const sku = skuFromCompRow(comp);
        if (sku) merged.set(productId, sku);
      } else {
        merged.set(productId, {
          productId,
          title: strField(pv, 'title', 'title'),
          brand: strField(pv, 'brand', 'brand'),
          gtin: firstGtin(pv?.gtin),
          yourPrice,
          benchmarkPrice: 0,
          priceDiff: 0,
          currency: strField(pv, 'currencyCode', 'currency_code', 'EUR'),
          country: 'GR',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const catalogMergeKeys = new Set<string>();
    for (const row of catalogRows) {
      const pid = getProductView(row)?.id as string | undefined;
      if (pid) catalogMergeKeys.add(productMergeKey(pid));
    }

    // Competitiveness rows whose offer did not appear in ProductView catalog (unusual)
    for (const [mkey, compRow] of compByProduct) {
      if (catalogMergeKeys.has(mkey)) continue;
      const pv = getProductView(compRow);
      const pid = pv?.id as string | undefined;
      if (!pid) continue;
      const sku = skuFromCompRow(compRow);
      if (sku) merged.set(pid, sku);
    }

    const allMerged = [...merged.values()];
    const withMarketBenchmarkCount = allMerged.filter((r) => r.benchmarkPrice > 0).length;
    if (compRows.length > 0 && withMarketBenchmarkCount === 0 && allMerged.length > 0) {
      const sample = compRows[0];
      logger.warn(
        `[Merchant] ${compRows.length} competitiveness rows, catalog ${allMerged.length} SKUs, αλλά 0 με benchmark>0 (parsing ή Google χωρίς τιμή αγοράς). Keys δείγματος: ${Object.keys(sample || {}).join(',')}`
      );
    }

    const rowsToWrite = allMerged.slice(0, MAX_SKU_DOCS_PER_SYNC);
    if (allMerged.length > MAX_SKU_DOCS_PER_SYNC) {
      logger.warn(
        `[Merchant] Catalog ${allMerged.length} SKUs — αποθήκευση πρώτων ${MAX_SKU_DOCS_PER_SYNC} (όριο ανά sync).`
      );
    }

    await clearPriceBenchmarkSkus(brandId);

    if (rowsToWrite.length === 0) {
      logger.info(`[Merchant] No catalog SKUs for brand ${brandId} (merged ${merged.size})`);
      await getDb().collection('import_jobs').add({
        brandId,
        type: 'price_benchmarks',
        source: 'merchant_center_api',
        status: 'completed',
        imported: 0,
        withMarketBenchmark: 0,
        insightsImported: 0,
        failed: 0,
        errors: [],
        warnings: [
          'Δεν επιστράφηκαν γραμμές από ProductView (έλεγξε Merchant ID, OAuth, ότι ο λογαριασμός GMC έχει ενεργά προϊόντα στο feed).',
        ],
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, imported: 0, withMarketBenchmark: 0 };
    }

    let count = 0;
    const BATCH_LIMIT = 450;

    for (let i = 0; i < rowsToWrite.length; i += BATCH_LIMIT) {
      const batch = getDb().batch();
      const chunk = rowsToWrite.slice(i, i + BATCH_LIMIT);

      for (const sku of chunk) {
        const docId = sku.productId.replace(/[/\\:]/g, '_');
        const ref = getDb()
          .collection('price_benchmarks')
          .doc(brandId)
          .collection('skus')
          .doc(docId);

        batch.set(ref, sku);
        count++;
      }

      await batch.commit();
    }

    const withMarketBenchmarkWritten = rowsToWrite.filter((r) => r.benchmarkPrice > 0).length;

    logger.info(
      `[Merchant] Imported ${count} SKU docs for ${brandId} (${withMarketBenchmarkWritten} με benchmark τιμάς αγοράς > 0)`
    );

    // Also fetch PriceInsightsProductView (non-blocking)
    let insightsCount = 0;
    try {
      const storedName = typeof connector.merchantName === 'string' ? connector.merchantName : '';
      const resolvedSellerLabel = await resolveMerchantSellerLabel(merchantId, accessToken, storedName);
      if (
        resolvedSellerLabel &&
        isGenericMerchantAccountName(storedName) &&
        !isGenericMerchantAccountName(resolvedSellerLabel)
      ) {
        await getDb().doc(`connectors/${brandId}`).set(
          { merchant: { merchantName: resolvedSellerLabel } },
          { merge: true }
        );
      }
      insightsCount = await fetchPriceInsights(
        brandId,
        merchantId,
        accessToken,
        resolvedSellerLabel
      );
    } catch (e) {
      logger.warn('[Merchant] PriceInsights fetch failed (non-blocking):', e);
    }

    await getDb().collection('import_jobs').add({
      brandId,
      type: 'price_benchmarks',
      source: 'merchant_center_api',
      status: 'completed',
      imported: count,
      withMarketBenchmark: withMarketBenchmarkWritten,
      insightsImported: insightsCount,
      failed: 0,
      errors: [],
      warnings:
        withMarketBenchmarkWritten === 0 && count > 0
          ? [
              'Ο κατάλογος εισήχθη, αλλά το GMC δεν επέστρεψε benchmark τιμάς αγοράς για κανένα SKU (συχνό για νέους λογαριασμούς ή όταν λείπουν GTIN). Ελέγξτε feed & Growth › Price competitiveness στο Merchant Center.',
            ]
          : [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, imported: count, withMarketBenchmark: withMarketBenchmarkWritten };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Merchant] Error:`, msg);
    return { success: false, imported: 0, error: msg };
  }
}

/**
 * Fetch Price Insights (suggested prices + predicted impact) from GMC.
 */
async function fetchPriceInsights(
  brandId: string,
  merchantId: string,
  accessToken: string,
  merchantDisplayName: string
): Promise<number> {
  const query = `
    SELECT
      product_view.id,
      product_view.title,
      product_view.brand,
      product_view.price_micros,
      product_view.currency_code,
      price_insights.suggested_price_micros,
      price_insights.suggested_price_currency_code,
      price_insights.predicted_impressions_change_fraction,
      price_insights.predicted_clicks_change_fraction,
      price_insights.predicted_conversions_change_fraction
    FROM PriceInsightsProductView
  `;

  let allRows: any[] = [];
  try {
    allRows = await searchMerchantReports(merchantId, accessToken, query, 'PriceInsights');
  } catch (e) {
    logger.warn('[Merchant] PriceInsights query failed:', e);
    return 0;
  }

  logger.info(`[Merchant] Got ${allRows.length} price insight rows for ${merchantId}`);

  if (allRows.length === 0) return 0;

  const insights: any[] = [];

  for (const row of allRows) {
    const pv = getProductView(row);
    const pi = getPriceInsightsBlock(row);
    const productId = pv?.id as string | undefined;
    if (!productId) continue;

    const priceMicros = microsFrom(pv, 'priceMicros', 'price_micros');
    const suggestedMicros = microsFrom(pi, 'suggestedPriceMicros', 'suggested_price_micros');
    const currentPrice = priceMicros / 1_000_000;
    const suggestedPrice = suggestedMicros / 1_000_000;

    const frac = (camel: string, snake: string) =>
      parseFloat(
        String(
          (pi?.[camel] ?? pi?.[snake] ?? '0') as string | number
        )
      );

    insights.push({
      productId,
      title: strField(pv, 'title', 'title'),
      brand: strField(pv, 'brand', 'brand'),
      currency: strField(pv, 'currencyCode', 'currency_code', 'EUR'),
      currentPrice,
      suggestedPrice,
      priceDiffPercent: currentPrice > 0
        ? Math.round(((suggestedPrice - currentPrice) / currentPrice) * 1000) / 10
        : 0,
      predictedImpressionsChange: frac('predictedImpressionsChangeFraction', 'predicted_impressions_change_fraction'),
      predictedClicksChange: frac('predictedClicksChangeFraction', 'predicted_clicks_change_fraction'),
      predictedConversionsChange: frac('predictedConversionsChangeFraction', 'predicted_conversions_change_fraction'),
    });
  }

  // Store as a single document (capped at 2000 items for safety)
  await getDb().doc(`price_insights/${brandId}`).set({
    items: insights.slice(0, 2000),
    count: insights.length,
    sellerName: merchantDisplayName.trim() || null,
    syncedAt: FieldValue.serverTimestamp(),
  });

  logger.info(`[Merchant] Saved ${insights.length} price insights for brand ${brandId}`);
  return insights.length;
}
