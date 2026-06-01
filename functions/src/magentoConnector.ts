/**
 * Magento / Adobe Commerce Connector
 *
 * Flow:
 * 1. User enters e-shop URL + Access Token (from Admin → System → Integrations)
 * 2. We validate via GET /rest/V1/store/storeConfigs
 * 3. Credentials stored in Firestore (connectors/{brandId}.magento)
 * 4. Sync performs historical backfill first, then incremental updates → Firestore
 *
 * Compatible with Magento 2.x / Adobe Commerce REST API.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { encryptToken, decryptToken } from './tokenCrypto';
import { getCustomerEmailIdentity } from './customerIdentity';
import {
  buildHistoricalOrIncrementalWindow,
  ECOMMERCE_INCREMENTAL_OVERLAP_HOURS,
  coerceSyncDate,
  toMagentoDateTime,
  toYmd,
  type ConnectorSyncMode,
} from './syncPolicy';

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

/** Default per-request timeout για Magento REST. Σπασμένα/υποφορτωμένα stores κρεμούν fetch χωρίς αυτό. */
const MAGENTO_FETCH_TIMEOUT_MS = 30_000;
const MAGENTO_ACTIVE_STOCK_SKU_CHUNK_SIZE = 50;
/** Full-catalog fallback (ERP-less brands): max σελίδες/run (×100 προϊόντα), resume με cursor. */
const MAGENTO_FULL_CATALOG_PAGE_BUDGET = 150;

/** fetch wrapper με AbortController — μετατρέπει κρεμάσματα σε καθαρά errors. */
async function magentoFetch(url: string, init: RequestInit = {}, timeoutMs = MAGENTO_FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Magento request timeout (${Math.round(timeoutMs / 1000)}s): ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

type ProbeFail = { lastStatus: number; lastBody: string; lastUrl: string };
type MagentoStoreConfig = {
  id?: number | string;
  code?: string;
  website_id?: number | string;
  store_name?: string;
  website_name?: string;
  base_url?: string;
  secure_base_url?: string;
  /** Storefront media root (π.χ. https://shop.gr/pub/media/). */
  base_media_url?: string;
  secure_base_media_url?: string;
  base_static_url?: string;
  secure_base_static_url?: string;
};

/** Εγγραφές απο τις ρυθμίσεις store (για UX επιλογών εξαίρεσης & analytics). */
export type MagentoStoreDirectoryEntry = {
  id: number;
  code: string;
  storeName: string;
  baseUrl: string;
};

export function directoryFromMagentoStoreConfigs(configs: unknown[]): MagentoStoreDirectoryEntry[] {
  const typed = configs.filter((cfg): cfg is MagentoStoreConfig => typeof cfg === 'object' && cfg !== null);
  const out: MagentoStoreDirectoryEntry[] = [];
  for (const cfg of typed) {
    if (String(cfg.code || '').trim().toLowerCase() === 'admin') continue;
    const id = Number(cfg.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    out.push({
      id,
      code: String(cfg.code || '').trim(),
      storeName: String(cfg.store_name || cfg.website_name || '').trim(),
      baseUrl: getStoreConfigUrls(cfg)[0] || '',
    });
  }
  return out;
}

/** Κανονικοποιημένο hostname (χωρίς www) από store base URL — για KPI rules (orderStoreDomain). */
function storefrontHostFromBaseUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    let h = u.hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  } catch {
    return '';
  }
}

function normalizeComparableHost(input: string): string {
  try {
    const host = new URL(input).hostname.trim().toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return String(input || '').trim().toLowerCase().replace(/^www\./, '');
  }
}

/**
 * Apex (registrable) domain για χαλαρό subdomain match (π.χ. shop.safeblock.gr → safeblock.gr).
 * Εδώ κρατάμε τα 2 τελευταία labels (αρκετό για .gr/.com/.net κ.λπ.). Δεν είναι Public Suffix List
 * ακριβές (ξεγλιστράει το co.uk), αλλά αρκεί για να αποτρέψει σιωπηλό λάθος pick.
 */
function getApexDomain(host: string): string {
  const clean = String(host || '').trim().toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join('.');
}

