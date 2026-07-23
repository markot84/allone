/** Parent SKU resolution: declared catalog relations ONLY (Magento itemGroupId). The suffix-strip
 * heuristic is gone — its token whitelist was tennis-specific and invented groups PI doesn't have;
 * a SKU without a declared parent is its own group, matching Product Intelligence semantics. */

export function resolveParentSku(sku: string | null | undefined, itemGroupId?: string | null): string {
  const normalized = String(sku || '').trim();
  if (!normalized) return '';
  const group = String(itemGroupId || '').trim();
  return group && group !== normalized ? group : normalized;
}

export function hasDerivedParentSku(sku: string | null | undefined, itemGroupId?: string | null): boolean {
  const normalized = String(sku || '').trim();
  if (!normalized) return false;
  return resolveParentSku(normalized, itemGroupId) !== normalized;
}
