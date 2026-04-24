/**
 * Magento / Adobe Commerce Connector
 *
 * Flow:
 * 1. User enters e-shop URL + Access Token (from Admin → System → Integrations)
 * 2. We validate via GET /rest/V1/store/storeConfigs
 * 3. Credentials stored in Firestore (connectors/{brandId}.magento)
 * 4. Sync fetches orders (3 years) + products → Firestore (no PII stored)
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
  headers: Record<string, string>
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

  const paths = [
    'searchTerms?searchCriteria[pageSize]=50&searchCriteria[sortOrders][0][field]=popularity&searchCriteria[sortOrders][0][direction]=DESC',
    'searchTerms?searchCriteria[pageSize]=50',
  ];
  const codeVariants = [...new Set([String(storeCode || '').trim(), '', 'all', 'default'])];
  for (const code of codeVariants) {
    for (const path of paths) {
      try {
        const url = buildMagentoRestUrl(restApiBase, path, code);
        const res = await fetch(url, { headers });
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
            source: 'magento_searchTerms_api',
            termsProvenance: 'magento_searchTerms_rest',
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
  candidates: { code: string; storeName: string; baseUrl: string }[];
} {
  const typed = configs.filter((cfg): cfg is MagentoStoreConfig => typeof cfg === 'object' && cfg !== null);
  const nonAdmin = typed.filter((cfg) => String(cfg.code || '').trim().toLowerCase() !== 'admin');
  const availableCodes = nonAdmin.map((cfg) => String(cfg.code || '').trim()).filter(Boolean);
  const candidates = nonAdmin.map((cfg) => ({
    code: String(cfg.code || '').trim(),
    storeName: String(cfg.store_name || cfg.website_name || '').trim(),
    baseUrl: getStoreConfigUrls(cfg)[0] || '',
  }));

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
  accessToken: string,
  preferredStoreCode?: string
): Promise<{
  success: boolean;
  shopName?: string;
  storeCode?: string;
  storeName?: string;
  error?: string;
  availableStoreCodes?: string[];
  storeCandidates?: { code: string; storeName: string; baseUrl: string }[];
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

  await getDb().doc(`connectors/${brandId}`).set(
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
        accessToken: encryptToken(tokenPlain),
        connectedAt: FieldValue.serverTimestamp(),
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
  };
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
  storeCandidates?: { code: string; storeName: string; baseUrl: string }[];
}> {
  try {
    const probe = await probeMagentoStoreConfigs(storeUrl, accessToken);
    if (!probe.ok) {
      return { success: false, error: formatMagentoProbeError(probe.fail) };
    }

    const { configs, restApiBase } = probe;
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
 * Fetch Magento orders (last 3 years) + products and store in Firestore.
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
  const storeCode = String((connector as { storeCode?: string }).storeCode || '').trim();
  const storeId = Number((connector as { storeId?: number | string }).storeId);
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
    // ── Orders (last 3 years, no PII) ──────────────────────────────────
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - 3);
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
        'fields': 'items[entity_id,increment_id,created_at,updated_at,status,grand_total,subtotal,tax_amount,discount_amount,total_item_count,order_currency_code,shipping_description,payment[method,additional_information],items[sku,name,qty_ordered,price,product_id,product_type,parent_item_id,row_total,base_row_total]],total_count',
      });
      if (Number.isFinite(storeId) && storeId > 0) {
        searchParams.set('searchCriteria[filter_groups][1][filters][0][field]', 'store_id');
        searchParams.set('searchCriteria[filter_groups][1][filters][0][value]', String(storeId));
        searchParams.set('searchCriteria[filter_groups][1][filters][0][condition_type]', 'eq');
      }

      const res = await fetch(buildMagentoRestUrl(restApiBase, `orders?${searchParams.toString()}`, storeCode), { headers });
      if (!res.ok) {
        logger.error(`[Magento] Orders fetch failed (${res.status})`);
        break;
      }

      const body = await res.json();
      const orders: any[] = body.items || [];
      const totalCount: number = body.total_count || 0;

      for (const o of orders) {
        const paymentAdditionalInfo = Array.isArray(o.payment?.additional_information)
          ? o.payment.additional_information.filter(Boolean).join(' • ')
          : typeof o.payment?.additional_information === 'string'
            ? o.payment.additional_information
            : '';
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
            paymentMethod: paymentAdditionalInfo || o.payment?.method || '',
            shippingMethod: normalizeMagentoShippingDescription(o.shipping_description || ''),
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

      hasMore = currentPage * 100 < totalCount;
      currentPage++;
      // Hard cap αυξήθηκε από 30 → 100 (10.000 παραγγελίες/sync) για brands με μεγάλο όγκο.
      if (currentPage > 100) break;
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

    // Real Magento search queries (popularity from /V1/searchTerms — Commerce/extension only).
    // Magento Open Source ΔΕΝ εκθέτει αυτό το endpoint by default. Για OSS, ο χρήστης
    // ανεβάζει CSV από Marketing → Search Terms (UI). ΔΕΝ χρησιμοποιούμε ονόματα προϊόντων ως proxy.
    await fetchAndSaveMagentoPopularSearchTerms(db, brandId, restApiBase, storeCode, headers);

    // ── Products ───────────────────────────────────────────────────────
    // Δεν περιορίζουμε με `fields` ώστε να πάρουμε media_gallery_entries, custom_attributes,
    // extension_attributes (configurable links), category_links — απαιτούνται για Ads Feed.
    const prodItems: { id: string; data: Record<string, unknown> }[] = [];
    let prodPage = 1;
    let prodMore = true;

    // SKU lookup map (id → sku) ώστε για configurable parents να γράψουμε `parentSkus` στα variants.
    const idToSku = new Map<string, string>();
    const parentLinks: { childId: string; parentId: string }[] = [];

    while (prodMore) {
      const searchParams = new URLSearchParams({
        'searchCriteria[pageSize]': '100',
        'searchCriteria[currentPage]': String(prodPage),
      });

      const res = await fetch(buildMagentoRestUrl(restApiBase, `products?${searchParams.toString()}`, storeCode), { headers });
      if (!res.ok) {
        logger.warn(`[Magento] Products fetch failed (${res.status}) page=${prodPage}`);
        break;
      }

      const body = await res.json();
      const products: any[] = body.items || [];
      const totalCount: number = body.total_count || 0;

      for (const p of products) {
        const customAttrs = p.custom_attributes || [];
        const getAttr = (code: string): string => {
          const v = customAttrs.find((a: any) => a.attribute_code === code)?.value;
          return v == null ? '' : String(v);
        };
        const stockItem = p.extension_attributes?.stock_item;

        // Image: προτεραιότητα custom_attributes.image (σχετικό path) → /catalog/product
        // εναλλακτικά πρώτο media_gallery_entries[].file
        const imagePath = getAttr('image') || getAttr('small_image') || getAttr('thumbnail') || '';
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
          .map((c: any) => String(c?.category_id || ''))
          .filter(Boolean);

        const configurableLinks: string[] = (p.extension_attributes?.configurable_product_links || [])
          .map((id: any) => String(id))
          .filter(Boolean);
        if (p.type_id === 'configurable' && configurableLinks.length > 0) {
          for (const childId of configurableLinks) {
            parentLinks.push({ childId, parentId: String(p.id) });
          }
        }

        idToSku.set(String(p.id), String(p.sku || ''));

        prodItems.push({
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
            // Feed-ready fields
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
            // Variant relationships (αν configurable)
            configurableLinks,
            createdAt: p.created_at || '',
            updatedAt: p.updated_at || '',
            source: 'magento_api',
            brandId,
          },
        });
      }

      prodMore = prodPage * 100 < totalCount;
      prodPage++;
      // Hard cap αυξήθηκε από 30 → 100 (10.000 SKUs/sync)
      if (prodPage > 100) break;
    }

    // Συμπλήρωση parentSku στα child variants (ώστε στο Ads Feed → item_group_id = parent SKU).
    if (parentLinks.length > 0) {
      const childToParents = new Map<string, Set<string>>();
      for (const { childId, parentId } of parentLinks) {
        if (!childToParents.has(childId)) childToParents.set(childId, new Set());
        childToParents.get(childId)!.add(parentId);
      }
      for (const item of prodItems) {
        const childId = String((item.data as any).productId || '');
        const parents = childToParents.get(childId);
        if (!parents || parents.size === 0) continue;
        const parentSkus = [...parents].map((pid) => idToSku.get(pid)).filter((v): v is string => Boolean(v));
        if (parentSkus.length > 0) {
          (item.data as Record<string, unknown>).parentSkus = parentSkus;
          (item.data as Record<string, unknown>).itemGroupId = parentSkus[0];
        }
      }
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

// ─── Test-only exports ─────────────────────────────────────────────
// Exposed for unit tests; not part of the public connector API.
export const __test = {
  pickMagentoStoreConfig,
  getApexDomain,
  normalizeComparableHost,
  normalizeComparableUrl,
};
