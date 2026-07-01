/** PER-157 — reads the server-precomputed `marketing_plan_insight/{brandId}` doc so the Marketing
 * Plan page no longer loads the ~222k-product catalog to compute the insight client-side. The doc
 * holds one insight per preset (JSON blob, the procurement_signals pattern). When it's missing,
 * not ready, or stale, callers fall back to the local compute (graceful degradation). */
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import { useBrandSyncVersion } from './useBrandSyncVersion';
import type { MarketingPlanInsight } from '../services/marketingPlanInsights';

/** A doc older than this is treated as stale → the page falls back to the local compute. The
 *  nightly rebuild keeps it well within this window; the guard only catches a stalled pipeline. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

interface MarketingPlanInsightDocRaw {
  status?: 'running' | 'ready' | 'failed';
  insightsJson?: string;
  productCount?: number;
  signalCount?: number;
  sourceFingerprint?: string;
  computedAt?: { toMillis?: () => number } | null;
}

export interface MarketingPlanInsightProcessed {
  byPreset: Record<string, MarketingPlanInsight> | null;
  ready: boolean;
  status: 'running' | 'ready' | 'failed' | null;
  productCount: number;
  signalCount: number;
  fingerprint: string | null;
}

/** Pure: derive the usable state from a raw doc. `ready` requires status:'ready', a parseable blob,
 *  and a computedAt within STALE_MS of `nowMs`. Exported for unit testing (no Firestore needed). */
export function processMarketingPlanInsightDoc(
  raw: MarketingPlanInsightDocRaw | null,
  nowMs: number
): MarketingPlanInsightProcessed | null {
  if (!raw) return null;
  let byPreset: Record<string, MarketingPlanInsight> | null = null;
  if (raw.insightsJson) {
    try { byPreset = JSON.parse(raw.insightsJson) as Record<string, MarketingPlanInsight>; } catch { byPreset = null; }
  }
  const computedAtMs = raw.computedAt?.toMillis?.() ?? 0;
  const fresh = computedAtMs > 0 && nowMs - computedAtMs < STALE_MS;
  return {
    byPreset,
    ready: raw.status === 'ready' && !!byPreset && fresh,
    status: raw.status ?? null,
    productCount: raw.productCount ?? 0,
    signalCount: raw.signalCount ?? 0,
    fingerprint: raw.sourceFingerprint ?? null,
  };
}

export function useMarketingPlanInsight() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const syncVersion = useBrandSyncVersion(brandId).data?.version ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['marketing_plan_insight', brandId, syncVersion],
    // Parse + freshness here (not in render) — Date.now()/JSON.parse must not run during render.
    queryFn: async (): Promise<MarketingPlanInsightProcessed | null> => {
      if (!brandId) return null;
      const snap = await getDoc(doc(db, 'marketing_plan_insight', brandId));
      const raw = snap.exists() ? (snap.data() as MarketingPlanInsightDocRaw) : null;
      return processMarketingPlanInsightDoc(raw, Date.now());
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    /** Per-preset insights, or null when the doc is absent/not-ready/stale (→ caller falls back). */
    byPreset: data?.ready ? data.byPreset : null,
    productCount: data?.productCount ?? 0,
    isLoading: isPending,
  };
}
