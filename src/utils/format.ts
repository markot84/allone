/**
 * European number formatting: 18.300,55 (period thousands, comma decimal)
 * Uses el-GR locale for consistency across the app.
 */
const LOCALE = 'el-GR';

export function formatNumber(n: number, decimals = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatCurrency(n: number, decimals = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPercent(n: number, decimals = 1): string {
  return formatNumber(n, decimals) + '%';
}

/** Compact: €18,3K or €1,2M */
export function formatCurrencyCompact(n: number, decimals = 1): string {
  if (n >= 1_000_000) {
    return `€${formatNumber(n / 1_000_000, decimals)}M`;
  }
  if (n >= 1_000) {
    return `€${formatNumber(n / 1_000, decimals)}K`;
  }
  return `€${formatCurrency(n, decimals)}`;
}

/** Number with multiplier suffix: 9,93x */
export function formatMultiplier(n: number, decimals = 2): string {
  return `${formatNumber(n, decimals)}x`;
}
