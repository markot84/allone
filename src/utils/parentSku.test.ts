import { describe, it, expect } from 'vitest';
import { resolveParentSku, hasDerivedParentSku } from './parentSku';

describe('resolveParentSku', () => {
  it('prefers the catalog (itemGroupId) when present', () => {
    expect(resolveParentSku('RS10164-48', 'RS10164')).toBe('RS10164');
    expect(hasDerivedParentSku('RS10164-48', 'RS10164')).toBe(true);
  });

  it('ignores itemGroupId equal to the SKU', () => {
    expect(resolveParentSku('243102-1.30mm', '243102-1.30mm')).toBe('243102');
  });

  it('strips string gauge', () => {
    expect(resolveParentSku('243102-1.30mm')).toBe('243102');
    expect(resolveParentSku('241136-113-1.30mm')).toBe('241136-113');
  });

  it('strips grip / size / shoe', () => {
    expect(resolveParentSku('WRT73921-L3')).toBe('WRT73921');
    expect(resolveParentSku('023625-01-BalsamGreen-XXL')).toBe('023625-01-BalsamGreen');
    expect(resolveParentSku('1011C127-004-41.5')).toBe('1011C127-004');
    expect(resolveParentSku('SHIRT-unstrung')).toBe('SHIRT');
  });

  it('does NOT strip unrecognized suffixes (color codes, words)', () => {
    expect(resolveParentSku('095618-01-BLACK')).toBe('095618-01-BLACK');
    expect(resolveParentSku('241136-113')).toBe('241136-113'); // 113 = 3-digit color code, not a size
    expect(resolveParentSku('PROD-EDITION')).toBe('PROD-EDITION');
  });

  it('real-world SKUs', () => {
    expect(resolveParentSku('101479-370-L3')).toBe('101479-370');
    expect(resolveParentSku('101488-370-L2')).toBe('101488-370');
    expect(resolveParentSku('WRT106200-case')).toBe('WRT106200-case');
    expect(resolveParentSku('1041A522-967')).toBe('1041A522-967');
  });

  it('strips multiple variant tokens repeatedly (configurable parent)', () => {
    expect(resolveParentSku('101479-370-L3-UNSTRUNG')).toBe('101479-370');
    expect(resolveParentSku('101488-370-L2-UNSTRUNG')).toBe('101488-370');
    expect(resolveParentSku('023625-01-BalsamGreen-XXL')).toBe('023625-01-BalsamGreen');
    expect(resolveParentSku('152002-113')).toBe('152002-113'); // color code, unchanged
    expect(resolveParentSku('WRT116200')).toBe('WRT116200');
  });

  it('returns the same SKU when there is no parent', () => {
    expect(resolveParentSku('SIMPLE123')).toBe('SIMPLE123');
    expect(hasDerivedParentSku('SIMPLE123')).toBe(false);
    expect(resolveParentSku('')).toBe('');
  });
});
