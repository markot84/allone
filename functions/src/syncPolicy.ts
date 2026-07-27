export type ConnectorSyncMode = 'historical' | 'incremental' | 'snapshot';

export const DEFAULT_HISTORY_YEARS = 3;
export const DEFAULT_INCREMENTAL_OVERLAP_HOURS = 48;
/** 20-day (480h) incremental overlap so e-commerce syncs re-read updated_at >= (lastSync − 20d), catching late cancellations, refunds, chargebacks (EU 14-day withdrawal + buffer). */
export const ECOMMERCE_INCREMENTAL_OVERLAP_HOURS = 480;

export interface SyncWindow {
  mode: ConnectorSyncMode;
  windowStart: Date;
  windowEnd: Date;
  historyStartYear: number;
}

export function coerceSyncDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Yesterday→today window: tiny overlap for late-settling conversions without re-fetching the year. */
export function buildYesterdayToTodayWindow(now: Date = new Date()): { since: string; until: string } {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return {
    since: toYmd(yesterday),
    until: toYmd(now),
  };
}

/** Number of consecutive UTC days (today inclusive) re-fetched after the initial historical load. */
export const DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS = 35;

/** Rolling [since … until] window including today (UTC, via `toYmd`); backfills days missing from Firestore after a partial payload that a yesterday/today window never re-fetched. */
export function buildRollingUtcDayWindow(
  inclusiveDayCount: number,
  now: Date = new Date()
): { since: string; until: string } {
  const k =
    Number.isFinite(inclusiveDayCount) && inclusiveDayCount >= 2
      ? Math.floor(inclusiveDayCount)
      : DEFAULT_INCREMENTAL_ROLLING_LOOKBACK_DAYS;
  const since = new Date(now.getTime());
  since.setUTCDate(since.getUTCDate() - (k - 1));
  return { since: toYmd(since), until: toYmd(now) };
}

export function toMagentoDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Whether heavy post-sync aggregations should run: yes if data changed (success or imported > 0), no on clean failure or queued jobs (the worker aggregates on finish). */
export function shouldRunPostSyncAggregations(
  result: { success?: boolean; imported?: number; queued?: boolean } | null | undefined
): boolean {
  if (!result) return false;
  if (result.queued === true) return false;
  return result.success !== false || Number(result.imported ?? 0) > 0;
}

export function buildHistoricalOrIncrementalWindow(
  connector: Record<string, unknown>,
  lastSyncField: string,
  historyLoadedField = 'historyLoadedUntilYear',
  historyYears = DEFAULT_HISTORY_YEARS,
  overlapHours = DEFAULT_INCREMENTAL_OVERLAP_HOURS
): SyncWindow {
  const now = new Date();
  const historyStartYear = now.getUTCFullYear() - historyYears;
  const loadedYear = Number(connector[historyLoadedField] || 0);
  const lastSyncAt = coerceSyncDate(connector[lastSyncField]);
  const historyLoaded = Number.isFinite(loadedYear) && loadedYear <= historyStartYear && loadedYear > 0;

  if (historyLoaded && lastSyncAt) {
    return {
      mode: 'incremental',
      windowStart: subtractHours(lastSyncAt, overlapHours),
      windowEnd: now,
      historyStartYear,
    };
  }

  return {
    mode: 'historical',
    windowStart: new Date(Date.UTC(historyStartYear, 0, 1)),
    windowEnd: now,
    historyStartYear,
  };
}
