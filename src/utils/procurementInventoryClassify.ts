/** Unified classification of a procurement inventory row (KPI cards, alerts, priority_tag);
 * must match ProductIntelligence.procInventorySummary. */
export type ProcurementStockTag = 'dead' | 'low' | 'healthy' | 'excess';

export function classifyProcurementInventoryRow(params: {
  stock: number;
  evalGrade: string;
  needsRefill: boolean;
  /** Value from the code STATUS column (uppercase trim). */
  statusUpper: string;
}): ProcurementStockTag {
  const grade = params.evalGrade.trim().toUpperCase();
  const st = params.statusUpper;
  if (params.stock === 0 || st.includes('ΑΝΕΝΕΡΓ') || grade === 'C') return 'dead';
  if (params.needsRefill) return 'low';
  if (grade === 'A') return 'healthy';
  return 'excess';
}
