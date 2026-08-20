/** Sum of the "real 12-month turnover" column in the Costing (Procurement) sheet. */

import { parseNum } from './procurementNum';

function isNumericColName(k: string): boolean {
  return k.trim() !== '' && !isNaN(Number(k.trim()));
}

/** Metadata keys added by Firestore / the import pipeline — excluded from positional lookup. */
const METADATA_KEYS = new Set(['id', 'brandId', 'rowIndex', 'sheetType', 'createdAt', 'updatedAt']);

// In Firestore the header is stored as 'ΤΖΙΡΟΣ' (the exact Excel column header)
const COL_ALIASES: Record<string, string[]> = {
  'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ': [
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12 ΜΗΝΟΥ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ (12ΜΗΝΟ)',
    'ΠΡΑΓΜΑΤΙΚΟΣ_ΤΖΙΡΟΣ_12ΜΗΝΟΥ',
    'ΠΡΑΓΜ. ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    '12ΜΗΝΟ ΤΖΙΡΟΣ',
    '12Μ ΤΖΙΡΟΣ',
    'ΤΖΙΡΟΣ',
  ],
};

/** Matches columns by normalised (whitespace/newline/underscore) comparison:
 *  pass 1 exact match, pass 2 substring fallback for short/partial aliases. */
function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (rows.length === 0) return keyword;
  const keys = Object.keys(rows[0]).filter((k) => !isNumericColName(k));
  const normStr = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
  const aliases = COL_ALIASES[keyword.toUpperCase()] ?? [keyword];
  // Pass 1: exact normalised match
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find((k) => normStr(k) === aUp);
    if (found) return found;
  }
  // Pass 2: substring/includes fallback
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find((k) => normStr(k).includes(aUp));
    if (found) return found;
  }
  return keyword;
}

/** Canonical costing column order (matches PROCUREMENT_TEMPLATE.xlsx sheet "ΚΟΣΤΟΛΟΓΗΣΗ"). */
const COSTING_CANONICAL_ORDER = [
  'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ',
  'ΔΕΥΤΕΡΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΑΝΑΛΥΣΗ ΚΟΣΤΟΥΣ ΑΝΑ ΔΡΑΣΤΗΡΙΟΤΗΤΑ',
  'ΜΕΣΟ ΚΟΣΤΟΣ ΚΑΤΗΓΟΡΙΑΣ', 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
];

/** Sum of the "real 12-month turnover" column (column H) in the Costing sheet; falls back to
 *  positional lookup (index 7) sorted by canonical template order when named matching fails. */
export function getCostingReal12mTurnover(rows: Record<string, unknown>[]): { sum: number; hasColumn: boolean } {
  if (rows.length === 0) return { sum: 0, hasColumn: false };
  let col = findCol(rows, 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ');
  const first = rows[0];
  let hasColumn = col in first && first[col] !== undefined;

  // Positional fallback: column H = index 7 of data columns (metadata stripped), sorted by
  // canonical costing order so it resolves regardless of Firestore key order/format.
  if (!hasColumn) {
    const normK = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
    const canonicalNorm = COSTING_CANONICAL_ORDER.map(normK);
    const dataKeys = Object.keys(first)
      .filter((k) => !METADATA_KEYS.has(k) && !isNumericColName(k))
      .sort((a, b) => {
        const ia = canonicalNorm.indexOf(normK(a));
        const ib = canonicalNorm.indexOf(normK(b));
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      });
    if (dataKeys.length > 7) {
      col = dataKeys[7];
      hasColumn = col in first;
    }
  }

  const kodikosKey = Object.keys(rows[0]).find(k => k.toUpperCase().replace(/[\s_]+/g, '') === 'ΚΩΔΙΚΟΣ') ?? 'ΚΩΔΙΚΟΣ';
  const productRows = rows.filter(r => {
    const v = r[kodikosKey];
    return v != null && String(v).trim() !== '';
  });
  const sum = productRows.reduce((s, r) => s + parseNum(r[col]), 0);
  return { sum, hasColumn };
}
