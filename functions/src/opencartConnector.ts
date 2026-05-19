/**
 * OpenCart Connector
 *
 * Flow:
 * 1. User enters e-shop URL + OpenCart REST Admin API OAuth credentials
 * 2. Session authentication via /index.php?route=rest/admin_security/gettoken
 * 3. User login via /index.php?route=rest/login_admin/login
 * 4. Credentials stored in Firestore (connectors/{brandId}.opencart)
 * 5. Sync: πρώτο 3ετίας orders + full products catalog· incremental orders μετά
 *
 * Compatible with the OpenCart REST Admin API OAuth extension.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { getCustomerEmailIdentity } from './customerIdentity';
import { buildHistoricalOrIncrementalWindow, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS } from './syncPolicy';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const OPENCART_USER_AGENT = 'PerformancePlus/1.0 (+https://performanceplus.gr)';

type OpenCartCredentialInput = {
  clientId?: string;
  clientSecret?: string;
  token?: string;
  username?: string;
  password?: string;
};

type OpenCartConnectionTest = {
  success: boolean;
  shopName?: string;
  apiToken?: string;
  error?: string;
};

type OpenCartRestAdminAuth = {
  accessToken: string;
  cookieHeader?: string;
  userToken?: string;
};

function describeFetchError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = (error as Error & { cause?: unknown }).cause as
    | (Error & { code?: string; errno?: string; syscall?: string; address?: string; port?: number })
    | undefined;
  return {
    name: error.name,
    message: error.message,
    causeName: cause?.name,
    causeMessage: cause?.message,
    code: cause?.code,
    errno: cause?.errno,
    syscall: cause?.syscall,
    address: cause?.address,
    port: cause?.port,
  };
}

async function getObservedOutboundIp(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      headers: { 'User-Agent': OPENCART_USER_AGENT },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return data.ip || null;
  } catch (error) {
    logger.warn('[OpenCart] Outbound IP diagnostic failed:', describeFetchError(error));
    return null;
  }
}

/**
 * Validate OpenCart REST Admin API OAuth credentials and save them on success.
 */
export async function saveOpenCartCredentials(
  brandId: string,
  storeUrl: string,
  credentials: OpenCartCredentialInput
): Promise<{ success: boolean; shopName?: string; error?: string }> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  const testResult = await testOpenCartConnection(normalizedUrl, credentials);
  if (!testResult.success) {
    return { success: false, error: testResult.error };
  }

  const connectorData: Record<string, unknown> = {
    connected: true,
    storeUrl: normalizedUrl,
    shopName: testResult.shopName || normalizedUrl,
    authType: 'oauth',
    connectedAt: FieldValue.serverTimestamp(),
  };

  if (credentials.clientId) connectorData.clientId = credentials.clientId;
  if (credentials.clientSecret) connectorData.clientSecret = encryptToken(credentials.clientSecret);
  if (credentials.username) connectorData.username = credentials.username;
  if (credentials.password) connectorData.password = encryptToken(credentials.password);
  if (testResult.apiToken || credentials.token) {
    connectorData.apiToken = encryptToken(testResult.apiToken || credentials.token || '');
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      opencart: connectorData,
    },
    { merge: true }
  );

  logger.info(`[OpenCart] Connected brand ${brandId} to store ${normalizedUrl}`);
  return { success: true, shopName: testResult.shopName };
}

/**
 * Test OpenCart REST Admin API OAuth connection.
 * The extension requires two explicit steps:
 * 1. session authentication (`rest/admin_security/gettoken`)
 * 2. admin user login (`rest/login_admin/login`)
 */
