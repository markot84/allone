/**
 * Shopify Connector
 *
 * Flow:
 * 1. User enters shop domain → redirected to Shopify OAuth
 * 2. Shopify redirects back with auth code → exchanged for permanent access token
 * 3. Token stored in Firestore (connectors/{brandId}.shopify)
 * 4. Sync fetches orders (3 years) + products → Firestore
 *
 * Required secrets:
 * - SHOPIFY_API_KEY
 * - SHOPIFY_API_SECRET
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { getCustomerEmailIdentity } from './customerIdentity';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const SHOPIFY_API_VERSION = '2024-01';

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

/**
 * Generate the OAuth consent URL for Shopify
 */
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
  const state = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${normalizedDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for a permanent access token
 */
export async function handleShopifyCallback(
  code: string,
  brandId: string,
  shopDomain: string
): Promise<{ success: boolean; error?: string }> {
  const { apiKey, apiSecret } = getCredentials();
  const normalizedDomain = normalizeShopDomain(shopDomain);

  try {
    const res = await fetch(
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
      logger.error('[Shopify] Token exchange failed:', err);
      return { success: false, error: `Token exchange failed: ${res.status}` };
    }

    const data = await res.json();
    const accessToken: string = data.access_token;
    const scope: string = data.scope || '';

    // Fetch shop info for display
    let shopName = normalizedDomain;
    try {
      const shopRes = await fetch(
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
    logger.error('[Shopify] Callback error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Fetch Shopify orders (last 3 years) + products and store in Firestore.
 * Order docs include `customerId` (Shopify customer id — όχι email/όνομα) για RFM από raw orders.
 */
export async function fetchShopifyData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.shopify;

  if (!connector?.connected || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Shopify not connected' };
  }

  const { shopDomain } = connector;
  const accessToken = decryptToken(connector.accessToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Shopify token unavailable — reconnect required' };
  }
  const baseUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  let totalImported = 0;

  try {
    // ── Orders (last 3 years) ──────────────────────────────────────────
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - 3);

    let orderPage = 1;
    let hasMore = true;
    const batchItems: { id: string; data: Record<string, unknown> }[] = [];

    while (hasMore) {
      // No `fields` filter: Shopify truncates nested line_items without product_id/variant_id,
      // which we need for catalog alignment (join to shopify_products).
      const params = new URLSearchParams({
        status: 'any',
        created_at_min: since.toISOString(),
        limit: '250',
        page: String(orderPage),
      });

      const res = await fetch(`${baseUrl}/orders.json?${params}`, { headers });
      if (!res.ok) {
        const errText = await res.text();
        logger.error(`[Shopify] Orders fetch failed (${res.status}):`, errText.slice(0, 300));
        break;
      }

      const { orders = [] } = await res.json();
      if (orders.length === 0) { hasMore = false; break; }

      for (const o of orders) {
        const shopifyCid = o.customer_id != null && o.customer_id !== '' ? String(o.customer_id) : '';
        const emailIdentity = getCustomerEmailIdentity(o.email || o.contact_email);
        batchItems.push({
          id: `shopify_${o.id}`,
          data: {
            orderId: String(o.id),
            orderName: o.name || '',
            ...(shopifyCid ? { customerId: shopifyCid } : {}),
            ...emailIdentity,
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

      hasMore = orders.length === 250;
      orderPage++;
      if (orderPage > 20) break; // safety cap
    }

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

    // ── Products ───────────────────────────────────────────────────────
    let prodPage = 1;
    let prodMore = true;
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];

    while (prodMore) {
      const params = new URLSearchParams({
        limit: '250',
        page: String(prodPage),
        fields: 'id,title,handle,product_type,vendor,status,tags,variants,created_at,updated_at',
      });

      const res = await fetch(`${baseUrl}/products.json?${params}`, { headers });
      if (!res.ok) break;

      const { products = [] } = await res.json();
      if (products.length === 0) { prodMore = false; break; }

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

      prodMore = products.length === 250;
      prodPage++;
      if (prodPage > 20) break;
    }

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

    // ── Log import_jobs ────────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'shopify_api',
      status: 'completed',
      imported: totalImported,
      orders: batchItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[Shopify] Sync complete for brand ${brandId}: ${totalImported} total items`);
    return { success: true, imported: totalImported };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Shopify] fetchShopifyData error for ${brandId}:`, msg);
    return { success: false, imported: totalImported, error: msg };
  }
}

/**
 * Normalize shop domain to {store}.myshopify.com format
 */
function normalizeShopDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/\/+$/, '');
  if (!domain.includes('.')) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}
