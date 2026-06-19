/**
 * Spreadsheet / clipboard formula-injection guard (CWE-1236 / SEC-M5 / PER-71).
 *
 * Exported CSV / XLSX cells — and tabular text copied to the clipboard — can carry
 * attacker-controlled strings (product names, descriptions, customer/HR free text). If a
 * cell begins with `=`, `+`, `-`, `@`, or a leading tab/CR, Excel / Sheets / LibreOffice
 * treat it as a formula and execute it on open (or on paste). Prefixing a single apostrophe
 * forces the cell to be read as text; spreadsheet apps hide the apostrophe on display.
 *
 * Numbers, booleans, Dates, null/undefined and plain-number strings pass through untouched,
 * so numeric columns stay numeric and sortable.
 */

const DANGEROUS_LEAD = /^[=+\-@]/;
const CONTROL_LEAD = /^[\t\r]/;
// A value that is *just* a number (optional sign, optional single decimal separator) is safe
// even though it may start with + or - ; keep it numeric rather than turning it into text.
const PLAIN_NUMBER = /^[+-]?\d{1,15}(?:[.,]\d+)?$/;

/**
 * Returns the value unchanged unless it is a string that could be interpreted as a formula,
 * in which case a single leading apostrophe is prepended. Non-strings are returned as-is.
 */
export function sanitizeSpreadsheetCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  // Already neutralized — never double-prefix.
  if (value.charCodeAt(0) === 0x27 /* ' */) return value;
  const lead = value.replace(/^\s+/, '');
  const dangerous = CONTROL_LEAD.test(value) || DANGEROUS_LEAD.test(lead);
  if (dangerous && !PLAIN_NUMBER.test(value.trim())) return `'${value}`;
  return value;
}

/** Maps {@link sanitizeSpreadsheetCell} over every cell of a row (for XLSX aoa / json rows). */
export function sanitizeRow(row: readonly unknown[]): unknown[] {
  return row.map(sanitizeSpreadsheetCell);
}

/**
 * Guards multi-line text copied to the clipboard: each line is treated as a future
 * spreadsheet cell, so pasting the copied text into Excel/Sheets cannot smuggle a formula.
 */
export function sanitizeClipboardText(text: string): string {
  return text
    .split('\n')
    .map((line) => sanitizeSpreadsheetCell(line))
    .join('\n');
}