export async function testOpenCartConnection(
  storeUrl: string,
  credentials: OpenCartCredentialInput
): Promise<OpenCartConnectionTest> {
  const outboundIp = await getObservedOutboundIp();
  logger.info('[OpenCart] Connection diagnostic', {
    storeUrl,
    username: credentials.username,
    outboundIp,
    userAgent: OPENCART_USER_AGENT,
  });

  try {
    const auth = await authenticateOpenCartRestAdmin(storeUrl, credentials);
    const res = await fetch(buildOpenCartRestUrl(storeUrl, 'rest/product_admin/products', { limit: '1' }), {
      headers: buildOpenCartRestHeaders(auth),
    });
    logger.info('[OpenCart] OAuth REST extension response', {
      storeUrl,
      status: res.status,
      statusText: res.statusText,
      outboundIp,
    });

    if (res.ok) {
      return {
        success: true,
        shopName: storeUrl.replace(/^https?:\/\//, ''),
        apiToken: auth.accessToken,
      };
    }

    let details = '';
    try {
      details = await res.text();
    } catch {
      details = '';
    }
    if (isCloudflareChallenge(details)) {
      logger.warn('[OpenCart] OAuth request blocked by Cloudflare/WAF', {
        storeUrl,
        status: res.status,
        outboundIp,
      });
      return {
        success: false,
        error:
          'Cloudflare/WAF blocks the OpenCart REST API endpoint. Add a bypass/allow rule for /index.php?route=rest/* and /api/rest/*, or allow the Firebase outbound IP shown in connector diagnostics.',
      };
    }
    return { success: false, error: `OpenCart OAuth authentication failed (${res.status}). ${details.slice(0, 160)}`.trim() };
  } catch (error) {
    logger.warn('[OpenCart] OAuth REST Admin authentication failed:', {
      storeUrl,
      outboundIp,
      error: describeFetchError(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'OpenCart OAuth endpoint not reachable. Check the e-shop URL and REST API extension.',
    };
  }
}

function isCloudflareChallenge(body: string): boolean {
  const text = body.toLowerCase();
  return (
    text.includes('just a moment') ||
    text.includes('cf-browser-verification') ||
    text.includes('challenge-platform') ||
    text.includes('cloudflare')
  );
}

async function authenticateOpenCartRestAdmin(
  storeUrl: string,
  credentials: OpenCartCredentialInput
): Promise<OpenCartRestAdminAuth> {
  const clientId = credentials.clientId?.trim();
  const clientSecret = credentials.clientSecret?.trim();
  const username = credentials.username?.trim();
  const password = credentials.password?.trim();

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Missing OpenCart OAuth client_id, client_secret, username, or password.');
  }

  const session = await authenticateOpenCartSession(storeUrl, clientId, clientSecret);
  return loginOpenCartAdminUser(storeUrl, session, username, password);
}

async function authenticateOpenCartSession(
  storeUrl: string,
  clientId: string,
  clientSecret: string
): Promise<OpenCartRestAdminAuth> {
  const url = buildOpenCartRestUrl(storeUrl, 'rest/admin_security/gettoken', {
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'User-Agent': OPENCART_USER_AGENT,
    },
  });
  const bodyText = await res.text();
  const json = parseJsonObject(bodyText);
  const token = extractOAuthToken(json);
  if (!res.ok || !token) {
    throw new Error(`OpenCart session authentication failed (${res.status}). ${summarizeOpenCartApiError(bodyText)}`);
  }
  return {
    accessToken: token,
    cookieHeader: getCookieHeaderFromResponse(res),
  };
}

async function loginOpenCartAdminUser(
  storeUrl: string,
  session: OpenCartRestAdminAuth,
  username: string,
  password: string
): Promise<OpenCartRestAdminAuth> {
  const res = await fetch(buildOpenCartRestUrl(storeUrl, 'rest/admin_security/login'), {
    method: 'POST',
    headers: buildOpenCartRestHeaders(session),
    body: JSON.stringify({ username, password }),
  });
  const bodyText = await res.text();
  const json = parseJsonObject(bodyText);
  if (!res.ok || isOpenCartApiFailure(json)) {
    throw new Error(`OpenCart user login failed (${res.status}). ${summarizeOpenCartApiError(bodyText)}`);
  }

  const loginToken = extractOAuthToken(json);
  const cookieHeader = mergeCookieHeaders(session.cookieHeader, getCookieHeaderFromResponse(res));
  return {
    accessToken: loginToken || session.accessToken,
    cookieHeader,
    userToken: extractOpenCartUserToken(json) || undefined,
  };
}

function buildOpenCartRestUrl(storeUrl: string, route: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams(extra).toString();
  return `${storeUrl}/index.php?route=${route}${query ? `&${query}` : ''}`;
}

function buildOpenCartRestHeaders(auth: OpenCartRestAdminAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': OPENCART_USER_AGENT,
  };
  if (auth.cookieHeader) headers.Cookie = auth.cookieHeader;
  return headers;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isOpenCartApiFailure(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data.success === 0 || data.success === false;
}

function summarizeOpenCartApiError(bodyText: string): string {
  const parsed = parseJsonObject(bodyText);
  const rawError = parsed?.error ?? parsed?.message ?? parsed?.data;
  const message = Array.isArray(rawError) ? rawError.join(', ') : rawError ? String(rawError) : bodyText;
  return message.slice(0, 180).trim() || 'No response body';
}

function getCookieHeaderFromResponse(res: Response): string | undefined {
  const headers = res.headers as Headers & { getSetCookie?: () => string[]; raw?: () => Record<string, string[]> };
  const setCookies = headers.getSetCookie?.() ?? headers.raw?.()['set-cookie'] ?? [];
  const cookieParts = setCookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean);
  if (cookieParts.length > 0) return cookieParts.join('; ');

  const singleCookie = res.headers.get('set-cookie');
  return singleCookie?.split(';')[0]?.trim() || undefined;
}

