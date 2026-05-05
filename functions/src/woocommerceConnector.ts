/**
 * WooCommerce Connector
 *
 * Flow:
 * 1. User enters e-shop URL + Consumer Key + Consumer Secret
 * 2. We validate with a test API call (GET /wp-json/wc/v3/system_status)
 * 3. Credentials stored in Firestore (connectors/{brandId}.woocommerce)
 * 4. Sync: πρώτο full 3ετίας + catalog· μετά incremental (modified / updated_at)
 *
 * No OAuth redirect needed — WooCommerce uses REST API keys.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { getCustomerEmailIdentity } from './customerIdentity';
import { buildHistoricalOrIncrementalWindow, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS, coerceSyncDate, subtractHours } from './syncPolicy';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

/**
 * Validate WooCommerce credentials and save them
 */
export async function saveWooCredentials(
  brandId: string,
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ success: boolean; shopName?: string; error?: string }> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);

  const testResult = await testWooConnection(normalizedUrl, consumerKey, consumerSecret);

  if (!testResult.success) {
    return { success: false, error: testResult.error };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      woocommerce: {
        connected: true,
        storeUrl: normalizedUrl,
        shopName: testResult.shopName || normalizedUrl,
        wooVersion: testResult.version || '',
        consumerKey: encryptToken(consumerKey),
        consumerSecret: encryptToken(consumerSecret),
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[WooCommerce] Connected brand ${brandId} to store ${normalizedUrl}`);
  return { success: true, shopName: testResult.shopName };
}

/**
 * Test WooCommerce REST API connection
 */
export async function testWooConnection(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ success: boolean; shopName?: string; version?: string; error?: string }> {
  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const endpoint = `${storeUrl}/wp-json/wc/v3/system_status`;

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: 'Invalid credentials (Consumer Key or Secret)' };
      }
      if (res.status === 404) {
        return { success: false, error: 'WooCommerce REST API not found. Verify the store URL and that WooCommerce is installed.' };
      }
      const errText = await res.text();
      return { success: false, error: `Connection failed (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const environment = data.environment || {};
    const shopName = environment.site_title || environment.home_url || storeUrl;
    const version = data.version || environment.version || '';

    logger.info(`[WooCommerce] Connection test OK — shop: ${shopName}, WC version: ${version}`);
    return { success: true, shopName, version };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[WooCommerce] Connection test failed:', msg);
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { success: false, error: 'e-shop URL not reachable. Check the domain.' };
    }
    return { success: false, error: msg };
  }
}

/**
 * Fetch WooCommerce orders (last 3 years) + products and store in Firestore.
 * Fetch WooCommerce orders + products. Customer email is stored for audience exports,
 * while `customerEmailHash` is used for analytics/matching.
 */
