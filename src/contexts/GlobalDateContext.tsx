/**
 * Ημερολογιακή περίοδος ανά brand: κάθε brand θυμάται δικό του preset/custom range.
 * Δεν μοιράζεται πλέον ένα global range μεταξύ brands (localStorage ανά brand id).
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { useBrand } from '../hooks/useBrand';

export type GlobalPeriod = 'current_month' | 'last_30' | 'current_year' | 'custom';

export const GLOBAL_PERIOD_OPTIONS: { key: GlobalPeriod; label: string }[] = [
  { key: 'current_month', label: 'Τρέχων Μήνας' },
  { key: 'last_30', label: 'Τελευταίες 30ημ.' },
  { key: 'current_year', label: 'Τρέχον Έτος' },
  { key: 'custom', label: 'Προσαρμοσμένο' },
];

/** Παλιά κλειδιά (πριν το per-brand) — μεταφέρονται μία φορά στο πρώτο brand που φορτώνει με κενό map. */
const LS_PERIOD_LEGACY = 'perf_global_period';
const LS_FROM_LEGACY = 'perf_global_from';
const LS_TO_LEGACY = 'perf_global_to';

const LS_BY_BRAND = 'perf_global_date_by_brand_v1';

type BrandDateSnap = {
  period: GlobalPeriod;
  customFrom: string;
  customTo: string;
};

