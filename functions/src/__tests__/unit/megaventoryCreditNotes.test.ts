/** isLikelyCreditDocument admits credit/return docs (positive amounts, credit-flavored type text) without
 * deciding customer-vs-supplier; that split is the aggregator's parent-join. No per-brand type lists. */
import { describe, it, expect } from 'vitest';
import { isLikelyCreditDocument, isLikelySalesInvoice } from '../../megaventoryConnector';

const row = (amount: number): Record<string, unknown> => ({ DocumentAmountGrandTotal: amount });
const type = (abbreviation: string, description: string) => ({ id: '1', abbreviation, description });

describe('isLikelyCreditDocument', () => {
  it('admits Greek retail return credit notes (the dominant store type)', () => {
    expect(isLikelyCreditDocument(row(45.9), type('ΠΛΑΣΤΗΡΑ-ΠΣΤ-ΛΙΑΝ_Cr', 'ΠΛΑΣΤΗΡΑ Πιστωτική απόδ. λιαν. επιστροφής (Credit)'))).toBe(true);
  });

  it('admits english credit notes and supplier-return credits (classified later by parent join)', () => {
    expect(isLikelyCreditDocument(row(211.85), type('Credit Note_Cr', 'Credit Note'))).toBe(true);
    expect(isLikelyCreditDocument(row(24.75), type('ΠΤΠ-EE', 'Πιστωτικό τιμολόγιο προμηθευτή'))).toBe(true);
  });

  it('rejects zero/negative amounts and quotes/proformas', () => {
    expect(isLikelyCreditDocument(row(0), type('Credit Note_Cr', 'Credit Note'))).toBe(false);
    expect(isLikelyCreditDocument(row(-5), type('Credit Note_Cr', 'Credit Note'))).toBe(false);
    expect(isLikelyCreditDocument(row(10), type('Q', 'Credit quote προσφορά'))).toBe(false);
  });

  it('rejects plain sales documents', () => {
    expect(isLikelyCreditDocument(row(100), type('SI', 'Sales Invoice'))).toBe(false);
    expect(isLikelyCreditDocument(row(100), type('SR', 'ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ - ΑΠΟΣΤΟΛΗ'))).toBe(false);
  });

  it('is mutually exclusive with isLikelySalesInvoice on credit rows', () => {
    const creditType = type('ΠΛΑΣΤΗΡΑ-ΠΣΤ-ΛΙΑΝ_Cr', 'Πιστωτική απόδειξη λιανικής επιστροφής');
    expect(isLikelyCreditDocument(row(30), creditType)).toBe(true);
    expect(isLikelySalesInvoice(row(30), creditType)).toBe(false); // the old filter rejected these → gross turnover
    const salesType = type('SI', 'Τιμολόγιο Πώλησης');
    expect(isLikelySalesInvoice(row(30), salesType)).toBe(true);
    expect(isLikelyCreditDocument(row(30), salesType)).toBe(false);
  });
});
