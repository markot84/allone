import { describe, expect, it } from 'vitest';
import { formatIsoRangeLabelGr, shiftIsoDateByYears, shiftPeriodByYears } from './periodComparison';

describe('shiftIsoDateByYears', () => {
  it('shifts a plain day back one year without a UTC off-by-one', () => {
    expect(shiftIsoDateByYears('2026-09-04', -1)).toBe('2025-09-04');
    expect(shiftIsoDateByYears('2026-01-01', -1)).toBe('2025-01-01');
  });

  it('shifts forward as well', () => {
    expect(shiftIsoDateByYears('2025-06-15', 1)).toBe('2026-06-15');
  });

  it('clamps 29 February to 28 February on a non-leap target year', () => {
    expect(shiftIsoDateByYears('2024-02-29', -1)).toBe('2023-02-28');
    expect(shiftIsoDateByYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('returns malformed input unchanged', () => {
    expect(shiftIsoDateByYears('', -1)).toBe('');
    expect(shiftIsoDateByYears('2026-13', -1)).toBe('2026-13');
    expect(shiftIsoDateByYears('not-a-date', -1)).toBe('not-a-date');
  });
});

describe('shiftPeriodByYears', () => {
  it('shifts both ends of the range', () => {
    expect(shiftPeriodByYears({ fromDate: '2026-09-01', toDate: '2026-09-03' }, -1)).toEqual({
      fromDate: '2025-09-01',
      toDate: '2025-09-03',
    });
  });
});

describe('formatIsoRangeLabelGr', () => {
  it('renders a range with both ends', () => {
    const label = formatIsoRangeLabelGr('2025-01-01', '2025-09-03');
    expect(label).toContain('2025');
    expect(label).toContain('–');
  });

  it('renders a single day once', () => {
    const label = formatIsoRangeLabelGr('2025-09-03', '2025-09-03');
    expect(label).not.toContain('–');
  });

  it('passes malformed input through', () => {
    expect(formatIsoRangeLabelGr('x', 'y')).toBe('x – y');
  });
});
