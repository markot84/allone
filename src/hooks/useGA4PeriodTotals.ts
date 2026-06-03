import { useQuery } from '@tanstack/react-query';
import { auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../config/firebase';
import { useBrand } from './useBrand';

const PERIOD_TOTALS_URL = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/ga4PeriodTotals`;

/**
 * GA4-deduplicated σύνολα περιόδου (όπως τα δείχνει το GA4 UI για το επιλεγμένο εύρος).
 * Χρειάζεται γιατί τα ημερήσια totalUsers/newUsers ΔΕΝ αθροίζονται σωστά: το GA4 κάνει dedup ανά
 * περίοδο (ένας χρήστης σε 5 μέρες = 1 χρήστης, όχι 5). Τα sessions/pageviews/conversions είναι
 * αθροιστικά οπότε ταιριάζουν ήδη — αλλά τα επιστρέφουμε κι αυτά για ενιαία, ακριβή KPI cards.
 */
export interface GA4PeriodTotals {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  pageViews: number;
  bounceRate: number;
  avgSessionDuration: number;
  conversions: number;
  addToCarts: number;
}

async function fetchPeriodTotals(
  brandId: string,
  startDate: string,
  endDate: string
): Promise<GA4PeriodTotals | null> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return null;
  const res = await fetch(PERIOD_TOTALS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(await getAppCheckHeader()),
    },
    body: JSON.stringify({ brandId, startDate, endDate }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; totals?: GA4PeriodTotals };
  return data?.success && data.totals ? data.totals : null;
}

/**
 * @param from YYYY-MM-DD
 * @param to   YYYY-MM-DD
 * @param enabled Συνήθως `hasData` (αποφυγή κλήσης όταν δεν υπάρχει GA4 connector).
 */
export function useGA4PeriodTotals(from: string, to: string, enabled = true) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  const { data, isFetching } = useQuery({
    queryKey: ['ga4_period_totals', brandId, from, to],
    queryFn: () => (brandId ? fetchPeriodTotals(brandId, from, to) : Promise.resolve(null)),
    enabled: !!brandId && enabled && valid,
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 0,
    placeholderData: (prev) => prev,
  });

  return { periodTotals: data ?? null, isLoadingPeriodTotals: isFetching };
}
