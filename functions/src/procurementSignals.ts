/**
 * Procurement Signals Aggregator
 *
 * Διαβάζει τα 4 βασικά procurement collections για ένα brand και παράγει
 * ενιαίο per-SKU signal map που χρησιμοποιείται από το client resolver
 * (useProductSignals) σε όλες τις εμπορικές πολιτικές:
 *
 *   - procurement_inventory       → status, κατηγορία, διαθέσιμο/δυναμικό υπόλοιπο,
 *                                    ημέρες επάρκειας, lifetime sales, replenishment,
 *                                    κόστος μονάδας → tied capital
 *   - procurement_pricing_policy  → list/corporate prices, εκπτώσεις A/B/C, costs,
 *                                    margin (avg_sale_price vs total_cost)
 *   - procurement_fiscal_year     → annual revenue/profit (κρατάμε το πιο πρόσφατο)
 *   - procurement_item_evaluation → score + label
 *
 * Output:
 *   procurement_signals/{brandId}
 *     { skuSignalsJson, skuCount, sources, computedAt }
 *
 * skuSignalsJson είναι JSON.stringify(Record<sku, ProcurementSignal>) για να
 * αποφύγουμε τα Firestore index limits σε μεγάλα maps (ίδιο pattern με skuStatsJson).
 */

import * as admin from 'firebase-admin';
import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

let _db: Firestore | null = null;

export function setDb(db: Firestore) {
  _db = db;
}

function getDb(): Firestore {
  return _db ?? (admin.firestore() as unknown as Firestore);
}

/** Robust string→number parsing (διαχειρίζεται "1.234,56", "1,234.56", "12%", "  10 €"). */
function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[€$£%]/g, '').replace(/\s+/g, '');
  // Αν έχει και τελεία και κόμμα: το τελευταίο είναι το decimal separator
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      // ευρωπαϊκό format: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // αμερικάνικο: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nz(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Per-SKU signal — ότι θεωρούμε χρήσιμο για στρατηγικές αποφάσεις. */
export interface ProcurementSignal {
  // identity
  category?: string;
  description?: string;
  supplier?: string;
  flow_group?: string;
  status?: string; // STATUS_ΚΩΔΙΚΟΥ (π.χ. "Επί παραγγελία", "Προς κατάργηση")
  evaluation_label?: string; // ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ από inventory ή item_evaluation
  evaluation_score?: number;

  // inventory snapshot
  available_stock?: number;
  dynamic_stock?: number;
  days_of_cover?: number;
  lifetime_qty?: number; // ΣΥΝΟΛΙΚΕΣ_ΠΩΛΗΣΕΙΣ (lifetime από procurement)

  // capital
  cost_unit?: number; // ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ
  tied_capital?: number; // available_stock × cost_unit
  replenishment_qty?: number;
  replenishment_value?: number;

  // pricing
  list_price?: number;
  corporate_price?: number;
  avg_sale_price?: number;
  total_cost?: number;
  primary_cost?: number;
  margin_pct?: number; // (avg_sale_price - total_cost)/avg_sale_price
  discount_a?: number;
  discount_b?: number;
  discount_c?: number;

  // fiscal (latest year captured)
  fiscal_year?: string;
  annual_revenue?: number;
  annual_profit?: number;
}

interface InventoryRow {
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
  ΠΟΣΟΤΗΤΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ?: string;
  ΑΞΙΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ?: string;
  [k: string]: unknown;
}

interface PricingRow {
  ΚΩΔΙΚΟΣ?: string;
  ΚΟΣΤΟΣ_ΑΓΟΡΑΣ?: string;
  ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ?: string;
  ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ?: string;
  ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ?: string;
  ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ?: string;
  ΤΙΜΟΚΑΤΑΛΟΓΟΣ_ΒΑΣΗΣ?: string;
  ΕΤΑΙΡΙΚΟΣ_ΚΑΤΑΛΟΓΟΣ?: string;
  ΕΚΠΤΩΤΙΚΟΣ_Α?: string;
  ΕΚΠΤΩΤΙΚΟΣ_Β?: string;
  ΕΚΠΤΩΤΙΚΟΣ_C?: string;
  [k: string]: unknown;
}

