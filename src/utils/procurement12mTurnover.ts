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

function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (rows.length === 0) return keyword;
  const keys = Object.keys(rows[0]).filter((k) => !isNumericColName(k));
  const aliases = COL_ALIASES[keyword.toUpperCase()] ?? [keyword];
  for (const alias of aliases) {
    const aUp = alias.toUpperCase();
    const found = keys.find((k) => k.toUpperCase().includes(aUp));
    if (found) return found;
  }
  return keyword;
}

export function getCostingReal12mTurnover(rows: Record<string, unknown>[]): { sum: number; hasColumn: boolean } {
  if (rows.length === 0) return { sum: 0, hasColumn: false };
  const col = findCol(rows, 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ');
  const first = rows[0];
  const hasColumn = col in first && first[col] !== undefined;
  const sum = rows.reduce((s, r) => s + parseNum(r[col]), 0);
  return { sum, hasColumn };
}
