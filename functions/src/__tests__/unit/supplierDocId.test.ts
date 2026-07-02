/** All supplier writers must land on the same doc for the same (brand, name) —
 * the divergent-id schemes were the PER-182 duplicate root cause. */
import { describe, it, expect } from 'vitest';
import { supplierDocId } from '../../erpConnectorFirestore';

describe('supplierDocId', () => {
  it('is deterministic across casing, whitespace and accents', () => {
    expect(supplierDocId('e-tennis', 'Nike')).toBe(supplierDocId('e-tennis', ' NIKE '));
    expect(supplierDocId('e-tennis', 'ACME  Sports')).toBe(supplierDocId('e-tennis', 'acme sports'));
    expect(supplierDocId('b1', 'Λιβάρδας')).toBe(supplierDocId('b1', 'ΛΙΒΑΡΔΑΣ'));
  });

  it('is brand-scoped (no cross-brand takeover)', () => {
    expect(supplierDocId('brand-a', 'Nike')).not.toBe(supplierDocId('brand-b', 'Nike'));
  });

  it('never emits Firestore-invalid ids', () => {
    const id = supplierDocId('b1', 'A/B\\C');
    expect(id).not.toMatch(/[/\\]/);
    expect(supplierDocId('b1', 'X'.repeat(2000)).length).toBeLessThanOrEqual(900);
  });
});
