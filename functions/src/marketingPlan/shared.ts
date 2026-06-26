/**
 * PER-157 — server-side port of the deps that `marketingPlanInsights.ts` needs.
 *
 * `functions/` is a separate npm package and cannot import `src/services`. These few symbols are
 * copied VERBATIM from the client (`ecommerceSalesChannel.ts`, `ecommerceRawOrders.ts`,
 * `marketingPlanEngine.ts`) so the ported compute is byte-faithful. Parity with the client compute
 * is enforced by `__tests__/unit/marketingPlanInsightsParity.test.ts` against the PER-157 #1 baseline.
 * If the client originals change, update here and re-run that test.
 */

// --- types (minimal, structurally compatible with the client's) -------------------------------
export type Product = Record<string, unknown> & { id?: string };

export interface EcommerceRawLineItem {
  sku?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
  rowTotal?: number;
  productId?: string;
  parentItemId?: string | number | null;
  [k: string]: unknown;
}

export interface EcommerceRawOrder {
  orderId: string;
  orderName?: string;
  platform: string;
  status: string;
  total: number;
  currency?: string;
  createdAt: string;
  lineItems: EcommerceRawLineItem[];
  dataAnalysisIncluded?: boolean;
  revenueIncluded?: boolean;
  [k: string]: unknown;
}

// --- order predicates (verbatim: ecommerceSalesChannel.ts + ecommerceRawOrders.ts) ------------
const EXCLUDED_STATUS_SET = new Set([
  'cancelled',
  'canceled',
  'pending',
  'pending_payment',
  'payment_review',
  'failed',
  'closed',
  'refunded',
  'voided',
  /** Viva / Klarna handshake in progress — not treated as a completed order. */
  'viva_klarna_undefined',
]);

export function isExcludedEcommerceStatus(status: string | null | undefined): boolean {
  return EXCLUDED_STATUS_SET.has(String(status || '').trim().toLowerCase());
}

function isEcommerceOrderCancelled(status: string | null | undefined): boolean {
  return isExcludedEcommerceStatus(status);
}

export function isEcommerceOrderDataAnalysisIncluded(
  order: Pick<EcommerceRawOrder, 'status' | 'dataAnalysisIncluded'>
): boolean {
  if (order.dataAnalysisIncluded === false) return false;
  if (order.dataAnalysisIncluded === true) return true;
  return !isEcommerceOrderCancelled(order.status);
}

export function isEcommerceDemoLineItem(lineItem: EcommerceRawLineItem): boolean {
  const needle = `${lineItem.sku || ''} ${lineItem.title || ''} ${lineItem.name || ''}`.toLowerCase();
  return needle.includes('demo');
}

// --- preset period resolver (verbatim: marketingPlanEngine.ts) --------------------------------
export type MarketingPlanPresetId =
  | 'next_month'
  | 'next_quarter'
  | 'black_friday'
  | 'christmas'
  | 'january_sales'
  | 'back_to_school';

/** All presets the CF precomputes (one insight each). */
export const MARKETING_PLAN_PRESETS: MarketingPlanPresetId[] = [
  'next_month',
  'next_quarter',
  'black_friday',
  'christmas',
  'january_sales',
  'back_to_school',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function resolvePlanPeriod(presetId: MarketingPlanPresetId): {
  fromDate: string;
  toDate: string;
  periodLabel: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  if (presetId === 'next_month') {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const ld = lastDayOfMonth(ny, nm);
    return { fromDate: `${ny}-${pad(nm)}-01`, toDate: `${ny}-${pad(nm)}-${pad(ld)}`, periodLabel: 'Επόμενος μήνας' };
  }
  if (presetId === 'next_quarter') {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 4;
    const startM = qStartMonth > 12 ? qStartMonth - 12 : qStartMonth;
    const startY = qStartMonth > 12 ? y + 1 : y;
    const endM = startM + 2 > 12 ? startM + 2 - 12 : startM + 2;
    const endY = startM + 2 > 12 ? startY + 1 : startY;
    const ld = lastDayOfMonth(endY, endM);
    return { fromDate: `${startY}-${pad(startM)}-01`, toDate: `${endY}-${pad(endM)}-${pad(ld)}`, periodLabel: 'Επόμενο τρίμηνο' };
  }
  const seasonal: Record<string, { sm: number; sd: number; em: number; ed: number; label: string; rollYear?: boolean }> = {
    black_friday: { sm: 11, sd: 20, em: 11, ed: 30, label: 'Black Friday', rollYear: true },
    christmas:    { sm: 12, sd: 1,  em: 12, ed: 24, label: 'Χριστούγεννα', rollYear: true },
    january_sales:{ sm: 1,  sd: 10, em: 2,  ed: 28, label: 'Εκπτώσεις Ιανουαρίου' },
    back_to_school:{ sm: 9, sd: 1,  em: 9,  ed: 20, label: 'Back to School', rollYear: true },
  };
  const s = seasonal[presetId] ?? seasonal.black_friday;
  // Roll to next year if the season has already passed this year
  const targetDate = new Date(y, s.sm - 1, s.sd);
  const targetYear = s.rollYear && targetDate < now ? y + 1 : y;
  const endYear = s.em < s.sm ? targetYear + 1 : targetYear;
  return {
    fromDate: `${targetYear}-${pad(s.sm)}-${pad(s.sd)}`,
    toDate: `${endYear}-${pad(s.em)}-${pad(s.ed)}`,
    periodLabel: s.label,
  };
}
