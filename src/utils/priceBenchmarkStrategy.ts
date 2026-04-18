import type { Product, PriceBenchmarkPresetId, PriceBenchmarkStrategyScope } from '../types';

/** Ελάχιστα πεδία benchmark (συμβατό με PriceBenchmark από usePriceBenchmarks). */
export interface BenchmarkPriceFields {
  productId: string;
  gtin: string;
  benchmarkPrice: number;
  priceDiff: number;
  yourPrice: number;
}

/** Κλειδιά σύζευξης SKU ↔ GMC productId (`online:el:GR:SKU` κ.λπ.). */
export function benchmarkKeyCandidatesFromProductId(productId: string, gtin: string): string[] {
  const raw = (productId || '').trim();
  const parts = raw ? raw.split(':').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const g = (gtin || '').trim().toLowerCase();
  const candidates = [raw.toLowerCase(), ...parts, g].filter(Boolean);
  return [...new Set(candidates)];
}

export function productKeyCandidates(product: Product): string[] {
  const out: string[] = [];
  const add = (s?: string) => {
    const t = (s || '').trim().toLowerCase();
    if (!t) return;
    out.push(t);
    if (t.includes(':')) {
      t.split(':')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .forEach((x) => out.push(x));
    }
  };
  add(product.sku);
  add(product.id);
  return [...new Set(out)];
}

export type BenchmarkLookup<T extends BenchmarkPriceFields> = Map<string, T>;

export function buildBenchmarkLookup<T extends BenchmarkPriceFields>(
  benchmarks: readonly T[],
): BenchmarkLookup<T> {
  const lookup: BenchmarkLookup<T> = new Map();
  for (const b of benchmarks) {
    for (const key of benchmarkKeyCandidatesFromProductId(b.productId, b.gtin)) {
      if (!lookup.has(key)) lookup.set(key, b);
    }
  }
  return lookup;
}

export function findBenchmarkForProductInLookup<T extends BenchmarkPriceFields>(
  product: Product,
  lookup: ReadonlyMap<string, T>,
): T | undefined {
  for (const key of productKeyCandidates(product)) {
    const match = lookup.get(key);
    if (match) return match;
  }
  return undefined;
}

export function findBenchmarkForProduct<T extends BenchmarkPriceFields>(
  product: Product,
  benchmarks: readonly T[],
): T | undefined {
  return findBenchmarkForProductInLookup(product, buildBenchmarkLookup(benchmarks));
}

export function isCheaperThanMarket(b: BenchmarkPriceFields | undefined): boolean {
  return !!b && b.benchmarkPrice > 0 && b.priceDiff < 0;
}

export const PRICE_BENCHMARK_PRESET_OPTIONS: {
  id: PriceBenchmarkPresetId;
  label: string;
  hint: string;
}[] = [
  {
    id: 'below_market',
    label: 'Φθηνότεροι από την αγορά',
    hint: 'Μόνο SKU όπου η τιμή σας είναι χαμηλότερη από το benchmark GMC (priceDiff < 0).',
  },
  {
    id: 'all_benchmarked',
    label: 'Όλα με έγκυρο benchmark',
    hint: 'Όλα τα SKU που συνδέονται με GMC benchmark (benchmarkPrice > 0).',
  },
];

function brandOf(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  return p.supplier?.trim() ?? '';
}

export function productMatchesPriceBenchmarkTextFilters(
  product: Product,
  brandFilter: string,
  categoryFilter: string,
  search: string,
): boolean {
  const bf = brandFilter.trim().toLowerCase();
  if (bf && !brandOf(product).toLowerCase().includes(bf)) return false;
  const cf = categoryFilter.trim().toLowerCase();
  if (cf && !(product.category ?? '').toLowerCase().includes(cf)) return false;
  const q = search.trim().toLowerCase();
  if (q) {
    const hay = `${product.name ?? ''} ${product.sku ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function productMatchesPriceBenchmarkPreset(
  _product: Product,
  preset: PriceBenchmarkPresetId,
  benchmark: BenchmarkPriceFields | undefined,
): boolean {
  if (!benchmark || benchmark.benchmarkPrice <= 0) return false;
  if (preset === 'below_market') return isCheaperThanMarket(benchmark);
  return true;
}

export function productParticipatesInPriceBenchmarkStrategy(
  product: Product,
  scope: PriceBenchmarkStrategyScope | null | undefined,
  benchmark: BenchmarkPriceFields | undefined,
): boolean {
  if (!scope) return true;
  if (scope.selectedProductIds && scope.selectedProductIds.length > 0) {
    return scope.selectedProductIds.includes(product.id);
  }
  if (!productMatchesPriceBenchmarkTextFilters(product, scope.brandFilter, scope.categoryFilter, scope.search)) {
    return false;
  }
  return productMatchesPriceBenchmarkPreset(product, scope.preset, benchmark);
}

/**
 * Έλεγχος συμμετοχής SKU στο scope Price Benchmarking.
 * Όταν υπάρχουν `selectedProductIds`, **δεν** καλεί `findBenchmarkForProduct` (αποφυγή freeze σε μεγάλο κατάλογο).
 */
export function productInPriceBenchmarkScope<T extends BenchmarkPriceFields>(
  product: Product,
  scope: PriceBenchmarkStrategyScope | null | undefined,
  benchmarks: readonly T[],
): boolean {
  if (!scope) return true;
  if (scope.selectedProductIds && scope.selectedProductIds.length > 0) {
    return scope.selectedProductIds.includes(product.id);
  }
  const lookup = buildBenchmarkLookup(benchmarks);
  return productParticipatesInPriceBenchmarkStrategy(
    product,
    scope,
    findBenchmarkForProductInLookup(product, lookup),
  );
}

export function productInPriceBenchmarkScopeWithLookup<T extends BenchmarkPriceFields>(
  product: Product,
  scope: PriceBenchmarkStrategyScope | null | undefined,
  lookup: ReadonlyMap<string, T>,
): boolean {
  if (!scope) return true;
  if (scope.selectedProductIds && scope.selectedProductIds.length > 0) {
    return scope.selectedProductIds.includes(product.id);
  }
  return productParticipatesInPriceBenchmarkStrategy(
    product,
    scope,
    findBenchmarkForProductInLookup(product, lookup),
  );
}

export function filterProductsByPriceBenchmarkScope<T extends BenchmarkPriceFields>(
  products: Product[],
  scope: PriceBenchmarkStrategyScope | null | undefined,
  benchmarks: readonly T[],
): Product[] {
  if (!scope) return products;
  const lookup = buildBenchmarkLookup(benchmarks);
  const filtered = products.filter((p) => productInPriceBenchmarkScopeWithLookup(p, scope, lookup));
  return filtered.length > 0 ? filtered : products;
}

/** 0–100: υψηλό = ισχυρό πλεονέκτημα τιμής έναντι αγοράς. */
export function calculatePriceBenchmarkAdvantageScore(b: BenchmarkPriceFields | undefined): number {
  if (!b || b.benchmarkPrice <= 0) return 22;
  if (b.priceDiff >= 0) return 32 + Math.min(28, b.priceDiff);
  const depth = Math.min(55, -b.priceDiff * 2.2);
  return Math.round(48 + depth);
}
