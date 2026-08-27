import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { ymd } = __test;

describe('ymd (date filter parsing)', () => {
  it('parses ISO timestamps and plain dates as calendar dates, not Excel serials', () => {
    expect(ymd('2026-08-27T03:17:25.121Z')).toBe('2026-08-27');
    expect(ymd('2025-06-05')).toBe('2025-06-05');
  });

  it('still converts whole-number Excel serials', () => {
    expect(ymd('44240')).toBe('2021-02-13');
  });

  it('rejects garbage', () => {
    expect(ymd('')).toBeNull();
    expect(ymd('not-a-date')).toBeNull();
  });
});
