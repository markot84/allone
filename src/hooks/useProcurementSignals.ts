/**
 * useProcurementSignals — fetches the server-aggregated `procurement_signals/{brandId}`
 * doc και deserializes το JSON map. Επιστρέφει επίσης ένα refresh mutation που
 * καλείται μετά από procurement upload.
 *
 * Βλ. functions/src/procurementSignals.ts για τη δομή του ProcurementSignal.
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth, FUNCTIONS_BASE_URL } from '../config/firebase';
import { useBrand } from './useBrand';

const REFRESH_URL = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/refreshSignals`;

export interface ProcurementSignal {
  category?: string;
  description?: string;
  supplier?: string;
  flow_group?: string;
  status?: string;
  evaluation_label?: string;
  evaluation_score?: number;
  available_stock?: number;
  dynamic_stock?: number;
  days_of_cover?: number;
  lifetime_qty?: number;
  cost_unit?: number;
  tied_capital?: number;
  replenishment_qty?: number;
  replenishment_value?: number;
  list_price?: number;
  corporate_price?: number;
  avg_sale_price?: number;
  total_cost?: number;
  primary_cost?: number;
  margin_pct?: number;
  discount_a?: number;
  discount_b?: number;
  discount_c?: number;
  fiscal_year?: string;
  annual_revenue?: number;
  annual_profit?: number;
}

interface ProcurementSignalsRaw {
  brandId: string;
  skuCount: number;
  skuSignalsJson: string;
  sources?: Record<string, number>;
  computedAt?: any;
}

async function fetchProcurementSignals(brandId: string): Promise<ProcurementSignalsRaw | null> {
  const snap = await getDoc(doc(db, 'procurement_signals', brandId));
  if (!snap.exists()) return null;
  return snap.data() as ProcurementSignalsRaw;
}

export function useProcurementSignals() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['procurement_signals', brandId],
    queryFn: () => (brandId ? fetchProcurementSignals(brandId) : Promise.resolve(null)),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    enabled: !!brandId,
  });

  const signalsBySku = useMemo<Record<string, ProcurementSignal>>(() => {
    if (!data?.skuSignalsJson) return {};
    try {
      return JSON.parse(data.skuSignalsJson) as Record<string, ProcurementSignal>;
    } catch {
      return {};
    }
  }, [data]);

  return {
    signalsBySku,
    skuCount: data?.skuCount ?? 0,
    sources: data?.sources ?? {},
    computedAt: data?.computedAt ?? null,
    isLoading: isPending,
    hasData: !!data && (data.skuCount ?? 0) > 0,
  };
}

/** Mutation που καλεί το server endpoint refreshSignals — να χρησιμοποιείται μετά procurement upload. */
export function useRefreshProcurementSignals() {
  const queryClient = useQueryClient();
  const { currentBrand } = useBrand();

  const mutation = useMutation({
    mutationFn: async (): Promise<{ ok: boolean; error?: string; skuCount?: number }> => {
      const brandId = currentBrand?.id;
      if (!brandId) return { ok: false, error: 'no-brand' };
      const token = await auth.currentUser?.getIdToken();
      if (!token) return { ok: false, error: 'no-auth' };
      try {
        const res = await fetch(REFRESH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ brandId }),
        });
        if (!res.ok) {
          const txt = await res.text();
          return { ok: false, error: `HTTP ${res.status}: ${txt}` };
        }
        const json = (await res.json()) as { skuCount?: number };
        await queryClient.invalidateQueries({ queryKey: ['procurement_signals', brandId] });
        return { ok: true, skuCount: json.skuCount };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  return {
    refresh: () => mutation.mutateAsync(),
    isRefreshing: mutation.isPending,
  };
}