function mergeCookieHeaders(...headers: Array<string | undefined>): string | undefined {
  const cookies = new Map<string, string>();
  for (const header of headers) {
    if (!header) continue;
    for (const part of header.split(';')) {
      const cookie = part.trim();
      const eq = cookie.indexOf('=');
      if (eq <= 0) continue;
      cookies.set(cookie.slice(0, eq), cookie);
    }
  }
  return cookies.size > 0 ? [...cookies.values()].join('; ') : undefined;
}

function extractOpenCartUserToken(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const direct = normalizeBearerToken(record.user_token || record.userToken || record.session || record.session_id);
  if (direct) return direct;
  if (record.data && typeof record.data === 'object') return extractOpenCartUserToken(record.data);
  return null;
}

function extractOAuthToken(data: unknown): string | null {
  if (!data || typeof data !== 'object') return normalizeBearerToken(data);
  const record = data as Record<string, unknown>;
  const direct = normalizeBearerToken(
    record.access_token || record.token || record.api_token || record.accessToken || record.bearerToken
  );
  if (direct) return direct;
  if (record.data && typeof record.data === 'object') {
    if (Array.isArray(record.data)) {
      for (const item of record.data) {
        const token = extractOAuthToken(item);
        if (token) return token;
      }
    }
    return extractOAuthToken(record.data);
  }
  return null;
}

function normalizeBearerToken(value: unknown): string | null {
  const token = String(value || '').trim();
  if (!token) return null;
  return token.replace(/^Bearer\s+/i, '').trim() || null;
}

function ocParseMoney(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function ocParseQty(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Extract tax amount from OpenCart order payload.
 * Looks in `totals` / `order_totals` array (code or title containing "tax"/"vat"/"φπα")
 * and falls back to direct fields like `tax`, `total_tax`.
 */
function extractOcTaxAmount(source: unknown): number {
  if (!source || typeof source !== 'object') return 0;
  const o = source as Record<string, unknown>;

  const totalsArr = o.totals ?? o.order_totals ?? o.order_total;
  if (Array.isArray(totalsArr)) {
    let tax = 0;
    for (const t of totalsArr) {
      if (!t || typeof t !== 'object') continue;
      const entry = t as Record<string, unknown>;
      const code = String(entry.code ?? entry.title ?? '').toLowerCase();
      if (code.includes('tax') || code.includes('vat') || code.includes('φπα') || code.includes('fpa')) {
        tax += ocParseMoney(entry.value);
      }
    }
    if (tax > 0) return tax;
  }

  for (const k of ['tax', 'total_tax', 'totalTax', 'tax_amount'] as const) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0) {
      const n = ocParseMoney(v);
      if (n > 0) return n;
    }
  }
  return 0;
}

