/**
 * Άθροισμα στήλης «Πραγματικός τζίρος 12μήνου» στο φύλλο Κοστολόγηση (Procurement).
 * Αντιγραφή λογικής από ProcurementPage ώστε το Dashboard/Οικονομικά να μην εξαρτώνται από το component.
 */

function parseNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  const dots = (s.match(/\./g) ?? []).length;
  if (dots > 1) {
    const n = parseFloat(s.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  if (dots === 1) {
    const afterDot = s.split('.')[1] ?? '';
    if (afterDot.length === 3) {
      const n = parseFloat(s.replace(/\./g, ''));
      return isNaN(n) ? 0 : n;
    }
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isNumericColName(k: string): boolean {
  return k.trim() !== '' && !isNaN(Number(k.trim()));
}

/** Metadata keys added by Firestore / the import pipeline — excluded from positional lookup. */
const METADATA_KEYS = new Set(['id', 'brandId', 'rowIndex', 'sheetType', 'createdAt', 'updatedAt']);

const COL_ALIASES: Record<string, string[]> = {
  'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ': [
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ (12ΜΗΝΟ)',
    'ΠΡΑΓΜ. ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    '12ΜΗΝΟ ΤΖΙΡΟΣ',
    '12Μ ΤΖΙΡΟΣ',
  ],
};

/** Normalises whitespace, newlines and underscores before comparing — handles Excel headers
 *  that contain line-breaks, extra spaces, or underscore-separated Firestore keys. */
function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (rows.length === 0) return keyword;
  const keys = Object.keys(rows[0]).filter((k) => !isNumericColName(k));
  const normStr = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
  const aliases = COL_ALIASES[keyword.toUpperCase()] ?? [keyword];
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

/** Άθροισμα στήλης «Πραγματικός τζίρος 12μήνου» στο φύλλο Κοστολόγηση (στήλη Η).
 *  Falls back to positional lookup (column index 7 = H) when named matching fails.
 *  The positional fallback sorts dataKeys by canonical costing template order so that
 *  alphabetical / underscore-keyed Firestore docs still resolve to the correct column. */
export function getCostingReal12mTurnover(rows: Record<string, unknown>[]): { sum: number; hasColumn: boolean } {
  if (rows.length === 0) return { sum: 0, hasColumn: false };
  let col = findCol(rows, 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ');
  const first = rows[0];
  let hasColumn = col in first && first[col] !== undefined;

  // Positional fallback: column H = index 7 of data columns (after stripping metadata keys).
  // Sort by canonical costing column order so the correct column is at position 7
  // regardless of Firestore key ordering or underscore vs. space key format.
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

  const sum = rows.reduce((s, r) => s + parseNum(r[col]), 0);
  return { sum, hasColumn };
}
