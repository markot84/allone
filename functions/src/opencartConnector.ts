/**
 * OpenCart Connector
 *
 * Flow:
 * 1. User enters e-shop URL + native API key or OAuth credentials
 * 2. We login via POST /index.php?route=api/login or use OAuth Bearer auth
 * 3. Credentials stored in Firestore (connectors/{brandId}.opencart)
 * 4. Sync: πρώτο 3ετίας orders + full products catalog· incremental orders μετά
 *
 * Compatible with OpenCart 3.x+ REST API.
 * For e-shops using third-party REST extensions, the token header approach is also supported.
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

type OpenCartAuthType = 'native' | 'oauth';

type OpenCartCredentialInput = {
  apiUsername?: string;
  apiKey?: string;
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
  authType?: OpenCartAuthType;
  error?: string;
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
 * Validate OpenCart credentials via native API login or OAuth REST extension
 * and save them on success.
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
    authType: testResult.authType || 'native',
    connectedAt: FieldValue.serverTimestamp(),
  };

  if (credentials.apiUsername) connectorData.apiUsername = credentials.apiUsername;
  if (credentials.apiKey) connectorData.apiKey = encryptToken(credentials.apiKey);
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
 * Test OpenCart connection. OAuth credentials use the REST extension Bearer flow;
 * native credentials try OC3+ api/login first, then simple REST extension auth.
 */
