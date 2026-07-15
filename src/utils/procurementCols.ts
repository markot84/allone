/** Column matching for procurement sheets (Greek XLSX headers vary per export). */

import { logger } from './logger';

/** Returns true if the column name is a numeric value (e.g. "4065528.538423248") */
export function isNumericColName(k: string): boolean {
  return k.trim() !== '' && !isNaN(Number(k.trim()));
}

/** Keyword → alternative search terms, checked IN ORDER.
 *
 *  Order matters. findCol tries every alias for an exact match before falling back to substring
 *  matching, so the most specific real header must come first: where several columns contain the
 *  same word, the substring pass resolves to whichever key comes first, and Firestore field order
 *  is undefined. */
export const COL_ALIASES: Record<string, string[]> = {
  'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ': ['ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ', 'ΔΙΑΘΕΣΙΜΟ', 'ΥΠΟΛΟΙΠΟ', 'ΑΠΟΘΕΜΑ', 'STOCK', 'AVAILABLE'],
  'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ':  ['ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΠΡΩΤΟΓΕΝΕΣ', 'ΚΟΣΤΟΣ ΑΓΟΡΑΣ', 'ΚΟΣΤΟΣ', 'ΤΙΜΗ ΑΓΟΡΑΣ', 'ΑΓΟΡΑ', 'COST'],
  // The inventory sheet also has «ΠΟΣΟΤΗΤΑ ΑΜΕΣΗΣ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ» and «ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ»,
  // so the quantity column must be matched exactly.
  'ΑΝΑΤΡΟΦΟΔΟΣΙΑ':       ['ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ', 'ΑΝΑΤΡΟΦΟΔΟΤΗΣΗ', 'REORDER', 'REFILL'],
  'ΒΑΘΜΟΛΟΓΙΑ':          ['ΒΑΘΜΟΛΟΓΙΑ', 'ΒΑΘΜΟΣ', 'SCORE', 'RATING'],
  // The item sheet has «ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ» + «ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ»; the customer sheet has a
  // plain «ΑΞΙΟΛΟΓΗΣΗ» and resolves on the second alias.
  'ΑΞΙΟΛΟΓΗΣΗ':          ['ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'ΑΞΙΟΛΟΓΗΣΗ', 'EVALUATION', 'RATING'],
  'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ':   ['ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΕΩΣ', 'ΜΕΣΗ ΤΙΜΗ', 'ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΠΩΛΗΣΗΣ', 'PRICE'],
  'ΤΙΜΗ ΠΩΛΗΣΗΣ':        ['ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΠΩΛΗΣΗΣ', 'ΤΙΜΗ', 'PRICE', 'ΠΩΛΗΣΗ'],
  'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ':     ['ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ', 'ΣΥΝΟΛΙΚΟ', 'TOTAL COST'],
  'ΔΕΥΤΕΡΟΓΕΝΕΣ':        ['ΔΕΥΤΕΡΟΓΕΝΕΣ', 'ΔΕΥΤΕΡ'],
  'ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ':['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ', 'ΤΖΙΡΟΣ'],
  'ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ': ['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ', 'ΚΕΡΔΟΣ'],
  // Costing sheet · column H — not the fiscal year (what-if)
  // Stored in Firestore as 'ΤΖΙΡΟΣ' (the exact header from the Excel template)
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
  'ΤΖΙΡΟΣ':              ['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ', 'ΤΖΙΡΟΣ', 'TURNOVER', 'ΕΣΟΔΑ', 'REVENUE'],
  'ΚΕΡΔΟΣ':              ['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ', 'ΚΕΡΔΟΣ', 'PROFIT', 'ΚΕΡΔΗ'],
  'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ': ['ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΑΞΙΑ ΑΝΑΤΡΟΦ'],
  'ΠΕΡΙΓΡΑΦΗ':           ['ΠΕΡΙΓΡΑΦΗ', 'ΟΝΟΜΑ', 'DESCRIPTION', 'NAME'],
  // «ΚΩΔΙΚΟΣ MASTER»/«MASTER» listed after «ΚΩΔΙΚΟΣ» so on detail sheets (which have both) the
  // exact «ΚΩΔΙΚΟΣ» variant wins via pass-1.
  'ΚΩΔΙΚΟΣ':             ['ΚΩΔΙΚΟΣ', 'ΚΩΔΙΚΟΣ MASTER', 'MASTER', 'SKU', 'CODE', 'BARCODE'],
};

/** Value columns of the statistics sheet (everything that isn't metadata or the metric label).
 *
 *  Unlike every other sheet, numeric-looking column names must be KEPT: sheets imported before the
 *  headerless-stat fix had their first data row eaten as the header, so the value column is named
 *  after that row's value (e.g. "929"). Filtering it leaves every stat row with no value. */
export function statValueCols(
  rows: Record<string, unknown>[],
  metricCol: string,
  excludedKeys: Set<string>,
): string[] {
  if (rows.length === 0) return [];
  const keys = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  return [...keys].filter(k => !excludedKeys.has(k) && k !== metricCol);
}

/** Rebuilds the stat row lost to the headerless-import bug, whose metric name and value survive as
 *  the two column names («ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ» = 929).
 *
 *  Returns null unless the value column is numeric-named — correctly imported sheets have nothing
 *  to recover, so this goes inert once the data is re-imported. */
export function recoverEatenStatRow(
  metricCol: string,
  valueCols: string[],
): Record<string, string> | null {
  if (valueCols.length !== 1) return null;
  const valueCol = valueCols[0];
  if (!isNumericColName(valueCol) || !metricCol || isNumericColName(metricCol)) return null;
  return { [metricCol]: metricCol, [valueCol]: valueCol };
}

/** Finds a non-numeric column key matching the keyword (with aliases), normalising whitespace/
 *  newlines/underscores: pass 1 exact normalised match, pass 2 substring fallback. */
export function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (rows.length === 0) return keyword;
  const keys = Object.keys(rows[0]).filter(k => !isNumericColName(k));
  const normStr = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
  const aliases = COL_ALIASES[keyword.toUpperCase()] ?? [keyword];
  // Pass 1: exact normalised match
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find(k => normStr(k) === aUp);
    if (found) return found;
  }
  // Pass 2: substring/includes fallback
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find(k => normStr(k).includes(aUp));
    if (found) return found;
  }
  if (import.meta.env.DEV) {
    logger.warn('[Procurement] Column not found:', { keyword, available: keys });
  }
  return keyword;
}
