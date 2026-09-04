/** Year-over-year period shifting for "same window, last year" comparisons.
 *
 * Deliberately string/calendar based: `new Date('YYYY-MM-DD')` parses as UTC and
 * `toISOString()` re-serializes as UTC, so in any timezone ahead of UTC (the whole
 * Greek user base) a naive shift lands one day early. Everything here builds the
 * result from the calendar fields, never from a UTC serialization. */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed `YYYY-MM-DD` day key. */
export function isIsoDay(value: string | null | undefined): boolean {
  return typeof value === 'string' && ISO_DAY.test(value);
}

export interface IsoPeriod {
  fromDate: string;
  toDate: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Days in `month` (1-12) of `year` — 0 as the day rolls back to the last of the previous month. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Shift an ISO `YYYY-MM-DD` by whole years, clamping to the target month's last day
 * (29 Feb → 28 Feb on a non-leap year). Invalid input is returned unchanged. */
export function shiftIsoDateByYears(ymd: string, years: number): string {
  if (!ISO_DAY.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d || m > 12) return ymd;
  const targetYear = y + years;
  const day = Math.min(d, lastDayOfMonth(targetYear, m));
  return `${targetYear}-${pad2(m)}-${pad2(day)}`;
}

/** Both ends of a period shifted by whole years. */
export function shiftPeriodByYears(period: IsoPeriod, years: number): IsoPeriod {
  return {
    fromDate: shiftIsoDateByYears(period.fromDate, years),
    toDate: shiftIsoDateByYears(period.toDate, years),
  };
}

/** Greek short-date label for a day (noon-local so DST never shifts the date). */
function formatIsoDayGr(ymd: string): string {
  if (!ISO_DAY.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  try {
    return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('el-GR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return ymd;
  }
}

/** Human label for a range, e.g. «1 Ιαν 2025 – 3 Σεπ 2025»; a single day renders once. */
export function formatIsoRangeLabelGr(fromDate: string, toDate: string): string {
  if (!ISO_DAY.test(fromDate) || !ISO_DAY.test(toDate)) return `${fromDate} – ${toDate}`;
  if (fromDate === toDate) return formatIsoDayGr(fromDate);
  return `${formatIsoDayGr(fromDate)} – ${formatIsoDayGr(toDate)}`;
}
