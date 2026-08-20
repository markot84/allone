/** Competitor Monitoring via Meta Ad Library API; uses App Access Token (app_id|app_secret).
 * Tracks competitor ad activity: new ads, long-running ads, active ads. */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { decryptToken } from './tokenCrypto';
import { safeFetch } from './urlValidator';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const META_GRAPH_VERSION = 'v24.0';
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Broad EU + export markets (B2B ads often absent in GR alone); override via competitor_settings.reachedCountries. */
const DEFAULT_REACH_COUNTRIES = [
  'GR',
  'CY',
  'US',
  'GB',
  'DE',
  'IT',
  'FR',
  'ES',
  'PT',
  'NL',
  'BE',
  'AT',
  'PL',
  'BG',
  'RO',
  'TR',
];

function resolveReachedCountries(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const codes = raw.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
    if (codes.length > 0) return [...new Set(codes)];
  }
  return [...DEFAULT_REACH_COUNTRIES];
}

function getAppToken(): string {
  const appId = (process.env.META_APP_ID || '').trim();
  const appSecret = (process.env.META_APP_SECRET || '').trim();
  return `${appId}|${appSecret}`;
}

/** `ads_archive` often rejects the app token; the Meta OAuth user token (ads_read/ads_management) usually works.
 * Order: valid OAuth token → app token. */
async function resolveAdLibraryAccessToken(
  brandId: string
): Promise<{ token: string; source: 'user' | 'app' } | null> {
  try {
    const snap = await getDb().doc(`connectors/${brandId}`).get();
    const meta = snap.data()?.meta as
      | { connected?: boolean; accessToken?: string; expiresAt?: number }
      | undefined;
    const tok = decryptToken(meta?.accessToken);
    if (meta?.connected && typeof tok === 'string' && tok.length > 20) {
      if (!meta.expiresAt || meta.expiresAt > Date.now()) {
        logger.info(`[Competitor] ads_archive: χρήση Meta OAuth token (brand ${brandId})`);
        return { token: tok, source: 'user' };
      }
      logger.warn(`[Competitor] Meta OAuth token expired για ${brandId} — δοκιμή app token για ads_archive`);
    }
  } catch (e) {
    logger.warn(`[Competitor] Ανάγνωση connectors/${brandId}:`, { err: e });
  }
  const app = getAppToken();
  if (!app || app === '|') return null;
  logger.info(`[Competitor] ads_archive: χρήση app access token (brand ${brandId})`);
  return { token: app, source: 'app' };
}

interface CompetitorConfig {
  pageId: string;
  name: string;
  platform: string;
}

interface CompetitorAd {
  adId: string;
  competitorName: string;
  competitorPageId: string;
  adText: string;
  startDate: string;
  endDate?: string;
  platforms: string[];
  isActive: boolean;
  daysRunning: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

function normalizePagingNext(next: string | undefined | null): string | null {
  if (!next) return null;
  if (next.startsWith('http')) return next;
  if (next.startsWith('/')) return `https://graph.facebook.com${next}`;
  return `${META_GRAPH_URL}/${next.replace(/^\//, '')}`;
}

/** Body for ads_archive — POST avoids very long GET URLs (access_token + many params). */
function buildAdLibrarySearchParams(
  accessToken: string,
  mode: 'plain' | 'jsonArray',
  pageIdTrim: string,
  reachCountries: string[]
): URLSearchParams {
  const params = new URLSearchParams({
    access_token: accessToken,
    ad_active_status: 'ALL',
    ad_type: 'ALL',
    media_type: 'ALL',
    fields:
      'id,ad_creative_bodies,ad_delivery_start_time,ad_delivery_stop_time,page_name,publisher_platforms,page_id',
    limit: '100',
    ad_reached_countries: JSON.stringify(reachCountries),
  });
  if (mode === 'plain') {
    params.set('search_page_ids', pageIdTrim);
  } else {
    params.set('search_page_ids', JSON.stringify([pageIdTrim]));
  }
  return params;
}

function adCreativeFirstLine(ad: { ad_creative_bodies?: unknown }): string {
  const b = ad.ad_creative_bodies;
  if (Array.isArray(b) && b.length > 0) return String(b[0]);
  if (typeof b === 'string') return b;
  return '';
}

/** User-facing Greek message when Meta rejects Ad Library calls (permission / app config). */
function isAdLibraryPermissionDenied(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('does not have permission') ||
    m.includes('permission denied') ||
    m.includes('invalid oauth') ||
    (m.includes('permission') && (m.includes('application') || m.includes('this action')))
  );
}

