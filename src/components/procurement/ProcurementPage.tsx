import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Package, Calculator, Star, Users, FileText, Calendar, BarChart3,
  Upload, ChevronRight, ArrowLeft, Tag, DollarSign, Search, X,
  ChevronDown, ChevronLeft, EyeOff,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip,
  LineChart, Line, Legend, Cell,
} from 'recharts';
import { Card, Spinner, Button, useToast, PageHeader } from '../common';
import { useProcurement } from '../../hooks/useProcurement';
import { useRefreshProcurementSignals } from '../../hooks/useProcurementSignals';
import { useBrand } from '../../hooks/useBrand';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { ProcurementService } from '../../services/firestore';
import { seedProcurementDemoData } from '../../services/procurementDemoData';
import {
  PROCUREMENT_SHEET_LABELS,
  type ProcurementSheetType,
} from '../../types/procurement';

// ── Constants ─────────────────────────────────────────────────────────────────

const SHEET_ICONS: Record<ProcurementSheetType, React.ReactNode> = {
  inventory: <Package size={18} />,
  costing: <Calculator size={18} />,
  item_evaluation: <Star size={18} />,
  customer_evaluation: <Users size={18} />,
  pricing_policy: <FileText size={18} />,
  fiscal_year: <Calendar size={18} />,
  statistics: <BarChart3 size={18} />,
};

const SHEET_ICON_BG: Record<ProcurementSheetType, string> = {
  inventory: 'bg-blue-50 text-blue-600',
  costing: 'bg-orange-50 text-orange-600',
  item_evaluation: 'bg-green-50 text-green-600',
  customer_evaluation: 'bg-purple-50 text-purple-600',
  pricing_policy: 'bg-yellow-50 text-yellow-700',
  fiscal_year: 'bg-emerald-50 text-emerald-600',
  statistics: 'bg-gray-50 text-gray-600',
};

const TOP_N = 10;

const CHART_TITLES: Record<ProcurementSheetType, string> = {
  inventory: `Top ${TOP_N} SKU ανά διαθέσιμο απόθεμα`,
  costing: `Top ${TOP_N} SKU ανά πρωτογενές κόστος`,
  item_evaluation: 'Κατανομή ειδών ανά αξιολόγηση',
  customer_evaluation: 'Κατανομή πελατών ανά αξιολόγηση',
  pricing_policy: `Top ${TOP_N} SKU ανά μέση τιμή πώλησης`,
  fiscal_year: `Top ${TOP_N} SKU ανά απολογιστικό τζίρο`,
  statistics: 'Τάση ανά περίοδο',
};

const SHEET_KEYS = [
  'inventory', 'costing', 'item_evaluation', 'customer_evaluation',
  'pricing_policy', 'fiscal_year', 'statistics',
] as const;

const EXCLUDED_KEYS = new Set(['id', 'brandId', 'rowIndex', 'sheetType', 'createdAt', 'updatedAt']);

const CHART_COLORS = {
  accent: '#F97316',
  secondary: '#78716C',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  purple: '#8B5CF6',
};

const EVAL_COLORS: Record<string, string> = {
  A: '#22C55E', B: '#F59E0B', C: '#EF4444',
  VIP: '#3B82F6', Καλή: '#F59E0B', Νέος: '#6B7280',
  Άριστα: '#22C55E', Καλά: '#F59E0B', Μέτρια: '#EF4444',
};

