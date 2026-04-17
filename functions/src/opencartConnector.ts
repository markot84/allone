/**
 * OpenCart Connector
 *
 * Flow:
 * 1. User enters e-shop URL + API username + API key
 * 2. We login via POST /index.php?route=api/login to get a session token
 * 3. Credentials stored in Firestore (connectors/{brandId}.opencart)
 * 4. Sync fetches orders (90 days) + products → Firestore (no PII stored)
 *
 * Compatible with OpenCart 3.x+ REST API.
 * For e-shops using third-party REST extensions, the token header approach is also supported.
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

/**
 * Validate OpenCart credentials via the native API login endpoint
 * and save them on success.
 */
export async function saveOpenCartCredentials(
  brandId: string,
  storeUrl: string,
  apiUsername: string,
  apiKey: string
): Promise<{ success: boolean; shopName?: string; error?: string }> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  const testResult = await testOpenCartConnection(normalizedUrl, apiUsername, apiKey);
  if (!testResult.success) {
    return { success: false, error: testResult.error };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      opencart: {
        connected: true,
        storeUrl: normalizedUrl,
        shopName: testResult.shopName || normalizedUrl,
        apiUsername,
        apiKey: encryptToken(apiKey),
        apiToken: encryptToken(testResult.apiToken || ''),
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[OpenCart] Connected brand ${brandId} to store ${normalizedUrl}`);
  return { success: true, shopName: testResult.shopName };
}

/**
 * Test OpenCart connection by logging in via the API.
 * Tries the native OC3+ api/login first, then falls back to a REST extension pattern.
 */
export async function testOpenCartConnection(
  storeUrl: string,
  apiUsername: string,
  apiKey: string
): Promise<{ success: boolean; shopName?: string; apiToken?: string; error?: string }> {
  // ── Try native OpenCart 3.x/4.x API login ────────────────────────
  try {
    const loginUrl = `${storeUrl}/index.php?route=api/login`;
    const form = new URLSearchParams({ username: apiUsername, key: apiKey });

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });

    if (res.ok) {
      const data = await res.json();
      if (data.api_token || data.token) {
        const token = data.api_token || data.token;
        logger.info(`[OpenCart] Login OK for ${storeUrl}`);
        return { success: true, shopName: storeUrl.replace(/^https?:\/\//, ''), apiToken: token };
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
    logger.warn('[OpenCart] Native login failed, trying REST extension:', msg);
  }

  // ── Fallback: REST extension with X-Oc-Restadmin-Id header ───────
  try {
    const testUrl = `${storeUrl}/index.php?route=rest/product_admin/products&limit=1`;
    const res = await fetch(testUrl, {
      headers: {
        'X-Oc-Restadmin-Id': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      logger.info(`[OpenCart] REST extension auth OK for ${storeUrl}`);
      return { success: true, shopName: storeUrl.replace(/^https?:\/\//, ''), apiToken: apiKey };
    }
  } catch {
    // ignore
  }

  return { success: false, error: 'Could not authenticate. Verify the e-shop URL, API username, and API key. Ensure the API user is enabled in System → Users → API.' };
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

/**
 * Fetch OpenCart orders (last 90 days) + products and store in Firestore.
 * No PII is stored.
 */
export async function fetchOpenCartData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.opencart;

  if (!connector?.connected || !connector?.apiKey) {
    return { success: false, imported: 0, error: 'OpenCart not connected' };
  }

  const { storeUrl, apiUsername } = connector;
  const apiKey = decryptToken(connector.apiKey);
  if (!apiKey) {
    return { success: false, imported: 0, error: 'OpenCart credentials unavailable — reconnect required' };
  }
  let token = await refreshApiToken(storeUrl, apiUsername, apiKey);
  const useRestExtension = !token;

  const buildHeaders = (): Record<string, string> => {
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

  let totalImported = 0;

  try {
    // ── Orders (last 90 days) ──────────────────────────────────────
    const orderItems: { id: string; data: Record<string, unknown> }[] = [];
    let orderPage = 1;
    let hasMore = true;

    while (hasMore) {
      const route = useRestExtension ? 'rest/order_admin/orders' : 'api/order';
      const url = buildUrl(route, { page: String(orderPage), limit: '100' });
      const res = await fetch(url, { headers: buildHeaders() });

      if (!res.ok) {
        logger.warn(`[OpenCart] Orders page ${orderPage} returned ${res.status}`);
        break;
      }

      const body = await res.json();
      const orders: any[] = body.orders || body.data || (Array.isArray(body) ? body : []);
      if (orders.length === 0) { hasMore = false; break; }

      const since = new Date();
      since.setDate(since.getDate() - 90);

      for (const o of orders) {
        const dateAdded = o.date_added || o.dateAdded || '';
        if (dateAdded && new Date(dateAdded) < since) continue;

        orderItems.push({
          id: `oc_${o.order_id || o.orderId}`,
          data: {
            orderId: String(o.order_id || o.orderId || ''),
            createdAt: dateAdded,
            status: o.order_status || o.status || '',
            total: parseFloat(o.total || '0'),
            currency: o.currency_code || o.currency || 'EUR',
            paymentMethod: o.payment_method || '',
            shippingMethod: o.shipping_method || '',
            productsCount: parseInt(o.products || '0', 10) || 0,
            source: 'opencart_api',
            brandId,
          },
        });
      }

      hasMore = orders.length >= 100;
      orderPage++;
      if (orderPage > 30) break;
    }

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
      const res = await fetch(url, { headers: buildHeaders() });

      if (!res.ok) break;

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
      if (prodPage > 30) break;
    }

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

    // ── Log import_jobs ────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'opencart_api',
      status: 'completed',
      imported: totalImported,
      orders: orderItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[OpenCart] Sync complete for brand ${brandId}: ${totalImported} total items`);
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
