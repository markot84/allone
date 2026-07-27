import { describe, expect, it } from 'vitest';
import { sanitizeSpreadsheetCell, sanitizeRow, sanitizeClipboardText } from './spreadsheetSafe';

describe('sanitizeSpreadsheetCell — formula-injection guard (SEC-M5 / PER-71)', () => {
  it('prefixes strings that begin with a formula trigger', () => {
    expect(sanitizeSpreadsheetCell('=1+1')).toBe("'=1+1");
    expect(sanitizeSpreadsheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeSpreadsheetCell('=HYPERLINK("http://evil","x")')).toBe('\'=HYPERLINK("http://evil","x")');
    expect(sanitizeSpreadsheetCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    // non-numeric signed leads are formulas, not numbers
    expect(sanitizeSpreadsheetCell('-1+1')).toBe("'-1+1");
    expect(sanitizeSpreadsheetCell('+1+1')).toBe("'+1+1");
  });

  it('catches a trigger hidden behind leading whitespace or control chars', () => {
    expect(sanitizeSpreadsheetCell('   =cmd')).toBe("'   =cmd");
    expect(sanitizeSpreadsheetCell('\t=cmd')).toBe("'\t=cmd");
    expect(sanitizeSpreadsheetCell('\tcmd')).toBe("'\tcmd");
    expect(sanitizeSpreadsheetCell('\rcmd')).toBe("'\rcmd");
  });

  it('leaves genuine numbers (typed and string) intact so columns stay numeric', () => {
    expect(sanitizeSpreadsheetCell(-5)).toBe(-5);
    expect(sanitizeSpreadsheetCell(12.5)).toBe(12.5);
    expect(sanitizeSpreadsheetCell('-5')).toBe('-5');
    expect(sanitizeSpreadsheetCell('+5')).toBe('+5');
    expect(sanitizeSpreadsheetCell('12.5')).toBe('12.5');
    expect(sanitizeSpreadsheetCell('-1234.56')).toBe('-1234.56');
  });

  it('passes through safe strings and non-strings', () => {
    expect(sanitizeSpreadsheetCell('normal text')).toBe('normal text');
    expect(sanitizeSpreadsheetCell('a=b in the middle')).toBe('a=b in the middle');
    expect(sanitizeSpreadsheetCell('')).toBe('');
    expect(sanitizeSpreadsheetCell(null)).toBe(null);
    expect(sanitizeSpreadsheetCell(undefined)).toBe(undefined);
    expect(sanitizeSpreadsheetCell(true)).toBe(true);
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(sanitizeSpreadsheetCell(d)).toBe(d);
  });

  it('never double-prefixes an already-neutralized value', () => {
    expect(sanitizeSpreadsheetCell("'=safe")).toBe("'=safe");
  });

  it('sanitizeRow maps over every cell, preserving non-string types', () => {
    expect(sanitizeRow(['=evil', 'ok', 10, '-5', '@x'])).toEqual(["'=evil", 'ok', 10, '-5', "'@x"]);
  });

  it('sanitizeClipboardText guards every line independently', () => {
    expect(sanitizeClipboardText('safe line\n=cmd\n@SUM(A1)\nnormal')).toBe("safe line\n'=cmd\n'@SUM(A1)\nnormal");
  });
});