const BADGE_KEYS = new Set(['ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'ΑΞΙΟΛΟΓΗΣΗ', 'STATUS ΚΩΔΙΚΟΥ', 'ΟΜΑΔΑ ΡΟΗΣ', 'ΚΙΒΩΤΟΛΟΓΙΟ']);

const BADGE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  C: 'bg-red-100 text-red-700 border-red-200',
  Άριστα: 'bg-green-100 text-green-700 border-green-200',
  Καλά: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Μέτρια: 'bg-red-100 text-red-700 border-red-200',
  VIP: 'bg-blue-100 text-blue-700 border-blue-200',
  Καλή: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Νέος: 'bg-gray-100 text-gray-600 border-gray-200',
  Ενεργό: 'bg-green-100 text-green-700 border-green-200',
  Κωδικοποιημένο: 'bg-gray-100 text-gray-600 border-gray-200',
  Υψηλή: 'bg-blue-100 text-blue-700 border-blue-200',
  Χαμηλή: 'bg-red-100 text-red-700 border-red-200',
  Ναι: 'bg-green-100 text-green-700 border-green-200',
  Όχι: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STAT_LINE_COLORS = ['#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B', '#EF4444', '#78716C'];

/** Canonical column order per sheet (matches PROCUREMENT_TEMPLATE.xlsx). Unknown cols go to the end. */
const CANONICAL_COLUMN_ORDER: Record<ProcurementSheetType, string[]> = {
  inventory: [
    'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΠΡΟΜΗΘΕΥΤΗΣ', 'ΟΜΑΔΑ ΡΟΗΣ',
    'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'STATUS ΚΩΔΙΚΟΥ', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ Μ.Μ.',
    'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ', 'ΔΥΝΑΜΙΚΟ ΥΠΟΛΟΙΠΟ', 'ΣΥΝΟΛΙΚΕΣ ΠΩΛΗΣΕΙΣ',
    'ΗΜΕΡΕΣ ΕΠΑΡΚΕΙΑΣ ΔΙΑΘΕΣΙΜΟΥ ΑΠΟΘΕΜΑΤΟΣ', 'ΚΙΒΩΤΟΛΟΓΙΟ',
    'ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ',
    'ΠΟΣΟΤΗΤΑ ΑΜΕΣΗΣ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΠΟΣΟΤΗΤΑ ΠΡΟΣ ΠΡΟΩΘΗΣΗ',
  ],
  costing: [
    'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ',
    'ΔΕΥΤΕΡΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΑΝΑΛΥΣΗ ΚΟΣΤΟΥΣ ΑΝΑ ΔΡΑΣΤΗΡΙΟΤΗΤΑ',
    'ΜΕΣΟ ΚΟΣΤΟΣ ΚΑΤΗΓΟΡΙΑΣ', 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
  ],
  item_evaluation: [
    'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΑΞΙΟΛΟΓΗΣΗ', 'ΒΑΘΜΟΛΟΓΙΑ',
    'ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ',
  ],
  customer_evaluation: [
    'ΚΩΔΙΚΟΣ', 'ΕΠΩΝΥΜΙΑ', 'ΑΞΙΟΛΟΓΗΣΗ', 'ΒΑΘΜΟΛΟΓΙΑ', 'ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ',
  ],
  pricing_policy: [
    'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΚΟΣΤΟΣ ΑΓΟΡΑΣ', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ',
    'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ', 'MARKETING BASED COSTING', 'ACTIVITY BASED COSTING',
    'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΤΙΜΟΚΑΤΑΛΟΓΟΣ ΒΑΣΗΣ',
    'ΕΤΑΙΡΙΚΟΣ ΚΑΤΑΛΟΓΟΣ', 'ΕΚΠΤΩΤΙΚΟΣ Α', 'ΕΚΠΤΩΤΙΚΟΣ Β', 'ΕΚΠΤΩΤΙΚΟΣ C',
  ],
  fiscal_year: [
    'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ',
    'ΠΡΟΤΑΣΗ ΤΙΜΟΛΟΓΙΑΚΗΣ ΠΟΛΙΤΙΚΗΣ', 'ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ',
    'ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ',
  ],
  statistics: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    // Greek/European format: dots = thousands, comma = decimal  (e.g. "1.234,56")
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  const dots = (s.match(/\./g) ?? []).length;
  if (dots > 1) {
    // Multiple dots → all thousands separators (e.g. "1.234.567")
    const n = parseFloat(s.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  if (dots === 1) {
    const afterDot = s.split('.')[1] ?? '';
    if (afterDot.length === 3) {
      // Exactly 3 digits after dot → Greek thousands (e.g. "4.332" = 4332, "1.000" = 1000)
      const n = parseFloat(s.replace(/\./g, ''));
      return isNaN(n) ? 0 : n;
    }
  }
  // Standard decimal (e.g. "4.33", "65427.42")
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Returns true if the column name is a numeric value (e.g. "4065528.538423248") */
function isNumericColName(k: string): boolean {
  return k.trim() !== '' && !isNaN(Number(k.trim()));
}

/** Excludes summary/total rows that have an empty ΚΩΔΙΚΟΣ field.
 *  The procurement Excel template places a grand-total row at index 0 with no ΚΩΔΙΚΟΣ;
 *  including it in sums or averages doubles (or otherwise skews) every KPI. */
function getProductRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (rows.length === 0) return rows;
  const kodikosKey =
    Object.keys(rows[0]).find(k => k.toUpperCase().replace(/[\s_]+/g, '') === 'ΚΩΔΙΚΟΣ') ??
    'ΚΩΔΙΚΟΣ';
  return rows.filter(r => {
    const v = r[kodikosKey];
    return v != null && String(v).trim() !== '';
  });
}

/** Totals for the ΑΠΟΛΟΓΙΣΤΙΚΟ ΕΤΟΣ sheet: sum per-SKU rows (semantically correct & robust).
 *  Uses getProductRows to exclude the grand-total row at index 0 (empty ΚΩΔΙΚΟΣ),
 *  which would otherwise double every figure. */
function getFiscalYearTotals(rows: Record<string, unknown>[]): { turnover: number; profit: number; marginPct: number } {
  if (rows.length === 0) return { turnover: 0, profit: 0, marginPct: 0 };
  const productRows = getProductRows(rows);
  const src = productRows.length > 0 ? productRows : rows;
  const turnoverCol = findCol(src, 'ΤΖΙΡΟΣ');
  const profitCol   = findCol(src, 'ΚΕΡΔΟΣ');
  const turnover = src.reduce((s, r) => s + parseNum(r[turnoverCol]), 0);
  const profit   = src.reduce((s, r) => s + parseNum(r[profitCol]), 0);
  return { turnover, profit, marginPct: turnover > 0 ? profit / turnover : 0 };
}

/** Keyword → alternative search terms (checked in order). */
const COL_ALIASES: Record<string, string[]> = {
  'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ': ['ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ', 'ΔΙΑΘΕΣΙΜΟ', 'ΥΠΟΛΟΙΠΟ', 'ΑΠΟΘΕΜΑ', 'STOCK', 'AVAILABLE'],
  'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ':  ['ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΠΡΩΤΟΓΕΝΕΣ', 'ΚΟΣΤΟΣ ΑΓΟΡΑΣ', 'ΚΟΣΤΟΣ', 'ΤΙΜΗ ΑΓΟΡΑΣ', 'ΑΓΟΡΑ', 'COST'],
  'ΑΝΑΤΡΟΦΟΔΟΣΙΑ':       ['ΑΝΑΤΡΟΦΟΔΟΣΙΑ', 'ΑΝΑΤΡΟΦΟΔΟΤΗΣΗ', 'REORDER', 'REFILL'],
  'ΒΑΘΜΟΛΟΓΙΑ':          ['ΒΑΘΜΟΛΟΓΙΑ', 'ΒΑΘΜΟΣ', 'SCORE', 'RATING'],
  'ΑΞΙΟΛΟΓΗΣΗ':          ['ΑΞΙΟΛΟΓΗΣΗ', 'EVALUATION', 'RATING'],
  'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ':   ['ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΕΩΣ', 'ΜΕΣΗ ΤΙΜΗ', 'ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΠΩΛΗΣΗΣ', 'PRICE'],
  'ΤΙΜΗ ΠΩΛΗΣΗΣ':        ['ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΠΩΛΗΣΗΣ', 'ΤΙΜΗ', 'PRICE', 'ΠΩΛΗΣΗ'],
  'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ':     ['ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ', 'ΣΥΝΟΛΙΚΟ', 'TOTAL COST'],
  'ΔΕΥΤΕΡΟΓΕΝΕΣ':        ['ΔΕΥΤΕΡΟΓΕΝΕΣ', 'ΔΕΥΤΕΡ'],
  'ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ':['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ', 'ΤΖΙΡΟΣ'],
  'ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ': ['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ', 'ΚΕΡΔΟΣ'],
  // Κοστολόγηση · στήλη Η — όχι απολογιστικό έτος (what-if)
  // Στη Firestore αποθηκεύεται ως 'ΤΖΙΡΟΣ' (το ακριβές header από το Excel template)
  'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ': [
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12 ΜΗΝΟΥ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ (12ΜΗΝΟ)',
    'ΠΡΑΓΜΑΤΙΚΟΣ_ΤΖΙΡΟΣ_12ΜΗΝΟΥ',
    'ΠΡΑΓΜ. ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12ΜΗΝΟΥ',
    'ΤΖΙΡΟΣ 12 ΜΗΝΩΝ',
    '12ΜΗΝΟ ΤΖΙΡΟΣ',
    '12Μ ΤΖΙΡΟΣ',
    'ΤΖΙΡΟΣ',
  ],
  'ΤΖΙΡΟΣ':              ['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ', 'ΤΖΙΡΟΣ', 'TURNOVER', 'ΕΣΟΔΑ', 'REVENUE'],
  'ΚΕΡΔΟΣ':              ['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ', 'ΚΕΡΔΟΣ', 'PROFIT', 'ΚΕΡΔΗ'],
  'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ': ['ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΑΞΙΑ ΑΝΑΤΡΟΦ'],
  'ΠΕΡΙΓΡΑΦΗ':           ['ΠΕΡΙΓΡΑΦΗ', 'ΟΝΟΜΑ', 'DESCRIPTION', 'NAME'],
  'ΚΩΔΙΚΟΣ':             ['ΚΩΔΙΚΟΣ', 'SKU', 'CODE', 'BARCODE'],
};

/** Returns the first non-numeric column key whose name contains the keyword (case-insensitive).
 *  Tries multiple aliases when the primary keyword doesn't match.
 *  Normalises whitespace, newlines and underscores before comparing — handles Excel headers
 *  that contain line-breaks, extra spaces, or underscore-separated Firestore keys.
 *
 *  Two-pass strategy:
 *   1. Exact normalised match (===) — avoids false positives like "ΤΖΙΡΟΣ 12ΜΗΝΟΥ ΑΛΥΣΙΔΑ"
 *      matching before "ΤΖΙΡΟΣ 12ΜΗΝΟΥ".
 *   2. Substring/includes match — fallback for short/partial aliases (e.g. "ΠΡΩΤΟΓΕΝΕΣ"
 *      finding "ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ"). */
function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (rows.length === 0) return keyword;
  const keys = Object.keys(rows[0]).filter(k => !isNumericColName(k));
  const normStr = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
  const aliases = COL_ALIASES[keyword.toUpperCase()] ?? [keyword];
  // Pass 1: exact normalised match
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find(k => normStr(k) === aUp);
    if (found) return found;
  }
  // Pass 2: substring/includes fallback
  for (const alias of aliases) {
    const aUp = normStr(alias);
    const found = keys.find(k => normStr(k).includes(aUp));
    if (found) return found;
  }
  if (import.meta.env.DEV) {
    console.warn(`[Procurement] Column "${keyword}" not found. Available:`, keys);
  }
  return keyword;
}

/** Άθροισμα στήλης «Πραγματικός τζίρος 12μήνου» στο φύλλο Κοστολόγηση (στήλη Η στο PROCUREMENT_TEMPLATE).
 *  Falls back to positional lookup (column index 7 = H) when named matching fails.
 *  The positional fallback sorts dataKeys by canonical costing template order so that
 *  alphabetical / underscore-keyed Firestore docs still resolve to the correct column. */
function getCostingReal12mTurnover(rows: Record<string, unknown>[]): { sum: number; hasColumn: boolean } {
  if (rows.length === 0) return { sum: 0, hasColumn: false };
  let col = findCol(rows, 'ΠΡΑΓΜΑΤΙΚΟΣ ΤΖΙΡΟΣ 12ΜΗΝΟΥ');
  const first = rows[0];
  let hasColumn = col in first && first[col] !== undefined;

  // Positional fallback: column H = index 7 of data columns (after stripping metadata keys).
  // Sort by canonical costing column order (normalising underscores/spaces) so the correct
  // column is always at position 7 regardless of Firestore key ordering.
  if (!hasColumn) {
    const normK = (s: string) => s.toUpperCase().replace(/[\s\n\r_]+/g, ' ').trim();
    const canonicalNorm = CANONICAL_COLUMN_ORDER['costing'].map(normK);
    const dataKeys = Object.keys(first)
      .filter(k => !EXCLUDED_KEYS.has(k) && !isNumericColName(k))
      .sort((a, b) => {
        const ia = canonicalNorm.indexOf(normK(a));
        const ib = canonicalNorm.indexOf(normK(b));
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      });
    if (dataKeys.length > 7) {
      col = dataKeys[7];
      hasColumn = col in first;
    }
  }

  const kodikosKey = Object.keys(rows[0]).find(k => k.toUpperCase().replace(/[\s_]+/g, '') === 'ΚΩΔΙΚΟΣ') ?? 'ΚΩΔΙΚΟΣ';
  const productRows = rows.filter(r => {
    const v = r[kodikosKey];
    return v != null && String(v).trim() !== '';
  });
  const sum = productRows.reduce((s, r) => s + parseNum(r[col]), 0);
  return { sum, hasColumn };
}

function isNumericLike(v: string): boolean {
  if (!v.trim()) return false;
  const cleaned = v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  return !isNaN(parseFloat(cleaned)) && cleaned !== '' && isFinite(Number(cleaned));
}

function formatNumCell(raw: string): string {
  const n = parseNum(raw);
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString('el-GR');
  }
  return n.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Normalizes a header key for canonical ordering lookup (case/whitespace/underscore/dot-insensitive). */
function normalizeHeader(s: string): string {
  return s.toUpperCase().replace(/[._\s]+/g, ' ').trim();
}

/** Returns the position of `key` in the canonical list for `sheet`. Unknown keys go after known ones. */
function canonicalOrderIndex(sheet: ProcurementSheetType, key: string): number {
  const order = CANONICAL_COLUMN_ORDER[sheet];
  if (!order || order.length === 0) return Number.MAX_SAFE_INTEGER;
  const nk = normalizeHeader(key);
  const idx = order.findIndex(c => normalizeHeader(c) === nk);
  return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
}

/** A column counts as "empty" when all its values are null/undefined/empty/'-'. */
function isColumnEmpty(rows: Record<string, unknown>[], col: string): boolean {
  return !rows.some(r => {
    const v = r[col];
    if (v == null) return false;
    const s = String(v).trim();
    return s !== '' && s !== '-';
  });
}

function getSummary(key: ProcurementSheetType, rows: Record<string, unknown>[]) {
  const count = rows.length;
  if (count === 0) {
    if (key === 'customer_evaluation') return { count, primary: '—', secondary: 'Δεν υπάρχει το υποσύστημα' };
    return { count, primary: '—', secondary: '' };
  }
  const fmt0 = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 0 });
  const fmt2 = (n: number) => n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  switch (key) {
    case 'inventory': {
      const stockCol  = findCol(rows, 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
      const refillQtyCol = findCol(rows, 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ');
      const refillValCol = findCol(rows, 'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ');
      const sumStock = rows.reduce((s, r) => s + parseNum(r[stockCol]), 0);
      const refillRows = rows.filter(r => parseNum(r[refillQtyCol]) > 0);
      const toRefill = refillRows.length;
      const refillValue = refillRows.reduce((s, r) => s + parseNum(r[refillValCol]), 0);
      const secParts: string[] = [];
      if (toRefill > 0) secParts.push(`${fmt0(toRefill)} SKU για ανατροφοδοσία`);
      if (refillValue > 0) secParts.push(`Αξία ανατροφ.: €${fmt0(refillValue)}`);
      return {
        count,
        primary: fmt0(sumStock),
        secondary: secParts.join(' · ') || 'Σύνολο τεμαχίων διαθέσιμου αποθέματος',
      };
    }
    case 'costing': {
      const primCol = findCol(rows, 'ΠΡΩΤΟΓΕΝΕΣ');
      const secCol  = findCol(rows, 'ΔΕΥΤΕΡΟΓΕΝΕΣ');
      const totals = rows
        .map(r => parseNum(r[primCol]) + parseNum(r[secCol]))
        .filter(n => n > 0);
      const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
      return { count, primary: `€${fmt2(avg)}`, secondary: 'Μέσο συνολικό κόστος (πρωτογενές + δευτερογενές)' };
    }
    case 'item_evaluation': {
      const evalCol = findCol(rows, 'ΑΞΙΟΛΟΓΗΣΗ');
      const dist: Record<string, number> = {};
      rows.forEach(r => {
        const cat = String(r[evalCol] ?? '').trim();
        if (cat) dist[cat] = (dist[cat] ?? 0) + 1;
      });
      const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
      const top = entries[0];
      return {
        count,
        primary: top ? `${fmt0(top[1])} · ${top[0]}` : fmt0(count),
        secondary: entries.slice(0, 3).map(([k, v]) => `${k}: ${fmt0(v)}`).join(' · ') || 'Κατανομή αξιολογήσεων',
      };
    }
    case 'customer_evaluation': {
      const scoreCol = findCol(rows, 'ΒΑΘΜΟΛΟΓΙΑ');
      const evalCol = findCol(rows, 'ΑΞΙΟΛΟΓΗΣΗ');
      const scores = rows.map(r => parseNum(r[scoreCol])).filter(Boolean);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const vip = rows.filter(r => String(r[evalCol] ?? '').toUpperCase() === 'VIP').length;
      return { count, primary: avg.toFixed(1), secondary: vip > 0 ? `${vip} VIP πελάτες` : 'Μέση βαθμολογία' };
    }
    case 'pricing_policy': {
      const productRows = getProductRows(rows);
      const src = productRows.length > 0 ? productRows : rows;
      const priceCol = findCol(rows, 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ');
      const costCol  = findCol(rows, 'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ');
      const pairs = src
        .map(r => ({ p: parseNum(r[priceCol]), c: parseNum(r[costCol]) }))
        .filter(x => x.p > 0);
      const avgPrice = pairs.length ? pairs.reduce((s, x) => s + x.p, 0) / pairs.length : 0;
      const withCost = pairs.filter(x => x.c > 0);
      // Aggregate margin: (avgPrice - avgCost) / avgPrice (matches Excel calculation)
      const avgCost  = withCost.length ? withCost.reduce((s, x) => s + x.c, 0) / withCost.length : 0;
      const avgMargin = avgPrice > 0 ? (avgPrice - avgCost) / avgPrice : 0;
      const marginPart = withCost.length ? ` · Περιθώριο: ${(avgMargin * 100).toFixed(1)}%` : '';
      return {
        count,
        primary: `€${fmt2(avgPrice)}`,
        secondary: `Μέση τιμή πώλησης ανά SKU${marginPart}`,
      };
    }
    case 'fiscal_year': {
      const { turnover, profit, marginPct } = getFiscalYearTotals(rows);
      return { count, primary: `€${fmt0(turnover)}`, secondary: `Κέρδος: €${fmt0(profit)} (${(marginPct * 100).toFixed(1)}%)` };
    }
    case 'statistics':
      return { count, primary: fmt0(count), secondary: 'μετρικές' };
    default:
      return { count, primary: String(count), secondary: '' };
  }
}

/**
 * Identifies the "metric name" column in statistics rows by finding
 * the key whose values are mostly non-numeric (text) strings.
 * Needed because Firestore returns fields in undefined order, so we
 * cannot rely on allKeys[0] being the label column.
 */
function findStatMetricColumn(rows: Record<string, unknown>[], excludedKeys: Set<string>): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]).filter(k => !excludedKeys.has(k));
  if (keys.length === 0) return '';
  let bestKey = keys[0];
  let bestScore = -1;
  for (const key of keys) {
    const values = rows.map(r => String(r[key] ?? '').trim()).filter(Boolean);
    const textCount = values.filter(v => !isNumericLike(v)).length;
    if (textCount > bestScore) {
      bestScore = textCount;
      bestKey = key;
    }
  }
  return bestKey;
}

