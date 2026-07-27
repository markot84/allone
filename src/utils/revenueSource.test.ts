import { describe, it, expect } from 'vitest';
import {
  resolveRevenuePerformanceSource,
  prefersEshopRevenuePerformance,
  REVENUE_PERFORMANCE_SOURCES,
} from './revenueSource';

describe('resolveRevenuePerformanceSource', () => {
  it('honors an explicit eshop_order_date regardless of connectors', () => {
    expect(resolveRevenuePerformanceSource('eshop_order_date', false)).toBe('eshop_order_date');
    expect(resolveRevenuePerformanceSource('eshop_order_date', true)).toBe('eshop_order_date');
  });

  it('honors an explicit erp_document_date regardless of connectors', () => {
    expect(resolveRevenuePerformanceSource('erp_document_date', true)).toBe('erp_document_date');
    expect(resolveRevenuePerformanceSource('erp_document_date', false)).toBe('erp_document_date');
  });

  it('defaults to e-shop order-date when an e-shop connector exists', () => {
    expect(resolveRevenuePerformanceSource(undefined, true)).toBe('eshop_order_date');
  });

  it('defaults to ERP document-date for ERP-only brands (no e-shop connector)', () => {
    expect(resolveRevenuePerformanceSource(undefined, false)).toBe('erp_document_date');
  });

  it('treats unknown/legacy values as unset (falls back to the default rule)', () => {
    expect(resolveRevenuePerformanceSource('garbage', true)).toBe('eshop_order_date');
    expect(resolveRevenuePerformanceSource('', false)).toBe('erp_document_date');
  });

  it('exposes exactly the two valid source ids', () => {
    expect([...REVENUE_PERFORMANCE_SOURCES].sort()).toEqual(['erp_document_date', 'eshop_order_date']);
  });
});

describe('prefersEshopRevenuePerformance', () => {
  it('is true only when the resolved source is the e-shop order-date lens', () => {
    // hybrid brand, e-shop connector present, unset → e-shop lens, ERP/procurement bypassed
    expect(prefersEshopRevenuePerformance(undefined, true)).toBe(true);
    // ERP-only brand, unset → keeps ERP cascade
    expect(prefersEshopRevenuePerformance(undefined, false)).toBe(false);
    // explicit ERP pin on a brand that has an e-shop → still ERP
    expect(prefersEshopRevenuePerformance('erp_document_date', true)).toBe(false);
  });
});
