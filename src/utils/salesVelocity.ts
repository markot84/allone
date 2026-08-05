import type { Product } from '../types';

/**
 * Sales velocity across the three windows the catalogue actually stores.
 *
 * There is no per-SKU time series anywhere in the data model — only cumulative quantities for the
 * last 7 / 30 / 90 days. Dividing each by its own length turns them into comparable average daily
 * rates, which is the only honest way to put them on one axis: oldest window first, so a rising
 * line means the SKU is accelerating.
 */
export interface VelocityPoint {
  /** Window label, for the accessible description. */
  label: string;
  /** Average units sold per day over that window. */
  rate: number;
}

export function velocityPoints(product: Product): VelocityPoint[] {
  const windows: { days: number; qty: number | undefined; label: string }[] = [
    { days: 90, qty: product.qty_sold_last_90d, label: '90 ημέρες' },
    { days: 30, qty: product.qty_sold_last_30d, label: '30 ημέρες' },
    { days: 7, qty: product.qty_sold_last_7d, label: '7 ημέρες' },
  ];
  return windows
    .filter((w): w is { days: number; qty: number; label: string } =>
      typeof w.qty === 'number' && Number.isFinite(w.qty)
    )
    .map((w) => ({ label: w.label, rate: w.qty / w.days }));
}

/** True when at least one row can draw a spark — the column is hidden for catalogues that can't. */
export function hasVelocityData(products: Product[]): boolean {
  return products.some((p) => velocityPoints(p).length >= 2);
}