function normalizeComparableUrl(input: string): string {
  try {
    const u = new URL(input);
    const host = normalizeComparableHost(u.toString());
    const pathname = u.pathname.replace(/\/+$/, '');
    return `${host}${pathname}`;
  } catch {
    return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

function getStoreConfigUrls(config: MagentoStoreConfig): string[] {
  return [config.base_url, config.secure_base_url].filter((value): value is string => Boolean(value && String(value).trim()));
}

/** Δημόσιο storefront URL (προτιμά https). */
function getStorefrontWebUrl(config: MagentoStoreConfig | null): string {
  if (!config) return '';
  const candidate = (config.secure_base_url || config.base_url || '').trim().replace(/\/+$/, '');
  return candidate;
}

/** Storefront media root (π.χ. https://shop.gr/pub/media/). */
function getStoreMediaBaseUrl(config: MagentoStoreConfig | null): string {
  if (!config) return '';
  const candidate = (config.secure_base_media_url || config.base_media_url || '').trim().replace(/\/+$/, '');
  return candidate;
}

/** Συνεπής με το chart e-commerce: BOX/lockers σε ένα bucket, διπλές ετικέτες ACS+ΕΛΤΑ. */
function normalizeMagentoShippingDescription(raw: string | null | undefined): string {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (/\bbox\b|box\s*now|i\s*-?\s*box|locker|θήκ/i.test(lower)) {
    return 'BOX Now';
  }
  if (/\bacs\b/i.test(lower) && (/έλτα|elta/i.test(lower))) {
    const acsIdx = lower.search(/\bacs\b/i);
    const eltaCandidates = [lower.indexOf('έλτα'), lower.search(/\belta\b/i)].filter((i) => i >= 0);
    const eltaIdx = eltaCandidates.length ? Math.min(...eltaCandidates) : -1;
    if (eltaIdx < 0 || acsIdx <= eltaIdx) return 'ACS Courier';
    return 'ΕΛΤΑ Courier';
  }
  return s.replace(/^(table\s+rate|flat\s+rate|best\s+way)\s*[-–—]\s*/i, '').trim() || s;
}

/**
 * Τα Marketing › Search Terms του Magento κρατούνται στο DB, αλλά το Open Source **δεν** εκθέτει
 * λίστα `GET /V1/searchTerms` στο module-search (μόνο `GET /V1/search` για catalog). Commerce / custom
 * modules μπορεί να το προσθέτουν — δοκιμάζουμε πολλά store scopes. Αν αποτύχει παντού, βλ. fallback.
 */
async function fetchAndSaveMagentoPopularSearchTerms(
  db: Firestore,
  brandId: string,
  restApiBase: string,
  storeCode: string,
  headers: Record<string, string>,
  storeId?: number
): Promise<number> {
  // Σεβόμαστε admin CSV upload: αν ο user έχει ανεβάσει χειροκίνητα search terms
  // από Magento Admin (Marketing → Search Terms), ΔΕΝ τα overwrite-άρουμε.
  try {
    const existing = await db.doc(`magento_popular_searches/${brandId}`).get();
    if (existing.exists) {
      const data = existing.data() as { termsProvenance?: string } | undefined;
      if (data?.termsProvenance === 'magento_admin_csv') {
        logger.info(`[Magento] Skipping searchTerms REST (admin CSV present) for ${brandId}`);
        return 0;
      }
    }
  } catch {
    /* ignore */
  }

  const customModuleQuery = Number.isFinite(storeId) && storeId && storeId > 0
    ? `performance-plus/search-terms?limit=100&storeId=${encodeURIComponent(String(storeId))}`
    : 'performance-plus/search-terms?limit=100';
  const paths = [
    customModuleQuery,
    'searchTerms?searchCriteria[pageSize]=50&searchCriteria[sortOrders][0][field]=popularity&searchCriteria[sortOrders][0][direction]=DESC',
    'searchTerms?searchCriteria[pageSize]=50',
  ];
  const codeVariants = [...new Set([String(storeCode || '').trim(), '', 'all', 'default'])];
  for (const code of codeVariants) {
    for (const path of paths) {
      try {
        const url = buildMagentoRestUrl(restApiBase, path, code);
        const res = await magentoFetch(url, { headers });
        if (!res.ok) {
          logger.warn(`[Magento] searchTerms [store=${code || 'default'}] ${path}: HTTP ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { items?: unknown[] };
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) continue;
        const terms: { term: string; hits: number; results?: number }[] = [];
        for (const it of items as Record<string, unknown>[]) {
          const term = String(
            it.query_text ?? it.search_text ?? it.query ?? it.term ?? it.keyword ?? it.display_text ?? ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (!term) continue;
          const hits = Number(it.popularity ?? it.hits ?? it.count ?? 0) || 0;
          const resultsNum = Number(it.num_results ?? it.results ?? 0);
          const entry: { term: string; hits: number; results?: number } = { term, hits };
          if (Number.isFinite(resultsNum) && resultsNum > 0) entry.results = resultsNum;
          terms.push(entry);
        }
        if (terms.length === 0) continue;
        terms.sort((a, b) => b.hits - a.hits);
        await db.doc(`magento_popular_searches/${brandId}`).set(
          {
            brandId,
            terms: terms.slice(0, 100),
            syncedAt: FieldValue.serverTimestamp(),
            source: path.startsWith('performance-plus/')
              ? 'magento_performance_plus_search_terms_api'
              : 'magento_searchTerms_api',
            termsProvenance: path.startsWith('performance-plus/')
              ? 'magento_performance_plus_module'
              : 'magento_searchTerms_rest',
          },
          { merge: true }
        );
        logger.info(`[Magento] Popular search terms (REST): ${terms.length} for brand ${brandId}`);
        return terms.length;
      } catch (e) {
        logger.warn(`[Magento] searchTerms failed [store=${code || 'default'}] (${path}):`, e);
      }
    }
  }
  return 0;
}

function getMagentoShopLabel(config: MagentoStoreConfig | null, fallbackUrl: string): string {
  const candidateUrl = getStoreConfigUrls(config || {})[0];
  if (candidateUrl) {
    return candidateUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
  return config?.store_name || fallbackUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Επιλογή του σωστού storeConfig για το URL που έδωσε ο χρήστης.
 *
 * Σημαντικό: σε multi-website Magento (π.χ. ίδιο backend για Safeblock + e-tennis),
 * το /storeConfigs επιστρέφει ΟΛΑ τα stores. Ποτέ μην πέφτουμε σιωπηλά στο "first non-admin"
 * — αν το URL του χρήστη δεν ταιριάζει σε κανένα storeConfig και υπάρχουν >1 επιλογές,
 * ζητάμε ρητά store_code (ambiguous). Αυτό αποτρέπει το να εμφανιστεί π.χ. e-tennis αντί για safeblock.
 */
function pickMagentoStoreConfig(
  configs: unknown[],
  storeUrl: string,
  preferredStoreCode?: string
): {
  selected: MagentoStoreConfig | null;
  availableCodes: string[];
  ambiguous: boolean;
  matchedByUrl: boolean;
  candidates: MagentoStoreDirectoryEntry[];
} {
  const typed = configs.filter((cfg): cfg is MagentoStoreConfig => typeof cfg === 'object' && cfg !== null);
  const nonAdmin = typed.filter((cfg) => String(cfg.code || '').trim().toLowerCase() !== 'admin');
  const availableCodes = nonAdmin.map((cfg) => String(cfg.code || '').trim()).filter(Boolean);
  const candidates = directoryFromMagentoStoreConfigs(configs);

  const requestedCode = String(preferredStoreCode || '').trim().toLowerCase();
  if (requestedCode) {
    const exact = typed.find((cfg) => String(cfg.code || '').trim().toLowerCase() === requestedCode);
    return {
      selected: exact || null,
      availableCodes,
      ambiguous: false,
      matchedByUrl: false,
      candidates,
    };
  }

  const targetHost = normalizeComparableHost(storeUrl);
  const targetUrl = normalizeComparableUrl(storeUrl);
  const targetApex = getApexDomain(targetHost);

  const ranked = typed
    .map((cfg) => {
      let score = 0;
      for (const rawUrl of getStoreConfigUrls(cfg)) {
        const cfgHost = normalizeComparableHost(rawUrl);
        const cfgUrl = normalizeComparableUrl(rawUrl);
        const cfgApex = getApexDomain(cfgHost);
        if (cfgUrl && (cfgUrl === targetUrl || targetUrl.startsWith(cfgUrl) || cfgUrl.startsWith(targetUrl))) {
          score = Math.max(score, 120);
        }
        if (cfgHost && cfgHost === targetHost) score = Math.max(score, 100);
        // Apex match (subdomain tolerant): shop.safeblock.gr ↔ safeblock.gr
        if (cfgApex && targetApex && cfgApex === targetApex) score = Math.max(score, 80);
      }
      if (String(cfg.code || '').trim().toLowerCase() === 'admin') score -= 1000;
      return { cfg, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked.find((item) => item.score > 0);
  if (best) {
    return {
      selected: best.cfg,
      availableCodes,
      ambiguous: false,
      matchedByUrl: true,
      candidates,
    };
  }

  // Δεν βρέθηκε URL match.
  if (nonAdmin.length === 1) {
    return {
      selected: nonAdmin[0],
      availableCodes,
      ambiguous: false,
      matchedByUrl: false,
      candidates,
    };
  }
  if (nonAdmin.length > 1) {
    // Multi-store install και το URL δεν ταυτοποιεί ξεκάθαρα ποιο store θέλει ο χρήστης.
    return {
      selected: null,
      availableCodes,
      ambiguous: true,
      matchedByUrl: false,
      candidates,
    };
  }
  return {
    selected: typed[0] || null,
    availableCodes,
    ambiguous: false,
    matchedByUrl: false,
    candidates,
  };
}

function buildMagentoRestUrl(restApiBase: string, endpoint: string, storeCode?: string): string {
  const cleanBase = restApiBase.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^V1\/+/, '');
  const encodedStoreCode = String(storeCode || '').trim();
  return encodedStoreCode
    ? `${cleanBase}/rest/${encodeURIComponent(encodedStoreCode)}/V1/${cleanEndpoint}`
    : `${cleanBase}/rest/V1/${cleanEndpoint}`;
}

function normalizeSkuKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadActiveStockSkus(db: Firestore, brandId: string): Promise<string[]> {
  const snap = await db.collection('products').where('brandId', '==', brandId).where('stock_level', '>', 0).get();
  const skus = new Set<string>();
  for (const doc of snap.docs) {
    const row = doc.data();
    const sku = normalizeSkuKey(row.sku ?? row.id);
    if (sku) skus.add(sku);
  }
  return [...skus].sort();
}

function formatMagentoProductAccessError(status: number, url: string, body = ''): string {
  if (status === 401 || status === 403) {
    return (
      `Magento product catalog access denied (HTTP ${status}). ` +
      'Το token διαβάζει orders/store configs, αλλά όχι τον κατάλογο προϊόντων, άρα δεν μπορούμε να φέρουμε εικόνες. ' +
      'Δημιουργήστε ή ανανεώστε Magento Admin Integration με Resource Access για Catalog / Products (ή All), κάντε Reconnect στο Magento connector και μετά Sync. ' +
      `Endpoint: ${url}`
    );
  }
  const snippet = body.replace(/\s+/g, ' ').slice(0, 180);
  return `Magento products fetch failed (HTTP ${status})${snippet ? `: ${snippet}` : ''}`;
}

async function probeMagentoProductCatalogAccess(
  restApiBase: string,
  storeCode: string | undefined,
  headers: Record<string, string>
): Promise<{ ok: true } | { ok: false; status: number; url: string; body: string }> {
  const params = new URLSearchParams({
    'searchCriteria[pageSize]': '1',
    'searchCriteria[currentPage]': '1',
    fields: 'items[id,sku],total_count',
  });
  const url = buildMagentoRestUrl(restApiBase, `products?${params.toString()}`, storeCode);
  const res = await magentoFetch(url, { headers });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, url, body: await res.text().catch(() => '') };
}

type MagentoCategoryNode = {
  id?: number | string;
  name?: string;
  path?: string;
  children_data?: MagentoCategoryNode[];
};

type MagentoCategoryInfo = {
  id: string;
  name: string;
  pathIds: string[];
  pathNames: string[];
};

function isUsefulMagentoCategoryName(name: string): boolean {
  return !!name && !/^(root catalog|default category|root|catalog)$/i.test(name.trim());
}

function flattenMagentoCategoryTree(
  node: MagentoCategoryNode,
  out: Map<string, MagentoCategoryInfo>,
  parentNames: string[] = []
): void {
  const id = String(node.id ?? '').trim();
  const name = String(node.name ?? '').trim();
  const nextNames = isUsefulMagentoCategoryName(name) ? [...parentNames, name] : parentNames;
  if (id) {
    out.set(id, {
      id,
      name,
      pathIds: String(node.path || '')
        .split('/')
        .map((v) => v.trim())
        .filter(Boolean),
      pathNames: nextNames,
    });
  }
  for (const child of node.children_data || []) {
    flattenMagentoCategoryTree(child, out, nextNames);
  }
}

async function fetchMagentoCategoryMap(
  restApiBase: string,
  storeCode: string | undefined,
  headers: Record<string, string>
): Promise<Map<string, MagentoCategoryInfo>> {
  try {
    const res = await magentoFetch(buildMagentoRestUrl(restApiBase, 'categories', storeCode), { headers });
    if (!res.ok) return new Map();
    const root = (await res.json()) as MagentoCategoryNode;
    const out = new Map<string, MagentoCategoryInfo>();
    flattenMagentoCategoryTree(root, out);
    return out;
  } catch {
    return new Map();
  }
}

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
        const res = await magentoFetch(url, { headers, redirect: 'follow' });
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
  accessToken: string,
  preferredStoreCode?: string,
  opts?: { syncAllStores?: boolean }
): Promise<{
  success: boolean;
  shopName?: string;
  storeCode?: string;
  storeName?: string;
  syncAllStores?: boolean;
  error?: string;
  availableStoreCodes?: string[];
  storeCandidates?: MagentoStoreDirectoryEntry[];
}> {
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  const tokenPlain = normalizeMagentoToken(accessToken);
  const testResult = await testMagentoConnection(normalizedUrl, tokenPlain, preferredStoreCode);

  if (!testResult.success) {
    return {
      success: false,
      error: testResult.error,
      availableStoreCodes: testResult.availableStoreCodes,
      storeCandidates: testResult.storeCandidates,
    };
  }

  const connectorRef = getDb().doc(`connectors/${brandId}`);
  const storeDirectory = testResult.storeDirectory ?? [];

  await connectorRef.set(
    {
      magento: {
        connected: true,
        storeUrl: normalizedUrl,
        /** Πρόθεμα για όλα τα REST calls — μπορεί να τελειώνει σε /index.php */
        restApiBase: testResult.restApiBase || normalizedUrl,
        shopName: testResult.shopName || normalizedUrl,
        storeCode: testResult.storeCode || '',
        storeName: testResult.storeName || '',
        storeId: testResult.storeId ?? null,
        magentoVersion: testResult.version || '',
        /** Δημόσιο storefront base για product links στο Ads Feed */
        storeWebUrl: testResult.storeWebUrl || '',
        /** Storefront media root για image_link στο Ads Feed */
        mediaBaseUrl: testResult.mediaBaseUrl || '',
        productCatalogAccess: true,
        productCatalogAccessCheckedAt: FieldValue.serverTimestamp(),
        accessToken: encryptToken(tokenPlain),
        connectedAt: FieldValue.serverTimestamp(),
        syncAllStores: Boolean(opts?.syncAllStores),
        storeDirectory,
      },
    },
    { merge: true }
  );

  logger.info(`[Magento] Connected brand ${brandId} to store ${normalizedUrl}`);
  return {
    success: true,
    shopName: testResult.shopName,
    storeCode: testResult.storeCode,
    storeName: testResult.storeName,
    syncAllStores: Boolean(opts?.syncAllStores),
  };
}

/**
 * Ενημέρωση ρυθμίσεων συγχρονισμού χωρίς να ξανά-υποχρεώσει access token στο UI.
 */
export async function updateMagentoSyncScope(
  brandId: string,
  syncAllStores: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const snap = await getDb().doc(`connectors/${brandId}`).get();
    const mag = snap.data()?.magento;
    if (!mag?.connected) {
      return { ok: false, error: 'Το Magento δεν είναι συνδεδεμένο για αυτό το brand.' };
    }
    await getDb().doc(`connectors/${brandId}`).set(
      { 'magento.syncAllStores': syncAllStores },
      { merge: true }
    );
    logger.info(`[Magento] Updated syncAllStores=${syncAllStores} for brand ${brandId}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Test Magento REST API connection via store config endpoint.
 * Δοκιμάζει πολλαπλά URL patterns (rewrite vs index.php, www vs bare host).
 */
export async function testMagentoConnection(
  storeUrl: string,
  accessToken: string,
  preferredStoreCode?: string
): Promise<{
  success: boolean;
  shopName?: string;
  storeCode?: string;
  storeName?: string;
  storeId?: number;
  version?: string;
  restApiBase?: string;
  /** Δημόσιο storefront base (π.χ. https://safeblock.gr) — για product link στο feed. */
  storeWebUrl?: string;
  /** Storefront media root (π.χ. https://safeblock.gr/pub/media/) — για image_link στο feed. */
  mediaBaseUrl?: string;
  error?: string;
  /** Όταν ambiguous ή λάθος storeCode, στέλνουμε τα διαθέσιμα στο frontend. */
  availableStoreCodes?: string[];
  storeCandidates?: MagentoStoreDirectoryEntry[];
  /** Πλήρης λίστα store views (με numeric id) — debugging / σύζευξη. */
  storeDirectory?: MagentoStoreDirectoryEntry[];
}> {
  try {
    const probe = await probeMagentoStoreConfigs(storeUrl, accessToken);
    if (!probe.ok) {
      return { success: false, error: formatMagentoProbeError(probe.fail) };
    }

    const { configs, restApiBase } = probe;
    const storeDirectoryFull = directoryFromMagentoStoreConfigs(configs);
    const pick = pickMagentoStoreConfig(configs, storeUrl, preferredStoreCode);
    const { selected, availableCodes, ambiguous, candidates } = pick;

    // Πάντα logάρουμε όλα τα διαθέσιμα stores για debugging multi-website installs.
    logger.info(
      `[Magento] storeConfigs candidates (url=${storeUrl}, preferredCode=${preferredStoreCode || '—'}): ` +
      JSON.stringify(candidates)
    );

    if (preferredStoreCode && !selected) {
      return {
        success: false,
        error: availableCodes.length
          ? `Το store code "${preferredStoreCode}" δεν βρέθηκε. Διαθέσιμα codes: ${availableCodes.join(', ')}`
          : `Το store code "${preferredStoreCode}" δεν βρέθηκε στο Magento storeConfigs.`,
        availableStoreCodes: availableCodes,
        storeCandidates: candidates,
        storeDirectory: storeDirectoryFull,
      };
    }

    if (ambiguous) {
      const listed = candidates
        .map((c) => `${c.code}${c.storeName ? ` (${c.storeName})` : ''}${c.baseUrl ? ` → ${c.baseUrl}` : ''}`)
        .join(' · ');
      return {
        success: false,
        error:
          `Το Magento επέστρεψε ${availableCodes.length} stores και το URL «${storeUrl}» δεν ταιριάζει ξεκάθαρα σε κάποιο. ` +
          `Συμπλήρωσε το πεδίο «Store Code» με ένα από: ${availableCodes.join(', ')}. ` +
          (listed ? `Λεπτομέρειες: ${listed}` : ''),
        availableStoreCodes: availableCodes,
        storeCandidates: candidates,
        storeDirectory: storeDirectoryFull,
      };
    }

    const storeName = getMagentoShopLabel(selected, storeUrl);
    const resolvedStoreCode = String(selected?.code || preferredStoreCode || '').trim();
    const resolvedStoreName = String(selected?.store_name || '').trim();
    const storeIdNum = Number(selected?.id);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${normalizeMagentoToken(accessToken)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': MAGENTO_UA,
    };

    const productAccess = await probeMagentoProductCatalogAccess(restApiBase, resolvedStoreCode || undefined, headers);
    if (!productAccess.ok) {
      return {
        success: false,
        error: formatMagentoProductAccessError(productAccess.status, productAccess.url, productAccess.body),
        availableStoreCodes: availableCodes,
        storeCandidates: candidates,
        storeDirectory: storeDirectoryFull,
      };
    }

    let version = '';
    try {
      const modRes = await magentoFetch(`${restApiBase}/rest/V1/modules`, { headers });
      if (modRes.ok) {
        const modules = await modRes.json();
        if (Array.isArray(modules) && modules.includes('Magento_Store')) {
          version = 'Magento 2.x';
        }
      }
    } catch {
      // non-critical
    }

    const storeWebUrl = getStorefrontWebUrl(selected);
    const mediaBaseUrl = getStoreMediaBaseUrl(selected);
    logger.info(`[Magento] Connection test OK — store: ${storeName}, restApiBase=${restApiBase}, web=${storeWebUrl}, media=${mediaBaseUrl}`);
    return {
      success: true,
      restApiBase,
      shopName: String(storeName).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      storeCode: resolvedStoreCode || undefined,
      storeName: resolvedStoreName || undefined,
      storeId: Number.isFinite(storeIdNum) ? storeIdNum : undefined,
      version,
      storeWebUrl: storeWebUrl || undefined,
      mediaBaseUrl: mediaBaseUrl || undefined,
      storeDirectory: storeDirectoryFull,
      storeCandidates: storeDirectoryFull,
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
 * Εξαγωγή payment info από Magento order. Καλύπτει additional_information ως
 * array, keyed object («Viva Payment Method» / «Sub-Payment Method» από Stonewave/Viva),
 * ή string. Κρατάει `paymentInfoRaw` (capped JSON) ώστε να εντοπίζουμε νέα keys χωρίς νέο deploy.
 */
function extractMagentoPaymentInfo(payment: unknown): {
  paymentMethod: string;
  paymentMethodCode: string;
  paymentInfoRaw: string;
} {
  const p = (payment ?? {}) as Record<string, unknown>;
  const code = String(p.method ?? '').trim();
  const ai = p.additional_information;

  const parts: string[] = [];
  if (Array.isArray(ai)) {
    for (const v of ai) {
      if (v == null || v === '') continue;
      parts.push(typeof v === 'object' ? JSON.stringify(v) : String(v).trim());
    }
  } else if (ai && typeof ai === 'object') {
    for (const [k, v] of Object.entries(ai as Record<string, unknown>)) {
      if (v == null || v === '' || typeof v === 'object') continue;
      const val = String(v).trim();
      if (!val) continue;
      // Κρατάμε το label (π.χ. «Sub-Payment Method») ώστε το bucketing regex να το πιάνει.
      parts.push(/payment[\s_-]*method|method[\s_-]*title|viva|sub/i.test(k) ? `${k}: ${val}` : val);
    }
  } else if (typeof ai === 'string' && ai.trim()) {
    parts.push(ai.trim());
  }

  let paymentInfoRaw = '';
  try {
    paymentInfoRaw = JSON.stringify({ method: code, additional_information: ai }).slice(0, 1500);
  } catch {
    paymentInfoRaw = '';
  }

  return { paymentMethod: parts.join(' • '), paymentMethodCode: code, paymentInfoRaw };
}

/**
 * Map a page of Magento product items → feed-ready docs and stream-write them to
 * `magento_products`. Shared between the active_stock path (SKU-filtered) and the
 * full-catalog fallback (ERP-less brands). Returns the number of products written.
 */
async function ingestMagentoProductPage(
  db: Firestore,
  brandId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[],
  categoryMap: Map<string, MagentoCategoryInfo>,
  idToSku: Map<string, string>,
  parentLinks: { childId: string; parentId: string }[],
): Promise<number> {
  const pageItems: { id: string; data: Record<string, unknown> }[] = [];

  for (const p of products) {
    const customAttrs = p.custom_attributes || [];
    const getAttr = (code: string): string => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = customAttrs.find((a: any) => a.attribute_code === code)?.value;
      return v == null ? '' : String(v);
    };
    const stockItem = p.extension_attributes?.stock_item;

    const imagePath = getAttr('image') || getAttr('small_image') || getAttr('thumbnail') || '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const galleryFirst = (p.media_gallery_entries || []).find((e: any) => !e?.disabled)?.file || '';
    const imageRelative = imagePath || galleryFirst || '';

    const urlKey = getAttr('url_key');
    const description = getAttr('description');
    const shortDescription = getAttr('short_description');
    const metaTitle = getAttr('meta_title');
    const metaDescription = getAttr('meta_description');
    const gtin = getAttr('gtin') || getAttr('ean') || getAttr('upc') || getAttr('barcode');
    const mpn = getAttr('mpn') || getAttr('manufacturer_part_number');
    const color = getAttr('color');
    const size = getAttr('size');
    const visibility = Number(p.visibility ?? 0);

    const categoryIds: string[] = (p.extension_attributes?.category_links || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => String(c?.category_id || ''))
      .filter(Boolean);
    const categoryPaths = categoryIds
      .map((id) => categoryMap.get(id)?.pathNames || [])
      .filter((path) => path.length > 0)
      .sort((a, b) => b.length - a.length);
    const primaryCategoryPath = categoryPaths[0] || [];
    const categoryNames = [...new Set(categoryPaths.flat())];
    const categoryName = primaryCategoryPath[0] || '';
    const subcategoryName =
      primaryCategoryPath.length > 1 ? primaryCategoryPath[primaryCategoryPath.length - 1] : '';

    const configurableLinks: string[] = (p.extension_attributes?.configurable_product_links || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((id: any) => String(id))
      .filter(Boolean);
    if (p.type_id === 'configurable' && configurableLinks.length > 0) {
      for (const childId of configurableLinks) {
        parentLinks.push({ childId, parentId: String(p.id) });
      }
    }

    idToSku.set(String(p.id), String(p.sku || ''));
    pageItems.push({
      id: `mag_${p.id}`,
      data: {
        productId: String(p.id || ''),
        sku: p.sku || '',
        name: p.name || '',
        type: p.type_id || '',
        status: p.status === 1 ? 'active' : 'inactive',
        visibility,
        price: parseFloat(p.price || '0'),
        weight: parseFloat(p.weight || '0'),
        stockQuantity: stockItem?.qty ?? null,
        inStock: stockItem?.is_in_stock ?? null,
        specialPrice: getAttr('special_price') ? parseFloat(getAttr('special_price')) : null,
        manufacturer: getAttr('manufacturer'),
        category: categoryName,
        subcategory: subcategoryName,
        categoryNames,
        categoryPath: primaryCategoryPath,
        urlKey,
        description,
        shortDescription,
        metaTitle,
        metaDescription,
        imageRelative,
        gtin,
        mpn,
        color,
        size,
        categoryIds,
        configurableLinks,
        createdAt: p.created_at || '',
        updatedAt: p.updated_at || '',
        source: 'magento_api',
        brandId,
      },
    });
  }

  if (pageItems.length > 0) {
    for (let i = 0; i < pageItems.length; i += 500) {
      const batch = db.batch();
      const chunk = pageItems.slice(i, i + 500);
      for (const item of chunk) {
        batch.set(
          db.collection('magento_products').doc(item.id),
          { ...item.data, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      await batch.commit();
    }
  }

  return pageItems.length;
}

/**
 * Fetch Magento orders/products and store in Firestore.
 * First runs backfill history; later runs use updated_at with overlap for status/stock changes.
 * Customer email is stored for audience exports, while `customerEmailHash` is used
 * for analytics/matching.
 */
export async function fetchMagentoData(brandId: string): Promise<{
  success: boolean;
  imported: number;
  error?: string;
  message?: string;
  /** Non-fatal degraded outcome (π.χ. orders OK αλλά product-catalog ACL denied). */
  warning?: string;
  degraded?: boolean;
}> {
  const db = getDb();
  const connectorDoc = await db.doc(`connectors/${brandId}`).get();
  const connector = connectorDoc.data()?.magento;

  if (!connector?.connected || !connector?.accessToken) {
    return { success: false, imported: 0, error: 'Magento not connected' };
  }

  const storeUrl = String(connector.storeUrl || '').replace(/\/+$/, '');
  const storeWebUrl = String((connector as { storeWebUrl?: string }).storeWebUrl || '').trim();
  const restApiBase = String((connector as { restApiBase?: string }).restApiBase || storeUrl).replace(/\/+$/, '');
  const storeCode = String((connector as { storeCode?: string }).storeCode || '').trim();
  const storeId = Number((connector as { storeId?: number | string }).storeId);
  /** Όταν true δεν ωθούμε φίλτρο store_id στο REST API — εγκαταστάσεις πολλαπλών fronts στο ίδιο Magento. */
  const syncAllStores = Boolean((connector as { syncAllStores?: boolean }).syncAllStores);
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

  const storeIdToHost = new Map<number, string>();
  const fallbackOrderStoreHost = storefrontHostFromBaseUrl(storeWebUrl || storeUrl);

  try {
    const dirProbe = await probeMagentoStoreConfigs(storeUrl, accessToken);
    if (dirProbe.ok) {
      const dir = directoryFromMagentoStoreConfigs(dirProbe.configs);
      for (const e of dir) {
        const host = storefrontHostFromBaseUrl(e.baseUrl);
        if (host && Number.isFinite(e.id)) storeIdToHost.set(e.id, host);
      }
      if (dir.length > 0) {
        const cref = db.doc(`connectors/${brandId}`);
        await cref.set(
          {
            'magento.storeDirectory': dir,
          },
          { merge: true }
        );
      }
    }
  } catch (e) {
    logger.warn(`[Magento] storeDirectory refresh skipped for ${brandId}:`, e);
  }

  let totalImported = 0;
  const errors: string[] = [];

  const orderWindow = buildHistoricalOrIncrementalWindow(connector, 'lastOrdersSyncAt', 'historyLoadedUntilYear', 3, ECOMMERCE_INCREMENTAL_OVERLAP_HOURS);
  const orderCursor = coerceSyncDate((connector as Record<string, unknown>).ordersHistoryCursor);
  if (orderWindow.mode === 'historical' && orderCursor && orderCursor > orderWindow.windowStart) {
    orderWindow.windowStart = orderCursor;
  }

  const productsWindowStart: Date | null = null;
  const productsWindowEnd = new Date();
  const activeStockSkus = await loadActiveStockSkus(db, brandId);
  // ERP-less brands (άδειο `products`) → full_catalog fallback· αλλιώς active_stock enrichment.
  const productsMode: 'active_stock' | 'full_catalog' = activeStockSkus.length === 0 ? 'full_catalog' : 'active_stock';

  logger.info(
    `[Magento] Sync windows for ${brandId}: orders=${orderWindow.mode}:${toMagentoDateTime(orderWindow.windowStart)}->${toMagentoDateTime(orderWindow.windowEnd)} products=${productsMode}:activeStockSkus=${activeStockSkus.length} · ordersScope=${syncAllStores ? 'all_stores' : `store_id=${Number.isFinite(storeId) && storeId > 0 ? storeId : 'none'}`}`
  );

  try {
    // ── Orders ─────────────────────────────────────────────────────────
    let orderImportedCount = 0;
    let currentPage = 1;
    let hasMore = true;
    let ordersOk = true;
    let ordersBackfillIncomplete = false;
    let lastOrderCreatedAt: Date | null = null;

    while (hasMore) {
      const orderDateField = orderWindow.mode === 'incremental' ? 'updated_at' : 'created_at';
      const orderSortDirection = orderWindow.mode === 'incremental' ? 'DESC' : 'ASC';
      const orderWindowValue = orderWindow.mode === 'incremental'
        ? toMagentoDateTime(orderWindow.windowStart)
        : toYmd(orderWindow.windowStart);
      const searchParams = new URLSearchParams({
        'searchCriteria[filter_groups][0][filters][0][field]': orderDateField,
        'searchCriteria[filter_groups][0][filters][0][value]': orderWindowValue,
        'searchCriteria[filter_groups][0][filters][0][condition_type]': 'gteq',
        'searchCriteria[sortOrders][0][field]': orderDateField,
        'searchCriteria[sortOrders][0][direction]': orderSortDirection,
        'searchCriteria[pageSize]': '100',
        'searchCriteria[currentPage]': String(currentPage),
        'fields': 'items[entity_id,increment_id,store_id,customer_id,customer_email,customer_firstname,customer_lastname,billing_address[email,firstname,lastname],created_at,updated_at,status,grand_total,subtotal,tax_amount,discount_amount,base_grand_total,base_subtotal,base_tax_amount,base_discount_amount,base_currency_code,total_item_count,order_currency_code,shipping_description,payment,items[item_id,sku,name,qty_ordered,price,product_id,product_type,parent_item_id,row_total,base_row_total]],total_count',
      });
      if (!syncAllStores && Number.isFinite(storeId) && storeId > 0) {
        searchParams.set('searchCriteria[filter_groups][1][filters][0][field]', 'store_id');
        searchParams.set('searchCriteria[filter_groups][1][filters][0][value]', String(storeId));
        searchParams.set('searchCriteria[filter_groups][1][filters][0][condition_type]', 'eq');
      }

      const res = await magentoFetch(buildMagentoRestUrl(restApiBase, `orders?${searchParams.toString()}`, storeCode), { headers });
      if (!res.ok) {
        const error = `Orders fetch failed (${res.status})`;
        logger.error(`[Magento] ${error}`);
        errors.push(error);
        ordersOk = false;
        break;
      }

      const body = await res.json();
      const orders: any[] = body.items || [];
      const totalCount: number = body.total_count || 0;
      const pageOrderItems: { id: string; data: Record<string, unknown> }[] = [];

      for (const o of orders) {
        const { paymentMethod: paymentAdditionalInfo, paymentMethodCode, paymentInfoRaw } =
          extractMagentoPaymentInfo(o.payment);
        const magCid =
          o.customer_id != null && String(o.customer_id) !== '0' && String(o.customer_id) !== ''
            ? String(o.customer_id)
            : '';
        const emailIdentity = getCustomerEmailIdentity(
          o.customer_email || o.billing_address?.email || o.extension_attributes?.customer_email
        );
        const customerFirstname = String(o.customer_firstname || o.billing_address?.firstname || '').trim();
        const customerLastname = String(o.customer_lastname || o.billing_address?.lastname || '').trim();
        const customerName = [customerFirstname, customerLastname].filter(Boolean).join(' ');
        const created = o.created_at ? new Date(o.created_at) : null;
        if (created && !Number.isNaN(created.getTime()) && (!lastOrderCreatedAt || created > lastOrderCreatedAt)) {
          lastOrderCreatedAt = created;
        }
        pageOrderItems.push({
          id: `mag_${o.entity_id}`,
          data: {
            orderId: String(o.entity_id || ''),
            incrementId: o.increment_id || '',
            orderName: o.increment_id || String(o.entity_id || ''),
            ...(magCid ? { customerId: magCid } : {}),
            ...emailIdentity,
            ...(customerName ? { customerName } : {}),
            createdAt: o.created_at || '',
            updatedAt: o.updated_at || '',
            status: o.status || '',
            grandTotal: parseFloat(o.grand_total || '0'),
            subtotal: parseFloat(o.subtotal || '0'),
            taxAmount: parseFloat(o.tax_amount || '0'),
            discountAmount: parseFloat(o.discount_amount || '0'),
            // Base currency totals — απαραίτητα για multi-store/multi-website Magento (e.g. e-tennis GR/BG/RO/CY).
            // Όταν το store currency διαφέρει από το base (BGN/RON), χωρίς αυτά αθροίζαμε τα local νούμερα
            // σαν να ήταν EUR → υπερεκτίμηση τζίρου. Όλα τα aggregations χρησιμοποιούν τα base_* όταν υπάρχουν.
            baseGrandTotal: parseFloat(o.base_grand_total || '0'),
            baseSubtotal: parseFloat(o.base_subtotal || '0'),
            baseTaxAmount: parseFloat(o.base_tax_amount || '0'),
            baseDiscountAmount: parseFloat(o.base_discount_amount || '0'),
            baseCurrencyCode: o.base_currency_code || 'EUR',
            totalItemCount: parseInt(o.total_item_count || '0', 10),
            currency: o.order_currency_code || 'EUR',
            paymentMethod: paymentAdditionalInfo || paymentMethodCode || '',
            ...(paymentMethodCode ? { paymentMethodCode } : {}),
            ...(paymentInfoRaw ? { paymentInfoRaw } : {}),
            shippingMethod: normalizeMagentoShippingDescription(o.shipping_description || ''),
            magentoStoreId: Number.isFinite(Number(o.store_id)) ? Number(o.store_id) : null,
            orderStoreDomain: (() => {
              const sidN = Number(o.store_id);
              if (!Number.isFinite(sidN) || sidN <= 0) {
                return storeIdToHost.size === 0 && fallbackOrderStoreHost ? fallbackOrderStoreHost : null;
              }
              const mapped = storeIdToHost.get(sidN);
              if (mapped) return mapped;
              if (storeIdToHost.size === 0 && fallbackOrderStoreHost) return fallbackOrderStoreHost;
              return null;
            })(),
            lineItems: (o.items || []).slice(0, 250).map((li: any) => {
              function pickRowTotal(): number {
                for (const k of ['row_total', 'base_row_total'] as const) {
                  const v = li[k];
                  if (v == null || v === '') continue;
                  const n = parseFloat(String(v));
                  if (Number.isFinite(n)) return n;
                }
                return 0;
              }
              const rowTot = pickRowTotal();
              const pid = li.parent_item_id;
              return {
                itemId: li.item_id != null && li.item_id !== '' ? li.item_id : null,
                sku: li.sku || '',
                name: li.name || '',
                quantity: parseFloat(li.qty_ordered || '0'),
                price: parseFloat(li.price || '0'),
                productId: li.product_id || null,
                productType: li.product_type || '',
                parentItemId: pid != null && pid !== false ? pid : null,
                rowTotal: rowTot,
              };
            }),
            source: 'magento_api',
            brandId,
          },
        });
      }

      // Streaming write: commit each order page immediately to avoid OOM on large Magento histories.
      if (pageOrderItems.length > 0) {
        for (let i = 0; i < pageOrderItems.length; i += 500) {
          const batch = db.batch();
          const chunk = pageOrderItems.slice(i, i + 500);
          for (const item of chunk) {
            batch.set(db.collection('magento_orders').doc(item.id), { ...item.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          }
          await batch.commit();
        }
        orderImportedCount += pageOrderItems.length;
      }

      hasMore = currentPage * 100 < totalCount;
      currentPage++;
      /**
       * Backfill cap.
       * - Historical: 300 σελίδες (30K orders) ώστε brands με μεγάλο ιστορικό (e-tennis ~3 χρόνια
       *   × χιλιάδες/μήνα) να ολοκληρώνουν το backfill σε λίγες νύχτες αντί για >2 εβδομάδες.
       *   Το function timeout είναι 1800s — 30K orders × ~120ms/page χωράνε άνετα.
       * - Incremental: 100 σελίδες αρκούν (24h orders ~ <100 σελίδες).
       */
      const cap = orderWindow.mode === 'historical' ? 300 : 100;
      if (currentPage > cap) {
        if (hasMore && orderWindow.mode === 'historical') {
          ordersBackfillIncomplete = true;
        } else if (hasMore) {
          ordersOk = false;
          errors.push('Orders incremental page cap reached');
        }
        break;
      }
    }

    if (orderImportedCount > 0) {
      totalImported += orderImportedCount;
      logger.info(`[Magento] Orders: ${orderImportedCount} imported for brand ${brandId}`);
    }

    // Real Magento search queries (popularity from /V1/searchTerms — Commerce/extension only).
    // Magento Open Source ΔΕΝ εκθέτει αυτό το endpoint by default. Για OSS, ο χρήστης
    // ανεβάζει CSV από Marketing → Search Terms (UI). ΔΕΝ χρησιμοποιούμε ονόματα προϊόντων ως proxy.
    await fetchAndSaveMagentoPopularSearchTerms(db, brandId, restApiBase, storeCode, headers, storeId);

    // ── Products ───────────────────────────────────────────────────────
    // Streaming write: γράφουμε κάθε σελίδα στο Firestore αμέσως (αποφεύγουμε OOM για μεγάλα catalogs).
    // Δεν περιορίζουμε με `fields` ώστε να πάρουμε media_gallery_entries, custom_attributes,
    // extension_attributes (configurable links), category_links — απαιτούνται για Ads Feed.
    let prodPage = 1;
    let prodMore = true;
    let productsOk = true;
    let productsBackfillIncomplete = false;
    let prodImportedCount = 0;
    // Product-catalog access denial (HTTP 401/403) είναι ΜΗ-fatal: τα orders/E-commerce
    // ρέουν κανονικά· λείπει μόνο ο εμπλουτισμός εικόνων/meta. Το κρατάμε ξεχωριστά από
    // τα fatal errors ώστε το sync να ΜΗΝ βαφτίζεται «αποτυχία».
    let productCatalogDenied = false;
    let productCatalogDeniedReason = '';

    // SKU lookup map (id → sku) — lightweight, only IDs+SKUs kept in memory for variant resolution.
    const idToSku = new Map<string, string>();
    const parentLinks: { childId: string; parentId: string }[] = [];
    const categoryMap = await fetchMagentoCategoryMap(restApiBase, storeCode, headers);

    // Stock-source: ο ERP/import γεμίζει το `products` collection με stock_level>0.
    // Brands ΧΩΡΙΣ ERP (Magento-only, π.χ. safeblock) έχουν άδειο `products` → 0 SKUs.
    // Σε αυτή την περίπτωση κάνουμε fallback σε direct full-catalog sync (όπως πριν
    // το active_stock scoping), αλλιώς ο κατάλογος δεν θα συγχρονιζόταν ποτέ.
    const useFullCatalogFallback = productsMode === 'full_catalog';
    let fullCatalogResumeCursor: Date | null = null;

    if (useFullCatalogFallback) {
      // ── Full catalog fallback (no ERP stock source) ──────────────────
      const productCursor = coerceSyncDate((connector as Record<string, unknown>).productsHistoryCursor);
      let lastProductUpdatedAt: Date | null = null;
      let pagesFetched = 0;
      prodPage = 1;
      prodMore = true;
      logger.info(
        `[Magento] No active-stock SKUs for ${brandId} → full_catalog fallback (ERP-less)${productCursor ? ` resume updated_at>${toMagentoDateTime(productCursor)}` : ''}`
      );

      while (prodMore) {
        const searchParams = new URLSearchParams({
          'searchCriteria[pageSize]': '100',
          'searchCriteria[currentPage]': String(prodPage),
          'searchCriteria[sortOrders][0][field]': 'updated_at',
          'searchCriteria[sortOrders][0][direction]': 'ASC',
        });
        if (productCursor) {
          searchParams.set('searchCriteria[filter_groups][0][filters][0][field]', 'updated_at');
          searchParams.set('searchCriteria[filter_groups][0][filters][0][value]', toMagentoDateTime(productCursor));
          searchParams.set('searchCriteria[filter_groups][0][filters][0][condition_type]', 'gt');
        }

        const productUrl = buildMagentoRestUrl(restApiBase, `products?${searchParams.toString()}`, storeCode);
        const res = await magentoFetch(productUrl, { headers });
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          const error = `${formatMagentoProductAccessError(res.status, productUrl, bodyText)} page=${prodPage}`;
          logger.warn(`[Magento] ${error}`);
          productsOk = false;
          if (res.status === 401 || res.status === 403) {
            productCatalogDenied = true;
            productCatalogDeniedReason = error;
          } else {
            errors.push(error);
          }
          break;
        }

        const body = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const products: any[] = body.items || [];
        const totalCount: number = body.total_count || 0;
        prodImportedCount += await ingestMagentoProductPage(db, brandId, products, categoryMap, idToSku, parentLinks);

        for (const p of products) {
          const u = coerceSyncDate(p.updated_at);
          if (u && (!lastProductUpdatedAt || u > lastProductUpdatedAt)) lastProductUpdatedAt = u;
        }

        pagesFetched++;
        prodMore = prodPage * 100 < totalCount;
        if (prodMore && pagesFetched >= MAGENTO_FULL_CATALOG_PAGE_BUDGET) {
          productsBackfillIncomplete = true;
          prodMore = false;
          logger.warn(`[Magento] Full catalog page budget (${MAGENTO_FULL_CATALOG_PAGE_BUDGET}) reached for ${brandId}, resume next run`);
        }
        prodPage++;
      }

      // Resume cursor: αν κόπηκε από budget, συνεχίζουμε από το τελευταίο updated_at.
      if (productsOk && productsBackfillIncomplete && lastProductUpdatedAt) {
        fullCatalogResumeCursor = lastProductUpdatedAt;
      }
    } else {
      // ── Active-stock scope (ERP-backed): SKU-filtered enrichment ──────
      const activeSkuChunks = chunkArray(activeStockSkus, MAGENTO_ACTIVE_STOCK_SKU_CHUNK_SIZE);

      for (const skuChunk of activeSkuChunks) {
        prodPage = 1;
        prodMore = true;
        while (prodMore) {
          const searchParams = new URLSearchParams({
            'searchCriteria[pageSize]': '100',
            'searchCriteria[currentPage]': String(prodPage),
            'searchCriteria[filter_groups][0][filters][0][field]': 'sku',
            'searchCriteria[filter_groups][0][filters][0][value]': skuChunk.join(','),
            'searchCriteria[filter_groups][0][filters][0][condition_type]': 'in',
            'searchCriteria[sortOrders][0][field]': 'updated_at',
            'searchCriteria[sortOrders][0][direction]': 'ASC',
          });

          const productUrl = buildMagentoRestUrl(restApiBase, `products?${searchParams.toString()}`, storeCode);
          const res = await magentoFetch(productUrl, { headers });
          if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            const error = `${formatMagentoProductAccessError(res.status, productUrl, bodyText)} page=${prodPage}`;
            logger.warn(`[Magento] ${error}`);
            productsOk = false;
            if (res.status === 401 || res.status === 403) {
              productCatalogDenied = true;
              productCatalogDeniedReason = error;
            } else {
              errors.push(error);
            }
            break;
          }

          const body = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const products: any[] = body.items || [];
          const totalCount: number = body.total_count || 0;
          prodImportedCount += await ingestMagentoProductPage(db, brandId, products, categoryMap, idToSku, parentLinks);

          prodMore = prodPage * 100 < totalCount;
          prodPage++;
        }
        if (!productsOk) break;
      }
    }

    // Συμπλήρωση parentSku στα child variants (ώστε στο Ads Feed → item_group_id = parent SKU).
    // Γίνεται με targeted updates αφού έχουν γραφεί όλα τα products (streaming mode).
    if (parentLinks.length > 0) {
      const childToParents = new Map<string, Set<string>>();
      for (const { childId, parentId } of parentLinks) {
        if (!childToParents.has(childId)) childToParents.set(childId, new Set());
        childToParents.get(childId)!.add(parentId);
      }
      const childEntries = [...childToParents.entries()];
      for (let i = 0; i < childEntries.length; i += 500) {
        const batch = db.batch();
        for (const [childId, parentIds] of childEntries.slice(i, i + 500)) {
          const parentSkus = [...parentIds].map((pid) => idToSku.get(pid)).filter((v): v is string => Boolean(v));
          if (parentSkus.length === 0) continue;
          batch.update(db.collection('magento_products').doc(`mag_${childId}`), {
            parentSkus,
            itemGroupId: parentSkus[0],
          });
        }
        await batch.commit();
      }
    }

    if (prodImportedCount > 0) {
      totalImported += prodImportedCount;
      logger.info(`[Magento] Products: ${prodImportedCount} imported for brand ${brandId}`);
    }

    const connectorPatch: Record<string, unknown> = {};
    if (ordersOk) {
      if (orderWindow.mode === 'historical' && ordersBackfillIncomplete && lastOrderCreatedAt) {
        connectorPatch['magento.ordersHistoryCursor'] = new Date(lastOrderCreatedAt.getTime() + 1000);
      } else {
        connectorPatch['magento.ordersHistoryCursor'] = FieldValue.delete();
        connectorPatch['magento.lastOrdersSyncAt'] = FieldValue.serverTimestamp();
        if (orderWindow.mode === 'historical') {
          connectorPatch['magento.historyLoadedUntilYear'] = orderWindow.historyStartYear;
        }
      }
    }
    if (productsOk) {
      connectorPatch['magento.productCatalogAccess'] = true;
      connectorPatch['magento.productCatalogAccessError'] = FieldValue.delete();
      connectorPatch['magento.productCatalogAccessCheckedAt'] = FieldValue.serverTimestamp();
      connectorPatch['magento.productSyncScope'] = productsMode;
      connectorPatch['magento.activeStockSkuCount'] = activeStockSkus.length;
      // Full-catalog fallback: κράτα cursor αν κόπηκε από budget, αλλιώς καθάρισέ τον.
      connectorPatch['magento.productsHistoryCursor'] = fullCatalogResumeCursor
        ? fullCatalogResumeCursor
        : FieldValue.delete();
      connectorPatch['magento.lastProductsSyncAt'] = FieldValue.serverTimestamp();
    } else {
      connectorPatch['magento.productCatalogAccess'] = false;
      connectorPatch['magento.productCatalogAccessError'] =
        productCatalogDeniedReason || errors.find((e) => e.includes('product catalog')) || errors[errors.length - 1] || 'Magento products sync failed';
      connectorPatch['magento.productCatalogAccessCheckedAt'] = FieldValue.serverTimestamp();
    }
    if (Object.keys(connectorPatch).length) {
      connectorPatch['magento.lastSyncAt'] = FieldValue.serverTimestamp();
      await db.doc(`connectors/${brandId}`).update(connectorPatch);
    }

    // ── Log import_jobs ────────────────────────────────────────────────
    await db.collection('import_jobs').add({
      brandId,
      type: 'ecommerce',
      source: 'magento_api',
      status: errors.length ? 'partial' : 'completed',
      mode: orderWindow.mode,
      ordersMode: orderWindow.mode,
      productsMode,
      productSyncScope: productsMode,
      activeStockSkuCount: activeStockSkus.length,
      windowStart: orderWindow.windowStart.toISOString(),
      windowEnd: orderWindow.windowEnd.toISOString(),
      productsWindowStart: productsWindowStart ? productsWindowStart.toISOString() : null,
      productsWindowEnd: productsWindowEnd.toISOString(),
      ordersBackfillIncomplete,
      productsBackfillIncomplete,
      imported: totalImported,
      orders: orderImportedCount,
      products: prodImportedCount,
      failed: errors.length,
      errors: errors.slice(0, 20),
      // Degraded = μη-fatal (orders OK, λείπει μόνο ο εμπλουτισμός καταλόγου).
      degraded: productCatalogDenied,
      degradedReason: productCatalogDenied ? productCatalogDeniedReason.slice(0, 500) : null,
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(
      `[Magento] Sync complete for brand ${brandId}: ${totalImported} total items (errors=${errors.length}${productCatalogDenied ? ', product-catalog degraded' : ''})`
    );
    return {
      success: errors.length === 0,
      imported: totalImported,
      ...(errors.length ? { error: errors[0] } : {}),
      ...(productCatalogDenied
        ? {
            degraded: true,
            warning:
              'Τα orders συγχρονίστηκαν κανονικά. Δεν φέραμε εικόνες/στοιχεία καταλόγου (το Magento token δεν έχει πρόσβαση Catalog/Products). Τα δεδομένα E-commerce δεν επηρεάζονται.',
          }
        : {}),
    };
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

// ─── Test-only exports ─────────────────────────────────────────────
// Exposed for unit tests; not part of the public connector API.
export const __test = {
  pickMagentoStoreConfig,
  getApexDomain,
  normalizeComparableHost,
  normalizeComparableUrl,
};
