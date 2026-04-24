import { describe, expect, it } from 'vitest';
import {
  clampDateByBrandHistory,
  filterByBrandHistory,
  getBrandHistoryStartDate,
  getBrandHistoryStartISO,
  passesBrandHistory,
} from './brandHistoryStart';

const safeblock = { historyStartDate: '2025-09-01' };
const noCutoff = { historyStartDate: undefined };

describe('brandHistoryStart', () => {
  it('parsing: επιστρέφει ISO/Date όταν είναι έγκυρο', () => {
    expect(getBrandHistoryStartISO(safeblock)).toBe('2025-09-01');
    expect(getBrandHistoryStartDate(safeblock)?.toISOString()).toBe('2025-09-01T00:00:00.000Z');
    expect(getBrandHistoryStartISO({ historyStartDate: 'garbage' })).toBeNull();
    expect(getBrandHistoryStartISO(noCutoff)).toBeNull();
  });

  it('clamp: ανεβάζει παλαιότερες ημερομηνίες στο cutoff', () => {
    expect(clampDateByBrandHistory('2025-01-01', safeblock)).toBe('2025-09-01');
    expect(clampDateByBrandHistory('2025-09-01', safeblock)).toBe('2025-09-01');
    expect(clampDateByBrandHistory('2025-09-15', safeblock)).toBe('2025-09-15');
    expect(clampDateByBrandHistory(null, safeblock)).toBe('2025-09-01');
    expect(clampDateByBrandHistory('2025-01-01', noCutoff)).toBe('2025-01-01');
    expect(clampDateByBrandHistory(null, noCutoff)).toBeNull();
  });

  it('passes: σωστό true/false για διάφορες πηγές ημερομηνίας', () => {
    expect(passesBrandHistory('2025-08-31', safeblock)).toBe(false);
    expect(passesBrandHistory('2025-09-01', safeblock)).toBe(true);
    expect(passesBrandHistory(new Date('2025-09-15'), safeblock)).toBe(true);
    expect(passesBrandHistory(new Date('2024-01-01'), safeblock)).toBe(false);
    expect(passesBrandHistory('2025-01-01T12:00:00Z', safeblock)).toBe(false);
    expect(passesBrandHistory(null, safeblock)).toBe(false);
    expect(passesBrandHistory(null, noCutoff)).toBe(true); // χωρίς cutoff
  });

  it('filter: αφαιρεί προ-cutoff records, κρατάει >= cutoff', () => {
    const orders = [
      { id: 'o1', createdAt: '2025-08-15' },
      { id: 'o2', createdAt: '2025-09-01' },
      { id: 'o3', createdAt: '2025-12-31' },
    ];
    const out = filterByBrandHistory(orders, (o) => o.createdAt, safeblock);
    expect(out.map((o) => o.id)).toEqual(['o2', 'o3']);
    // χωρίς cutoff → no-op
    expect(filterByBrandHistory(orders, (o) => o.createdAt, noCutoff)).toEqual(orders);
  });
});
