/** Shopify Connector: OAuth → permanent access token in connectors/{brandId}.shopify, then
 * initial 3-year load of orders/products + incremental. Secrets: SHOPIFY_API_KEY, SHOPIFY_API_SECRET. */

import * as admin from 'firebase-admin';
import { signState } from './oauthState';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { encryptToken, decryptToken } from './tokenCrypto';
import { getCustomerEmailIdentity } from './customerIdentity';
import { buildHistoricalOrIncrementalWindow, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS, coerceSyncDate, subtractHours } from './syncPolicy';
// Strict shop-domain allow-list (throws on non-myshopify hosts) + SSRF-guarded fetch.
import { normalizeShopDomain } from './shopifyDomain';
import { safeFetch } from './urlValidator';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const SHOPIFY_API_VERSION = '2024-01';

// Shopify removed offset (`page`) pagination in API 2019-07; the offset param is silently
// ignored, so paging by it re-fetches the first 250 records forever. All list endpoints now
// advertise the next page in the `Link` header as `<…?limit=&page_info=…>; rel="next"`.
// Returns the `page_info` cursor of the `rel="next"` link, or null when there is no next page.
export function parseLinkHeaderNext(res: Pick<Response, 'headers'>): string | null {
  const link = res.headers.get('link');
  if (!link) return null;
  const match = link.match(/<([^>]+)>\s*;\s*rel="next"/i);
  if (!match) return null;
  try {
    return new URL(match[1]).searchParams.get('page_info');
  } catch {
    return null;
  }
}

// Per-run page cap: bounds a single invocation's runtime (~PAGE_CAP*250 records). Larger
// backfills resume next run from the persisted page_info cursor.
const SHOPIFY_PAGE_CAP = 20;

function getCredentials() {
  const raw = (s?: string) => (s?.trim().split(/\s+/)[0] || '');
  return {
    apiKey: raw(process.env.SHOPIFY_API_KEY),
    apiSecret: raw(process.env.SHOPIFY_API_SECRET),
  };
}

const SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_inventory',
].join(',');