interface FiscalRow {
  ΚΩΔΙΚΟΣ?: string;
  ΕΤΟΣ?: string;
  ΑΠΟΛΟΓΙΣΤΙΚΟΣ_ΤΖΙΡΟΣ?: string;
  ΑΠΟΛΟΓΙΣΤΙΚΟ_ΚΕΡΔΟΣ?: string;
  ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ?: string;
  [k: string]: unknown;
}

interface EvaluationRow {
  ΚΩΔΙΚΟΣ?: string;
  ΑΞΙΟΛΟΓΗΣΗ?: string;
  ΒΑΘΜΟΛΟΓΙΑ?: string;
  [k: string]: unknown;
}

/**
 * Κανονικοποίηση κλειδιού στήλης: κενά/τελείες → underscore (π.χ. "ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ" →
 * "ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ", "ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ Μ.Μ." → "ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ"). Idempotent για
 * ήδη κανονικά (underscore) headers όπως τα Megaventory custom reports.
 */
function normalizeProcKey(k: string): string {
  return k.trim().replace(/[.\s]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Ορισμένα procurement templates (χειροκίνητο XLSX) χρησιμοποιούν headers με κενά και «MASTER»
 * αντί για «ΚΩΔΙΚΟΣ» στο inventory sheet. Κανονικοποιούμε στο read ώστε ο aggregator να δουλεύει
 * ανεξάρτητα από το template, χωρίς να απαιτείται re-upload για ήδη αποθηκευμένα δεδομένα.
 */
function normalizeProcurementRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeProcKey(k);
    const existing = out[nk];
    if (existing === undefined || existing === null || existing === '') out[nk] = v;
  }
  const code = out['ΚΩΔΙΚΟΣ'];
  if ((code === undefined || code === null || String(code).trim() === '') &&
      out['MASTER'] != null && String(out['MASTER']).trim() !== '') {
    out['ΚΩΔΙΚΟΣ'] = out['MASTER'];
  }
  return out;
}

async function readCollection<T>(
  db: Firestore,
  collectionKey: string,
  brandId: string
): Promise<T[]> {
  const snap = await db
    .collection(collectionKey)
    .where('brandId', '==', brandId)
    .get();
  return snap.docs.map((d) => normalizeProcurementRow(d.data() as Record<string, unknown>) as T);
}

/**
 * Διαβάζει & ομογενοποιεί όλα τα procurement signals για ένα brand.
 * Επιστρέφει per-SKU map + provenance counts (πόσα SKUs είδαμε ανά πηγή).
 */
