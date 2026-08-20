/** Unified classification of a procurement inventory row (KPI cards, alerts, priority_tag);
 * must match ProductIntelligence.procInventorySummary. */
export type ProcurementStockTag = 'dead' | 'low' | 'healthy' | 'excess';

/** `null` = unclassified: a missing ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ grade is unknown, not excess (client decision). */
export function classifyProcurementInventoryRow(params: {
  stock: number;
  evalGrade: string;
  needsRefill: boolean;
  /** Value from the code STATUS column (uppercase trim). */
  statusUpper: string;
}): ProcurementStockTag | null {
  const grade = params.evalGrade.trim().toUpperCase();
  const st = params.statusUpper;
  if (params.stock === 0 || st.includes('ΑΝΕΝΕΡΓ') || grade === 'C') return 'dead';
  if (params.needsRefill) return 'low';
  if (grade === 'A') return 'healthy';
  if (!grade) return null;
  return 'excess';
}