export async function fetchWooCommerceData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.woocommerce as Record<string, unknown> | undefined;

  if (!(connector?.connected as boolean | undefined) || !connector?.consumerKey) {
    return { success: false, imported: 0, error: 'WooCommerce not connected' };
  }

  const orderWindow = buildHistoricalOrIncrementalWindow(connector || {}, 'lastOrdersSyncAt', 'historyLoadedUntilYear', 3, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS);
  const ordersSinceIso = orderWindow.windowStart.toISOString();
  const lastProdSync = coerceSyncDate(connector?.lastProductsSyncAt);
  const productsModifiedSinceIso = lastProdSync
    ? subtractHours(lastProdSync, 48).toISOString()
    : null;

  logger.info(
    `[WooCommerce] ${brandId} orders=${orderWindow.mode} (${ordersSinceIso}→${orderWindow.windowEnd.toISOString()}) products=${productsModifiedSinceIso ? 'incremental' : 'full'}`
  );

  const storeUrl = String(connector.storeUrl || '');
  const consumerKey = decryptToken(String(connector.consumerKey));
  const consumerSecret = decryptToken(String(connector.consumerSecret));
  if (!consumerKey || !consumerSecret) {
    return { success: false, imported: 0, error: 'WooCommerce credentials unavailable — reconnect required' };
  }
  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const baseHeaders = { Authorization: authHeader, 'Content-Type': 'application/json' };

  let totalImported = 0;
  let ordersSyncComplete = false;
  let productsSyncComplete = false;

  try {
    // ── Orders: historical ανά ημερομηνία δημιουργίας· incremental μετά via modified_after ──
    let orderPage = 1;
    let hasMore = true;
    let ordersAbort = false;
    const orderItems: { id: string; data: Record<string, unknown> }[] = [];

    while (hasMore) {
      const params = new URLSearchParams({
        per_page: '100',
        page: String(orderPage),
        orderby: 'date',
        order: 'desc',
      });
      if (orderWindow.mode === 'incremental') {
        params.set('modified_after', ordersSinceIso);
      } else {
        params.set('after', ordersSinceIso);
      }

      const res = await fetch(`${storeUrl}/wp-json/wc/v3/orders?${params}`, { headers: baseHeaders });
      if (!res.ok) {
        logger.error(`[WooCommerce] Orders fetch failed (${res.status})`);
        ordersAbort = true;
        break;
      }

      const orders = await res.json();
      if (!Array.isArray(orders) || orders.length === 0) { hasMore = false; break; }

      for (const o of orders) {
        const wooCid = o.customer_id != null && Number(o.customer_id) > 0 ? String(o.customer_id) : '';
        const emailIdentity = getCustomerEmailIdentity(o.billing?.email || o.shipping?.email);
        orderItems.push({
          id: `woo_${o.id}`,
          data: {
            orderId: String(o.id),
            orderNumber: o.number || '',
            ...(wooCid ? { customerId: wooCid } : {}),
            ...emailIdentity,
            createdAt: o.date_created || '',
            updatedAt: o.date_modified || '',
            status: o.status || '',
            total: parseFloat(o.total || '0'),
            subtotal: (o.line_items || []).reduce((s: number, li: any) => s + parseFloat(li.subtotal || '0'), 0),
            totalTax: parseFloat(o.total_tax || '0'),
            discountTotal: parseFloat(o.discount_total || '0'),
            currency: o.currency || 'EUR',
            paymentMethod: o.payment_method_title || '',
            lineItemCount: o.line_items?.length || 0,
            lineItems: (o.line_items || []).slice(0, 50).map((li: any) => ({
              sku: li.sku || '',
              name: li.name || '',
              quantity: li.quantity || 0,
              price: parseFloat(li.price || '0'),
              productId: li.product_id || null,
            })),
            source: 'woocommerce_api',
            brandId,
          },
        });
      }

      const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
      hasMore = orderPage < totalPages;
      orderPage++;
      if (orderPage > 30) {
        ordersAbort = true;
        logger.warn(`[WooCommerce] Orders page safety cap (${orderPage}) for ${brandId}`);
        break;
      }
    }

    ordersSyncComplete = !ordersAbort;

    if (orderItems.length > 0) {
      for (let i = 0; i < orderItems.length; i += 500) {
        const batch = db.batch();
        const chunk = orderItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('woo_orders').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += orderItems.length;
      logger.info(`[WooCommerce] Orders: ${orderItems.length} imported for brand ${brandId}`);
    }

    // ── Products: πρώτο sync όλος ο κατάλογος· μετά με `modified_after` ──
    let prodPage = 1;
    let prodMore = true;
    let productsAbort = false;
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];

    while (prodMore) {
      const params = new URLSearchParams({
        per_page: '100',
        page: String(prodPage),
      });
      if (productsModifiedSinceIso) {
        params.set('modified_after', productsModifiedSinceIso);
      }

      const res = await fetch(`${storeUrl}/wp-json/wc/v3/products?${params}`, { headers: baseHeaders });
      if (!res.ok) {
        productsAbort = true;
        logger.error(`[WooCommerce] Products fetch failed (${res.status})`);
        break;
      }

      const products = await res.json();
      if (!Array.isArray(products) || products.length === 0) { prodMore = false; break; }

      for (const p of products) {
        prodItems.push({
          id: `woo_${p.id}`,
          data: {
            productId: String(p.id),
            name: p.name || '',
            slug: p.slug || '',
            type: p.type || '',
            status: p.status || '',
            sku: p.sku || '',
            price: p.price || '0',
            regularPrice: p.regular_price || '0',
            salePrice: p.sale_price || '',
            stockStatus: p.stock_status || '',
            stockQuantity: p.stock_quantity ?? null,
            categories: (p.categories || []).map((c: any) => c.name || ''),
            tags: (p.tags || []).map((t: any) => t.name || ''),
            createdAt: p.date_created || '',
            updatedAt: p.date_modified || '',
            source: 'woocommerce_api',
            brandId,
          },
        });
      }

      const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
      prodMore = prodPage < totalPages;
      prodPage++;
      if (prodPage > 30) {
        productsAbort = true;
        logger.warn(`[WooCommerce] Products page safety cap (${prodPage}) for ${brandId}`);
        break;
      }
    }

    productsSyncComplete = !productsAbort;

    if (prodItems.length > 0) {
      for (let i = 0; i < prodItems.length; i += 500) {
        const batch = db.batch();
        const chunk = prodItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('woo_products').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += prodItems.length;
      logger.info(`[WooCommerce] Products: ${prodItems.length} imported for brand ${brandId}`);
    }

    const connectorPatch: Record<string, unknown> = {};
    if (ordersSyncComplete) {
      connectorPatch['woocommerce.lastOrdersSyncAt'] = FieldValue.serverTimestamp();
      if (orderWindow.mode === 'historical') {
        connectorPatch['woocommerce.historyLoadedUntilYear'] = orderWindow.historyStartYear;
      }
    }
    if (productsSyncComplete) {
      connectorPatch['woocommerce.lastProductsSyncAt'] = FieldValue.serverTimestamp();
    }
    if (Object.keys(connectorPatch).length > 0) {
      await db.doc(`connectors/${brandId}`).update(connectorPatch);
    }

    // ── Log import_jobs ────────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'woocommerce_api',
      mode: `${orderWindow.mode}_orders_${productsModifiedSinceIso ? 'incr' : 'full'}_products`,
      status: ordersSyncComplete && productsSyncComplete ? 'completed' : 'partial',
      imported: totalImported,
      orders: orderItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[WooCommerce] Sync complete for brand ${brandId}: ${totalImported} total items`);
    const bothOk = ordersSyncComplete && productsSyncComplete;
    if (!bothOk) {
      return {
        success: false,
        imported: totalImported,
        error: `WooCommerce incomplete — orders:${ordersSyncComplete ? 'OK' : 'Aborted'}, products:${productsSyncComplete ? 'OK' : 'Aborted'}`,
      };
    }
    return { success: true, imported: totalImported };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[WooCommerce] fetchWooCommerceData error for ${brandId}:`, msg);
    return { success: false, imported: totalImported, error: msg };
  }
}

/**
 * Normalize store URL to https://domain format
 */
function normalizeStoreUrl(input: string): string {
  let url = input.trim();
  url = url.replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url;
}
