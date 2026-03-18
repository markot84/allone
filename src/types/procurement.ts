/** Procurement analysis types — mapped from PROCUREMENT_TEMPLATE.xlsx 7 sheets */

export type ProcurementSheetType =
  | 'inventory'      // ΔΙΑΧΕΙΡΙΣΗ ΑΠΟΘΕΜΑΤΟΣ
  | 'costing'        // ΚΟΣΤΟΛΟΓΗΣΗ
  | 'item_evaluation'     // ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΩΝ
  | 'customer_evaluation' // ΑΞΙΟΛΟΓΗΣΗ ΠΕΛΑΤΩΝ
  | 'pricing_policy'      // ΤΙΜΟΛΟΓΙΑΚΗ ΠΟΛΙΤΙΚΗ
  | 'fiscal_year'        // ΑΠΟΛΟΓΙΣΤΙΚΟ ΕΤΟΣ
  | 'statistics';        // ΣΤΑΤΙΣΤΙΚΑ

export interface ProcurementInventory {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΠΕΡΙΓΡΑΦΗ?: string;
  ΚΑΤΗΓΟΡΙΑ?: string;
  ΠΡΟΜΗΘΕΥΤΗΣ?: string;
  ΟΜΑΔΑ_ΡΟΗΣ?: string;
  ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ?: string;
  STATUS_ΚΩΔΙΚΟΥ?: string;
  ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ?: string;
  ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ?: string;
  ΔΥΝΑΜΙΚΟ_ΥΠΟΛΟΙΠΟ?: string;
  ΣΥΝΟΛΙΚΕΣ_ΠΩΛΗΣΕΙΣ?: string;
  ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ?: string;
  ΚΙΒΩΤΟΛΟΓΙΟ?: string;
  ΠΟΣΟΤΗΤΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ?: string;
  ΑΞΙΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ?: string;
  ΠΟΣΟΤΗΤΑ_ΑΜΕΣΗΣ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ?: string;
  ΠΟΣΟΤΗΤΑ_ΠΡΟΣ_ΠΡΟΩΘΗΣΗ?: string;
  [key: string]: string | undefined;
}

export interface ProcurementCosting {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΠΕΡΙΓΡΑΦΗ?: string;
  ΚΑΤΗΓΟΡΙΑ?: string;
  ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ?: string;
  ΔΕΥΤΕΡΟΓΕΝΕΣ_ΚΟΣΤΟΣ?: string;
  ΑΝΑΛΥΣΗ_ΚΟΣΤΟΥΣ_ΑΝΑ_ΔΡΑΣΤΗΡΙΟΤΗΤΑ?: string;
  ΜΕΣΟ_ΚΟΣΤΟΣ_ΚΑΤΗΓΟΡΙΑΣ?: string;
  [key: string]: string | undefined;
}

export interface ProcurementItemEvaluation {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΠΕΡΙΓΡΑΦΗ?: string;
  ΚΑΤΗΓΟΡΙΑ?: string;
  ΑΞΙΟΛΟΓΗΣΗ?: string;
  ΒΑΘΜΟΛΟΓΙΑ?: string;
  ΑΞΙΟΛΟΓΗΣΗ_ΑΝΑ_ΔΕΙΚΤΗ?: string;
  [key: string]: string | undefined;
}

export interface ProcurementCustomerEvaluation {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΕΠΩΝΥΜΙΑ?: string;
  ΑΞΙΟΛΟΓΗΣΗ?: string;
  ΒΑΘΜΟΛΟΓΙΑ?: string;
  ΑΞΙΟΛΟΓΗΣΗ_ΑΝΑ_ΔΕΙΚΤΗ?: string;
  [key: string]: string | undefined;
}

export interface ProcurementPricingPolicy {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΠΕΡΙΓΡΑΦΗ?: string;
  ΚΑΤΗΓΟΡΙΑ?: string;
  ΚΟΣΤΟΣ_ΑΓΟΡΑΣ?: string;
  ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ?: string;
  ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ?: string;
  MARKETING_BASED_COSTING?: string;
  ACTIVITY_BASED_COSTING?: string;
  ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ?: string;
  ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ?: string;
  ΤΙΜΟΚΑΤΑΛΟΓΟΣ_ΒΑΣΗΣ?: string;
  ΕΤΑΙΡΙΚΟΣ_ΚΑΤΑΛΟΓΟΣ?: string;
  ΕΚΠΤΩΤΙΚΟΣ_Α?: string;
  ΕΚΠΤΩΤΙΚΟΣ_Β?: string;
  ΕΚΠΤΩΤΙΚΟΣ_C?: string;
  [key: string]: string | undefined;
}

export interface ProcurementFiscalYear {
  id: string;
  brandId?: string;
  ΚΩΔΙΚΟΣ?: string;
  ΠΕΡΙΓΡΑΦΗ?: string;
  ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ?: string;
  ΠΡΟΤΑΣΗ_ΤΙΜΟΛΟΓΙΑΚΗΣ_ΠΟΛΙΤΙΚΗΣ?: string;
  ΑΠΟΛΟΓΙΣΤΙΚΟΣ_ΤΖΙΡΟΣ?: string;
  ΑΠΟΛΟΓΙΣΤΙΚΟ_ΚΕΡΔΟΣ?: string;
  [key: string]: string | undefined;
}

/** ΣΤΑΤΙΣΤΙΚΑ: matrix structure (metric name → period values) */
export interface ProcurementStatistics {
  id: string;
  brandId?: string;
  /** First column: metric/label name */
  metric?: string;
  /** Flexible period columns (e.g. Ιαν, Φεβ, Μαρ...) */
  [key: string]: string | undefined;
}

export const PROCUREMENT_SHEET_NAMES: Record<ProcurementSheetType, string> = {
  inventory: 'ΔΙΑΧΕΙΡΙΣΗ ΑΠΟΘΕΜΑΤΟΣ',
  costing: 'ΚΟΣΤΟΛΟΓΗΣΗ',
  item_evaluation: 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΩΝ',
  customer_evaluation: 'ΑΞΙΟΛΟΓΗΣΗ ΠΕΛΑΤΩΝ',
  pricing_policy: 'ΤΙΜΟΛΟΓΙΑΚΗ ΠΟΛΙΤΙΚΗ',
  fiscal_year: 'ΑΠΟΛΟΓΙΣΤΙΚΟ ΕΤΟΣ',
  statistics: 'ΣΤΑΤΙΣΤΙΚΑ',
};

export const PROCUREMENT_SHEET_LABELS: Record<ProcurementSheetType, string> = {
  inventory: 'Διαχείριση Αποθέματος',
  costing: 'Κοστολόγηση',
  item_evaluation: 'Αξιολόγηση Είδων',
  customer_evaluation: 'Αξιολόγηση Πελατών',
  pricing_policy: 'Τιμολογιακή Πολιτική',
  fiscal_year: 'Απολογιστικό Έτος',
  statistics: 'Στατιστικά',
};
