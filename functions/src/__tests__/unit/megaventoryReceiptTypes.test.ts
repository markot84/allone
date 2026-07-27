/** Inbound-receipt classifier must keep supplier deliveries/purchases (the stock-age anchor) and reject
 * outbound deliveries, inter-branch transfers and returns. Cases are real e-tennis Megaventory types. */
import { describe, it, expect } from 'vitest';
import { isLikelyInboundReceiptDocumentType } from '../../megaventoryConnector';

const t = (abbreviation: string, description: string) => ({ id: '0', abbreviation, description });

describe('isLikelyInboundReceiptDocumentType', () => {
  it('keeps supplier delivery notes (Δελτίο Αποστολής Προμηθευτή) — the real receipt date', () => {
    expect(isLikelyInboundReceiptDocumentType(t('ΔΑΠ-OUT', 'Δελτίο Αποστολής Προμηθευτή OUTLET (ΔΑΠO)'))).toBe(true);
    expect(isLikelyInboundReceiptDocumentType(t('GLYF-ΔΑΠ', 'GLYF-Δελτίο Αποστολής Προμηθευτή'))).toBe(true);
    expect(isLikelyInboundReceiptDocumentType(t('MAROU-ΔΑΠ', 'MAROU-Δελτίο Αποστολής Προμηθευτή'))).toBe(true);
  });

  it('keeps supplier purchase invoices and goods receipts', () => {
    expect(isLikelyInboundReceiptDocumentType(t('Τιμ,Αγ.Outlet', 'Τιμολόγιο Αγοράς Προμηθευτή (Outlet)'))).toBe(true);
    expect(isLikelyInboundReceiptDocumentType(t('ΤΙΜΑΓ-Athens', 'Τιμολόγιο Αγοράς Προμηθευτή (Athens)'))).toBe(true);
    expect(isLikelyInboundReceiptDocumentType(t('ΕΕBUR', 'ΕE - Παραλαβή απο Εντολή Εργασίας'))).toBe(true);
    expect(isLikelyInboundReceiptDocumentType(t('PINV', 'Supplier Purchase Invoice'))).toBe(true);
  });

  it('rejects outbound customer delivery notes (no «Προμηθευτή»)', () => {
    expect(isLikelyInboundReceiptDocumentType(t('ΔΑ', 'Δελτίο Αποστολής'))).toBe(false);
    expect(isLikelyInboundReceiptDocumentType(t('ΔΑ-GLYF', 'GLYF - ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ'))).toBe(false);
  });

  it('rejects inter-branch transfers (Ενδοδιακίνηση)', () => {
    expect(isLikelyInboundReceiptDocumentType(t('ΕΝΔΟΔ-AE-ΓΛΥΦ', 'AE - ΕΝΔΟΔΙΑΚΙΝΗΣΗ ΓΛΥΦΑΔΑ'))).toBe(false);
  });

  it('rejects returns/credits — including returns TO a supplier (stock out)', () => {
    expect(isLikelyInboundReceiptDocumentType(t('ΠΛΑΣΤΗΡΑ-Δ.Ε.-ΠΡΟΜ', 'ΠΛΑΣΤΗΡΑ ΔΕΛΤΙΟ ΕΠΙΣΤΡΟΦΗΣ ΣΕ ΠΡΟΜΗΘΕΥΤΗ'))).toBe(false);
    expect(isLikelyInboundReceiptDocumentType(t('ΕΕ-ΠΣΤ-ΛΙΑΝ_Cr', 'ΕΕ Πιστωτική απόδ. λιαν. επιστροφής (Credit)'))).toBe(false);
  });

  it('rejects sales/retail receipts', () => {
    expect(isLikelyInboundReceiptDocumentType(t('ΑΛ (Μαμάσης)', 'Απόδειξη Λιανικής (Μελενίκου)'))).toBe(false);
  });
});