export async function computeProcurementSignals(brandId: string): Promise<{
  skuCount: number;
  signals: Record<string, ProcurementSignal>;
  sources: Record<string, number>;
}> {
  const db = getDb();

  const [inventoryRows, pricingRows, fiscalRows, evaluationRows] = await Promise.all([
    readCollection<InventoryRow>(db, 'procurement_inventory', brandId),
    readCollection<PricingRow>(db, 'procurement_pricing_policy', brandId),
    readCollection<FiscalRow>(db, 'procurement_fiscal_year', brandId),
    readCollection<EvaluationRow>(db, 'procurement_item_evaluation', brandId),
  ]);

  const sources = {
    inventory: 0,
    pricing: 0,
    fiscal: 0,
    evaluation: 0,
  };

  const map = new Map<string, ProcurementSignal>();
  const ensure = (sku: string): ProcurementSignal => {
    let cur = map.get(sku);
    if (!cur) {
      cur = {};
      map.set(sku, cur);
    }
    return cur;
  };

  // 1) Inventory (κύρια πηγή — status, stock, lifetime, tied capital)
  for (const row of inventoryRows) {
    const sku = String(row.ΚΩΔΙΚΟΣ || '').trim();
    if (!sku) continue;
    sources.inventory++;
    const sig = ensure(sku);
    sig.description = sig.description ?? row.ΠΕΡΙΓΡΑΦΗ?.trim();
    sig.category = sig.category ?? row.ΚΑΤΗΓΟΡΙΑ?.trim();
    sig.supplier = sig.supplier ?? row.ΠΡΟΜΗΘΕΥΤΗΣ?.trim();
    sig.flow_group = sig.flow_group ?? row.ΟΜΑΔΑ_ΡΟΗΣ?.trim();
    sig.status = sig.status ?? row.STATUS_ΚΩΔΙΚΟΥ?.trim();
    sig.evaluation_label = sig.evaluation_label ?? row.ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ?.trim();

    const cost = toNumber(row.ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ);
    const avail = toNumber(row.ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ);
    const dyn = toNumber(row.ΔΥΝΑΜΙΚΟ_ΥΠΟΛΟΙΠΟ);
    if (cost !== null) sig.cost_unit = cost;
    if (avail !== null) sig.available_stock = avail;
    if (dyn !== null) sig.dynamic_stock = dyn;
    if (cost !== null && avail !== null) sig.tied_capital = +(cost * avail).toFixed(2);

    const life = toNumber(row.ΣΥΝΟΛΙΚΕΣ_ΠΩΛΗΣΕΙΣ);
    if (life !== null) sig.lifetime_qty = life;

    const dco = toNumber(row.ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ);
    if (dco !== null) sig.days_of_cover = dco;

    const repQ = toNumber(row.ΠΟΣΟΤΗΤΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ);
    const repV = toNumber(row.ΑΞΙΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ);
    if (repQ !== null) sig.replenishment_qty = repQ;
    if (repV !== null) sig.replenishment_value = repV;
  }

  // 2) Pricing policy
  for (const row of pricingRows) {
    const sku = String(row.ΚΩΔΙΚΟΣ || '').trim();
    if (!sku) continue;
    sources.pricing++;
    const sig = ensure(sku);
    const list = toNumber(row.ΤΙΜΟΚΑΤΑΛΟΓΟΣ_ΒΑΣΗΣ);
    const corp = toNumber(row.ΕΤΑΙΡΙΚΟΣ_ΚΑΤΑΛΟΓΟΣ);
    const avg = toNumber(row.ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ);
    const totalCost = toNumber(row.ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ);
    const primary = toNumber(row.ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ);
    const dA = toNumber(row.ΕΚΠΤΩΤΙΚΟΣ_Α);
    const dB = toNumber(row.ΕΚΠΤΩΤΙΚΟΣ_Β);
    const dC = toNumber(row.ΕΚΠΤΩΤΙΚΟΣ_C);
    if (list !== null) sig.list_price = list;
    if (corp !== null) sig.corporate_price = corp;
    if (avg !== null) sig.avg_sale_price = avg;
    if (totalCost !== null) sig.total_cost = totalCost;
    if (primary !== null) sig.primary_cost = primary;
    if (dA !== null) sig.discount_a = dA;
    if (dB !== null) sig.discount_b = dB;
    if (dC !== null) sig.discount_c = dC;

    // Margin: προτιμάμε avg_sale - total_cost. Αν λείπει total_cost, fallback σε primary.
    const cost = totalCost ?? primary;
    if (avg !== null && cost !== null && avg > 0) {
      sig.margin_pct = +(((avg - cost) / avg) * 100).toFixed(2);
    }

    if (!sig.evaluation_label && typeof row.ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ === 'string') {
      sig.evaluation_label = row.ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ.trim();
    }
  }

  // 3) Fiscal year — κρατάμε το πιο πρόσφατο έτος ανά SKU
  const fiscalLatest = new Map<string, FiscalRow>();
  for (const row of fiscalRows) {
    const sku = String(row.ΚΩΔΙΚΟΣ || '').trim();
    if (!sku) continue;
    sources.fiscal++;
    const cur = fiscalLatest.get(sku);
    const curYear = String(cur?.ΕΤΟΣ || '').trim();
    const newYear = String(row.ΕΤΟΣ || '').trim();
    if (!cur || newYear.localeCompare(curYear) > 0) {
      fiscalLatest.set(sku, row);
    }
  }
  for (const [sku, row] of fiscalLatest.entries()) {
    const sig = ensure(sku);
    const rev = toNumber(row.ΑΠΟΛΟΓΙΣΤΙΚΟΣ_ΤΖΙΡΟΣ);
    const profit = toNumber(row.ΑΠΟΛΟΓΙΣΤΙΚΟ_ΚΕΡΔΟΣ);
    const avg = toNumber(row.ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ);
    const year = String(row.ΕΤΟΣ || '').trim();
    if (year) sig.fiscal_year = year;
    if (rev !== null) sig.annual_revenue = rev;
    if (profit !== null) sig.annual_profit = profit;
    if (avg !== null && sig.avg_sale_price === undefined) sig.avg_sale_price = avg;
  }

  // 4) Item evaluation — score & label fallback
  for (const row of evaluationRows) {
    const sku = String(row.ΚΩΔΙΚΟΣ || '').trim();
    if (!sku) continue;
    sources.evaluation++;
    const sig = ensure(sku);
    const score = toNumber(row.ΒΑΘΜΟΛΟΓΙΑ);
    if (score !== null) sig.evaluation_score = score;
    if (!sig.evaluation_label && typeof row.ΑΞΙΟΛΟΓΗΣΗ === 'string') {
      sig.evaluation_label = row.ΑΞΙΟΛΟΓΗΣΗ.trim();
    }
  }

  const signals: Record<string, ProcurementSignal> = {};
  for (const [sku, sig] of map.entries()) {
    // Καθαρισμός undefined fields για compact JSON
    const clean: ProcurementSignal = {};
    (Object.keys(sig) as (keyof ProcurementSignal)[]).forEach((k) => {
      const v = sig[k];
      if (v !== undefined && v !== null && v !== '') {
        (clean as any)[k] = v;
      }
    });
    if (Object.keys(clean).length > 0) signals[sku] = clean;
  }

  // Sanity log: π.χ. πόσα SKUs έχουν tied capital
  const withTied = Object.values(signals).filter((s) => nz(s.tied_capital) > 0).length;
  logger.info(
    `[ProcurementSignals] ${brandId}: ${map.size} SKUs (inv=${sources.inventory}, pricing=${sources.pricing}, fiscal=${sources.fiscal}, eval=${sources.evaluation}), withTiedCapital=${withTied}`
  );

  return { skuCount: map.size, signals, sources };
}

