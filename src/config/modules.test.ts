import { describe, expect, it } from 'vitest';
import {
  B2B_EDITION_ENABLED,
  effectiveBrandTypeForModules,
  isSectionHidden,
  resolveEnabledModules,
} from './modules';
import type { ModuleId } from '../types';

/** The six modules that exist only for the retired B2B edition. */
const B2B_ONLY: ModuleId[] = ['sales', 'accounts', 'markets', 'hr', 'offers', 'territories'];

describe('B2B edition switch', () => {
  it('is off — the product is developed for e-shop owners only', () => {
    expect(B2B_EDITION_ENABLED).toBe(false);
  });

  it('renders a brand still typed B2B in Firestore as B2C', () => {
    expect(effectiveBrandTypeForModules({ type: 'B2B' })).toBe('B2C');
    expect(effectiveBrandTypeForModules(null)).toBe('B2C');
  });

  it('disables every B2B-only module even when the brand overrides say otherwise', () => {
    // An old Firestore override is exactly what a retired edition must not honour.
    const overrides = Object.fromEntries(B2B_ONLY.map((id) => [id, true]));
    const modules = resolveEnabledModules({
      type: 'B2B',
      enabledModules: overrides,
    } as Parameters<typeof resolveEnabledModules>[0]);
    for (const id of B2B_ONLY) expect(modules[id], id).toBe(false);
  });

  it('leaves the e-shop modules alone', () => {
    const modules = resolveEnabledModules({ type: 'B2C' } as Parameters<typeof resolveEnabledModules>[0]);
    expect(modules.dashboard).toBe(true);
    expect(modules.ecommerce).toBe(true);
    expect(modules.rfm).toBe(true);
    expect(modules.products).toBe(true);
  });

  it('keeps HIDDEN_SECTIONS outranking the edition switch', () => {
    // `channels` is an e-shop module upstream enables; this build switches it off in
    // HIDDEN_SECTIONS, and that has to win — the two switches are independent.
    const modules = resolveEnabledModules({ type: 'B2C' } as Parameters<typeof resolveEnabledModules>[0]);
    expect(isSectionHidden('channels')).toBe(true);
    expect(modules.channels).toBe(false);
  });
});