/** Generate the OAuth consent URL for Shopify */
export function getShopifyAuthUrl(
  brandId: string,
  shopDomain: string,
  redirectUri: string,
  returnOrigin?: string
): string {
  const { apiKey } = getCredentials();
  const normalizedDomain = normalizeShopDomain(shopDomain);

  const payload: Record<string, string> = {
    brandId,
    provider: 'shopify',
    redirectUri,
    shopDomain: normalizedDomain,
  };
  if (returnOrigin?.trim()) payload.returnOrigin = returnOrigin.trim();
  const state = signState(payload);

  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${normalizedDomain}/admin/oauth/authorize?${params.toString()}`;
}

/** Exchange authorization code for a permanent access token */
export async function handleShopifyCallback(
  code: string,
  brandId: string,
  shopDomain: string
): Promise<{ success: boolean; error?: string }> {
  const { apiKey, apiSecret } = getCredentials();
  // Re-validate before the exchange — this call POSTs the global API secret to the host.
  let normalizedDomain: string;
  try {
    normalizedDomain = normalizeShopDomain(shopDomain);
  } catch {
    return { success: false, error: 'Invalid Shopify shop domain' };
  }

  try {
    const res = await safeFetch(
      `https://${normalizedDomain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: apiKey,
          client_secret: apiSecret,
          code,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      logger.error('[Shopify] Token exchange failed:', { alertKey: ALERT.shopifySyncFailed, err });
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const data = await res.json();
    const accessToken: string = data.access_token;
    const scope: string = data.scope || '';

    // Fetch shop info for display
    let shopName = normalizedDomain;
    try {
      const shopRes = await safeFetch(
        `https://${normalizedDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        shopName = shopData.shop?.name || normalizedDomain;
      }
    } catch {
      logger.warn('[Shopify] Could not fetch shop name, using domain');
    }

    await getDb().doc(`connectors/${brandId}`).set(
      {
        shopify: {
          connected: true,
          shopDomain: normalizedDomain,
          shopName,
          accessToken: encryptToken(accessToken),
          scope,
          connectedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    logger.info(`[Shopify] Connected brand ${brandId} to shop ${normalizedDomain}`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Shopify] Callback error:', { alertKey: ALERT.shopifySyncFailed, err: msg });
    return { success: false, error: msg };
  }
}

/** Fetch Shopify orders (last 3 years) + products into Firestore; order docs include
 * `customerId` (Shopify customer id — not email/name) for RFM from raw orders. */
export async function fetchShopifyData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.shopify as Record<string, unknown> | undefined;

  if (!(connector?.connected as boolean | undefined) || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Shopify not connected' };
  }

  const orderWindow = buildHistoricalOrIncrementalWindow(connector || {}, 'lastOrdersSyncAt', 'historyLoadedUntilYear', 3, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS);
  const ordersSinceIso = orderWindow.windowStart.toISOString();
  const lastProdSync = coerceSyncDate(connector?.lastProductsSyncAt);
  const productsUpdatedSinceIso = lastProdSync
    ? subtractHours(lastProdSync, 48).toISOString()
    : null;

  logger.info(
    `[Shopify] ${brandId} orders=${orderWindow.mode} (${ordersSinceIso} → ${orderWindow.windowEnd.toISOString()}) products=${productsUpdatedSinceIso ? 'incremental' : 'full'}`
  );

  // Re-pin the STORED domain on every read — connectors/{brandId} is member-writable, so a
  // tampered shopDomain must not receive the shop access token (or any request at all).
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(String(connector.shopDomain || ''));
  } catch {
    return { success: false, imported: 0, error: 'Invalid Shopify shop domain — reconnect required' };
  }
  const accessToken = decryptToken(String(connector.accessToken));
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Shopify token unavailable — reconnect required' };
  }
  const baseUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  let totalImported = 0;
  let ordersSyncComplete = false;
  let productsSyncComplete = false;

  try {
    // ── Orders: historical for 3 years, then incremental (updated_at). Cursor pagination via
    //    the `Link` header (offset `page` is ignored — see parseLinkHeaderNext). A stored
    //    ordersSyncPageCursor resumes a backfill that previously tripped the per-run page cap. ──
    let hasMore = true;
    let ordersAbort = false;
    let ordersCursorNext: string | null = null; // page_info to persist if we trip the page cap
    let ordersResumeStale = false; // a stored cursor Shopify rejects → clear it, restart next run
    // page_info embeds the original query, so resume pages must send ONLY limit + page_info.
    let ordersPageInfo: string | null = connector.ordersSyncPageCursor ? String(connector.ordersSyncPageCursor) : null;
    let ordersPageCount = 0;
    const batchItems: { id: string; data: Record<string, unknown> }[] = [];

    while (hasMore) {
      let params: URLSearchParams;
      if (ordersPageInfo) {
        // Cursor page: Shopify rejects every param except `limit` alongside `page_info`.
        params = new URLSearchParams({ limit: '250', page_info: ordersPageInfo });
      } else {
        // First page: full window filter. No `fields` filter — Shopify truncates nested
        // line_items without product_id/variant_id, needed for catalog alignment.
        params = new URLSearchParams({ status: 'any', limit: '250' });
        params.set(orderWindow.mode === 'incremental' ? 'updated_at_min' : 'created_at_min', ordersSinceIso);
      }

      const res = await safeFetch(`${baseUrl}/orders.json?${params}`, { headers });
      if (!res.ok) {
        const errText = await res.text();
        logger.error(`[Shopify] Orders fetch failed (${res.status}):`, { alertKey: ALERT.shopifySyncFailed, err: errText.slice(0, 300) });
        // A stored resume cursor rejected on its first use is stale/expired — clear it so the
        // next run restarts cleanly from the time window instead of stalling forever.
        if (ordersPageCount === 0 && ordersPageInfo) ordersResumeStale = true;
        ordersAbort = true;
        break;
      }

      const { orders = [] } = await res.json();

      for (const o of orders) {
        const shopifyCid = o.customer_id != null && o.customer_id !== '' ? String(o.customer_id) : '';
        const emailIdentity = getCustomerEmailIdentity(o.email || o.contact_email);
        // Parenthesize the customer-name ternary: without parens `||` binds tighter than `?:`,
        // forcing the customer branch (→ "undefined undefined" when customer fields absent).
        const shopifyName = [o.billing_address?.first_name, o.billing_address?.last_name].filter(Boolean).join(' ').trim()
          || [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(' ').trim()
          || (o.customer?.first_name && o.customer?.last_name ? `${o.customer?.first_name} ${o.customer?.last_name}`.trim() : '');
        batchItems.push({
          id: `shopify_${o.id}`,
          data: {
            orderId: String(o.id),
            orderName: o.name || '',
            ...(shopifyCid ? { customerId: shopifyCid } : {}),
            ...emailIdentity,
            ...(shopifyName ? { customerName: shopifyName } : {}),
            createdAt: o.created_at || '',
            updatedAt: o.updated_at || '',
            financialStatus: o.financial_status || '',
            fulfillmentStatus: o.fulfillment_status || '',
            totalPrice: parseFloat(o.total_price || '0'),
            subtotalPrice: parseFloat(o.subtotal_price || '0'),
            totalTax: parseFloat(o.total_tax || '0'),
            totalDiscounts: parseFloat(o.total_discounts || '0'),
            currency: o.currency || 'EUR',
            lineItemCount: o.line_items?.length || 0,
            lineItems: (o.line_items || []).slice(0, 50).map((li: any) => ({
              sku: li.sku || '',
              title: li.title || '',
              quantity: li.quantity || 0,
              price: parseFloat(li.price || '0'),
              ...(li.product_id != null && li.product_id !== ''
                ? { productId: String(li.product_id) }
                : {}),
              ...(li.variant_id != null && li.variant_id !== ''
                ? { variantId: String(li.variant_id) }
                : {}),
            })),
            tags: o.tags || '',
            source: 'shopify_api',
            brandId,
          },
        });
      }

      ordersPageInfo = parseLinkHeaderNext(res);
      hasMore = ordersPageInfo != null;
      ordersPageCount++;
      if (hasMore && ordersPageCount >= SHOPIFY_PAGE_CAP) {
        ordersCursorNext = ordersPageInfo; // resume from here on the next run
        ordersAbort = true;
        logger.warnAlert(`[Shopify] Orders paging cap (${ordersPageCount}) for ${brandId} — will resume next run`, { alertKey: ALERT.shopifySyncFailed });
        break;
      }
    }

    ordersSyncComplete = !ordersAbort;

    if (batchItems.length > 0) {
      for (let i = 0; i < batchItems.length; i += 500) {
        const batch = db.batch();
        const chunk = batchItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('shopify_orders').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += batchItems.length;
      logger.info(`[Shopify] Orders: ${batchItems.length} imported for brand ${brandId}`);
    }

    // ── Products: first sync full catalog, then only changes (`updated_at_min`). Same cursor
    //    pagination + resume-cursor handling as orders (offset `page` is ignored by Shopify). ──
    let prodMore = true;
    let productsAbort = false;
    let productsCursorNext: string | null = null;
    let productsResumeStale = false;
    let productsPageInfo: string | null = connector.productsSyncPageCursor ? String(connector.productsSyncPageCursor) : null;
    let prodPageCount = 0;
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];

    while (prodMore) {
      let params: URLSearchParams;
      if (productsPageInfo) {
        // Cursor page: only limit + page_info (page_info embeds the original fields/filter).
        params = new URLSearchParams({ limit: '250', page_info: productsPageInfo });
      } else {
        params = new URLSearchParams({
          limit: '250',
          fields: 'id,title,handle,product_type,vendor,status,tags,variants,created_at,updated_at',
        });
        if (productsUpdatedSinceIso) {
          params.set('updated_at_min', productsUpdatedSinceIso);
        }
      }

      const res = await safeFetch(`${baseUrl}/products.json?${params}`, { headers });
      if (!res.ok) {
        if (prodPageCount === 0 && productsPageInfo) productsResumeStale = true;
        productsAbort = true;
        break;
      }

      const { products = [] } = await res.json();

      for (const p of products) {
        prodItems.push({
          id: `shopify_${p.id}`,
          data: {
            productId: String(p.id),
            title: p.title || '',
            handle: p.handle || '',
            productType: p.product_type || '',
            vendor: p.vendor || '',
            status: p.status || '',
            tags: p.tags || '',
            createdAt: p.created_at || '',
            updatedAt: p.updated_at || '',
            variantCount: p.variants?.length || 0,
            variants: (p.variants || []).slice(0, 30).map((v: any) => ({
              sku: v.sku || '',
              price: v.price || '0',
              inventoryQuantity: v.inventory_quantity ?? null,
              title: v.title || '',
            })),
            source: 'shopify_api',
            brandId,
          },
        });
      }

      productsPageInfo = parseLinkHeaderNext(res);
      prodMore = productsPageInfo != null;
      prodPageCount++;
      if (prodMore && prodPageCount >= SHOPIFY_PAGE_CAP) {
        productsCursorNext = productsPageInfo;
        productsAbort = true;
        logger.warnAlert(`[Shopify] Products paging cap (${prodPageCount}) for ${brandId} — will resume next run`, { alertKey: ALERT.shopifySyncFailed });
        break;
      }
    }

    productsSyncComplete = !productsAbort;

    if (prodItems.length > 0) {
      for (let i = 0; i < prodItems.length; i += 500) {
        const batch = db.batch();
        const chunk = prodItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('shopify_products').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += prodItems.length;
      logger.info(`[Shopify] Products: ${prodItems.length} imported for brand ${brandId}`);
    }

    const connectorPatch: Record<string, unknown> = {};
    if (ordersSyncComplete) {
      connectorPatch['shopify.lastOrdersSyncAt'] = FieldValue.serverTimestamp();
      if (orderWindow.mode === 'historical') {
        connectorPatch['shopify.historyLoadedUntilYear'] = orderWindow.historyStartYear;
      }
      connectorPatch['shopify.ordersSyncPageCursor'] = FieldValue.delete();
    } else if (ordersCursorNext != null) {
      connectorPatch['shopify.ordersSyncPageCursor'] = String(ordersCursorNext);
    } else if (ordersResumeStale) {
      connectorPatch['shopify.ordersSyncPageCursor'] = FieldValue.delete();
    }
    if (productsSyncComplete) {
      connectorPatch['shopify.lastProductsSyncAt'] = FieldValue.serverTimestamp();
      connectorPatch['shopify.productsSyncPageCursor'] = FieldValue.delete();
    } else if (productsCursorNext != null) {
      connectorPatch['shopify.productsSyncPageCursor'] = String(productsCursorNext);
    } else if (productsResumeStale) {
      connectorPatch['shopify.productsSyncPageCursor'] = FieldValue.delete();
    }
    if (Object.keys(connectorPatch).length > 0) {
      await db.doc(`connectors/${brandId}`).update(connectorPatch);
    }

    // ── Log import_jobs ────────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'shopify_api',
      mode: `${orderWindow.mode}_orders_${productsUpdatedSinceIso ? 'incr' : 'full'}_products`,
      status: ordersSyncComplete && productsSyncComplete ? 'completed' : 'partial',
      imported: totalImported,
      orders: batchItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[Shopify] Sync complete for brand ${brandId}: ${totalImported} total items`);

    const bothOk = ordersSyncComplete && productsSyncComplete;
    if (!bothOk) {
      return {
        success: false,
        imported: totalImported,
        error: `Shopify sync incomplete — orders:${ordersSyncComplete ? 'OK' : 'Aborted'}, products:${productsSyncComplete ? 'OK' : 'Aborted'}`,
      };
    }
    return { success: true, imported: totalImported };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Shopify] fetchShopifyData error for ${brandId}:`, { alertKey: ALERT.shopifySyncFailed, err: msg });
    return { success: false, imported: totalImported, error: msg };
  }
}

