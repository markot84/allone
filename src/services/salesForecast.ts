import type {
  CommercialInfo,
  CommercialDirection,
  CommercialMagnitude,
  CommercialConfidence,
} from './commercialInfo';

/**
 * Πρόβλεψη πωλήσεων σε επίπεδο Κατηγορίας / Parent SKU.
 * Baseline = ιστορικό συγκρίσιμης περιόδου· προσαρμογή (uplift) από τις ενεργές «Εμπορικές Πληροφορίες».
 * Καθαρές συναρτήσεις (testable) — η σύνδεση δεδομένων γίνεται από το Marketing Plan.
 */

export interface ForecastGroupInput {
  category: string;
  parentSku?: string;
  /** Τζίρος συγκρίσιμης περιόδου (baseline). */
  pastRevenue: number;
  /** Τεμάχια συγκρίσιμης περιόδου (baseline). */
  pastUnits: number;
}

export interface ForecastRow {
  key: string;
  level: 'category' | 'parentSku';
  category: string;
  parentSku?: string;
  baselineRevenue: number;
  baselineUnits: number;
  /** Εφαρμοσμένο ποσοστό προσαρμογής (π.χ. +0.18 = +18%). */
  upliftPct: number;
  forecastRevenue: number;
  forecastUnits: number;
  /** Συνοπτικές εμπορικές πληροφορίες που οδήγησαν στην προσαρμογή. */
  drivers: string[];
  confidence: CommercialConfidence;
}

export interface SalesForecast {
  categories: ForecastRow[];
  parentSkus: ForecastRow[];
  totalBaselineRevenue: number;
  totalForecastRevenue: number;
  /** Πλήθος πληροφοριών που εφαρμόστηκαν τουλάχιστον σε μία ομάδα. */
  appliedInfoCount: number;
}

const MAX_ABS_UPLIFT = 0.6;

function baseUplift(direction: CommercialDirection, magnitude: CommercialMagnitude): number {
  if (direction === 'neutral') return 0;
  const mag = magnitude === 'high' ? 0.25 : magnitude === 'medium' ? 0.12 : 0.05;
  return direction === 'up' ? mag : -mag;
}

function confWeight(c: CommercialConfidence): number {
  return c === 'high' ? 1 : c === 'medium' ? 0.6 : 0.3;
}

const confRank: Record<CommercialConfidence, number> = { low: 0, medium: 1, high: 2 };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Ελέγχει αν μια πληροφορία αφορά μια ομάδα (κατηγορία/parentSku/επωνυμία). */
function infoMatchesGroup(info: CommercialInfo, category: string, parentSku?: string): boolean {
  const cat = norm(category);
  const psk = parentSku ? norm(parentSku) : '';
  const hay = `${cat} ${psk}`;

  const inList = (list: string[]) =>
    list.some((v) => {
      const n = norm(v);
      return n.length > 1 && (cat.includes(n) || n.includes(cat) || (!!psk && (psk.includes(n) || n.includes(psk))));
    });

  if (info.categories.length && inList(info.categories)) return true;
  if (info.parentSkus.length && inList(info.parentSkus)) return true;
  // Επωνυμίες (π.χ. Adidas) αναζητούνται μέσα στο όνομα κατηγορίας/parent SKU.
  if (info.brands.length && info.brands.some((b) => norm(b).length > 1 && hay.includes(norm(b)))) return true;
  return false;
}

function applyInfos(
  category: string,
  parentSku: string | undefined,
  infos: CommercialInfo[]
): { upliftPct: number; drivers: string[]; confidence: CommercialConfidence } {
  let upliftRaw = 0;
  const drivers: string[] = [];
  let conf: CommercialConfidence = 'low';
  for (const info of infos) {
    if (!infoMatchesGroup(info, category, parentSku)) continue;
    upliftRaw += baseUplift(info.direction, info.magnitude) * confWeight(info.confidence);
    drivers.push(info.summary);
    if (confRank[info.confidence] > confRank[conf]) conf = info.confidence;
  }
  const upliftPct = Math.max(-MAX_ABS_UPLIFT, Math.min(MAX_ABS_UPLIFT, upliftRaw));
  return { upliftPct, drivers, confidence: conf };
}

function buildRow(
  level: 'category' | 'parentSku',
  g: ForecastGroupInput,
  infos: CommercialInfo[]
): ForecastRow {
  const { upliftPct, drivers, confidence } = applyInfos(g.category, g.parentSku, infos);
  const factor = 1 + upliftPct;
  return {
    key: level === 'category' ? g.category : `${g.category}__${g.parentSku ?? ''}`,
    level,
    category: g.category,
    parentSku: g.parentSku,
    baselineRevenue: g.pastRevenue,
    baselineUnits: g.pastUnits,
    upliftPct,
    forecastRevenue: Math.round(g.pastRevenue * factor),
    forecastUnits: Math.round(g.pastUnits * factor),
    drivers,
    confidence,
  };
}

/**
 * Χτίζει την πρόβλεψη. Τα `categoryGroups` και `parentSkuGroups` περιέχουν baseline aggregates
 * (ίδιο μήκος περιόδου με τον στόχο). Το `activeInfo` είναι οι ενεργές εμπορικές πληροφορίες.
 */
export function buildSalesForecast(input: {
  categoryGroups: ForecastGroupInput[];
  parentSkuGroups?: ForecastGroupInput[];
  activeInfo: CommercialInfo[];
}): SalesForecast {
  const infos = input.activeInfo ?? [];

  const categories = (input.categoryGroups ?? [])
    .map((g) => buildRow('category', g, infos))
    .sort((a, b) => b.forecastRevenue - a.forecastRevenue);

  const parentSkus = (input.parentSkuGroups ?? [])
    .map((g) => buildRow('parentSku', g, infos))
    .sort((a, b) => b.forecastRevenue - a.forecastRevenue);

  const appliedIds = new Set<string>();
  for (const row of [...categories, ...parentSkus]) {
    for (const d of row.drivers) appliedIds.add(d);
  }

  return {
    categories,
    parentSkus,
    totalBaselineRevenue: categories.reduce((s, r) => s + r.baselineRevenue, 0),
    totalForecastRevenue: categories.reduce((s, r) => s + r.forecastRevenue, 0),
    appliedInfoCount: appliedIds.size,
  };
}