export async function testOpenCartConnection(
  storeUrl: string,
  credentials: OpenCartCredentialInput
): Promise<OpenCartConnectionTest> {
  const apiUsername = credentials.apiUsername || credentials.username || '';
  const apiKey = credentials.apiKey || '';
  const outboundIp = await getObservedOutboundIp();
  logger.info('[OpenCart] Connection diagnostic', {
    storeUrl,
    apiUsername,
    outboundIp,
    userAgent: OPENCART_USER_AGENT,
  });

  if (credentials.clientId || credentials.clientSecret || credentials.token) {
    return testOpenCartOAuthConnection(storeUrl, credentials, outboundIp);
  }

  if (!apiUsername || !apiKey) {
    return { success: false, error: 'Missing OpenCart API username or API key' };
  }

  // ── Try native OpenCart 3.x/4.x API login ────────────────────────
  try {
    const loginUrl = `${storeUrl}/index.php?route=api/login`;
    const form = new URLSearchParams({ username: apiUsername, key: apiKey });

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': OPENCART_USER_AGENT,
      },
      body: form,
    });
    logger.info('[OpenCart] Native login response', {
      storeUrl,
      status: res.status,
      statusText: res.statusText,
      outboundIp,
    });

    if (res.ok) {
      const data = await res.json();
      if (data.api_token || data.token) {
        const token = data.api_token || data.token;
        logger.info(`[OpenCart] Login OK for ${storeUrl}`);
        return { success: true, shopName: storeUrl.replace(/^https?:\/\//, ''), apiToken: token, authType: 'native' };
      }
      if (data.error) {
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        return { success: false, error: errMsg };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { success: false, error: 'e-shop URL not reachable. Check the domain.' };
    }
    logger.warn('[OpenCart] Native login failed, trying REST extension:', {
      storeUrl,
      outboundIp,
      error: describeFetchError(e),
    });
  }

  // ── Fallback: REST extension with X-Oc-Restadmin-Id header ───────
  try {
    const testUrl = `${storeUrl}/index.php?route=rest/product_admin/products&limit=1`;
    const res = await fetch(testUrl, {
      headers: {
        'X-Oc-Restadmin-Id': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': OPENCART_USER_AGENT,
      },
    });
    logger.info('[OpenCart] REST extension response', {
      storeUrl,
      status: res.status,
      statusText: res.statusText,
      outboundIp,
    });

    if (res.ok) {
      logger.info(`[OpenCart] REST extension auth OK for ${storeUrl}`);
      return { success: true, shopName: storeUrl.replace(/^https?:\/\//, ''), apiToken: apiKey, authType: 'native' };
    }
  } catch (error) {
    logger.warn('[OpenCart] REST extension failed:', {
      storeUrl,
      outboundIp,
      error: describeFetchError(error),
    });
  }

  return { success: false, error: 'Could not authenticate. Verify the e-shop URL, API username, and API key. Ensure the API user is enabled in System → Users → API.' };
}

async function testOpenCartOAuthConnection(
  storeUrl: string,
  credentials: OpenCartCredentialInput,
  outboundIp: string | null
): Promise<OpenCartConnectionTest> {
  const token = await resolveOAuthToken(storeUrl, credentials);
  if (!token) {
    return { success: false, error: 'Could not get OpenCart OAuth token. Verify client_id, client_secret, token, username, and password.' };
  }

  try {
    const testUrl = `${storeUrl}/index.php?route=rest/product_admin/products&limit=1`;
    const res = await fetch(testUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': OPENCART_USER_AGENT,
      },
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
        apiToken: token,
        authType: 'oauth',
      };
    }

    let details = '';
    try {
      details = await res.text();
    } catch {
      details = '';
    }
    return { success: false, error: `OpenCart OAuth authentication failed (${res.status}). ${details.slice(0, 160)}`.trim() };
  } catch (error) {
    logger.warn('[OpenCart] OAuth REST extension failed:', {
      storeUrl,
      outboundIp,
      error: describeFetchError(error),
    });
    return { success: false, error: 'OpenCart OAuth endpoint not reachable. Check the e-shop URL and REST API extension.' };
  }
}

async function resolveOAuthToken(storeUrl: string, credentials: OpenCartCredentialInput): Promise<string | null> {
  const suppliedToken = normalizeBearerToken(credentials.token);
  if (suppliedToken) return suppliedToken;

  if (!credentials.clientId || !credentials.clientSecret) return null;

  const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const tokenUrls = [
    `${storeUrl}/index.php?route=rest/admin_security/gettoken&grant_type=client_credentials`
    /*`${storeUrl}/api/rest/oauth2/token/client_credentials`,
    `${storeUrl}/api/rest/oauth2/token`,*/
  ];

  for (const tokenUrl of tokenUrls) {
    const token = await requestOAuthToken(tokenUrl, basicAuth, credentials);
    if (token) return token;
  }

  return null;
}

async function requestOAuthToken(
  tokenUrl: string,
  basicAuth: string,
  credentials: OpenCartCredentialInput
): Promise<string | null> {
  const payload =
    credentials.username && credentials.password
      ? {
          grant_type: 'password',
          username: credentials.username,
          password: credentials.password,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }
      : undefined;

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'User-Agent': OPENCART_USER_AGENT,
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return normalizeBearerToken(
      data.access_token || data.token || data.api_token || data.accessToken || data.bearerToken
    );
  } catch (error) {
    logger.warn('[OpenCart] OAuth token request failed:', {
      tokenUrl,
      error: describeFetchError(error),
    });
    return null;
  }
}

function normalizeBearerToken(value: unknown): string | null {
  const token = String(value || '').trim();
  if (!token) return null;
  return token.replace(/^Bearer\s+/i, '').trim() || null;
}

/**
 * Refresh the API token (native OC login tokens expire per session).
 */