/**
 * Persist στο Firestore. Χρησιμοποιεί JSON serialization για να αποφύγουμε
 * το όριο των 20K index entries σε μεγάλα maps (ίδιο pattern με ecommerce_summary).
 */
export async function refreshProcurementSignals(brandId: string): Promise<{
  skuCount: number;
  bytesJson: number;
  sources: Record<string, number>;
}> {
  const db = getDb();
  const { skuCount, signals, sources } = await computeProcurementSignals(brandId);

  if (skuCount === 0) {
    logger.info(`[ProcurementSignals] No procurement data for ${brandId} — clearing doc`);
    await db.doc(`procurement_signals/${brandId}`).set({
      brandId,
      skuCount: 0,
      skuSignalsJson: '{}',
      sources,
      computedAt: FieldValue.serverTimestamp(),
    });
    return { skuCount: 0, bytesJson: 2, sources };
  }

  const json = JSON.stringify(signals);
  await db.doc(`procurement_signals/${brandId}`).set({
    brandId,
    skuCount,
    skuSignalsJson: json,
    sources,
    computedAt: FieldValue.serverTimestamp(),
  });

  logger.info(
    `[ProcurementSignals] Persisted ${brandId}: ${skuCount} SKUs, ${(json.length / 1024).toFixed(1)}KB`
  );

  return { skuCount, bytesJson: json.length, sources };
}
