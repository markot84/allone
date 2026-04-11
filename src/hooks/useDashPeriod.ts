/**
 * Backward-compatible wrapper around GlobalDateContext.
 * Dashboard and ROI Attribution continue to import from here.
 */
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS, type GlobalPeriod } from '../contexts/GlobalDateContext';

export type DashPeriod = GlobalPeriod;

export const PERIOD_OPTIONS: { key: DashPeriod; label: string }[] = GLOBAL_PERIOD_OPTIONS;

export function useDashPeriod() {
  const { period, setPeriod, fromDate, toDate, cutoffDate } = useGlobalDate();
  return {
    period,
    setPeriod,
    periodDates: { fromDate, toDate },
    cutoffDate,
  };
}
