import { describe, it, expect } from 'vitest';
import { resolveStockSourceMode, STOCK_SOURCE_MODES } from './stockSource';

describe('resolveStockSourceMode', () => {
  it('honors an explicit choice regardless of context', () => {
    const ctx = { plan: 'enterprise', hasErpConnector: true };
    expect(resolveStockSourceMode('ecommerce', ctx)).toBe('ecommerce');
    expect(resolveStockSourceMode('erp', { hasErpConnector: false })).toBe('erp');
    expect(resolveStockSourceMode('procurement', { hasErpConnector: false })).toBe('procurement');
  });

  it('defaults enterprise + procurement module to procurement (preserves safeblock)', () => {
    expect(resolveStockSourceMode(undefined, { plan: 'enterprise', hasErpConnector: true })).toBe('procurement');
    // procurement module not explicitly disabled → still procurement
    expect(
      resolveStockSourceMode(undefined, { plan: 'enterprise', procurementModuleEnabled: true, hasErpConnector: false })
    ).toBe('procurement');
  });

  it('enterprise with procurement module explicitly disabled falls through to connector default', () => {
    expect(
      resolveStockSourceMode(undefined, { plan: 'enterprise', procurementModuleEnabled: false, hasErpConnector: true })
    ).toBe('erp');
  });

  it('defaults to ERP when an ERP connector exists (preserves e-tennis)', () => {
    expect(resolveStockSourceMode(undefined, { plan: 'growth', hasErpConnector: true })).toBe('erp');
    expect(resolveStockSourceMode(undefined, { hasErpConnector: true })).toBe('erp');
  });

  it('defaults to e-commerce when no ERP connector and not enterprise-procurement', () => {
    expect(resolveStockSourceMode(undefined, { plan: 'growth', hasErpConnector: false })).toBe('ecommerce');
    expect(resolveStockSourceMode(undefined, { hasErpConnector: false })).toBe('ecommerce');
  });

  it('treats unknown/legacy values as unset (falls back to the default rule)', () => {
    expect(resolveStockSourceMode('garbage', { hasErpConnector: true })).toBe('erp');
    expect(resolveStockSourceMode('', { hasErpConnector: false })).toBe('ecommerce');
  });

  it('exposes exactly the three valid modes', () => {
    expect([...STOCK_SOURCE_MODES].sort()).toEqual(['ecommerce', 'erp', 'procurement']);
  });
});
