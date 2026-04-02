/**
 * Shared period selector for Dashboard and ROI & Απόδοση.
 * Persisted in localStorage so it survives page navigation.
 */
import { useState, useCallback } from 'react';

export type DashPeriod = 'current_month' | 'last_30' | 'current_year';

export const PERIOD_OPTIONS: { key: DashPeriod; label: string }[] = [
  { key: 'current_month', label: 'Τρέχων Μήνας' },
  { key: 'last_30',       label: 'Τελευταίες 30ημ.' },
  { key: 'current_year',  label: 'Τρέχον Έτος' },
];

const LS_KEY = 'perf_dash_period';

function load(): DashPeriod {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'current_month' || v === 'last_30' || v === 'current_year') return v;
  } catch { /* ignore */ }
  return 'current_month';
}

export function useDashPeriod() {
  const [period, setPeriodState] = useState<DashPeriod>(load);

  const setPeriod = useCallback((p: DashPeriod) => {
    setPeriodState(p);
    try { localStorage.setItem(LS_KEY, p); } catch { /* ignore */ }
  }, []);

  /** Returns { fromDate, toDate } as YYYY-MM-DD strings */
  const periodDates = (() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toDate = now.toISOString().slice(0, 10);
    if (period === 'current_month') {
      return { fromDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, toDate };
    }
    if (period === 'last_30') {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { fromDate: d.toISOString().slice(0, 10), toDate };
    }
    // current_year
    return { fromDate: `${now.getFullYear()}-01-01`, toDate };
  })();

  /** Cutoff Date object (for ROI page's filter logic) */
  const cutoffDate = new Date(periodDates.fromDate);

  return { period, setPeriod, periodDates, cutoffDate };
}
