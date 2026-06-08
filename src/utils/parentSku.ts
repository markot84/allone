/**
 * Agnostic επίλυση «parent SKU» για το Top Products grouping.
 *
 * Δύο πλατφόρμες/περιπτώσεις χωρίς μάντεμα ανά brand:
 *  1) Όταν υπάρχει συγχρονισμένος κατάλογος (π.χ. Magento configurable links),
 *     ο πραγματικός parent έρχεται από το `itemGroupId` — αξιόπιστο, χωρίς ευρετικές.
 *  2) Όταν ΔΕΝ υπάρχει κατάλογος (π.χ. e-tennis: Magento product catalog 401, ERP flat),
 *     κόβουμε ΜΟΝΟ ένα αναγνωρισμένο trailing size/gauge token (π.χ. `-1.30mm`, `-L3`,
 *     `-XL`, `-42.5`, `-unstrung`). ΔΕΝ κόβουμε αυθαίρετες παύλες — πολλά SKUs έχουν
 *     νόμιμο suffix με `-`.
 *
 * Χρησιμοποιείται μόνο στο opt-in view «Μόνο Parent SKUs»· το «Όλα τα SKUs» μένει ως έχει.
 */

/** Αναγνωρισμένα variant tokens που επιτρέπεται να αφαιρεθούν από το τέλος ενός SKU. */
const VARIANT_SUFFIX_PATTERNS: readonly RegExp[] = [
  /^\d+(?:[.,]\d+)?\s*mm$/i, // gauge χορδής: 1.30mm, 1,25mm
  /^L[0-5]$/i, // tennis grip size: L0..L5
  /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/i, // μεγέθη ρούχων
  /^\d{2}(?:[.,]\d)?$/, // μέγεθος παπουτσιού: 38, 41.5 (2 ψηφία· τα 3ψήφια color codes π.χ. -113 ΔΕΝ κόβονται)
  /^(?:un)?strung$/i, // ρακέτα: strung / unstrung
];

function isVariantSuffixToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return VARIANT_SUFFIX_PATTERNS.some((re) => re.test(t));
}

/**
 * Επιστρέφει τον parent SKU.
 * @param sku Το SKU της (ενοποιημένης) γραμμής προϊόντος.
 * @param itemGroupId Προαιρετικός parent από τον κατάλογο (Magento `itemGroupId` κ.λπ.).
 */
export function resolveParentSku(sku: string | null | undefined, itemGroupId?: string | null): string {
  const normalized = String(sku || '').trim();
  if (!normalized) return '';

  // 1) Αξιόπιστος parent από κατάλογο.
  const group = String(itemGroupId || '').trim();
  if (group && group !== normalized) return group;

  // 2) Conservative heuristic: κόψε επαναληπτικά αναγνωρισμένα trailing size/gauge tokens.
  //    π.χ. e-tennis configurable: "101479-370-L3-UNSTRUNG" → -UNSTRUNG → -L3 → "101479-370".
  //    Σταματάμε στο πρώτο μη-αναγνωρισμένο token ή όταν μένει ένα segment (ποτέ κενό).
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
