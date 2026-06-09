/**
 * SEC-L13 — normalizeMvCustomReportRow turns Megaventory `ColumnName` values (untrusted, from the
 * API) into Firestore field keys. It must sanitize characters field keys can't hold, cap key
 * length + column count, and never let a column overwrite the reserved keys.
 */
import { describe, it, expect } from 'vitest';
import { normalizeMvCustomReportRow } from '../../megaventoryConnector';

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
