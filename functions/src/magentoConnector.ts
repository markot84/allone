/**
 * Magento / Adobe Commerce Connector
 *
 * Flow:
 * 1. User enters e-shop URL + Access Token (from Admin → System → Integrations)
 * 2. We validate via GET /rest/V1/store/storeConfigs
 * 3. Credentials stored in Firestore (connectors/{brandId}.magento)
 * 4. Sync fetches orders (90 days) + products → Firestore (no PII stored)
 *
 * Compatible with Magento 2.x / Adobe Commerce REST API.
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

/** BOM / whitespace από copy-paste */
function normalizeMagentoToken(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim();
}

/** Βάσεις URL: canonical + εναλλακτικό www / non-www (πολλά shops redirect και χάνεται auth) */
function getCandidateStoreBases(normalizedStoreUrl: string): string[] {
  const base = normalizedStoreUrl.replace(/\/+$/, '');
  const out = new Set<string>([base]);
  try {
    const u = new URL(base);
    const host = u.hostname;
    if (host.startsWith('www.')) {
      const alt = new URL(base);
      alt.hostname = host.slice(4);
      out.add(alt.toString().replace(/\/+$/, ''));
    } else {
      const alt = new URL(base);
      alt.hostname = 'www.' + host;
      out.add(alt.toString().replace(/\/+$/, ''));
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

const MAGENTO_UA = 'PerformancePlus-MagentoConnector/1.0';

type ProbeFail = { lastStatus: number; lastBody: string; lastUrl: string };

/**
 * Δοκιμάζει όλους τους συνήθεις τρόπους πρόσβασης στο REST API.
 * Σημαντικό: μερικά Magento χωρίς rewrite θέλουν /index.php/rest/...
 */
async function probeMagentoStoreConfigs(
  normalizedStoreUrl: string,
  accessToken: string
): Promise<
  | { ok: true; restApiBase: string; configs: unknown[] }
  | { ok: false; fail: ProbeFail }
> {
  const token = normalizeMagentoToken(accessToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': MAGENTO_UA,
  };

  let lastFail: ProbeFail = { lastStatus: 0, lastBody: '', lastUrl: '' };

  for (const base of getCandidateStoreBases(normalizedStoreUrl)) {
    const paths = [`${base}/rest/V1/store/storeConfigs`, `${base}/index.php/rest/V1/store/storeConfigs`];
    for (const url of paths) {
      lastFail = { ...lastFail, lastUrl: url };
      try {
        const res = await fetch(url, { headers, redirect: 'follow' });
        const text = await res.text();
        lastFail = { lastStatus: res.status, lastBody: text, lastUrl: url };

        if (!res.ok) {
          logger.warn(`[Magento] probe ${res.status} ${url} → ${text.slice(0, 280)}`);
          continue;
        }

        let configs: unknown;
        try {
          configs = JSON.parse(text);
        } catch {
          continue;
        }
        if (!Array.isArray(configs)) continue;

        const restApiBase = url.includes('/index.php/rest/')
          ? `${base.replace(/\/+$/, '')}/index.php`
          : base.replace(/\/+$/, '');

        return { ok: true, restApiBase, configs };
      } catch (e) {
        logger.warn(`[Magento] probe fetch error ${url}:`, e);
      }
    }
  }

  return { ok: false, fail: lastFail };
}

function formatMagentoProbeError(fail: ProbeFail): string {
  const { lastStatus, lastBody, lastUrl } = fail;
  if (lastStatus === 401) {
    return (
      'HTTP 401 — το Magento απέρριψε το Bearer token. Αν το Access Token είναι σωστό, συχνά φταίει ο server (Apache/nginx) που δεν περνάει το header Authorization στο PHP — ζητήστε από τον host: SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1 (ή ισοδύναμο). ' +
      `Δοκιμή: ${lastUrl}`
    );
  }
  if (lastStatus === 404) {
    return 'Magento REST API δεν βρέθηκε (404). Δοκιμάστε άλλο e-shop URL ή ενεργοποιήστε τα Magento web APIs.';
  }
  const snippet = lastBody.replace(/\s+/g, ' ').slice(0, 160);
  return `Σύνδεση απέτυχε (HTTP ${lastStatus || '—'}): ${snippet || lastUrl}`;
}

/**
 * Validate Magento credentials and save them.
 */
export async function saveMagentoCredentials(
  brandId: string,
  storeUrl: string,
  accessToken: string
): Promise<{ success: boolean; shopName?: string; error?: string }> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  const tokenPlain = normalizeMagentoToken(accessToken);
  const testResult = await testMagentoConnection(normalizedUrl, tokenPlain);

  if (!testResult.success) {
    return { success: false, error: testResult.error };
  }

  await getDb().doc(`connectors/${brandId}`).set(
    {
      magento: {
        connected: true,
        storeUrl: normalizedUrl,
        /** Πρόθεμα για όλα τα REST calls — μπορεί να τελειώνει σε /index.php */
        restApiBase: testResult.restApiBase || normalizedUrl,
        shopName: testResult.shopName || normalizedUrl,
        magentoVersion: testResult.version || '',
        accessToken: encryptToken(tokenPlain),
        connectedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info(`[Magento] Connected brand ${brandId} to store ${normalizedUrl}`);
  return { success: true, shopName: testResult.shopName };
}

/**
 * Test Magento REST API connection via store config endpoint.
 * Δοκιμάζει πολλαπλά URL patterns (rewrite vs index.php, www vs bare host).
 */
export async function testMagentoConnection(
  storeUrl: string,
  accessToken: string
): Promise<{
  success: boolean;
  shopName?: string;
  version?: string;
  restApiBase?: string;
  error?: string;
}> {
  try {
    const probe = await probeMagentoStoreConfigs(storeUrl, accessToken);
    if (!probe.ok) {
      return { success: false, error: formatMagentoProbeError(probe.fail) };
    }

    const { configs, restApiBase } = probe;
    const storeName = (configs[0] as { base_url?: string; store_name?: string })?.base_url
      || (configs[0] as { store_name?: string })?.store_name
      || storeUrl;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${normalizeMagentoToken(accessToken)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': MAGENTO_UA,
    };

    let version = '';
    try {
      const modRes = await fetch(`${restApiBase}/rest/V1/modules`, { headers });
      if (modRes.ok) {
        const modules = await modRes.json();
        if (Array.isArray(modules) && modules.includes('Magento_Store')) {
          version = 'Magento 2.x';
        }
      }
    } catch {
      // non-critical
    }

    logger.info(`[Magento] Connection test OK — store: ${storeName}, restApiBase=${restApiBase}`);
    return {
      success: true,
      restApiBase,
      shopName: String(storeName).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      version,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Magento] Connection test failed:', msg);
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return { success: false, error: 'e-shop URL not reachable. Check the domain.' };
    }
    return { success: false, error: msg };
  }
}

/**
 * Fetch Magento orders (last 90 days) + products and store in Firestore.
 * No PII is stored (no customer name/email/address).
 */
export async function fetchMagentoData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.magento;

  if (!connector?.connected || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Magento not connected' };
  }

  const storeUrl = String(connector.storeUrl || '').replace(/\/+$/, '');
  const restApiBase = String((connector as { restApiBase?: string }).restApiBase || storeUrl).replace(/\/+$/, '');
  const accessToken = decryptToken(connector.accessToken);
  if (!accessToken) {
    return { success: false, imported: 0, error: 'Magento token unavailable — reconnect required' };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': MAGENTO_UA,
  };

  let totalImported = 0;

  try {
    // ── Orders (last 90 days, no PII) ──────────────────────────────────
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString().split('T')[0]; // YYYY-MM-DD

    const orderItems: { id: string; data: Record<string, unknown> }[] = [];
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      const searchParams = new URLSearchParams({
        'searchCriteria[filter_groups][0][filters][0][field]': 'created_at',
        'searchCriteria[filter_groups][0][filters][0][value]': sinceStr,
        'searchCriteria[filter_groups][0][filters][0][condition_type]': 'gteq',
        'searchCriteria[sortOrders][0][field]': 'created_at',
        'searchCriteria[sortOrders][0][direction]': 'DESC',
        'searchCriteria[pageSize]': '100',
        'searchCriteria[currentPage]': String(currentPage),
        'fields': 'items[entity_id,increment_id,created_at,updated_at,status,grand_total,subtotal,tax_amount,discount_amount,total_item_count,order_currency_code,items[sku,name,qty_ordered,price,product_id]],total_count',
      });

      const res = await fetch(`${restApiBase}/rest/V1/orders?${searchParams}`, { headers });
      if (!res.ok) {
        logger.error(`[Magento] Orders fetch failed (${res.status})`);
        break;
      }

      const body = await res.json();
      const orders: any[] = body.items || [];
      const totalCount: number = body.total_count || 0;

      for (const o of orders) {
        orderItems.push({
          id: `mag_${o.entity_id}`,
          data: {
            orderId: String(o.entity_id || ''),
            incrementId: o.increment_id || '',
            createdAt: o.created_at || '',
            updatedAt: o.updated_at || '',
            status: o.status || '',
            grandTotal: parseFloat(o.grand_total || '0'),
            subtotal: parseFloat(o.subtotal || '0'),
            taxAmount: parseFloat(o.tax_amount || '0'),
            discountAmount: parseFloat(o.discount_amount || '0'),
            totalItemCount: parseInt(o.total_item_count || '0', 10),
            currency: o.order_currency_code || 'EUR',
            lineItems: (o.items || []).slice(0, 50).map((li: any) => ({
              sku: li.sku || '',
              name: li.name || '',
              quantity: parseFloat(li.qty_ordered || '0'),
              price: parseFloat(li.price || '0'),
              productId: li.product_id || null,
            })),
            source: 'magento_api',
            brandId,
          },
        });
      }

      hasMore = currentPage * 100 < totalCount;
      currentPage++;
      if (currentPage > 30) break;
    }

    if (orderItems.length > 0) {
      for (let i = 0; i < orderItems.length; i += 500) {
        const batch = db.batch();
        const chunk = orderItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('magento_orders').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += orderItems.length;
      logger.info(`[Magento] Orders: ${orderItems.length} imported for brand ${brandId}`);
    }

    // ── Products ───────────────────────────────────────────────────────
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];
    let prodPage = 1;
    let prodMore = true;

    while (prodMore) {
      const searchParams = new URLSearchParams({
        'searchCriteria[pageSize]': '100',
        'searchCriteria[currentPage]': String(prodPage),
        'fields': 'items[id,sku,name,type_id,status,price,weight,created_at,updated_at,extension_attributes[stock_item[qty,is_in_stock]],custom_attributes],total_count',
      });

      const res = await fetch(`${restApiBase}/rest/V1/products?${searchParams}`, { headers });
      if (!res.ok) break;

      const body = await res.json();
      const products: any[] = body.items || [];
      const totalCount: number = body.total_count || 0;

      for (const p of products) {
        const stockItem = p.extension_attributes?.stock_item;
        const customAttrs = p.custom_attributes || [];
        const getAttr = (code: string) => customAttrs.find((a: any) => a.attribute_code === code)?.value || '';

        prodItems.push({
          id: `mag_${p.id}`,
          data: {
            productId: String(p.id || ''),
            sku: p.sku || '',
            name: p.name || '',
            type: p.type_id || '',
            status: p.status === 1 ? 'active' : 'inactive',
            price: parseFloat(p.price || '0'),
            weight: parseFloat(p.weight || '0'),
            stockQuantity: stockItem?.qty ?? null,
            inStock: stockItem?.is_in_stock ?? null,
            specialPrice: getAttr('special_price') ? parseFloat(getAttr('special_price')) : null,
            manufacturer: getAttr('manufacturer'),
            createdAt: p.created_at || '',
            updatedAt: p.updated_at || '',
            source: 'magento_api',
            brandId,
          },
        });
      }

      prodMore = prodPage * 100 < totalCount;
      prodPage++;
      if (prodPage > 30) break;
    }

    if (prodItems.length > 0) {
      for (let i = 0; i < prodItems.length; i += 500) {
        const batch = db.batch();
        const chunk = prodItems.slice(i, i + 500);
        for (const item of chunk) {
          batch.set(db.collection('magento_products').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await batch.commit();
      }
      totalImported += prodItems.length;
      logger.info(`[Magento] Products: ${prodItems.length} imported for brand ${brandId}`);
    }

    // ── Log import_jobs ────────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'magento_api',
      status: 'completed',
      imported: totalImported,
      orders: orderItems.length,
      products: prodItems.length,
      failed: 0,
      errors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(`[Magento] Sync complete for brand ${brandId}: ${totalImported} total items`);
    return { success: true, imported: totalImported };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Magento] fetchMagentoData error for ${brandId}:`, msg);
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
