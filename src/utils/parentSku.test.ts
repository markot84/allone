import { describe, it, expect } from 'vitest';
import { resolveParentSku, hasDerivedParentSku } from './parentSku';

describe('resolveParentSku', () => {
  it('προτιμά τον κατάλογο (itemGroupId) όταν υπάρχει', () => {
    expect(resolveParentSku('RS10164-48', 'RS10164')).toBe('RS10164');
    expect(hasDerivedParentSku('RS10164-48', 'RS10164')).toBe(true);
  });

  it('αγνοεί itemGroupId ίδιο με το SKU', () => {
    expect(resolveParentSku('243102-1.30mm', '243102-1.30mm')).toBe('243102');
  });

  it('κόβει gauge χορδής (e-tennis)', () => {
    expect(resolveParentSku('243102-1.30mm')).toBe('243102');
    expect(resolveParentSku('241136-113-1.30mm')).toBe('241136-113');
  });

  it('κόβει grip / μέγεθος / παπούτσι', () => {
    expect(resolveParentSku('WRT73921-L3')).toBe('WRT73921');
    expect(resolveParentSku('023625-01-BalsamGreen-XXL')).toBe('023625-01-BalsamGreen');
    expect(resolveParentSku('1011C127-004-41.5')).toBe('1011C127-004');
    expect(resolveParentSku('SHIRT-unstrung')).toBe('SHIRT');
  });

  it('ΔΕΝ κόβει μη αναγνωρισμένα suffixes (color codes, λέξεις)', () => {
    expect(resolveParentSku('095618-01-BLACK')).toBe('095618-01-BLACK');
    expect(resolveParentSku('241136-113')).toBe('241136-113'); // 113 = 3ψήφιος color code, όχι μέγεθος
    expect(resolveParentSku('PROD-EDITION')).toBe('PROD-EDITION');
  });

  it('επιστρέφει το ίδιο SKU όταν δεν υπάρχει parent', () => {
    expect(resolveParentSku('SIMPLE123')).toBe('SIMPLE123');
    expect(hasDerivedParentSku('SIMPLE123')).toBe(false);
    expect(resolveParentSku('')).toBe('');
  });
});
