/** Server half of the import number-parsing contract — mirror of
 * `src/services/importNumberParity.test.ts`. Before this, the Cloud Function used a bare
 * parseFloat and read a Greek ERP export's "12.500,00" as 12.5, so the same file produced
 * different numbers depending on whether it was imported in the browser or server-side. */
import { describe, expect, it } from 'vitest';
import { parseLooseNumber } from '../../parseFile';
import { validateProduct } from '../../validateProduct';

/** Minimal valid row; each case adds ONE numeric column so the assertion isolates parsing.
 * (`pick` fuzz-matches any header containing "stock", so a multi-column row would let one
 * field's value leak into another and mask what this suite locks.) */
const BASE = { 'κωδικός': 'SKU-1', 'περιγραφή': 'Δοκιμή', 'λιανικής': '10' };

describe('validateProduct number parsing (Cloud Function side of the parity contract)', () => {
  it('reads a thousands-separated price', () => {
    expect(validateProduct({ ...BASE, 'λιανικής': '1.234,56' }, 0).data?.price).toBe(1234.56);
  });

  it('reads a thousands-separated cost', () => {
    expect(validateProduct({ ...BASE, 'τιμή_αγοράς': '1.000,00' }, 0).data?.cost_price).toBe(1000);
  });

  it('reads a thousands-separated stock level', () => {
    expect(validateProduct({ ...BASE, 'διαθεσιμότητα': '2.500' }, 0).data?.stock_level).toBe(2500);
  });

  it('reads a thousands-separated stock age', () => {
    expect(validateProduct({ ...BASE, 'stock_age_days': '1.200' }, 0).data?.stock_age_days).toBe(1200);
  });

  it('reads a thousands-separated capacity', () => {
    expect(validateProduct({ ...BASE, 'stock_capacity': '3.000' }, 0).data?.stock_capacity).toBe(3000);
  });

  it('reads a thousands-separated period revenue', () => {
    expect(validateProduct({ ...BASE, 'revenue_period': '45.000,50' }, 0).data?.revenue_period).toBe(45000.5);
  });

  it('reads a thousands-separated quantity sold', () => {
    expect(validateProduct({ ...BASE, 'πωλήσεις': '1.250' }, 0).data?.qty_sold_period).toBe(1250);
  });

  it('averages the Avg_Cost columns on the parsed values, not the truncated ones', () => {
    expect(
      validateProduct({ ...BASE, 'Avg_Cost_1': '12.500,00', 'Avg_Cost_2': '7.500,00' }, 0).data?.avg_cost
    ).toBe(10000);
  });

  it('accepts a currency symbol and the US convention', () => {
    expect(validateProduct({ ...BASE, 'λιανικής': '1.234,56 €' }, 0).data?.price).toBe(1234.56);
    expect(validateProduct({ ...BASE, 'λιανικής': '1,234.56' }, 0).data?.price).toBe(1234.56);
  });

  it('keeps the in-stock / out-of-stock text branch', () => {
    expect(validateProduct({ ...BASE, 'διαθεσιμότητα': 'In Stock' }, 0).data?.stock_level).toBe(1);
    expect(validateProduct({ ...BASE, 'διαθεσιμότητα': 'Out of Stock' }, 0).data?.stock_level).toBe(0);
  });
});

describe('parseLooseNumber (server mirror of the UI parser)', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['12.500,00', 12500],
    ['1.250', 1250],
    ['2.999', 2999],
    ['1,234.56', 1234.56],
    ['57,50', 57.5],
    ['57.50', 57.5],
    ['1.234,56 €', 1234.56],
    ['€ 99,99', 99.99],
    ['-1.500,25', -1500.25],
    ['0', 0],
    ['', 0],
    ['abc', 0],
  ] as [string, number][])('reads %j as %d', (raw, expected) => {
    expect(parseLooseNumber(raw)).toBe(expected);
  });

  it('passes finite numbers through and rejects NaN/Infinity/null', () => {
    expect(parseLooseNumber(42.5)).toBe(42.5);
    expect(parseLooseNumber(NaN)).toBe(0);
    expect(parseLooseNumber(Infinity)).toBe(0);
    expect(parseLooseNumber(null)).toBe(0);
    expect(parseLooseNumber(undefined)).toBe(0);
  });
});