/**
 * Maps OpenCart order / order-info payloads → normalized lineItems (aligned with client normalizer).
 */
function parseOpenCartOrderProductsToLineItems(source: unknown): Record<string, unknown>[] {
  if (!source || typeof source !== 'object') return [];
  const o = source as Record<string, unknown>;
  const raw = o.products ?? o.order_product ?? o.order_products;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.slice(0, 50).map((p: unknown) => {
    const row = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    const qty = ocParseQty(row.quantity ?? row.qty);
    const price = ocParseMoney(row.price);
    const rowTotRaw = row.total ?? row.sub_total ?? row.subtotal;
    const rowTot =
      rowTotRaw !== undefined && rowTotRaw !== null && rowTotRaw !== '' ? ocParseMoney(rowTotRaw) : undefined;
    const line: Record<string, unknown> = {
      productId: String(row.product_id ?? row.productId ?? ''),
      sku: String(row.model ?? row.sku ?? ''),
      name: String(row.name ?? ''),
      quantity: qty,
      price,
    };
    if (rowTot !== undefined && rowTot > 0) line.rowTotal = rowTot;
    return line;
  });
}

async function mapPool<T, R>(items: T[], poolSize: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  }
  const n = Math.max(1, Math.min(poolSize, items.length));
  await Promise.all(Array.from({ length: n }, () => runWorker()));
  return results;
}

/**
 * Fetch OpenCart orders (last 3 years) + products and store in Firestore.
 * Customer email is stored for audience exports, while `customerEmailHash` is used
 * for analytics/matching.
 */
