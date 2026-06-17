/** Brand-agnostic "parent SKU" resolution for Top Products grouping: use catalog
 * `itemGroupId` when present, else strip only a recognized trailing size/gauge token. */

/** Recognized variant tokens allowed to be stripped from the end of a SKU. */
const VARIANT_SUFFIX_PATTERNS: readonly RegExp[] = [
  /^\d+(?:[.,]\d+)?\s*mm$/i, // string gauge: 1.30mm, 1,25mm
  /^L[0-5]$/i, // grip size: L0..L5
  /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/i, // clothing sizes
  /^\d{2}(?:[.,]\d)?$/, // shoe size: 38, 41.5 (2 digits; 3-digit color codes e.g. -113 are NOT stripped)
  /^(?:un)?strung$/i, // racquet: strung / unstrung
];

function isVariantSuffixToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return VARIANT_SUFFIX_PATTERNS.some((re) => re.test(t));
}

/** Returns the parent SKU, preferring catalog `itemGroupId` over token stripping. */
export function resolveParentSku(sku: string | null | undefined, itemGroupId?: string | null): string {
  const normalized = String(sku || '').trim();
  if (!normalized) return '';

  // 1) Reliable parent from catalog.
  const group = String(itemGroupId || '').trim();
  if (group && group !== normalized) return group;

  // 2) Conservative heuristic: repeatedly strip recognized trailing size/gauge tokens,
  //    stopping at the first unrecognized token or when one segment remains (never empty).
  let base = normalized;
  for (;;) {
    const lastDash = base.lastIndexOf('-');
    if (lastDash <= 0 || lastDash >= base.length - 1) break;
    const tail = base.slice(lastDash + 1);
    if (!isVariantSuffixToken(tail)) break;
    base = base.slice(0, lastDash);
  }

  return base;
}

export function hasDerivedParentSku(sku: string | null | undefined, itemGroupId?: string | null): boolean {
  const normalized = String(sku || '').trim();
  if (!normalized) return false;
  return resolveParentSku(normalized, itemGroupId) !== normalized;
}
