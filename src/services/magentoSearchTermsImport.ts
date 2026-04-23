import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../config/firebase';

export interface ParsedSearchTerm {
  term: string;
  hits: number;
  results?: number;
}

export interface MagentoSearchTermsImportResult {
  success: boolean;
  imported: number;
  totalRows: number;
  errors: string[];
  preview: ParsedSearchTerm[];
}

const SUPPORTED_EXT = ['.csv', '.xlsx', '.xls', '.tsv', '.txt'];

const TERM_KEYS = [
  'search query',
  'searchquery',
  'search_query',
  'query',
  'query_text',
  'querytext',
  'keyword',
  'term',
  'search term',
  'όρος αναζήτησης',
  'αναζήτηση',
];
const HITS_KEYS = [
  'uses',
  'use',
  'usage',
  'popularity',
  'hits',
  'count',
  'searches',
  'χρήσεις',
];
const RESULTS_KEYS = ['results', 'num_results', 'numresults', 'result', 'αποτελέσματα'];

function normalizeKey(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickColumnIndex(header: string[], aliases: string[]): number {
  const norm = header.map(normalizeKey);
  for (const alias of aliases) {
    const a = normalizeKey(alias);
    const idx = norm.indexOf(a);
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < norm.length; i++) {
    if (aliases.some((a) => norm[i].includes(normalizeKey(a)))) return i;
  }
  return -1;
}

function parseSheetToRows(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
  }) as string[][];
}

function parseDelimited(text: string): string[][] {
  const looksTSV = text.indexOf('\t') > -1 && text.indexOf(',') < 0;
  const sep = looksTSV ? '\t' : ',';
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nx = text[i + 1];
    if (ch === '"') {
      if (inQ && nx === '"') {
        field += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === sep && !inQ) {
      cur.push(field.trim());
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (field || cur.length > 0) {
        cur.push(field.trim());
        lines.push(cur);
        cur = [];
        field = '';
      }
      if (ch === '\r' && nx === '\n') i++;
    } else {
      field += ch;
    }
  }
  if (field || cur.length > 0) {
    cur.push(field.trim());
    lines.push(cur);
  }
  return lines;
}

function isSupported(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXT.some((e) => lower.endsWith(e));
}

export async function parseMagentoSearchTermsFile(file: File): Promise<{
  rows: ParsedSearchTerm[];
  totalRows: number;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!isSupported(file.name)) {
    return {
      rows: [],
      totalRows: 0,
      errors: [`Μη υποστηριζόμενος τύπος αρχείου: ${file.name}. Επιτρέπονται: ${SUPPORTED_EXT.join(', ')}`],
    };
  }

  let rows: string[][] = [];
  try {
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      const buf = await file.arrayBuffer();
      rows = parseSheetToRows(buf);
    } else {
      const text = await file.text();
      rows = parseDelimited(text);
    }
  } catch (e) {
    return {
      rows: [],
      totalRows: 0,
      errors: [`Αποτυχία ανάγνωσης αρχείου: ${e instanceof Error ? e.message : 'unknown'}`],
    };
  }

  rows = rows.filter((r) => r.some((c) => String(c ?? '').trim().length > 0));
  if (rows.length < 2) {
    return { rows: [], totalRows: 0, errors: ['Το αρχείο είναι κενό ή δεν περιέχει headers + δεδομένα.'] };
  }

  const header = rows[0].map((c) => String(c ?? '').trim());
  const termIdx = pickColumnIndex(header, TERM_KEYS);
  const hitsIdx = pickColumnIndex(header, HITS_KEYS);
  const resultsIdx = pickColumnIndex(header, RESULTS_KEYS);

  if (termIdx < 0 || hitsIdx < 0) {
    return {
      rows: [],
      totalRows: rows.length - 1,
      errors: [
        `Δεν βρέθηκαν οι απαιτούμενες στήλες. Headers που εντοπίστηκαν: ${header.join(' | ')}. Χρειάζονται "Search Query" και "Uses".`,
      ],
    };
  }

  const parsed: ParsedSearchTerm[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const term = String(r[termIdx] ?? '').replace(/\s+/g, ' ').trim();
    if (!term) continue;
    const hits = Number(String(r[hitsIdx] ?? '').replace(/[^\d.-]/g, '')) || 0;
    const item: ParsedSearchTerm = { term: term.slice(0, 250), hits };
    if (resultsIdx >= 0) {
      const results = Number(String(r[resultsIdx] ?? '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(results)) item.results = results;
    }
    parsed.push(item);
  }

  // De-dup by term (case-insensitive), prefer max hits/results
  const map = new Map<string, ParsedSearchTerm>();
  for (const p of parsed) {
    const k = p.term.toLowerCase();
    const prev = map.get(k);
    if (!prev) map.set(k, p);
    else {
      map.set(k, {
        term: prev.term,
        hits: Math.max(prev.hits, p.hits),
        results: Math.max(prev.results ?? 0, p.results ?? 0) || prev.results || p.results,
      });
    }
  }
  const merged = [...map.values()].sort((a, b) => b.hits - a.hits);

  return { rows: merged, totalRows: parsed.length, errors };
}

/**
 * Saves parsed Magento Admin search terms to Firestore.
 * Provenance = 'magento_admin_csv' (highest trust source for OSS Magento).
 */
export async function importMagentoSearchTermsFile(
  brandId: string,
  file: File,
  maxRows = 200
): Promise<MagentoSearchTermsImportResult> {
  const { rows, totalRows, errors } = await parseMagentoSearchTermsFile(file);
  if (rows.length === 0) {
    return { success: false, imported: 0, totalRows, errors, preview: [] };
  }

  const top = rows.slice(0, maxRows);
  await setDoc(
    doc(db, 'magento_popular_searches', brandId),
    {
      brandId,
      terms: top.map((t) => ({
        term: t.term,
        hits: t.hits,
        ...(typeof t.results === 'number' ? { results: t.results } : {}),
      })),
      syncedAt: serverTimestamp(),
      source: 'magento_admin_csv',
      termsProvenance: 'magento_admin_csv',
      uploadedFileName: file.name,
    },
    { merge: true }
  );

  return {
    success: true,
    imported: top.length,
    totalRows,
    errors,
    preview: top.slice(0, 10),
  };
}