export async function fetchOpenCartData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.opencart as Record<string, unknown> | undefined;

  if (!connector || !(connector.connected as boolean | undefined)) {
    return { success: false, imported: 0, error: 'OpenCart not connected' };
  }

  const orderWindow = buildHistoricalOrIncrementalWindow(connector || {}, 'lastOrdersSyncAt', 'historyLoadedUntilYear', 3, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS);

  logger.info(
    `[OpenCart] ${brandId} orders=${orderWindow.mode} (${orderWindow.windowStart.toISOString()}→${orderWindow.windowEnd.toISOString()})`
  );

  const storeUrl = String((connector as { storeUrl?: string }).storeUrl || '');
  const savedToken = connector.apiToken ? decryptToken(String(connector.apiToken)) : '';
  const clientId = String((connector as { clientId?: string }).clientId || '');
  const clientSecret = connector.clientSecret ? decryptToken(String(connector.clientSecret)) : '';
  const oauthUsername = String((connector as { username?: string }).username || '');
  const oauthPassword = connector.password ? decryptToken(String(connector.password)) : '';
  let auth: OpenCartRestAdminAuth;
  try {
    auth = await authenticateOpenCartRestAdmin(storeUrl, {
      clientId,
      clientSecret,
      token: savedToken,
      username: oauthUsername,
      password: oauthPassword,
    });
  } catch (error) {
    return {
      success: false,
      imported: 0,
      error: error instanceof Error ? error.message : 'OpenCart OAuth credentials unavailable — reconnect required',
    };
  }

  const buildHeaders = (): Record<string, string> => {
    return buildOpenCartRestHeaders(auth);
  };

  const buildUrl = (route: string, extra: Record<string, string> = {}): string => {
    return buildOpenCartRestUrl(storeUrl, route, extra);
  };

  /** Extra API calls per order — returns line items AND tax extracted from detail payload. */
  const fetchOcOrderDetail = async (orderId: string): Promise<{ lineItems: Record<string, unknown>[]; tax: number }> => {
    const tryBodies = (json: unknown): { lineItems: Record<string, unknown>[]; tax: number } => {
      if (!json || typeof json !== 'object') return { lineItems: [], tax: 0 };
      const j = json as Record<string, unknown>;
      const sources = [json, j.order, j.data].filter(Boolean);
      for (const src of sources) {
        const lines = parseOpenCartOrderProductsToLineItems(src);
        const tax = extractOcTaxAmount(src);
        if (lines.length > 0 || tax > 0) return { lineItems: lines, tax };
      }
      return { lineItems: [], tax: 0 };
    };

    for (const key of ['id', 'order_id'] as const) {
      const url = buildUrl('rest/order_admin/order', { [key]: orderId });
      const res = await fetch(url, { headers: buildHeaders() });
      if (res.ok) {
        const json = await res.json();
        const result = tryBodies(json);
        if (result.lineItems.length > 0 || result.tax > 0) return result;
      }
    }
    return { lineItems: [], tax: 0 };
  };

  let totalImported = 0;
  let ordersAbort = false;
  let productsAbort = false;

  try {
    // ── Orders ──────────────────────────────────────
    const orderItems: { id: string; data: Record<string, unknown> }[] = [];
    let orderPage = 1;
    let hasMore = true;

    const filterSinceMs = orderWindow.windowStart.getTime();

    while (hasMore) {
      const url = buildUrl('rest/order_admin/orders', { page: String(orderPage), limit: '100' });
      const res = await fetch(url, { headers: buildHeaders() });

      if (!res.ok) {
        logger.warn(`[OpenCart] Orders page ${orderPage} returned ${res.status}`);
        ordersAbort = true;
        break;
      }

      const body = await res.json();
      const orders: any[] = body.orders || body.data || (Array.isArray(body) ? body : []);
      if (orders.length === 0) { hasMore = false; break; }

      const pageCandidates = orders.filter((o: Record<string, unknown>) => {
        const dateAdded = String(o.date_added || o.dateAdded || '');
        if (!dateAdded) return true;
        const d = new Date(dateAdded);
        if (Number.isNaN(d.getTime())) return true;
        return d.getTime() >= filterSinceMs;
      });

      const enriched = await mapPool(pageCandidates, 6, async (o: Record<string, unknown>) => {
        let lineItems = parseOpenCartOrderProductsToLineItems(o);
        let tax = extractOcTaxAmount(o);
        if (lineItems.length === 0 || tax === 0) {
          const oid = String(o.order_id || o.orderId || '');
          if (oid) {
            const detail = await fetchOcOrderDetail(oid);
            if (lineItems.length === 0) lineItems = detail.lineItems;
            if (tax === 0) tax = detail.tax;
          }
        }
        return { o, lineItems, tax };
      });

      for (const { o, lineItems, tax } of enriched) {
        const dateAdded = String(o.date_added || o.dateAdded || '');
        const ocCid =
          o.customer_id != null && String(o.customer_id) !== '0' && String(o.customer_id) !== ''
            ? String(o.customer_id)
            : o.customerId != null && String(o.customerId) !== '0'
              ? String(o.customerId)
              : '';
        const emailIdentity = getCustomerEmailIdentity(
          o.email || o.customer_email || o.customerEmail || o.payment_email || o.billing_email
        );
        const ocName = [
          o.firstname || o.first_name || o.payment_firstname,
          o.lastname || o.last_name || o.payment_lastname,
        ].filter(Boolean).join(' ').trim();
        const productCount =
          lineItems.length > 0 ? lineItems.length : parseInt(String(o.products || '0'), 10) || 0;
        orderItems.push({
          id: `oc_${o.order_id || o.orderId}`,
          data: {
            orderId: String(o.order_id || o.orderId || ''),
            ...(ocCid ? { customerId: ocCid } : {}),
            ...emailIdentity,
            ...(ocName ? { customerName: ocName } : {}),
            createdAt: dateAdded,
            status: o.order_status || o.status || '',
            total: parseFloat(String(o.total || '0')),
            totalTax: tax,
            currency: o.currency_code || o.currency || 'EUR',
            paymentMethod: o.payment_method || '',
            shippingMethod: o.shipping_method || '',
            productsCount: productCount,
            lineItems,
            source: 'opencart_api',
            brandId,
          },
        });
      }

      hasMore = orders.length >= 100;
      orderPage++;
      if (orderPage > 30) {
        ordersAbort = true;
        logger.warn(`[OpenCart] Orders page cap (${orderPage}) ${brandId}`);
        break;
      }
    }

    const ordersSyncComplete = !ordersAbort;

    if (orderItems.length > 0) {
      for (let i = 0; i < orderItems.length; i += 500) {
        const batch = db.batch();
        const chunk = orderItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('opencart_orders').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += orderItems.length;
      logger.info(`[OpenCart] Orders: ${orderItems.length} imported for brand ${brandId}`);
    }

    // ── Products ───────────────────────────────────────────────────
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];
    let prodPage = 1;
    let prodMore = true;

    while (prodMore) {
      const url = buildUrl('rest/product_admin/products', { page: String(prodPage), limit: '100' });
      const res = await fetch(url, { headers: buildHeaders() });

      if (!res.ok) {
        productsAbort = true;
        break;
      }

      const body = await res.json();
      const products: any[] = body.products || body.data || (Array.isArray(body) ? body : []);
      if (products.length === 0) { prodMore = false; break; }

      for (const p of products) {
        prodItems.push({
          id: `oc_${p.product_id || p.productId}`,
          data: {
            productId: String(p.product_id || p.productId || ''),
            name: p.name || '',
            model: p.model || '',
            sku: p.sku || '',
            price: parseFloat(p.price || '0'),
            quantity: parseInt(p.quantity || '0', 10),
            status: p.status === '1' || p.status === true ? 'active' : 'inactive',
            manufacturer: p.manufacturer || '',
            createdAt: p.date_added || p.dateAdded || '',
            updatedAt: p.date_modified || p.dateModified || '',
            source: 'opencart_api',
            brandId,
          },
        });
      }

      prodMore = products.length >= 100;
      prodPage++;
      if (prodPage > 30) {
        productsAbort = true;
        logger.warn(`[OpenCart] Products page cap (${prodPage}) ${brandId}`);
        break;
      }
    }

    const productsSyncComplete = !productsAbort;

    if (prodItems.length > 0) {
      for (let i = 0; i < prodItems.length; i += 500) {
        const batch = db.batch();
        const chunk = prodItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('opencart_products').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += prodItems.length;
      logger.info(`[OpenCart] Products: ${prodItems.length} imported for brand ${brandId}`);
    }

    const connectorPatch: Record<string, unknown> = {};
    if (ordersSyncComplete) {
      connectorPatch['opencart.lastOrdersSyncAt'] = FieldValue.serverTimestamp();
      if (orderWindow.mode === 'historical') {
        connectorPatch['opencart.historyLoadedUntilYear'] = orderWindow.historyStartYear;
      }
    }
    if (productsSyncComplete) {
      connectorPatch['opencart.lastProductsSyncAt'] = FieldValue.serverTimestamp();
    }
    if (Object.keys(connectorPatch).length > 0) {
      await db.doc(`connectors/${brandId}`).update(connectorPatch);
    }

    // ── Log import_jobs ────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'opencart_api',
      mode: `${orderWindow.mode}_orders_full_products_catalog`,
      status: ordersSyncComplete && productsSyncComplete ? 'completed' : 'partial',
      imported: totalImported,
      orders: orderItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[OpenCart] Sync complete for brand ${brandId}: ${totalImported} total items`);
    const bothOk = ordersSyncComplete && productsSyncComplete;
    if (!bothOk) {
      return {
        success: false,
        imported: totalImported,
        error: `OpenCart incomplete — orders:${ordersSyncComplete ? 'OK' : 'Aborted'}, products:${productsSyncComplete ? 'OK' : 'Aborted'}`,
      };
    }
    return { success: true, imported: totalImported };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[OpenCart] fetchOpenCartData error for ${brandId}:`, msg);
    return { success: false, imported: totalImported, error: msg };
  }
}

function normalizeStoreUrl(input: string): string {
  let url = input.trim();
  url = url.replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url;
}
