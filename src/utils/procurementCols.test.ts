import { describe, it, expect } from 'vitest';
import { findCol, isNumericColName, statValueCols, recoverEatenStatRow } from './procurementCols';

/** Column sets below are the real safeblock headers as stored in Firestore (PER-186). */
const INVENTORY_ROW = {
  'STATUS ΚΩΔΙΚΟΥ': '', MASTER: '', 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ': '', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ Μ.Μ.': '',
  'ΟΜΑΔΑ ΡΟΗΣ': '', 'ΠΟΣΟΤΗΤΑ ΑΜΕΣΗΣ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ': '', 'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ': '',
  'ΔΥΝΑΜΙΚΟ ΥΠΟΛΟΙΠΟ': '', ΠΡΟΜΗΘΕΥΤΗΣ: '', ΠΕΡΙΓΡΑΦΗ: '', 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ': '',
  'ΠΟΣΟΤΗΤΑ ΠΡΟΣ ΠΡΟΩΘΗΣΗ': '', 'ΣΥΝΟΛΙΚΕΣ ΠΩΛΗΣΕΙΣ': '', 'ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ': '',
  'ΗΜΕΡΕΣ ΕΠΑΡΚΕΙΑΣ ΔΙΑΘΕΣΙΜΟΥ ΑΠΟΘΕΜΑΤΟΣ': '', ΚΑΤΗΓΟΡΙΑ: '',
};

