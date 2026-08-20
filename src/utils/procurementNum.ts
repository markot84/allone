/** Numeric parsing for procurement sheet values (imported from XLSX, stored as strings). */

/** Parses a procurement cell into a number, tolerating Greek and raw-float formats.
 *
 *  A '.' is a decimal point unless proven otherwise:
 *  - ',' present -> Greek format, dots are thousands ("1.234,56" = 1234.56)
 *  - 2+ dots     -> thousands ("1.234.567" = 1234567)
 *
 *  A single dot with 3 digits after it ("11.735") is ambiguous — Greek thousands or a 3-decimal
 *  float — and is read as a decimal, because these sheets carry raw Excel floats and use ',' for
 *  Greek decimals. Do not add a thousands rule for it without checking real data: a wrong guess
 *  scales values by 1000.
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
