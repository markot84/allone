import { describe, it, expect } from 'vitest';
import { buildSalesForecast } from './salesForecast';
import type { CommercialInfo } from './commercialInfo';

function info(partial: Partial<CommercialInfo>): CommercialInfo {
  return {
    id: partial.id ?? 'i1',
    brandId: partial.brandId ?? 'b1',
    rawText: partial.rawText ?? '',
    status: partial.status ?? 'active',
    source: partial.source ?? 'owner',
    createdBy: null,
    summary: partial.summary ?? 'σήμα',
    categories: partial.categories ?? [],
    parentSkus: partial.parentSkus ?? [],
    brands: partial.brands ?? [],
    factorType: partial.factorType ?? 'trend',
    direction: partial.direction ?? 'neutral',
    magnitude: partial.magnitude ?? 'medium',
    horizonFrom: partial.horizonFrom ?? null,
    horizonTo: partial.horizonTo ?? null,
    confidence: partial.confidence ?? 'medium',
  };
}

describe('buildSalesForecast', () => {
  it('with no info, the forecast equals the baseline', () => {
    const f = buildSalesForecast({
      categoryGroups: [{ category: 'Tennis', pastRevenue: 1000, pastUnits: 50 }],
      activeInfo: [],
    });
    expect(f.categories).toHaveLength(1);
    expect(f.categories[0].upliftPct).toBe(0);
    expect(f.categories[0].forecastRevenue).toBe(1000);
    expect(f.totalForecastRevenue).toBe(1000);
  });

  it('upward info on a category increases the forecast', () => {
    const f = buildSalesForecast({
      categoryGroups: [
        { category: 'Tennis', pastRevenue: 1000, pastUnits: 50 },
        { category: 'Running', pastRevenue: 500, pastUnits: 20 },
      ],
      activeInfo: [info({ categories: ['Tennis'], direction: 'up', magnitude: 'high', confidence: 'high' })],
    });
    const tennis = f.categories.find((r) => r.category === 'Tennis')!;
    const running = f.categories.find((r) => r.category === 'Running')!;
    expect(tennis.upliftPct).toBeGreaterThan(0);
    expect(tennis.forecastRevenue).toBeGreaterThan(1000);
    expect(running.upliftPct).toBe(0); // not affected
    expect(f.appliedInfoCount).toBe(1);
  });

  it('recognizes a brand within the category name / parent SKU', () => {
    const f = buildSalesForecast({
      categoryGroups: [{ category: 'Adidas Originals', pastRevenue: 800, pastUnits: 40 }],
      activeInfo: [info({ brands: ['Adidas'], direction: 'up', magnitude: 'medium', confidence: 'high' })],
    });
    expect(f.categories[0].upliftPct).toBeGreaterThan(0);
    expect(f.categories[0].drivers.length).toBeGreaterThan(0);
  });

  it('downward info reduces the forecast', () => {
    const f = buildSalesForecast({
      categoryGroups: [{ category: 'Ski', pastRevenue: 1000, pastUnits: 30 }],
      activeInfo: [info({ categories: ['Ski'], direction: 'down', magnitude: 'high', confidence: 'high' })],
    });
    expect(f.categories[0].upliftPct).toBeLessThan(0);
    expect(f.categories[0].forecastRevenue).toBeLessThan(1000);
  });

  it('uplift is capped at +/-60%', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      info({ id: `i${i}`, categories: ['Tennis'], direction: 'up', magnitude: 'high', confidence: 'high' })
    );
    const f = buildSalesForecast({
      categoryGroups: [{ category: 'Tennis', pastRevenue: 1000, pastUnits: 50 }],
      activeInfo: many,
    });
    expect(f.categories[0].upliftPct).toBeLessThanOrEqual(0.6);
  });
});