describe('findCol', () => {
  it('resolves the plain inventory columns', () => {
    expect(findCol([INVENTORY_ROW], 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ')).toBe('ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
    expect(findCol([INVENTORY_ROW], 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ')).toBe('ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ Μ.Μ.');
    expect(findCol([INVENTORY_ROW], 'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ')).toBe('ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ');
  });

  /** Three inventory columns contain «ΑΝΑΤΡΟΦΟΔΟΣΙΑ». The substring pass picked whichever key came
   *  first — «ΠΟΣΟΤΗΤΑ ΑΜΕΣΗΣ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ» — so the refill card read 5 SKU / €1.937 instead of
   *  75 SKU / €16.806. */
  it('picks the refill QUANTITY column, not ΑΜΕΣΗΣ or ΑΞΙΑ', () => {
    expect(findCol([INVENTORY_ROW], 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ')).toBe('ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ');
  });

  it('is not sensitive to column order (Firestore field order is undefined)', () => {
    const reversed = Object.fromEntries(Object.entries(INVENTORY_ROW).reverse());
    expect(findCol([reversed], 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ')).toBe('ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ');
    expect(findCol([reversed], 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ')).toBe('ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
  });

  /** The item sheet has «ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ» + «ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ»; the customer sheet has a
   *  plain «ΑΞΙΟΛΟΓΗΣΗ». The same keyword must resolve correctly on both. */
  it('resolves ΑΞΙΟΛΟΓΗΣΗ per sheet', () => {
    const item = [{ ΚΩΔΙΚΟΣ: '', 'ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ': '', 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ': '' }];
    expect(findCol(item, 'ΑΞΙΟΛΟΓΗΣΗ')).toBe('ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ');

    const customer = [{ 'ΚΩΔΙΚΟΣ ΠΕΛΑΤΗ': '', 'ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ': '', ΒΑΘΜΟΛΟΓΙΑ: '', ΑΞΙΟΛΟΓΗΣΗ: '' }];
    expect(findCol(customer, 'ΑΞΙΟΛΟΓΗΣΗ')).toBe('ΑΞΙΟΛΟΓΗΣΗ');
  });

  it('prefers exact ΚΩΔΙΚΟΣ over MASTER when a sheet has both', () => {
    expect(findCol([{ ΚΩΔΙΚΟΣ: '', MASTER: '' }], 'ΚΩΔΙΚΟΣ')).toBe('ΚΩΔΙΚΟΣ');
  });

  it('normalises whitespace/newlines/underscores', () => {
    expect(findCol([{ 'ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ': '' }], 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ')).toBe('ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ');
    expect(findCol([{ 'ΔΙΑΘΕΣΙΜΟ\n ΥΠΟΛΟΙΠΟ': '' }], 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ')).toBe('ΔΙΑΘΕΣΙΜΟ\n ΥΠΟΛΟΙΠΟ');
  });

  it('falls back to the keyword when nothing matches', () => {
    expect(findCol([{ FOO: '' }], 'ΒΑΘΜΟΛΟΓΙΑ')).toBe('ΒΑΘΜΟΛΟΓΙΑ');
    expect(findCol([], 'ΒΑΘΜΟΛΟΓΙΑ')).toBe('ΒΑΘΜΟΛΟΓΙΑ');
  });

  it('ignores numeric column names', () => {
    expect(isNumericColName('929')).toBe(true);
    expect(isNumericColName('ΚΩΔΙΚΟΣ')).toBe(false);
  });
});

/** The real safeblock statistics shape: a headerless «metric | value» sheet whose first data row
 *  («ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ | 929») the importer ate as the header — so the value column is
 *  named "929" and every row's value hid behind the numeric-column filter (PER-186). */
const STAT_ROWS = [
  { '929': '307159.52999999956', 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ': 'ΣΥΝΟΛΙΚΗ ΑΞΙΑ ΑΠΟΘΕΜΑΤΟΣ', brandId: 'safeblock', sheetType: 'statistics', rowIndex: 0 },
  { '929': '55400.68', 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ': 'ΑΞΙΑ ΑΠΑΞΙΩΜΕΝΩΝ ΚΩΔΙΚΩΝ', brandId: 'safeblock', sheetType: 'statistics', rowIndex: 10 },
  { '929': '436', 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ': 'ΠΛΗΘΟΣ ΚΩΔΙΚΩΝ Α', brandId: 'safeblock', sheetType: 'statistics', rowIndex: 12 },
];
const EXCLUDED = new Set(['id', 'brandId', 'rowIndex', 'sheetType', 'createdAt', 'updatedAt']);

describe('statValueCols', () => {
  it('keeps the numeric-named value column (the empty-tab bug)', () => {
    expect(statValueCols(STAT_ROWS, 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ', EXCLUDED)).toEqual(['929']);
  });

  it('excludes metadata and the metric column itself', () => {
    const cols = statValueCols(STAT_ROWS, 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ', EXCLUDED);
    expect(cols).not.toContain('brandId');
    expect(cols).not.toContain('ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ');
  });

  it('unions keys across rows (Firestore omits empty fields per row)', () => {
    const rows = [{ m: 'a', X: '1' }, { m: 'b', Y: '2' }];
    expect(statValueCols(rows, 'm', EXCLUDED).sort()).toEqual(['X', 'Y']);
  });

  it('works on a correctly-imported sheet too', () => {
    const rows = [{ ΔΕΙΚΤΗΣ: 'ΣΥΝΟΛΙΚΗ ΑΞΙΑ', ΤΙΜΗ: '307159.53', brandId: 'b' }];
    expect(statValueCols(rows, 'ΔΕΙΚΤΗΣ', EXCLUDED)).toEqual(['ΤΙΜΗ']);
  });
});

describe('recoverEatenStatRow', () => {
  it('rebuilds the eaten row from the header pair', () => {
    expect(recoverEatenStatRow('ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ', ['929'])).toEqual({
      'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ': 'ΠΛΗΘΟΣ ΕΝΕΡΓΟΥ ΚΩΔΙΚΟΛΟΓΙΟΥ',
      '929': '929',
    });
  });

  it('recovers nothing from a correctly-imported sheet', () => {
    expect(recoverEatenStatRow('ΔΕΙΚΤΗΣ', ['ΤΙΜΗ'])).toBeNull();
  });

  it('recovers nothing when the shape is not a single metric/value pair', () => {
    expect(recoverEatenStatRow('ΔΕΙΚΤΗΣ', ['929', '930'])).toBeNull();
    expect(recoverEatenStatRow('', ['929'])).toBeNull();
    expect(recoverEatenStatRow('123', ['929'])).toBeNull();
  });
});
