/** Canonical `suppliers` doc id: brand-scoped + name-normalized so every writer
 * (MV normalizer, imports, UI) upserts the same doc. Keep in sync with functions/src/erpConnectorFirestore.ts. */
export function supplierDocId(brandId: string, name: string): string {
  const norm = String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('el-GR');
  return `sup_${brandId}_${norm}`.replace(/[/\\]/g, '_').slice(0, 900);
}
