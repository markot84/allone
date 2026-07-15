/** Numeric parsing for procurement sheet values (imported from XLSX, stored as strings). */

/** Parses a procurement cell into a number, tolerating Greek and raw-float formats.
 *
 *  A '.' is a DECIMAL point unless we can prove otherwise:
 *  - a ',' present  -> Greek format, dots are thousands  ("1.234,56" = 1234.56)
 *  - 2+ dots        -> unambiguously thousands           ("1.234.567" = 1234567)
 *
 *  A single dot with exactly 3 digits after it ("11.735") is genuinely ambiguous — Greek thousands
 *  or a 3-decimal float. It used to be read as thousands, which multiplied such values by 1000 and
 *  made safeblock's Αξία Αποθέματος €1,451,382 instead of €289,341 — off the back of just 4 rows in
 *  929 (PER-186). Every real column that contains 3-decimal values also contains values with 1, 2 or
 *  15 decimals, which proves the dot is a decimal point there; no column anywhere in either
 *  environment consists solely of 3-decimal values. So decimal is the correct reading.
 */
export function parseNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    // Greek/European format: dots = thousands, comma = decimal (e.g. "1.234,56")
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  if ((s.match(/\./g) ?? []).length > 1) {
    // Multiple dots → all thousands separators (e.g. "1.234.567")
    const n = parseFloat(s.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
