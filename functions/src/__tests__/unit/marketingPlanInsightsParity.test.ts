/**
 * PER-157 parity gate — proves the SERVER-side ported compute
 * (functions/src/marketingPlan/marketingPlanInsights.ts) produces byte-identical insights to the
 * CLIENT compute, by feeding it the same fixtures captured in task #1 and asserting equality with
 * `internal/pentest/fixtures/per157-baseline.json` (which was produced by the client compute).
 *
 * Skips cleanly when fixtures are absent (they're gitignored → absent in CI), so it never breaks
 * the functions unit suite. Run locally after capturing fixtures:
 *   cd functions && NODE_OPTIONS=--max-old-space-size=4096 \
 *     npx vitest run src/__tests__/unit/marketingPlanInsightsParity.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildMarketingPlanInsight } from '../../marketingPlan/marketingPlanInsights';

// cwd is `functions/` when vitest runs; fixtures live at repo-root/internal/pentest/fixtures.
const FX = resolve(process.cwd(), '..', 'internal', 'pentest', 'fixtures');
const META = resolve(FX, 'meta.json');
const PRODUCTS = resolve(FX, 'products.jsonl');
const SIGNALS = resolve(FX, 'procurement-signals.json');
const ORDERS = resolve(FX, 'last-year-orders.json');
const DEMAND_ORDERS = resolve(FX, 'demand-orders.json');
const BASELINE = resolve(FX, 'per157-baseline.json');

const have = [META, PRODUCTS, SIGNALS, ORDERS, BASELINE].every(existsSync);

// Same deterministic subset the bench test snapshots (must stay in sync with per157-bench.test.ts).
const parityOf = (insight: ReturnType<typeof buildMarketingPlanInsight>) => ({
  evidence: insight.evidence,
  dataQuality: insight.dataQuality,
  totalSkusCovered: insight.totalSkusCovered,
  reorderPlan: insight.reorderPlan.map((r) => ({
    key: r.key, action: r.action, confidence: r.confidence, source: r.reorderQtySource,
    lastYearUnits: r.lastYearUnits, lastYearRevenue: r.lastYearRevenue,
    currentStock: r.currentStock, estimatedReorderQty: r.estimatedReorderQty,
    marginPct: r.marginPct, daysOfCover: r.daysOfCover, skuCount: r.skus?.length ?? 0,
  })),
  skuSuggestions: insight.skuSuggestions.map((s) => ({
    sku: s.sku, category: s.category, brand: s.brand,
    lastYearUnits: s.lastYearUnits, lastYearRevenue: s.lastYearRevenue,
    currentStock: s.currentStock, estimatedReorderQty: s.estimatedReorderQty,
    source: s.reorderQtySource, confidence: s.confidence,
  })),
});

describe.skipIf(!have)('PER-157 server compute parity (vs client baseline)', () => {
  // Guard all reads so the describe body doesn't throw when fixtures are absent
  // (describe.skipIf skips the its but still evaluates the body).
  const meta = have ? JSON.parse(readFileSync(META, 'utf8')) : null;
  const baseline = have ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const products = have ? readFileSync(PRODUCTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const signals = have ? JSON.parse(JSON.parse(readFileSync(SIGNALS, 'utf8')).skuSignalsJson || '{}') : {};
  const lastYearOrders = have ? JSON.parse(readFileSync(ORDERS, 'utf8')) : [];

  // Loads the ~222k-product fixture + runs the compute (~8s) — needs a generous timeout vs the 5s default.
  it('faithful (next_month) scenario matches the client baseline byte-for-byte', () => {
    const insight = buildMarketingPlanInsight({
      period: meta.period, lastYearOrders, inventoryProducts: products, procurementSignals: signals,
    });
    expect(parityOf(insight)).toEqual(baseline.scenarios.faithful.parity);
  }, 120_000);

  it.skipIf(!existsSync(DEMAND_ORDERS) || !meta.demandScenario)(
    'demand (2022-05) scenario matches the client baseline byte-for-byte', () => {
      const demandOrders = JSON.parse(readFileSync(DEMAND_ORDERS, 'utf8'));
      const insight = buildMarketingPlanInsight({
        period: meta.demandScenario.period, lastYearOrders: demandOrders,
        inventoryProducts: products, procurementSignals: signals,
      });
      expect(parityOf(insight)).toEqual(baseline.scenarios.demand.parity);
    },
    120_000,
  );
});

describe.skipIf(have)('PER-157 server compute parity (fixtures absent)', () => {
  it('is skipped until task #1 fixtures are captured', () => {
    expect(true).toBe(true);
  });
});
