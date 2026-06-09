/**
 * Unit tests for functions/src/megaventoryConnector.ts.
 *
 * 1) extractMvCategory (PER-60) — ProductGet returned an empty
 *    `ProductCategoryDescription` on every e-tennis product; the real name lives
 *    in `ProductCategoryName` (and, with includeReferencedObjects, a nested
 *    `ProductCategory` object). Preference: ProductCategoryName → nested → Description.
 *
 * 2) normalizeMvCustomReportRow (SEC-L13) — turns Megaventory `ColumnName` values
 *    (untrusted, from the API) into Firestore field keys. It must sanitize
 *    characters field keys can't hold, cap key length + column count, and never
 *    let a column overwrite the reserved keys.
 */
import { describe, it, expect } from 'vitest';
import { extractMvCategory, normalizeMvCustomReportRow } from '../../megaventoryConnector';

describe('extractMvCategory (PER-60)', () => {
  it('prefers flat ProductCategoryName (the real human-readable name)', () => {
    expect(extractMvCategory({ ProductCategoryName: 'Ανδρικά Ρούχα' })).toBe('Ανδρικά Ρούχα');
  });

  it('prefers ProductCategoryName even when Description is also present', () => {
    expect(
      extractMvCategory({ ProductCategoryName: 'Παπούτσια Running', ProductCategoryDescription: 'stale' })
    ).toBe('Παπούτσια Running');
  });

  it('falls back to nested ProductCategory.ProductCategoryName (includeReferencedObjects)', () => {
    expect(
      extractMvCategory({ ProductCategory: { ProductCategoryName: 'Babolat', ProductCategoryID: 12 } })
    ).toBe('Babolat');
  });

  it('falls back to nested ProductCategory.ProductCategoryDescription when nested name is empty', () => {
    expect(
      extractMvCategory({ ProductCategory: { ProductCategoryName: '', ProductCategoryDescription: 'Tennis' } })
    ).toBe('Tennis');
  });

  it('falls back to flat ProductCategoryDescription when no name anywhere', () => {
    expect(extractMvCategory({ ProductCategoryDescription: 'Legacy Cat' })).toBe('Legacy Cat');
  });

  it('returns empty string when no category data is present (the old e-tennis case)', () => {
    expect(extractMvCategory({ ProductSKU: 'ABC', ProductCategoryDescription: '' })).toBe('');
    expect(extractMvCategory({})).toBe('');
  });

  it('trims whitespace', () => {
    expect(extractMvCategory({ ProductCategoryName: '  Ρούχα  ' })).toBe('Ρούχα');
  });

  it('ignores a non-object ProductCategory value safely', () => {
    expect(extractMvCategory({ ProductCategory: 42, ProductCategoryDescription: 'D' })).toBe('D');
  });

  // PER-60 (live-confirmed): includeReferencedObjects embeds the category as `mvProductCategory`
  // (mv prefix), with the name as a full path. The product itself carries only ProductCategoryID.
  it('reads the real includeReferencedObjects shape mvProductCategory.ProductCategoryName (leaf of the path)', () => {
    expect(
      extractMvCategory({
        ProductCategoryID: 8274,
        mvProductCategory: {
          ProductCategoryID: 8274,
          ProductCategoryName: 'Root Catalog/e-tennis/Αθλητικά Παπούτσια',
          ProductCategoryDescription: '<h3>...</h3>',
        },
      })
    ).toBe('Αθλητικά Παπούτσια');
  });

  it('mvProductCategory takes precedence over flat fields', () => {
    expect(
      extractMvCategory({
        ProductCategoryName: 'stale-flat',
        mvProductCategory: { ProductCategoryName: 'Root Catalog/e-tennis/Babolat' },
      })
    ).toBe('Babolat');
  });

  it('strips the Root Catalog / brand path prefix down to the leaf segment', () => {
    expect(extractMvCategory({ ProductCategoryName: 'Root Catalog/e-tennis/Ανδρικά Ρούχα' })).toBe('Ανδρικά Ρούχα');
  });

  it('returns empty when only a numeric ProductCategoryID is present (no referenced object)', () => {
    expect(extractMvCategory({ ProductCategoryID: 8274 })).toBe('');
  });
});

describe('normalizeMvCustomReportRow (SEC-L13)', () => {
  it('sanitizes characters Firestore field keys cannot hold (~ * / [ ] ( ) .)', () => {
    const out = normalizeMvCustomReportRow({
      Index: 7,
      Data: [
        { ColumnName: 'Net.Amount', Value: 5 },
        { ColumnName: 'A~B*C/D', Value: 9 },
      ],
    });
    expect(out['Net_Amount']).toBe(5);
    expect(out['A_B_C_D']).toBe(9);
    expect(out.mvRowIndex).toBe(7);
  });

  it('never lets a column overwrite the reserved keys (mvRowIndex/source/cells)', () => {
    const out = normalizeMvCustomReportRow({
      Data: [
        { ColumnName: 'mvRowIndex', Value: 'X' },
        { ColumnName: 'source', Value: 'X' },
        { ColumnName: 'cells', Value: 'X' },
      ],
    });
    expect(out.mvRowIndex).toBeNull(); // reserved → not overwritten
    expect(out.source).toBe('megaventory_custom_report_row');
    expect(Array.isArray(out.cells)).toBe(true);
  });

  it('caps the key length at 100 chars', () => {
    const out = normalizeMvCustomReportRow({ Data: [{ ColumnName: 'a'.repeat(200), Value: 1 }] });
    expect(out['a'.repeat(100)]).toBe(1);
    expect(out['a'.repeat(200)]).toBeUndefined();
  });

  it('caps the number of columns at 200', () => {
    const Data = Array.from({ length: 250 }, (_, i) => ({ ColumnName: `col${i}`, Value: i }));
    const out = normalizeMvCustomReportRow({ Data });
    expect(Object.keys(out).filter((k) => k.startsWith('col')).length).toBe(200);
  });

  it('passes through a row with no Data array unchanged', () => {
    const out = normalizeMvCustomReportRow({ foo: 'bar' });
    expect(out.foo).toBe('bar');
  });
});