const DEFAULT_SNAP: BrandDateSnap = {
  period: 'current_month',
  customFrom: '',
  customTo: '',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD στην **τοπική** ημερολογιακή ημέρα (ίδιο με first-of-month / year strings). */
function formatLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Μετατόπιση κατά ημέρες στο **τοπικό** ημερολόγιο (αποφεύγει UTC skew του toISOString). */
function addLocalDays(base: Date, deltaDays: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
}

/**
 * Το τέλος περιόδου είναι χθες (ολοκληρωμένα ημερήσια δεδομένα). Στην 1η του μήνα / έτους
 * το χθες πέφτει πριν το start της περιόδου → κενό διάστημα και charts χωρίς σειρά.
 * Clamp ώστε πάντα from ≤ to (τουλάχιστον μία ημέρα).
 */
function clampIsoRange(fromDate: string, toDate: string): { fromDate: string; toDate: string } {
  if (!fromDate || !toDate) {
    const d = fromDate || toDate;
    return { fromDate: d, toDate: d };
  }
  if (fromDate <= toDate) return { fromDate, toDate };
  return { fromDate, toDate: fromDate };
}

function computeDates(period: GlobalPeriod, customFrom: string, customTo: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yesterday = addLocalDays(now, -1);
  const toDate = formatLocalYMD(yesterday);

  let range: { fromDate: string; toDate: string };
  if (period === 'custom') {
    range = { fromDate: customFrom || toDate, toDate: customTo || toDate };
  } else if (period === 'last_30') {
    const start = addLocalDays(now, -30);
    range = { fromDate: formatLocalYMD(start), toDate };
  } else if (period === 'current_year') {
    range = { fromDate: `${now.getFullYear()}-01-01`, toDate };
  } else {
    range = { fromDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, toDate };
  }
  return clampIsoRange(range.fromDate, range.toDate);
}

function isGlobalPeriod(v: string | null): v is GlobalPeriod {
  return (
    v === 'current_month' || v === 'last_30' || v === 'current_year' || v === 'custom'
  );
}

function readStoredMap(): Record<string, BrandDateSnap> {
  try {
    const raw = localStorage.getItem(LS_BY_BRAND);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, BrandDateSnap>;
  } catch {
    return {};
  }
}

function writeStoredMap(map: Record<string, BrandDateSnap>) {
  try {
    localStorage.setItem(LS_BY_BRAND, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function snapFromLegacyStorage(): BrandDateSnap | null {
  try {
    const p = localStorage.getItem(LS_PERIOD_LEGACY);
    if (!isGlobalPeriod(p)) return null;
    return {
      period: p,
      customFrom: localStorage.getItem(LS_FROM_LEGACY) ?? '',
      customTo: localStorage.getItem(LS_TO_LEGACY) ?? '',
    };
  } catch {
    return null;
  }
}

function clearLegacyKeys() {
  try {
    localStorage.removeItem(LS_PERIOD_LEGACY);
    localStorage.removeItem(LS_FROM_LEGACY);
    localStorage.removeItem(LS_TO_LEGACY);
  } catch {
    /* ignore */
  }
}

/**
 * Φόρτωση αποθηκευμένης περιόδου για brand. Κενό map + παλιά κλειδιά → migrate μία φορά μόνο σε αυτό το brand.
 */
function loadSnapshotForBrand(brandId: string): BrandDateSnap {
  const map = readStoredMap();
  const existing = map[brandId];
  if (existing && isGlobalPeriod(existing.period)) {
    return {
      period: existing.period,
      customFrom: existing.customFrom ?? '',
      customTo: existing.customTo ?? '',
    };
  }

  if (Object.keys(map).length === 0) {
    const legacy = snapFromLegacyStorage();
    if (legacy) {
      map[brandId] = legacy;
      writeStoredMap(map);
      clearLegacyKeys();
      return legacy;
    }
  }

  return { ...DEFAULT_SNAP };
}

function persistBrandSnapshot(brandId: string | null | undefined, snap: BrandDateSnap) {
  if (!brandId) return;
  const map = readStoredMap();
  map[brandId] = snap;
  writeStoredMap(map);
}

interface GlobalDateContextValue {
  period: GlobalPeriod;
  setPeriod: (p: GlobalPeriod) => void;
  customFrom: string;
  customTo: string;
  setCustomRange: (from: string, to: string) => void;
  fromDate: string;
  toDate: string;
  /** Cutoff Date object (for ROI filter logic) */
  cutoffDate: Date;
}

const GlobalDateContext = createContext<GlobalDateContextValue | null>(null);

export function GlobalDateProvider({ children }: { children: ReactNode }) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const [period, setPeriodState] = useState<GlobalPeriod>(DEFAULT_SNAP.period);
  const [customFrom, setCustomFrom] = useState(DEFAULT_SNAP.customFrom);
  const [customTo, setCustomTo] = useState(DEFAULT_SNAP.customTo);

  /** Συγχρονισμός με αλλαγή brand — πριν το paint ώστε να μη φαίνεται στιγμιαία η περίοδος άλλου brand. */
  useLayoutEffect(() => {
    if (!brandId) {
      setPeriodState(DEFAULT_SNAP.period);
      setCustomFrom(DEFAULT_SNAP.customFrom);
      setCustomTo(DEFAULT_SNAP.customTo);
      return;
    }
    const snap = loadSnapshotForBrand(brandId);
    setPeriodState(snap.period);
    setCustomFrom(snap.customFrom);
    setCustomTo(snap.customTo);
  }, [brandId]);

  const setPeriod = useCallback(
    (p: GlobalPeriod) => {
      setPeriodState(p);
      persistBrandSnapshot(brandId, { period: p, customFrom, customTo });
    },
    [brandId, customFrom, customTo]
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      setCustomFrom(from);
      setCustomTo(to);
      setPeriodState('custom');
      persistBrandSnapshot(brandId, { period: 'custom', customFrom: from, customTo: to });
    },
    [brandId]
  );

  const { fromDate, toDate } = useMemo(
    () => computeDates(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const cutoffDate = useMemo(() => new Date(fromDate), [fromDate]);

  const value: GlobalDateContextValue = {
    period,
    setPeriod,
    customFrom,
    customTo,
    setCustomRange,
    fromDate,
    toDate,
    cutoffDate,
  };

  return <GlobalDateContext.Provider value={value}>{children}</GlobalDateContext.Provider>;
}

export function useGlobalDate(): GlobalDateContextValue {
  const ctx = useContext(GlobalDateContext);
  if (!ctx) throw new Error('useGlobalDate must be used inside GlobalDateProvider');
  return ctx;
}
