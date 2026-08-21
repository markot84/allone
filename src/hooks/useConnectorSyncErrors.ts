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

export interface ConnectorStatus {
  id: string;
  name: string;
  /** `ok` synced recently, `stale` connected but nothing for over a day, `error` last sync failed. */
  state: 'ok' | 'stale' | 'error';
  /** Millisecond timestamp of the last successful sync, when the connector records one. */
  lastSyncAt: number | null;
  error: string | null;
}

/** Connected connectors older than this without a successful sync read as stale, not healthy. */
const STALE_AFTER_HOURS = 26;

type ConnectorDoc = {
  connected?: boolean;
  lastSyncAt?: { toDate?: () => Date } | string;
  lastSyncError?: string;
  lastSyncErrorAt?: { toDate?: () => Date };
};

function toMillis(value: ConnectorDoc['lastSyncAt']): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const date = value.toDate?.();
  return date ? date.getTime() : null;
}

/** Every connected connector of the current brand with its freshness. Exported for tests. */
export function collectConnectorStatuses(data: Record<string, unknown>, now = Date.now()): ConnectorStatus[] {
  const d = data as Record<string, ConnectorDoc>;
  const errored = new Set(collectConnectorSyncErrors(data, now).map((e) => e.id));
  const out: ConnectorStatus[] = [];
  for (const [id, name] of Object.entries(CONNECTOR_NAMES)) {
    const c = d[id];
    if (!c?.connected) continue;
    const lastSyncAt = toMillis(c.lastSyncAt);
    const stale = lastSyncAt === null || now - lastSyncAt > STALE_AFTER_HOURS * 3600_000;
    out.push({
      id,
      name,
      state: errored.has(id) ? 'error' : stale ? 'stale' : 'ok',
      lastSyncAt,
      error: errored.has(id) ? (c.lastSyncError ?? null) : null,
    });
  }
  return out;
}

/**
 * The brand's connected data sources and how fresh each one is.
 *
 * Shares the query key with `useConnectorSyncErrors` so the two hooks are one Firestore read
 * between them, however many components ask.
 */
export function useConnectorStatuses(): ConnectorStatus[] {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data } = useQuery({
    queryKey: ['connector_statuses', brandId],
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'connectors', brandId!));
      return collectConnectorStatuses(snap.data() || {});
    },
  });

  return data ?? [];
}