/** Parse Graph error JSON (full body or embedded) for error_subcode e.g. 2332004. */
function extractMetaErrorSubcode(raw: string): number | undefined {
  const s = raw.trim();
  try {
    const j = JSON.parse(s) as { error?: { error_subcode?: number } };
    const sc = j?.error?.error_subcode;
    if (typeof sc === 'number') return sc;
  } catch {
    /* not JSON */
  }
  const m = s.match(/["']error_subcode["']\s*:\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

/** Subcode 2332004 = "App role required": the Facebook user tied to the token must be
 * Admin/Developer on this exact Meta app, not only Business Manager admin. */
function friendlyAdLibraryPermissionMessage(
  competitorName: string,
  usedUserToken: boolean,
  errorSubcode?: number
): string {
  const base = `${competitorName}: Δεν είναι δυνατή η παρακολούθηση διαφημίσεων — η Meta απορρίπτει την πρόσβαση στο Ad Library (ads_archive).`;

  if (errorSubcode === 2332004) {
    if (usedUserToken) {
      return `${base} Κωδικός σφάλματος Meta 2332004 («App role required»): ο λογαριασμός Facebook με τον οποίο κάνατε «Σύνδεση Meta» στις Συνδέσεις πρέπει να έχει ρόλο Administrator ή Developer στην ίδια εφαρμογή (developers.facebook.com → App → App roles). Αν άλλος λογαριασμός έκανε τη σύνδεση, προσθέστε κι αυτόν στους ρόλους ή αποσυνδέστε και συνδέστε ξανά με λογαριασμό που είναι ήδη στη λίστα· μετά «Scan τώρα».`;
    }
    return `${base} Κωδικός 2332004: το Ad Library χρειάζεται user token από λογαριασμό με ρόλο Admin/Developer στο Meta App. Συνδέστε το Meta από τις Συνδέσεις — το app token (μόνο META_APP_ID/SECRET) συχνά απορρίπτεται για ads_archive.`;
  }

  if (errorSubcode === 2332002) {
    return `${base} Κωδικός 2332002: η εφαρμογή/λογαριασμός δεν έχει πρόσβαση στο Ad Library API. Απαιτείται επιβεβαίωση ταυτότητας & αίτηση πρόσβασης στο facebook.com/ads/library/api (ID confirmation) — δεν λύνεται με permissions/scopes μόνο. Αφορά το Meta App συνολικά.`;
  }

  if (usedUserToken) {
    return `${base} Ελέγξτε ότι η εφαρμογή είναι Live και τα permissions (ads_read κ.λπ.)· αν χρειάζεται, App Review. Δοκιμάστε αποσύνδεση και επανασύνδεση Meta στις Συνδέσεις.`;
  }
  return `${base} Συνδέστε το Meta από τις Συνδέσεις ώστε να χρησιμοποιείται user OAuth token (ο λογαριασμός που συνδέεται πρέπει να έχει ρόλο Admin/Developer στην εφαρμογή).`;
}

/** Fetch competitor ads from Meta Ad Library for a brand. */
export async function fetchCompetitorAds(brandId: string): Promise<{
  success: boolean;
  totalAds: number;
  newAds: number;
  error?: string;
  warnings?: string[];
}> {
  const settingsDoc = await getDb().doc(`competitor_settings/${brandId}`).get();
  const settings = settingsDoc.data();

  if (!settings?.competitors || !Array.isArray(settings.competitors) || settings.competitors.length === 0) {
    return { success: true, totalAds: 0, newAds: 0 };
  }

  const competitors: CompetitorConfig[] = settings.competitors;
  const resolved = await resolveAdLibraryAccessToken(brandId);
  if (!resolved) {
    return {
      success: false,
      totalAds: 0,
      newAds: 0,
      error:
        'Δεν υπάρχει έγκυρο Meta token για Ad Library. Συνδέστε το Meta στις Συνδέσεις (προτείνεται) ή ορίστε META_APP_ID / META_APP_SECRET στα Cloud Functions.',
    };
  }
  const accessToken = resolved.token;
  const tokenSourceUser = resolved.source === 'user';

  let totalAds = 0;
  let newAds = 0;
  const warnings: string[] = [];
  const now = new Date();

  // Pre-fetch existing ad IDs to avoid N+1 reads
  const existingAdsSnap = await getDb()
    .collection('competitor_ads')
    .doc(brandId)
    .collection('ads')
    .get();
  const existingAdsMap = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of existingAdsSnap.docs) {
    existingAdsMap.set(doc.id, doc.data());
  }

  const countries = resolveReachedCountries((settings as { reachedCountries?: unknown })?.reachedCountries);

  for (const competitor of competitors) {
    if (!competitor.pageId) continue;

    const pageIdTrim = String(competitor.pageId).trim();
    if (!/^\d+$/.test(pageIdTrim)) {
      warnings.push(`${competitor.name}: Page ID "${pageIdTrim}" — χρειάζεται αριθμητικό Facebook Page ID (όχι URL ή username).`);
      continue;
    }

    try {
      let adsFetchedForPage = 0;
      let hadAdLibraryHttpError = false;
      let usedSearchPageIdsMode: 'plain' | 'jsonArray' | null = null;

      const processOnePage = async (data: any): Promise<boolean> => {
        if (data.error) {
          const err = data.error as { message?: string; code?: number; error_subcode?: number };
          const raw = err.message || JSON.stringify(err);
          const fullJson = JSON.stringify(data.error);
          const subcode =
            typeof err.error_subcode === 'number' ? err.error_subcode : extractMetaErrorSubcode(fullJson);
          logger.warn(`[Competitor] Ad Library API (${competitor.name}): ${raw} (code ${err.code ?? '?'})`);
          const msg = isAdLibraryPermissionDenied(raw) || isAdLibraryPermissionDenied(fullJson)
            ? friendlyAdLibraryPermissionMessage(competitor.name, tokenSourceUser, subcode)
            : `Ad Library API (${competitor.name}): ${raw} (code ${err.code ?? '?'})`;
          warnings.push(msg);
          return false;
        }
        const ads: any[] = data.data || [];
        adsFetchedForPage += ads.length;

        const batch = getDb().batch();
        let batchCount = 0;

        for (const ad of ads) {
          const adId = ad.id;
          if (!adId) continue;

          const startDate = ad.ad_delivery_start_time || '';
          const endDate = ad.ad_delivery_stop_time || undefined;
          const adText = adCreativeFirstLine(ad);
          const platforms: string[] = ad.publisher_platforms || [];
          const isActive = !endDate || new Date(endDate) > now;

          let daysRunning = 0;
          if (startDate) {
            const parsed = new Date(startDate).getTime();
            if (!isNaN(parsed)) {
              daysRunning = Math.max(0, Math.floor((now.getTime() - parsed) / (1000 * 60 * 60 * 24)));
            }
          }

          const existingData = existingAdsMap.get(adId);
          const isNew = !existingData;
          if (isNew) newAds++;

          const adDoc: CompetitorAd = {
            adId,
            competitorName: competitor.name,
            competitorPageId: pageIdTrim,
            adText: adText.slice(0, 500),
            startDate,
            endDate,
            platforms,
            isActive,
            daysRunning,
            firstSeenAt: isNew ? now.toISOString() : (existingData?.firstSeenAt || now.toISOString()),
            lastSeenAt: now.toISOString(),
          };

          const ref = getDb()
            .collection('competitor_ads')
            .doc(brandId)
            .collection('ads')
            .doc(adId);

          batch.set(ref, adDoc, { merge: true });
          batchCount++;
          totalAds++;
          existingAdsMap.set(adId, adDoc);

          if (batchCount >= 450) {
            await batch.commit();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }

        logger.info(`[Competitor] ${competitor.name}: page returned ${ads.length} ads (mode=${usedSearchPageIdsMode})`);
        return true;
      };

      const runPagination = async (mode: 'plain' | 'jsonArray', reachCountriesForQuery: string[]): Promise<void> => {
        usedSearchPageIdsMode = mode;
        adsFetchedForPage = 0;
        let nextUrl: string | null = null;
        let isFirst = true;

        while (isFirst || nextUrl) {
          logger.info(
            `[Competitor] ${nextUrl ? 'GET page' : 'GET'} ${competitor.name} (page ${pageIdTrim}), mode=${mode}, countries=${JSON.stringify(reachCountriesForQuery)}`
          );
          let res: Response;
          if (nextUrl) {
            // nextUrl is paging.next; safeFetch blocks one resolving to an internal/private address.
            res = await safeFetch(nextUrl);
          } else {
            const paramsStr = buildAdLibrarySearchParams(
              accessToken,
              mode,
              pageIdTrim,
              reachCountriesForQuery
            ).toString();
            // ads_archive is a GET-only read edge; POST returns 400 "Unsupported post request"
            // (code 100 / subcode 33). One competitor page id per query → URL stays short. (PER-284)
            res = await fetch(`${META_GRAPH_URL}/ads_archive?${paramsStr}`);
          }

          if (!res.ok) {
            hadAdLibraryHttpError = true;
            const errText = await res.text();
            logger.warn(`[Competitor] Ad Library HTTP ${res.status} for ${competitor.name}: ${errText.slice(0, 500)}`);
            let userMsg: string;
            if (
              (res.status === 400 || res.status === 403) &&
              isAdLibraryPermissionDenied(errText)
            ) {
              const sub = extractMetaErrorSubcode(errText);
              userMsg = friendlyAdLibraryPermissionMessage(competitor.name, tokenSourceUser, sub);
            } else {
              userMsg = `Ad Library API error for ${competitor.name} (${res.status}): ${errText.slice(0, 200)}`;
            }
            warnings.push(userMsg);
            return;
          }

          const data: any = await res.json();
          const ok = await processOnePage(data);
          if (!ok) {
            hadAdLibraryHttpError = true;
            return;
          }

          nextUrl = normalizePagingNext(data.paging?.next);
          isFirst = false;
        }
      };

      await runPagination('plain', countries);

      if (!hadAdLibraryHttpError && adsFetchedForPage === 0) {
        logger.info(`[Competitor] Retrying ${competitor.name} with search_page_ids JSON array format`);
        await runPagination('jsonArray', countries);
      }

      /** Meta often returns rows for a single ad_reached_countries ISO code but [] for many;
       * probe one country at a time (union via deduped writes). */
      if (!hadAdLibraryHttpError && adsFetchedForPage === 0) {
        const probeOrder = [
          ...new Set([
            ...countries,
            'GR',
            'CY',
            'US',
            'GB',
            'DE',
            'IT',
            'ES',
            'FR',
            'NL',
            'PL',
            'RO',
            'BG',
            'AT',
            'CH',
          ]),
        ];
        for (const c of probeOrder) {
          if (hadAdLibraryHttpError) break;
          const one = [c];
          logger.info(`[Competitor] ${competitor.name}: single-country probe ${c} (plain)`);
          await runPagination('plain', one);
          if (adsFetchedForPage > 0) {
            logger.info(`[Competitor] ${competitor.name}: single-country probe hit with ${c}`);
            break;
          }
          await runPagination('jsonArray', one);
          if (adsFetchedForPage > 0) {
            logger.info(`[Competitor] ${competitor.name}: single-country JSON probe hit with ${c}`);
            break;
          }
        }
      }

      if (!hadAdLibraryHttpError && adsFetchedForPage === 0) {
        logger.warn(`[Competitor] ${competitor.name} (page ${pageIdTrim}): 0 ads for countries ${JSON.stringify(countries)}`);
        warnings.push(
          `${competitor.name}: 0 ads για reach [${countries.join(', ')}] (δοκιμάστηκαν και ερωτήματα ανά χώρα). Επιβεβαιώστε Page ID στο facebook.com/ads/library · φίλτρο χωρών · App (Live) με πρόσβαση Ad Library API · META_APP_ID/SECRET στα Functions.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Competitor] Error for ${competitor.name}:`, { alertKey: ALERT.competitorMonitorFailed, err: msg });
      warnings.push(`Exception for ${competitor.name}: ${msg.slice(0, 200)}`);
    }
  }

  try {
    await getDb().doc(`competitor_settings/${brandId}`).set(
      {
        lastSyncAt: now.toISOString(),
        lastAdLibraryWarnings: warnings.length > 0 ? warnings : FieldValue.delete(),
      },
      { merge: true }
    );
  } catch (e) {
    logger.warn(`[Competitor] Failed to update competitor_settings: ${e}`);
  }

  try {
    await getDb().collection('import_jobs').add({
      brandId,
      type: 'competitor_ads',
      source: 'meta_ad_library',
      status: warnings.length ? 'partial' : 'completed',
      imported: totalAds,
      newAds,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn(`[Competitor] Failed to log import job: ${e}`);
  }

  // Per-competitor failures were only warned about; without an `error` the nightly wrap logs a
  // cheerful success and nobody learns the Ad Library sync is dead.
  return {
    success: warnings.length === 0,
    totalAds,
    newAds,
    warnings: warnings.length > 0 ? warnings : undefined,
    ...(warnings.length ? { error: warnings[0] } : {}),
  };
}
