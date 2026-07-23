import { describe, it, expect } from 'vitest';
import { resolveParentSku, hasDerivedParentSku } from './parentSku';

describe('resolveParentSku (declared relations only)', () => {
  it('uses the catalog itemGroupId when present', () => {
    expect(resolveParentSku('RS10164-48', 'RS10164')).toBe('RS10164');
    expect(hasDerivedParentSku('RS10164-48', 'RS10164')).toBe(true);
  });

  it('ignores itemGroupId equal to the SKU', () => {
    expect(resolveParentSku('243102-1.30mm', '243102-1.30mm')).toBe('243102-1.30mm');
    expect(hasDerivedParentSku('243102-1.30mm', '243102-1.30mm')).toBe(false);
  });

  it('never invents a parent from the SKU shape', () => {
    expect(resolveParentSku('243102-1.30mm')).toBe('243102-1.30mm');
    expect(resolveParentSku('WRT73921-L3')).toBe('WRT73921-L3');
    expect(resolveParentSku('1011C127-004-41.5')).toBe('1011C127-004-41.5');
    expect(hasDerivedParentSku('WRT73921-L3')).toBe(false);
  });

  it('empty input', () => {
    expect(resolveParentSku('')).toBe('');
    expect(hasDerivedParentSku('')).toBe(false);
  });
});
