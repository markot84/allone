/** A missing grade is unknown, not excess: rows without ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ stay unclassified (null). */
import { describe, it, expect } from 'vitest';
import { classifyProcurementInventoryRow } from './procurementInventoryClassify';

const row = (over: Partial<Parameters<typeof classifyProcurementInventoryRow>[0]> = {}) =>
  classifyProcurementInventoryRow({ stock: 10, evalGrade: '', needsRefill: false, statusUpper: '', ...over });

describe('classifyProcurementInventoryRow', () => {
  it('grades map to buckets: A → healthy, C → dead, B/D → excess', () => {
    expect(row({ evalGrade: 'A' })).toBe('healthy');
    expect(row({ evalGrade: 'a' })).toBe('healthy');
    expect(row({ evalGrade: 'C' })).toBe('dead');
    expect(row({ evalGrade: 'B' })).toBe('excess');
    expect(row({ evalGrade: 'D' })).toBe('excess');
  });

  it('missing grade → unclassified (null), never excess', () => {
    expect(row({ evalGrade: '' })).toBeNull();
    expect(row({ evalGrade: '   ' })).toBeNull();
  });

  it('hard states win regardless of grade', () => {
    expect(row({ stock: 0 })).toBe('dead');
    expect(row({ statusUpper: 'ΑΝΕΝΕΡΓΟ' })).toBe('dead');
    expect(row({ needsRefill: true })).toBe('low');
    expect(row({ needsRefill: true, evalGrade: 'A' })).toBe('low');
  });
});