async function refreshApiToken(storeUrl: string, apiUsername: string, apiKey: string): Promise<string | null> {
  try {
    const form = new URLSearchParams({ username: apiUsername, key: apiKey });
    const res = await fetch(`${storeUrl}/index.php?route=api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (res.ok) {
      const data = await res.json();
      return data.api_token || data.token || null;
    }
  } catch (e) {
    logger.warn('[OpenCart] Token refresh failed:', e);
  }
  return null;
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
  const authType = String((connector as { authType?: string }).authType || '');
  const apiUsername = String((connector as { apiUsername?: string }).apiUsername || '');
  const apiKey = connector.apiKey ? decryptToken(String(connector.apiKey)) : '';
  const savedToken = connector.apiToken ? decryptToken(String(connector.apiToken)) : '';
  const clientId = String((connector as { clientId?: string }).clientId || '');
  const clientSecret = connector.clientSecret ? decryptToken(String(connector.clientSecret)) : '';
  const oauthUsername = String((connector as { username?: string }).username || '');
  const oauthPassword = connector.password ? decryptToken(String(connector.password)) : '';
  const useOAuth = authType === 'oauth' || Boolean(clientId || clientSecret);
  if (!useOAuth && !apiKey) {
    return { success: false, imported: 0, error: 'OpenCart credentials unavailable — reconnect required' };
  }
  let token = useOAuth
    ? await resolveOAuthToken(storeUrl, {
        clientId,
        clientSecret,
        token: savedToken,
        username: oauthUsername,
        password: oauthPassword,
      })
    : await refreshApiToken(storeUrl, apiUsername, apiKey);
  if (useOAuth && !token) {
    return { success: false, imported: 0, error: 'OpenCart OAuth token unavailable — reconnect required' };
  }
  const useRestExtension = useOAuth || !token;

  const buildHeaders = (): Record<string, string> => {
    if (useOAuth && token) {
      return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }
    if (useRestExtension) {
      return { 'X-Oc-Restadmin-Id': apiKey, 'Content-Type': 'application/json' };
    }
    return { 'Content-Type': 'application/json' };
  };

  const buildUrl = (route: string, extra: Record<string, string> = {}): string => {
    const params = new URLSearchParams(extra);
    if (token && !useRestExtension) params.set('api_token', token);
    params.set('route', route);
    return `${storeUrl}/index.php?${params}`;
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

    if (useRestExtension) {
      for (const key of ['id', 'order_id'] as const) {
        const url = buildUrl('rest/order_admin/order', { [key]: orderId });
        let res = await fetch(url, { headers: buildHeaders() });
        if (useOAuth && res.status === 401) {
          const t = await resolveOAuthToken(storeUrl, { clientId, clientSecret, username: oauthUsername, password: oauthPassword });
          if (t) {
            token = t;
            res = await fetch(url, { headers: buildHeaders() });
          }
        }
        if (res.ok) {
          const json = await res.json();
          const result = tryBodies(json);
          if (result.lineItems.length > 0 || result.tax > 0) return result;
        }
      }
      return { lineItems: [], tax: 0 };
    }

    const fetchInfo = async (): Promise<Response> =>
      fetch(buildUrl('api/order/info', { order_id: orderId }), { headers: buildHeaders() });

    let res = await fetchInfo();
    if (res.status === 401) {
      const t = await refreshApiToken(storeUrl, apiUsername, apiKey);
      if (t) {
        token = t;
        res = await fetchInfo();
      }
    }
    if (!res.ok) return { lineItems: [], tax: 0 };
    const json = await res.json();
    return tryBodies(json);
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
      const route = useRestExtension ? 'rest/order_admin/orders' : 'api/order';
      const url = buildUrl(route, { page: String(orderPage), limit: '100' });
      let res = await fetch(url, { headers: buildHeaders() });
      if (useOAuth && res.status === 401) {
        const t = await resolveOAuthToken(storeUrl, { clientId, clientSecret, username: oauthUsername, password: oauthPassword });
        if (t) {
          token = t;
          res = await fetch(url, { headers: buildHeaders() });
        }
      }

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
      const route = useRestExtension ? 'rest/product_admin/products' : 'api/product';
      const url = buildUrl(route, { page: String(prodPage), limit: '100' });
      let res = await fetch(url, { headers: buildHeaders() });
      if (useOAuth && res.status === 401) {
        const t = await resolveOAuthToken(storeUrl, { clientId, clientSecret, username: oauthUsername, password: oauthPassword });
        if (t) {
          token = t;
          res = await fetch(url, { headers: buildHeaders() });
        }
      }

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
