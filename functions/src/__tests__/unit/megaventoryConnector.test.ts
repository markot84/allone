/**
 * Unit tests for functions/src/megaventoryConnector.ts — PER-60 category extraction.
 *
 * Background: e-tennis's Megaventory ProductGet returned an empty
 * `ProductCategoryDescription` on every product, while the real category name
 * lives in `ProductCategoryName`. With `includeReferencedObjects: true` the
 * category can also arrive as a nested `ProductCategory` referenced object.
 *
 * extractMvCategory() preference order:
 *   1) flat ProductCategoryName
 *   2) nested ProductCategory.{ProductCategoryName|ProductCategoryDescription}
 *   3) flat ProductCategoryDescription (last resort — historically empty)
 */
import { describe, it, expect } from 'vitest';
import { extractMvCategory } from '../../megaventoryConnector';

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
});
