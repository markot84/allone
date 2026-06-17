/** parseXLSXBuffer caps the parse via sheetRows; assertSheetWithinLimits rejects
 * oversized/truncated sheets. Tested directly since XLSX.write recomputes !ref. */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXLSXBuffer, assertSheetWithinLimits } from '../../parseFile';

function workbookBuffer(rows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseXLSXBuffer', () => {
  it('parses a normal workbook', () => {
    const rows = parseXLSXBuffer(workbookBuffer([
      ['sku', 'name', 'price'],
      ['A1', 'Widget', '9.99'],
      ['A2', 'Gadget', '19.99'],
    ]));
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(['sku', 'name', 'price']);
    expect(rows[2][1]).toBe('Gadget');
  });
});

describe('assertSheetWithinLimits guard', () => {
  it('allows a small sheet', () => {
    expect(() => assertSheetWithinLimits({ A1: { t: 's', v: 'x' }, '!ref': 'A1:C100' })).not.toThrow();
  });

  it('allows a missing !ref (empty sheet)', () => {
    expect(() => assertSheetWithinLimits({})).not.toThrow();
    expect(() => assertSheetWithinLimits(undefined)).not.toThrow();
  });

  it('rejects a sheet whose declared cell range exceeds the cell limit', () => {
    // Wide but within the row cap: 26 cols × 100k rows = 2.6M cells > 2M.
    expect(() => assertSheetWithinLimits({ '!ref': 'A1:Z100000' })).toThrow(/cells exceeds/i);
  });

  it('rejects a sheet that declares more rows than the row limit (sheetRows truncation)', () => {
    expect(() => assertSheetWithinLimits({ '!ref': 'A1:A600000' })).toThrow(/row limit/i);
  });
});
