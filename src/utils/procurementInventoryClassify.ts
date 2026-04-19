/**
 * Ενιαία ταξινόμηση γραμμής procurement inventory (ίδια για KPI κάρτες, alerts, priority_tag).
 * Πρέπει να ταιριάζει με το φύλλο «Διαχείριση αποθέματος» — βλ. ProductIntelligence.procInventorySummary.
 */
export type ProcurementStockTag = 'dead' | 'low' | 'healthy' | 'excess';

export function classifyProcurementInventoryRow(params: {
  stock: number;
  evalGrade: string;
  needsRefill: boolean;
  /** Τιμή από στήλη STATUS ΚΩΔΙΚΟΥ (uppercase trim). */
  statusUpper: string;
}): ProcurementStockTag {
  const grade = params.evalGrade.trim().toUpperCase();
  const st = params.statusUpper;
  if (params.stock === 0 || st.includes('ΑΝΕΝΕΡΓ') || grade === 'C') return 'dead';
  if (params.needsRefill) return 'low';
  if (grade === 'A') return 'healthy';
  return 'excess';
}
