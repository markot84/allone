/** PER-293 — per-brand non-merchandise rules (brands/{id}.nonMerchandise): out of stock analytics, revenue untouched. Mirrored in src/utils/productUtils.ts. */

export type NonMerchandiseRules = { categories?: string[]; nameContains?: string[] };
export type ClassifiableRow = { name?: unknown; sku?: unknown; category?: unknown };

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
// Accent- AND case-insensitive so 'ΔΩΡΟΕΠΙΤΑΓΕΣ' matches 'Δωροεπιταγές'.
const fold = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Reads `nonMerchandise` off a brand doc's data; tolerant of missing/malformed shapes. */
export function readNonMerchandise(data: Record<string, unknown> | undefined): NonMerchandiseRules {
  const raw = (data?.nonMerchandise ?? {}) as NonMerchandiseRules;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map(fold).filter(Boolean);
  return { categories: list(raw.categories), nameContains: list(raw.nameContains) };
}

/** Platform rule, ported verbatim (plain `lower`, NOT `fold`) so empty brand rules keep exact current numbers. */
function isPlatformNonMerchandise(row: ClassifiableRow): boolean {
  const sku = lower(row.sku);
  const name = lower(row.name);
  return sku === 'discount' || sku.includes('shipping') || name.includes('shipping πωλήσεων');
}

function isDemo(row: ClassifiableRow): boolean {
  return lower(row.name).includes('demo') || lower(row.sku).includes('demo');
}

/** Excluded from STOCK/PRODUCT analytics = demo ∪ platform non-merchandise ∪ brand additions. */
export function buildIsNonStocked(rules: NonMerchandiseRules): (row: ClassifiableRow) => boolean {
  const cats = rules.categories ?? [];
  const needles = rules.nameContains ?? [];
  return (row) => {
    if (isDemo(row) || isPlatformNonMerchandise(row)) return true;
    if (cats.length && cats.includes(fold(row.category))) return true;
    if (needles.length) {
      const name = fold(row.name);
      return needles.some((n) => name.includes(n));
    }
    return false;
  };
}
