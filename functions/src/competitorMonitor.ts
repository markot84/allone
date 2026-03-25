/**
 * Competitor Monitoring via Meta Ad Library API
 *
 * Uses App Access Token (app_id|app_secret) — no user OAuth needed.
 * Tracks competitor ad activity: new ads, long-running ads, active ads.
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

function getAppToken(): string {
  const appId = (process.env.META_APP_ID || '').trim();
  const appSecret = (process.env.META_APP_SECRET || '').trim();
  return `${appId}|${appSecret}`;
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

/**
 * Fetch competitor ads from Meta Ad Library for a brand.
 */
export async function fetchCompetitorAds(brandId: string): Promise<{
  success: boolean;
  totalAds: number;
  newAds: number;
  error?: string;
}> {
  const settingsDoc = await getDb().doc(`competitor_settings/${brandId}`).get();
  const settings = settingsDoc.data();

  if (!settings?.competitors || settings.competitors.length === 0) {
    return { success: true, totalAds: 0, newAds: 0 };
  }

  const competitors: CompetitorConfig[] = settings.competitors;
  const appToken = getAppToken();

  if (!appToken || appToken === '|') {
    return { success: false, totalAds: 0, newAds: 0, error: 'META_APP_ID or META_APP_SECRET not configured' };
  }

  let totalAds = 0;
  let newAds = 0;
  const now = new Date();

  for (const competitor of competitors) {
    try {
      const params = new URLSearchParams({
        access_token: appToken,
        search_page_ids: competitor.pageId,
        ad_reached_countries: 'GR',
        ad_active_status: 'ALL',
        fields: 'id,ad_creative_bodies,ad_delivery_start_time,ad_delivery_stop_time,page_name,publisher_platforms',
        limit: '50',
      });

      const res = await fetch(`${META_GRAPH_URL}/ads_archive?${params.toString()}`);

      if (!res.ok) {
        const errText = await res.text();
        logger.warn(`[Competitor] Ad Library query failed for ${competitor.name} (${res.status}): ${errText.slice(0, 300)}`);
        continue;
      }

      const data = await res.json();
      const ads = data.data || [];

      const batch = getDb().batch();
      let batchCount = 0;

      for (const ad of ads) {
        const adId = ad.id;
        if (!adId) continue;

        const startDate = ad.ad_delivery_start_time || '';
        const endDate = ad.ad_delivery_stop_time || undefined;
        const adText = (ad.ad_creative_bodies || [])[0] || '';
        const platforms: string[] = ad.publisher_platforms || [];
        const isActive = !endDate || new Date(endDate) > now;

        let daysRunning = 0;
        if (startDate) {
          daysRunning = Math.floor(
            (now.getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
          );
        }

        const existingDoc = await getDb()
          .collection('competitor_ads')
          .doc(brandId)
          .collection('ads')
          .doc(adId)
          .get();

        const isNew = !existingDoc.exists;
        if (isNew) newAds++;

        const adDoc: CompetitorAd = {
          adId,
          competitorName: competitor.name,
          competitorPageId: competitor.pageId,
          adText: adText.slice(0, 500),
          startDate,
          endDate,
          platforms,
          isActive,
          daysRunning,
          firstSeenAt: isNew ? now.toISOString() : (existingDoc.data()?.firstSeenAt || now.toISOString()),
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
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      logger.info(`[Competitor] ${competitor.name}: ${ads.length} ads (${newAds} new)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Competitor] Error for ${competitor.name}:`, msg);
    }
  }

  await getDb().collection('import_jobs').add({
    brandId,
    type: 'competitor_ads',
    source: 'meta_ad_library',
    status: 'completed',
    imported: totalAds,
    newAds,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, totalAds, newAds };
}
