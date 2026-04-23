import type { MarketingCostLine } from '../types';

function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Ημερομηνίες YYYY-MM-DD από from έως to (συμπεριλαμβανομένων), UTC. */
export function eachDateInclusive(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  let cur = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
  const endT = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0)).getTime();
  while (cur.getTime() <= endT) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function dailyRateForLine(
  line: MarketingCostLine,
  day: string,
  monthlyBudget: number
): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const dim = daysInCalendarMonth(y, m);
  if (dim <= 0) return 0;

  switch (line.kind) {
    case 'fixed_monthly': {
      const amt = Math.max(0, line.amountEUR ?? 0);
      return amt / dim;
    }
    case 'percent_of_budget': {
      const p = Math.max(0, line.percent ?? 0);
      if (monthlyBudget <= 0) return 0;
      return (monthlyBudget * (p / 100)) / dim;
    }
    case 'one_off_month': {
      const month = line.month?.slice(0, 7) ?? '';
      if (!month || day.slice(0, 7) !== month) return 0;
      const amt = Math.max(0, line.amountEUR ?? 0);
      return amt / dim;
    }
    default:
      return 0;
  }
}

export type MarketingOverheadBreakdown = { id: string; label: string; amount: number };

/**
 * Επιπλέον κόστη marketing (εκτός ad spend) για το διάστημα [fromDate, toDate].
 *
 * - **fixed_monthly** (π.χ. agency retainer): πλήρες ποσό **ανά ημερολογιακό μήνα** που εμφανίζεται
 *   στην περίοδο (όχι αναλογία ημερών μέσα στον μήνα). Έτσι «Τρέχων Μήνας» 1–20 Απριλίου = 1× το μηνιαίο κόστος, όχι 20/30.
 * - **percent_of_budget** / **one_off_month**: παραμένω κατανομή ανά ημέρα.
 */
export function computeMarketingOverheadForPeriod(
  lines: MarketingCostLine[] | undefined,
  monthlyBudget: number,
  fromDate: string,
  toDate: string
): { total: number; byLine: MarketingOverheadBreakdown[] } {
  if (!lines?.length) {
    return { total: 0, byLine: [] };
  }

  const byId = new Map<string, number>();
  for (const line of lines) {
    byId.set(line.id, 0);
  }

  const monthKeys = new Set<string>();
  for (const day of eachDateInclusive(fromDate, toDate)) {
    monthKeys.add(day.slice(0, 7));
  }
  const distinctCalendarMonths = monthKeys.size;

  for (const line of lines) {
    if (line.kind === 'fixed_monthly') {
      const amt = Math.max(0, line.amountEUR ?? 0);
      byId.set(line.id, Math.round(amt * distinctCalendarMonths * 100) / 100);
    }
  }

  for (const day of eachDateInclusive(fromDate, toDate)) {
    for (const line of lines) {
      if (line.kind === 'fixed_monthly') continue;
      const add = dailyRateForLine(line, day, monthlyBudget);
      if (add <= 0) continue;
      byId.set(line.id, (byId.get(line.id) ?? 0) + add);
    }
  }

  const byLine: MarketingOverheadBreakdown[] = lines.map((line) => ({
    id: line.id,
    label: line.label?.trim() || '—',
    amount: Math.round((byId.get(line.id) ?? 0) * 100) / 100,
  }));

  const total = Math.round(byLine.reduce((s, b) => s + b.amount, 0) * 100) / 100;
  return { total, byLine };
}