function getChartData(key: ProcurementSheetType, rows: Record<string, unknown>[]) {
  switch (key) {
    case 'inventory': {
      const stockCol = findCol(rows, 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
      const evalCol  = findCol(rows, 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ');
      const codeCol  = findCol(rows, 'ΚΩΔΙΚΟΣ');
      return [...rows]
        .map(r => ({ name: String(r[codeCol] ?? ''), stock: parseNum(r[stockCol]), eval: String(r[evalCol] ?? 'C') }))
        .filter(r => r.stock > 0)
        .sort((a, b) => b.stock - a.stock)
        .slice(0, TOP_N);
    }
    case 'costing': {
      const primCol = findCol(rows, 'ΠΡΩΤΟΓΕΝΕΣ');
      const secCol  = findCol(rows, 'ΔΕΥΤΕΡΟΓΕΝΕΣ');
      const codeCol = findCol(rows, 'ΚΩΔΙΚΟΣ');
      return [...rows]
        .map(r => ({ name: String(r[codeCol] ?? ''), primary: parseNum(r[primCol]), secondary: parseNum(r[secCol]) }))
        .filter(r => r.primary > 0)
        .sort((a, b) => b.primary - a.primary)
        .slice(0, TOP_N);
    }
    case 'item_evaluation': {
      const evalCol = findCol(rows, 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ');
      const dist: Record<string, number> = {};
      rows.forEach(r => { const cat = String(r[evalCol] ?? '').trim() || 'Χωρίς'; dist[cat] = (dist[cat] ?? 0) + 1; });
      return Object.entries(dist).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    }
    case 'customer_evaluation': {
      const evalCol = findCol(rows, 'ΑΞΙΟΛΟΓΗΣΗ');
      const dist: Record<string, number> = {};
      rows.forEach(r => { const cat = String(r[evalCol] ?? '').trim() || 'Χωρίς'; dist[cat] = (dist[cat] ?? 0) + 1; });
      return Object.entries(dist).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    }
    case 'pricing_policy': {
      const productRows = getProductRows(rows);
      const src = productRows.length > 0 ? productRows : rows;
      const costCol  = findCol(src, 'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ');
      const priceCol = findCol(src, 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ');
      const codeCol  = findCol(src, 'ΚΩΔΙΚΟΣ');
      return [...src]
        .map(r => ({ name: String(r[codeCol] ?? ''), cost: parseNum(r[costCol]), price: parseNum(r[priceCol]) }))
        .filter(r => r.price > 0 && r.name !== '')
        .sort((a, b) => b.price - a.price)
        .slice(0, TOP_N);
    }
    case 'fiscal_year': {
      const productRows = getProductRows(rows);
      const src = productRows.length > 0 ? productRows : rows;
      const turnoverCol = findCol(src, 'ΤΖΙΡΟΣ');
      const profitCol   = findCol(src, 'ΚΕΡΔΟΣ');
      const codeCol     = findCol(src, 'ΚΩΔΙΚΟΣ');
      return [...src]
        .map(r => ({ name: String(r[codeCol] ?? ''), turnover: parseNum(r[turnoverCol]), profit: parseNum(r[profitCol]) }))
        .filter(r => r.turnover !== 0 && r.name !== '')
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, TOP_N);
    }
    case 'statistics': {
      if (rows.length === 0) return [];
      const metricKey = findStatMetricColumn(rows, EXCLUDED_KEYS);
      const allKeys = Object.keys(rows[0]).filter(k => !EXCLUDED_KEYS.has(k) && !isNumericColName(k));
      const periodKeys = allKeys.filter(k => k !== metricKey);
      return periodKeys.map(period => {
        const point: Record<string, unknown> = { period };
        rows.forEach(r => {
          const name = String(r[metricKey] ?? '').slice(0, 30);
          if (name) point[name] = parseNum(r[period]);
        });
        return point;
      });
    }
    default:
      return [];
  }
}

function getStatSeriesNames(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const metricKey = findStatMetricColumn(rows, EXCLUDED_KEYS);
  return rows.map(r => String(r[metricKey] ?? '').slice(0, 30)).filter(Boolean);
}

// ── Chart component ───────────────────────────────────────────────────────────

const Y_AXIS_WIDTH = 115;

function ProcurementChart({ tabKey, rows }: { tabKey: ProcurementSheetType; rows: Record<string, unknown>[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (rows.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartData = getChartData(tabKey, rows) as any[];
  if (chartData.length === 0) return null;

  const W = chartWidth;
  const axisStyle = { fill: '#57606a', fontSize: 11 };
  const marginH = { top: 5, right: 20, left: 0, bottom: 5 };
  const marginV = { top: 10, right: 10, left: 0, bottom: 5 };

  // Horizontal bar charts — Top N items
  if (tabKey === 'inventory') {
    const H = Math.max(200, chartData.length * 34 + 30);
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart layout="vertical" width={W} height={H} data={chartData} margin={marginH}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => Number(v).toLocaleString('el-GR')} />
          <YAxis type="category" dataKey="name" width={Y_AXIS_WIDTH} tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip formatter={(v: number | undefined) => [Number(v ?? 0).toLocaleString('el-GR'), 'Απόθεμα']} />
          <Bar dataKey="stock" radius={[0, 4, 4, 0]} barSize={20}>
            {chartData.map((entry: { eval: string }, i: number) => (
              <Cell key={i} fill={EVAL_COLORS[entry.eval] ?? CHART_COLORS.accent} />
            ))}
          </Bar>
        </BarChart>
      </div>
    );
  }

  if (tabKey === 'costing') {
    const H = Math.max(200, chartData.length * 42 + 40);
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart layout="vertical" width={W} height={H} data={chartData} margin={marginH}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
          <YAxis type="category" dataKey="name" width={Y_AXIS_WIDTH} tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${(v ?? 0).toFixed(2)}`, name === 'primary' ? 'Πρωτογενές κόστος' : 'Δευτερογενές κόστος']} />
          <Legend formatter={(v: string) => v === 'primary' ? 'Πρωτογενές κόστος' : 'Δευτερογενές κόστος'} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="primary" fill={CHART_COLORS.accent} radius={[0, 4, 4, 0]} barSize={13} />
          <Bar dataKey="secondary" fill={CHART_COLORS.secondary} radius={[0, 4, 4, 0]} barSize={13} />
        </BarChart>
      </div>
    );
  }

  // Distribution charts — count per category
  if (tabKey === 'item_evaluation') {
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart width={W} height={220} data={chartData} margin={marginV}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
          <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
          <RechartsTooltip formatter={(v: number | undefined) => [v ?? 0, 'Αριθμός ειδών']} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
            {chartData.map((entry: { name: string }, i: number) => (
              <Cell key={i} fill={EVAL_COLORS[entry.name] ?? CHART_COLORS.info} />
            ))}
          </Bar>
        </BarChart>
      </div>
    );
  }

  if (tabKey === 'customer_evaluation') {
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart width={W} height={220} data={chartData} margin={marginV}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
          <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
          <RechartsTooltip formatter={(v: number | undefined) => [v ?? 0, 'Αριθμός πελατών']} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
            {chartData.map((entry: { name: string }, i: number) => (
              <Cell key={i} fill={EVAL_COLORS[entry.name] ?? CHART_COLORS.purple} />
            ))}
          </Bar>
        </BarChart>
      </div>
    );
  }

  if (tabKey === 'pricing_policy') {
    const H = Math.max(200, chartData.length * 42 + 40);
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart layout="vertical" width={W} height={H} data={chartData} margin={marginH}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
          <YAxis type="category" dataKey="name" width={Y_AXIS_WIDTH} tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${(v ?? 0).toFixed(2)}`, name === 'cost' ? 'Συνολικό κόστος' : 'Μέση τιμή πώλησης']} />
          <Legend formatter={(v: string) => v === 'cost' ? 'Συνολικό κόστος' : 'Μέση τιμή πώλησης'} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="cost" fill={CHART_COLORS.secondary} radius={[0, 4, 4, 0]} barSize={13} />
          <Bar dataKey="price" fill={CHART_COLORS.accent} radius={[0, 4, 4, 0]} barSize={13} />
        </BarChart>
      </div>
    );
  }

  if (tabKey === 'fiscal_year') {
    const H = Math.max(200, chartData.length * 42 + 40);
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <BarChart layout="vertical" width={W} height={H} data={chartData} margin={marginH}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${Number(v).toLocaleString('el-GR', { maximumFractionDigits: 0 })}`} />
          <YAxis type="category" dataKey="name" width={Y_AXIS_WIDTH} tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${Number(v ?? 0).toLocaleString('el-GR')}`, name === 'turnover' ? 'Τζίρος' : 'Κέρδος']} />
          <Legend formatter={(v: string) => v === 'turnover' ? 'Τζίρος' : 'Κέρδος'} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="turnover" fill={CHART_COLORS.info} radius={[0, 4, 4, 0]} barSize={13} />
          <Bar dataKey="profit" fill={CHART_COLORS.success} radius={[0, 4, 4, 0]} barSize={13} />
        </BarChart>
      </div>
    );
  }

  if (tabKey === 'statistics') {
    const allSeriesNames = getStatSeriesNames(rows);
    const seriesNames = allSeriesNames.slice(0, 6);
    const hiddenCount = allSeriesNames.length - seriesNames.length;
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <LineChart width={W} height={240} data={chartData} margin={marginV}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
          <XAxis dataKey="period" tick={axisStyle} tickLine={false} axisLine={false} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip wrapperStyle={{ fontSize: 11 }} />
          {seriesNames.map((name, i) => (
            <Line key={name} type="monotone" dataKey={name} stroke={STAT_LINE_COLORS[i % STAT_LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
        {hiddenCount > 0 && (
          <p className="text-xs text-[var(--nts-medium-gray)] mt-2">+{hiddenCount} ακόμα μετρικές στον πίνακα παρακάτω</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {seriesNames.map((name, i) => (
            <div key={name} className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: STAT_LINE_COLORS[i % STAT_LINE_COLORS.length] }} />
              <span className="text-[11px] text-[var(--nts-medium-gray)]">{name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ── Excel-style column filter dropdown ────────────────────────────────────────

function ColumnFilterDropdown({
  column, allValues, selectedValues, onApply, onClose,
}: {
  column: string;
  allValues: string[];
  selectedValues: string[];
  onApply: (vals: string[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [local, setLocal] = useState<string[]>(() =>
    selectedValues.length > 0 ? selectedValues : allValues
  );

  const filtered = allValues.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  const filteredAllChecked = filtered.length > 0 && filtered.every(v => local.includes(v));

  const toggleValue = (v: string) =>
    setLocal(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  const toggleAll = () =>
    setLocal(prev =>
      filteredAllChecked
        ? prev.filter(v => !filtered.includes(v))
        : [...new Set([...prev, ...filtered])]
    );

  return (
    <div className="bg-white border border-[var(--nts-border-gray)] rounded-lg shadow-2xl w-56 overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)]">
        <p className="text-[11px] font-semibold text-[var(--nts-charcoal)] truncate">{column}</p>
      </div>
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)] pointer-events-none" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Αναζήτηση..."
            className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-[var(--nts-border-gray)] rounded focus:outline-none focus:border-[var(--nts-accent)]"
          />
        </div>
      </div>
      <div className="px-2 pb-0.5 border-b border-[var(--nts-border-gray)] mb-1">
        <label className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-[var(--nts-light-gray)] rounded text-[11px] font-semibold text-[var(--nts-charcoal)]">
          <input type="checkbox" checked={filteredAllChecked} onChange={toggleAll} className="accent-[var(--nts-accent)]" />
          (Επιλογή όλων)
        </label>
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto' }} className="px-2 pb-1 space-y-0.5">
        {filtered.map(v => (
          <label key={v} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer hover:bg-[var(--nts-light-gray)] rounded text-[11px] text-[var(--nts-charcoal)]">
            <input type="checkbox" checked={local.includes(v)} onChange={() => toggleValue(v)} className="accent-[var(--nts-accent)]" />
            <span className="truncate">{v || '(κενό)'}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-[var(--nts-medium-gray)] px-1 py-2 text-center">Δεν βρέθηκαν αποτελέσματα</p>
        )}
      </div>
      <div className="flex gap-2 px-2 py-2 border-t border-[var(--nts-border-gray)]">
        <button
          onClick={() => onApply(local.length === allValues.length ? [] : local)}
          className="flex-1 py-1.5 text-[11px] font-semibold bg-[var(--nts-accent)] text-white rounded hover:opacity-90 transition-opacity"
        >
          Εφαρμογή
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-1.5 text-[11px] border border-[var(--nts-border-gray)] rounded hover:bg-[var(--nts-light-gray)] transition-colors"
        >
          Άκυρο
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProcurementPageProps {
  onSectionChange?: (section: string) => void;
}

export function ProcurementPage({ onSectionChange }: ProcurementPageProps = {}) {
  const toast = useToast();
  const { currentBrand } = useBrand();
  const { data, isRefreshing, hasData, invalidate, isSheetLoading } = useProcurement();
  // Full-page spinner ΜΟΝΟ για τα sheets που τροφοδοτούν την επισκόπηση/KPIs. Τα υπόλοιπα
  // (pricing_policy/customer_evaluation/fiscal_year/statistics) φορτώνουν στο παρασκήνιο και
  // εμφανίζονται όταν ανοίξει το αντίστοιχο tab → η σελίδα εμφανίζεται πολύ νωρίτερα.
  const criticalLoading = isSheetLoading('inventory') || isSheetLoading('costing') || isSheetLoading('item_evaluation');
  const { refresh: refreshProcurementSignals } = useRefreshProcurementSignals();
  const { monthlyRevenue, totalRevenue, hasData: hasEcommerce } = useEcommerceSummary();
  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview');
  const [activeTab, setActiveTab] = useState<ProcurementSheetType>('inventory');
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedDemo = async () => {
    if (!currentBrand?.id) { toast.error('Επιλέξτε brand'); return; }
    setIsSeeding(true);
    try {
      const count = await seedProcurementDemoData(
        currentBrand.id,
        (coll, items, bid) => ProcurementService.batchSet(coll, items, bid ?? undefined),
      );
      await invalidate();
      refreshProcurementSignals().catch(() => {});
      toast.success(`Φορτώθηκαν ${count} ενδεικτικές εγγραφές.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Σφάλμα κατά τη φόρτωση');
    } finally {
      setIsSeeding(false);
    }
  };

  // Global KPIs for the overview header
  const globalKPIs = useMemo(() => {
    const invRows = (data.inventory ?? []) as Record<string, unknown>[];
    const itemRows = (data.item_evaluation ?? []) as Record<string, unknown>[];
    const fmt0 = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 0 });

    const codeCol  = findCol(invRows, 'ΚΩΔΙΚΟΣ');
    const stockCol = findCol(invRows, 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
    const costCol  = findCol(invRows, 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ');
    const scoreCol = findCol(itemRows, 'ΒΑΘΜΟΛΟΓΙΑ');

    const uniqueSkus = new Set(
      invRows.map(r => String(r[codeCol] ?? '').trim()).filter(Boolean)
    ).size;
    const totalValue = invRows.reduce((s, r) => s + parseNum(r[costCol]) * parseNum(r[stockCol]), 0);

    const costRows = (data.costing ?? []) as Record<string, unknown>[];
    const { sum: costing12mSum, hasColumn: hasCosting12mCol } = getCostingReal12mTurnover(costRows);

    // Πραγματικός τζίρος 12μήνου: κύρια πηγή = άθροισμα Κοστολόγηση (στήλη Η)· εναλλακτικά e-shop όταν δεν υπάρχει η στήλη στο αρχείο
    const last12Revenue = (() => {
      if (hasCosting12mCol) return costing12mSum;
      if (!hasEcommerce) return 0;
      if (monthlyRevenue.length === 0) return totalRevenue;
      return monthlyRevenue.slice(-12).reduce((s, m) => s + (m.revenue ?? 0), 0);
    })();

    const productItemRows = getProductRows(itemRows);
    const scoreBase = productItemRows.length > 0 ? productItemRows : itemRows;
    const scores = scoreBase.map(r => parseNum(r[scoreCol])).filter(Boolean);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return [
      { label: 'Συνολικά SKUs', value: uniqueSkus > 0 ? uniqueSkus.toLocaleString('el-GR') : '—', Icon: Tag },
      { label: 'Αξία Αποθέματος', value: totalValue > 0 ? `€${fmt0(totalValue)}` : '—', Icon: Package },
      { label: 'Πραγματικός Τζίρος 12μήνου', value: last12Revenue > 0 ? `€${fmt0(last12Revenue)}` : '—', Icon: DollarSign },
      { label: 'Μέση Βαθμολογία Ειδών', value: scores.length > 0 ? avgScore.toFixed(1) : '—', Icon: Star },
    ];
  }, [data, monthlyRevenue, totalRevenue, hasEcommerce]);

  const tabs = SHEET_KEYS.map(key => ({
    id: key,
    label: PROCUREMENT_SHEET_LABELS[key],
    icon: SHEET_ICONS[key],
    count: data[key]?.length ?? 0,
  }));

  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState<{ col: string; rect: DOMRect } | null>(null);
  const [showChart, setShowChart] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const PAGE_SIZE = 20;

  const rawActiveData = (data[activeTab] ?? []) as Record<string, unknown>[];

  /**
   * For statistics: filter out metric rows that have no values across all period columns.
   * (If a stat couldn't be produced, we hide it — we don't want the client asking for it.)
   */
  const activeData = useMemo(() => {
    if (activeTab !== 'statistics' || rawActiveData.length === 0) return rawActiveData;
    const metricCol = findStatMetricColumn(rawActiveData, EXCLUDED_KEYS);
    const periodCols = Object.keys(rawActiveData[0]).filter(
      k => !EXCLUDED_KEYS.has(k) && !isNumericColName(k) && k !== metricCol,
    );
    return rawActiveData.filter(row =>
      periodCols.some(k => {
        const v = row[k];
        if (v == null) return false;
        const s = String(v).trim();
        return s !== '' && s !== '-' && parseNum(s) !== 0;
      }),
    );
  }, [rawActiveData, activeTab]);

  /**
   * Headers: union of ALL row keys (Firestore may omit empty fields per-row) →
   * filter out empty columns → apply canonical template order → pin metric col for stats.
   */
  const headers = useMemo(() => {
    if (activeData.length === 0) return [];
    const keySet = new Set<string>();
    activeData.forEach(r => {
      Object.keys(r).forEach(k => {
        if (!EXCLUDED_KEYS.has(k) && !isNumericColName(k)) keySet.add(k);
      });
    });
    const allKeys = [...keySet].filter(k => !isColumnEmpty(activeData, k));

    if (activeTab === 'statistics') {
      const metricCol = findStatMetricColumn(activeData, EXCLUDED_KEYS);
      return [metricCol, ...allKeys.filter(k => k !== metricCol)];
    }

    return allKeys.slice().sort((a, b) => {
      const ia = canonicalOrderIndex(activeTab, a);
      const ib = canonicalOrderIndex(activeTab, b);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, 'el');
    });
  }, [activeData, activeTab]);

  // Reset on tab change
  useEffect(() => { setColFilters({}); setOpenFilter(null); setCurrentPage(0); }, [activeTab]);
  // Reset page on filter change
  useEffect(() => { setCurrentPage(0); }, [colFilters]);

  const columnUniqueValues = useMemo(() => {
    const result: Record<string, string[]> = {};
    headers.forEach(h => {
      result[h] = [...new Set(activeData.map(r => String(r[h] ?? '')))].sort((a, b) => {
        const na = parseNum(a), nb = parseNum(b);
        if (na !== 0 || nb !== 0) return na - nb;
        return a.localeCompare(b, 'el');
      });
    });
    return result;
  }, [activeData, headers]);

  const filteredData = useMemo(() => {
    const entries = Object.entries(colFilters).filter(([, v]) => v.length > 0);
    if (entries.length === 0) return activeData;
    return activeData.filter(row =>
      entries.every(([col, vals]) => vals.includes(String(row[col] ?? '')))
    );
  }, [activeData, colFilters]);

  const hasFilters = Object.values(colFilters).some(v => v.length > 0);

  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  const pageData = filteredData.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Detect column types from data samples for proportional widths
  type ColType = 'badge' | 'number' | 'code' | 'text';
  const columnTypes = useMemo((): Record<string, ColType> => {
    if (activeData.length === 0) return {};
    return Object.fromEntries(headers.map(h => {
      if (BADGE_KEYS.has(h)) return [h, 'badge' as ColType];
      const hUp = h.toUpperCase();
      if (hUp.match(/^(ΚΩΔΙΚΟΣ|ΚΩΔ\.?|ΑΑ|ΑΡ\.|ΑΡΙΘ|ID)$/)) return [h, 'code' as ColType];
      if (hUp.includes('ΚΩΔΙΚΟΣ') && hUp.length < 18) return [h, 'code' as ColType];
      const samples = activeData.slice(0, 30).map(r => String(r[h] ?? '')).filter(Boolean);
      const numRatio = samples.length ? samples.filter(v => isNumericLike(v)).length / samples.length : 0;
      if (numRatio >= 0.7) return [h, 'number' as ColType];
      return [h, 'text' as ColType];
    }));
  }, [activeData, headers]);


  if (criticalLoading) {
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }

  const actionsBar = (showBack = false) => (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--nts-border-gray)]">
      {showBack ? (
        <button
          onClick={() => setViewMode('overview')}
          className="flex items-center gap-1.5 text-sm text-[var(--nts-accent)] hover:underline font-medium"
        >
          <ArrowLeft size={16} />
          Επισκόπηση
        </button>
      ) : (
        <p className="text-sm text-[var(--nts-medium-gray)]">
          Κάθε import αντικαθιστά τα τρέχοντα δεδομένα · snapshot αποθηκεύεται αυτόματα (τελευταία 5).
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleSeedDemo} disabled={isSeeding}>
          {isSeeding ? 'Φόρτωση…' : 'Ενδεικτικά δεδομένα'}
        </Button>
        {onSectionChange && (
          <Button onClick={() => onSectionChange('data-procurement')} variant="secondary" size="sm">
            Νέο Import
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      <PageHeader
        toolbarAriaLabel="Κατάσταση procurement"
        title={<h2 className="text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">Procurement</h2>}
        description={
          <p className="text-[14px] text-[var(--nts-medium-gray)]">
            Δεδομένα από 7 αναλύσεις (PROCUREMENT_TEMPLATE.xlsx). Εισαγωγή από την καρτέλα Procurement.
          </p>
        }
        actions={
          isRefreshing ? (
            <div className="inline-flex min-h-[36px] items-center gap-1.5 self-start rounded-full border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] px-2.5 py-1 text-[11px] text-[var(--nts-medium-gray)] lg:self-center">
              <Spinner size="sm" />
              Ανανέωση…
            </div>
          ) : undefined
        }
      />

      {!hasData ? (

        /* ── Empty state ────────────────────────────────────────────────────── */
        <Card padding="lg" className="border-2 border-dashed border-[var(--nts-border-gray)]">
          <div className="text-center py-12">
            <Upload size={48} className="text-[var(--nts-medium-gray)] mx-auto mb-4" />
            <p className="text-lg font-medium text-[var(--nts-charcoal)] mb-1">Δεν υπάρχουν δεδομένα Procurement</p>
            <p className="text-sm text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Φόρτωσε αρχείο Excel με τη δομή PROCUREMENT_TEMPLATE.xlsx (7 καρτέλες) στην ενότητα Procurement.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={handleSeedDemo} disabled={isSeeding} variant="secondary" size="sm">
                {isSeeding ? 'Φόρτωση…' : 'Φόρτωση ενδεικτικών δεδομένων'}
              </Button>
              {onSectionChange && (
                <Button onClick={() => onSectionChange('data-procurement')} variant="primary">
                  Άνοιγμα εισαγωγής Procurement
                </Button>
              )}
            </div>
          </div>
        </Card>

      ) : viewMode === 'overview' ? (

        /* ── Overview ───────────────────────────────────────────────────────── */
        <>
          {actionsBar(false)}

          {/* 4 global KPI cards */}
          {isRefreshing && (
            <div className="text-[11px] text-[var(--nts-medium-gray)] -mt-1">
              Γίνεται ανανέωση KPI από το τελευταίο import...
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {globalKPIs.map(({ label, value, Icon }) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)] px-5 py-4 border-l-4 border-l-[var(--nts-accent)]"
                style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[12px] font-medium text-[var(--nts-medium-gray)]">{label}</p>
                  <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
                    <Icon size={13} className="text-[var(--nts-medium-gray)]" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-[var(--nts-charcoal)] font-mono tracking-tight">{value}</p>
              </div>
            ))}
          </div>

          {/* 7 analysis cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {SHEET_KEYS.map(key => {
              const rows = (data[key] ?? []) as Record<string, unknown>[];
              const { count, primary, secondary } = getSummary(key, rows);
              return (
                <div
                  key={key}
                  onClick={() => { setActiveTab(key); setViewMode('detail'); }}
                  className="group rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)] p-5 flex flex-col cursor-pointer border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)] transition-all"
                  style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
                >
                  {/* Icon + label */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${SHEET_ICON_BG[key]}`}>
                      {SHEET_ICONS[key]}
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[var(--nts-medium-gray)] leading-tight">
                        {PROCUREMENT_SHEET_LABELS[key]}
                      </p>
                      <p className="text-[11px] text-[var(--nts-medium-gray)] mt-0.5">
                        {count > 0 ? `${count} εγγραφές` : <span className="text-[#EF4444]">Χωρίς δεδομένα</span>}
                      </p>
                    </div>
                  </div>

                  {/* Primary value */}
                  <p className="text-2xl font-bold text-[var(--nts-charcoal)] font-mono tracking-tight mb-1">{primary}</p>
                  {secondary && (
                    <p className="text-xs text-[var(--nts-medium-gray)]">{secondary}</p>
                  )}

                  {/* CTA */}
                  <div className="mt-auto pt-4 flex items-center gap-1 text-xs font-semibold text-[var(--nts-medium-gray)] group-hover:text-[var(--nts-accent)] transition-colors">
                    Δείτε αναλυτικά <ChevronRight size={13} />
                  </div>
                </div>
              );
            })}
          </div>
        </>

      ) : (

        /* ── Detail view ─────────────────────────────────────────────────────── */
        <>
          {actionsBar(true)}

          {/* Tab bar */}
          <div className="border-b border-[var(--nts-border-gray)]">
            <div className="flex flex-wrap gap-0">
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`group relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap focus:outline-none ${
                      isActive
                        ? 'text-[var(--nts-accent)]'
                        : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]'
                    }`}
                  >
                    {/* Active underline */}
                    <span
                      className={`absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full transition-all duration-200 ${
                        isActive ? 'bg-[var(--nts-accent)]' : 'bg-transparent group-hover:bg-[var(--nts-border-gray)]'
                      }`}
                    />
                    <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                      {tab.icon}
                    </span>
                    <span>{tab.label}</span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 ${
                        isActive
                          ? 'bg-[var(--nts-accent)] text-white'
                          : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] group-hover:bg-[var(--nts-border-gray)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart card */}
          {activeData.length > 0 && (
            <Card padding="lg">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[12px] font-semibold text-[var(--nts-medium-gray)]" style={{ textTransform: 'none' }}>
                  {CHART_TITLES[activeTab]}
                </p>
                <button
                  onClick={() => setShowChart(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)] transition-colors"
                >
                  {showChart ? (
                    <><EyeOff size={13} /> Απόκρυψη</>
                  ) : (
                    <><BarChart3 size={13} /> Εμφάνιση γραφήματος</>
                  )}
                </button>
              </div>
              {showChart && <ProcurementChart tabKey={activeTab} rows={activeData} />}
            </Card>
          )}

          {/* Data table */}
          <Card padding="none">
            {/* Status bar */}
            {activeData.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)]">
                <span className="text-[11px] text-[var(--nts-medium-gray)]">
                  {filteredData.length < activeData.length
                    ? `${filteredData.length.toLocaleString('el-GR')} από ${activeData.length.toLocaleString('el-GR')} εγγραφές`
                    : `${activeData.length.toLocaleString('el-GR')} εγγραφές`}
                  {totalPages > 1 && ` · Σελίδα ${currentPage + 1} από ${totalPages}`}
                </span>
                {hasFilters && (
                  <button
                    onClick={() => setColFilters({})}
                    className="flex items-center gap-1 text-[11px] text-[var(--nts-accent)] hover:underline"
                  >
                    <X size={11} /> Καθαρισμός φίλτρων
                  </button>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              {activeData.length === 0 ? (
                isSheetLoading(activeTab) ? (
                  <div className="flex items-center justify-center gap-3 p-8 text-[var(--nts-medium-gray)]">
                    <Spinner size="md" />
                    <span>Φόρτωση δεδομένων…</span>
                  </div>
                ) : (
                  <div className="p-8 text-center text-[var(--nts-medium-gray)]">Καμία εγγραφή σε αυτή την καρτέλα.</div>
                )
              ) : (
                <table className="text-sm">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr className="border-b border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)]">
                      {headers.map(h => {
                        const isFiltered = (colFilters[h]?.length ?? 0) > 0;
                        const ct = columnTypes[h] ?? 'text';
                        const isNumCol = ct === 'number' || ct === 'badge';
                        return (
                          <th
                            key={h}
                            className="px-3 py-0 font-semibold text-[var(--nts-charcoal)] text-[11px]"
                          >
                            <button
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setOpenFilter(prev => prev?.col === h ? null : { col: h, rect });
                              }}
                              className={`flex items-start gap-1 w-full py-2.5 group ${isNumCol ? 'justify-center' : 'justify-between'}`}
                            >
                              <span
                                className="leading-tight"
                                style={{ whiteSpace: 'normal', overflowWrap: 'normal', maxWidth: 130 }}
                              >
                                {h}
                              </span>
                              <ChevronDown
                                size={11}
                                className={`flex-shrink-0 mt-0.5 transition-colors ${isFiltered ? 'text-[var(--nts-accent)]' : 'text-[var(--nts-medium-gray)] opacity-40 group-hover:opacity-100'}`}
                              />
                            </button>
                            {isFiltered && <div className="h-0.5 bg-[var(--nts-accent)] rounded -mt-px" />}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr>
                        <td colSpan={headers.length} className="px-4 py-8 text-center text-[11px] text-[var(--nts-medium-gray)]">
                          Κανένα αποτέλεσμα για τα επιλεγμένα φίλτρα.
                        </td>
                      </tr>
                    ) : pageData.map((row, idx) => (
                      <tr
                        key={(row as { id?: string }).id ?? idx}
                        className={`border-b border-[var(--nts-border-gray)] hover:bg-[var(--nts-accent)]/5 transition-colors ${
                          idx % 2 === 1 ? 'bg-[var(--nts-light-gray)]/40' : ''
                        }`}
                      >
                        {headers.map(h => {
                          const raw = String(row[h] ?? '');
                          const isBadge = BADGE_KEYS.has(h) && raw in BADGE_STYLES;
                          const isNum = !isBadge && isNumericLike(raw);
                          const ct = columnTypes[h] ?? 'text';
                          const isText = ct === 'text';
                          return (
                            <td
                              key={h}
                              title={isText && raw.length > 25 ? raw : undefined}
                              className={`px-3 py-2 text-[var(--nts-charcoal)] text-[12px] whitespace-nowrap ${
                                isBadge ? 'text-center' :
                                isNum ? 'text-center font-mono tabular-nums' :
                                ct === 'code' ? 'text-left font-mono' :
                                'text-left'
                              }`}
                              style={isText ? { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}
                            >
                              {isBadge ? (
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${BADGE_STYLES[raw]}`}>
                                  {raw}
                                </span>
                              ) : isNum ? formatNumCell(raw) : raw}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)]">
                <button
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium border border-[var(--nts-border-gray)] rounded hover:bg-[var(--nts-light-gray)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={13} /> Προηγούμενη
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let page = i;
                    if (totalPages > 7) {
                      const half = 3;
                      const start = Math.max(0, Math.min(currentPage - half, totalPages - 7));
                      page = start + i;
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[28px] h-7 px-2 text-[11px] font-medium rounded transition-colors ${
                          page === currentPage
                            ? 'bg-[var(--nts-accent)] text-white'
                            : 'hover:bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]'
                        }`}
                      >
                        {page + 1}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage === totalPages - 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium border border-[var(--nts-border-gray)] rounded hover:bg-[var(--nts-light-gray)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Επόμενη <ChevronRight size={13} />
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Excel-style filter dropdown — rendered outside table to avoid overflow clipping */}
      {openFilter && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenFilter(null)} />
          <div
            className="fixed z-50"
            style={{ top: openFilter.rect.bottom + 2, left: Math.min(openFilter.rect.left, window.innerWidth - 230) }}
          >
            <ColumnFilterDropdown
              column={openFilter.col}
              allValues={columnUniqueValues[openFilter.col] ?? []}
              selectedValues={colFilters[openFilter.col] ?? []}
              onApply={(vals) => {
                setColFilters(prev => {
                  const next = { ...prev };
                  if (vals.length === 0) delete next[openFilter.col];
                  else next[openFilter.col] = vals;
                  return next;
                });
                setOpenFilter(null);
              }}
              onClose={() => setOpenFilter(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}


