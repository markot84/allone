import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

/** PER-194 — display names for connector doc keys (subset of ConnectorsPanel CONNECTORS). */
const CONNECTOR_NAMES: Record<string, string> = {
  google_ads: 'Google Ads',
  meta: 'Meta',
  tiktok: 'TikTok',
  merchant: 'Google Merchant',
  ga4: 'GA4',
  search_console: 'Search Console',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  opencart: 'OpenCart',
  magento: 'Magento',
  megaventory: 'Megaventory',
  softone: 'SoftOne',
  epsilon_net: 'Epsilon Net',
  entersoft: 'Entersoft',
};

/** Errors older than this are treated as stale (e.g. left behind by a continuation hand-off). */
const MAX_ERROR_AGE_HOURS = 48;

export interface ConnectorSyncError {
  id: string;
  name: string;
  error: string;
}

/** Connected connectors with a fresh (≤48h) lastSyncError. Exported for tests. */
export function collectConnectorSyncErrors(data: Record<string, unknown>, now = Date.now()): ConnectorSyncError[] {
  const d = data as Record<string, { connected?: boolean; lastSyncError?: string; lastSyncErrorAt?: { toDate?: () => Date } }>;
  const out: ConnectorSyncError[] = [];
  for (const [id, name] of Object.entries(CONNECTOR_NAMES)) {
    const c = d[id];
    if (!c?.connected || typeof c.lastSyncError !== 'string' || !c.lastSyncError.trim()) continue;
    // Resumable backfill checkpoints (OpenCart page-cap) are not failures — same heuristic as ConnectorsPanel.
    if (/page cap|sync incomplete/i.test(c.lastSyncError)) continue;
    const at = c.lastSyncErrorAt?.toDate?.();
    if (at && now - at.getTime() > MAX_ERROR_AGE_HOURS * 3600_000) continue;
    out.push({ id, name, error: c.lastSyncError });
  }
  return out;
}

/** PER-194 — connected connectors of the current brand with a fresh lastSyncError (written by the nightly wave, PER-288). */
export function useConnectorSyncErrors(): ConnectorSyncError[] {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data } = useQuery({
    queryKey: ['connector_sync_errors', brandId],
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'connectors', brandId!));
      return collectConnectorSyncErrors(snap.data() || {});
    },
  });

  return data ?? [];
}
