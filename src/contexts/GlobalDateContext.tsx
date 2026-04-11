/**
 * Global date range shared across Dashboard, ROI, Campaigns, E-commerce, GA4.
 * Dashboard sets the global period; each page may override locally for session.
 */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type GlobalPeriod = 'current_month' | 'last_30' | 'current_year' | 'custom';

export const GLOBAL_PERIOD_OPTIONS: { key: GlobalPeriod; label: string }[] = [
  { key: 'current_month', label: 'Τρέχων Μήνας' },
  { key: 'last_30',       label: 'Τελευταίες 30ημ.' },
  { key: 'current_year',  label: 'Τρέχον Έτος' },
  { key: 'custom',        label: 'Προσαρμοσμένο' },
];

const LS_PERIOD = 'perf_global_period';
const LS_FROM   = 'perf_global_from';
const LS_TO     = 'perf_global_to';

function pad(n: number) { return String(n).padStart(2, '0'); }

function computeDates(period: GlobalPeriod, customFrom: string, customTo: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const toDate = yesterday.toISOString().slice(0, 10);

  if (period === 'custom') {
    return { fromDate: customFrom || toDate, toDate: customTo || toDate };
  }
  if (period === 'last_30') {
    const d = new Date(now); d.setDate(d.getDate() - 30);
    return { fromDate: d.toISOString().slice(0, 10), toDate };
  }
  if (period === 'current_year') {
    return { fromDate: `${now.getFullYear()}-01-01`, toDate };
  }
  // current_month
  return { fromDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, toDate };
}

function loadPeriod(): GlobalPeriod {
  try {
    const v = localStorage.getItem(LS_PERIOD);
    if (v === 'current_month' || v === 'last_30' || v === 'current_year' || v === 'custom') return v;
  } catch { /* ignore */ }
  return 'current_month';
}

function loadCustom(): { from: string; to: string } {
  try {
    return { from: localStorage.getItem(LS_FROM) ?? '', to: localStorage.getItem(LS_TO) ?? '' };
  } catch { /* ignore */ }
  return { from: '', to: '' };
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
  const [period, setPeriodState] = useState<GlobalPeriod>(loadPeriod);
  const initCustom = useMemo(() => loadCustom(), []);
  const [customFrom, setCustomFrom] = useState(initCustom.from);
  const [customTo, setCustomTo]     = useState(initCustom.to);

  const setPeriod = useCallback((p: GlobalPeriod) => {
    setPeriodState(p);
    try { localStorage.setItem(LS_PERIOD, p); } catch { /* ignore */ }
  }, []);

  const setCustomRange = useCallback((from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriodState('custom');
    try {
      localStorage.setItem(LS_PERIOD, 'custom');
      localStorage.setItem(LS_FROM, from);
      localStorage.setItem(LS_TO, to);
    } catch { /* ignore */ }
  }, []);

  const { fromDate, toDate } = useMemo(
    () => computeDates(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const cutoffDate = useMemo(() => new Date(fromDate), [fromDate]);

  const value: GlobalDateContextValue = {
    period, setPeriod,
    customFrom, customTo, setCustomRange,
    fromDate, toDate, cutoffDate,
  };

  return <GlobalDateContext.Provider value={value}>{children}</GlobalDateContext.Provider>;
}

export function useGlobalDate(): GlobalDateContextValue {
  const ctx = useContext(GlobalDateContext);
  if (!ctx) throw new Error('useGlobalDate must be used inside GlobalDateProvider');
  return ctx;
}
