import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db, auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../../config/firebase';
import { useBrand } from '../../hooks/useBrand';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { usePriceInsights, type PriceInsight } from '../../hooks/usePriceInsights';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { Card, Button, Spinner, Badge, Tooltip, useToast, PageHeader } from '../common';
import {
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  Calendar,
  TrendingUp,
  Activity,
  ShoppingCart,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Filter,
  X as XIcon,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  exportBenchmarksCsv,
  exportBenchmarksXlsx,
  exportInsightsCsv,
  exportInsightsXlsx,
} from '../../utils/competitiveTableExport';
import { safeBrandName } from '../../services/reportExport';
import { logger } from '../../utils/logger';

const FUNCTIONS_BASE = FUNCTIONS_BASE_URL.replace(/\/$/, '');
const COMPETITIVE_BENCHMARK_LIMIT = 5000;
const COMPETITIVE_BENCHMARK_RENDER_LIMIT = 300;
const COMPETITIVE_CACHE_TTL = 24 * 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────

interface CompetitorConfig {
  pageId: string;
  name: string;
  platform: string;
}

interface CompetitorAd {
  adId: string;
  competitorName: string;
  competitorPageId: string;
  adText: string;
  startDate: string;
  endDate?: string;
  platforms: string[];
  isActive: boolean;
  daysRunning: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface CompetitorSettings {
  competitors: CompetitorConfig[];
  lastSyncAt?: string;
  /** ISO 3166-1 alpha-2 codes for Meta Ad Library reach filter; empty/absent = server default (GR, CY, US, GB). */
  reachedCountries?: string[];
  /** Last sync messages from Cloud Function (Meta API). */
  lastAdLibraryWarnings?: string[];
}

type Tab = 'pricing' | 'insights' | 'ads';

/** Price Benchmarks table columns — used in sort & column filters (xlsx-style). */
type BenchmarkCol =
  | 'title'
  | 'brand'
  | 'yourPrice'
  | 'benchmarkPrice'
  | 'priceDiff'
  | 'stock'
  | 'sold'
  | 'salesStockRatio'
  | 'gtin';

/** Price Insights table columns — filters / sorting as in benchmarks. */
type InsightCol =
  | 'title'
  | 'seller'
  | 'brand'
  | 'stock'
  | 'sold'
  | 'currentPrice'
  | 'suggestedPrice'
  | 'priceDiffPercent'
  | 'predImpr'
  | 'predClicks'
  | 'predConv';

type SortDir = 'asc' | 'desc';

interface BenchmarkColumnFilters {
  title?: string;
  /** Set of selected brands; if undefined/empty → all. */
  brand?: Set<string>;
  yourPrice?: string;
  benchmarkPrice?: string;
  priceDiff?: string;
  stock?: string;
  sold?: string;
  salesStockRatio?: string;
  gtin?: string;
}

interface InsightColumnFilters {
  title?: string;
  seller?: string;
  brand?: Set<string>;
  stock?: string;
  sold?: string;
  currentPrice?: string;
  suggestedPrice?: string;
  priceDiffPercent?: string;
  predImpr?: string;
  predClicks?: string;
  predConv?: string;
}

/** Excel-like numeric expressions: `>10`, `<5`, `>=3`, `<=8`, `5-20`, `=8`, or a plain number. */
function matchNumericExpr(value: number | null | undefined, expr: string): boolean {
  const e = (expr || '').trim();
  if (!e) return true;
  if (value == null || Number.isNaN(value)) return false;
  const range = e.match(/^(-?\d+(?:[.,]\d+)?)\s*[-–]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (range) {
    const a = parseFloat(range[1].replace(',', '.'));
    const b = parseFloat(range[2].replace(',', '.'));
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return value >= lo && value <= hi;
  }
  const op = e.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (op) {
    const n = parseFloat(op[2].replace(',', '.'));
    switch (op[1]) {
      case '>': return value > n;
      case '<': return value < n;
      case '>=': return value >= n;
      case '<=': return value <= n;
      default: return value === n;
    }
  }
  const notEq = e.match(/^(<>|!=)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (notEq) {
    const n = parseFloat(notEq[2].replace(',', '.'));
    return value !== n;
  }
  const n = parseFloat(e.replace(',', '.'));
  if (!Number.isNaN(n)) return value === n;
  return true;
}

/** From Firestore / import: empty → null (not 0), so 0 sales sorts correctly and the =0 filter is not confused with "no data". */
function parseInventoryField(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

type SkuInventoryRow = { stock: number | null; sold: number | null };

function compactInventoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9α-ωάέήίόύώϊϋΐΰ]+/gi, '');
}

function addProgressiveSkuParts(set: Set<string>, value: string): void {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  const parts = normalized.split(/[-_\s]+/).filter(Boolean);
  for (let i = parts.length; i >= 2; i -= 1) {
    const partial = parts.slice(0, i).join('-');
    set.add(partial);
    const compact = compactInventoryKey(partial);
    if (compact) set.add(compact);
  }
}

function inventoryKeyVariants(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const set = new Set<string>();
  const lower = raw.toLowerCase();
  set.add(lower);
  const compact = compactInventoryKey(lower);
  if (compact) set.add(compact);

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 4) {
    const offerId = parts.slice(3).join(':');
    set.add(offerId.toLowerCase());
    const offerCompact = compactInventoryKey(offerId);
    if (offerCompact) set.add(offerCompact);
    addProgressiveSkuParts(set, offerId);
  } else {
    addProgressiveSkuParts(set, raw);
  }

  for (const part of parts) {
    const partLower = part.toLowerCase();
    set.add(partLower);
    const partCompact = compactInventoryKey(part);
    if (partCompact) set.add(partCompact);
  }

  return [...set].filter(Boolean);
}

async function fetchProductIntelligenceInventory(brandId: string): Promise<Record<string, SkuInventoryRow>> {
  const chunks = await getDocs(collection(db, 'product_intelligence_inventory', brandId, 'chunks'));
  const merged: Record<string, SkuInventoryRow> = {};
  chunks.forEach((snap) => {
    const raw = snap.data().inventoryJson;
    if (!raw || typeof raw !== 'string') return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const k of Object.keys(parsed)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        merged[k] = (parsed as Record<string, SkuInventoryRow>)[k];
      }
    } catch {
      // Ignore a corrupt chunk; the remaining chunks still provide a useful lookup.
    }
  });
  return merged;
}

/** Sort Stock/Sales by relation (red/green): 2 = stock > sales, 0 = sales > stock, 1 = equal/incomparable. */
function stockSoldRelationTier(inv: SkuInventoryRow | null | undefined): number {
  const st = inv?.stock;
  const sd = inv?.sold;
  if (typeof st !== 'number' || typeof sd !== 'number' || !Number.isFinite(st) || !Number.isFinite(sd)) return 1;
  if (st > sd) return 2;
  if (sd > st) return 0;
  return 1;
}

/** Sales-to-current-stock ratio. Null when data is missing or stock <= 0 to avoid an artificial Infinity. */
function salesStockRatio(inv: SkuInventoryRow | null | undefined): number | null {
  const st = inv?.stock;
  const sd = inv?.sold;
  if (typeof st !== 'number' || typeof sd !== 'number') return null;
  if (!Number.isFinite(st) || !Number.isFinite(sd) || st <= 0) return null;
  return Math.round((sd / st) * 100) / 100;
}

function numericFilterPresets(col: string): { label: string; value: string }[] {
  if (col === 'priceDiff' || col === 'priceDiffPercent') {
    return [
      { label: 'Πάνω από αγορά (>0)', value: '>0' },
      { label: 'Κάτω από αγορά (<0)', value: '<0' },
      { label: 'Ίση τιμή (=0)', value: '=0' },
      { label: 'Ακριβότερα >10%', value: '>10' },
      { label: 'Φθηνότερα >10%', value: '<-10' },
    ];
  }
  if (col === 'salesStockRatio') {
    return [
      { label: 'Υψηλή ζήτηση (>1)', value: '>1' },
      { label: 'Μεσαία κίνηση (0.25-1)', value: '0.25-1' },
      { label: 'Χαμηλή κίνηση (<0.25)', value: '<0.25' },
      { label: 'Χωρίς πωλήσεις (=0)', value: '=0' },
    ];
  }
  if (col === 'stock') {
    return [
      { label: 'Με stock (>0)', value: '>0' },
      { label: 'Χωρίς stock (=0)', value: '=0' },
      { label: 'Υψηλό stock (>10)', value: '>10' },
    ];
  }
  if (col === 'sold') {
    return [
      { label: 'Με πωλήσεις (>0)', value: '>0' },
      { label: 'Χωρίς πωλήσεις (=0)', value: '=0' },
      { label: 'Υψηλές πωλήσεις (>10)', value: '>10' },
    ];
  }
  return [
    { label: 'Με τιμή (>0)', value: '>0' },
    { label: 'Μηδέν (=0)', value: '=0' },
  ];
}

function buildCustomNumericExpression(operator: string, first: string, second: string): string {
  const a = first.trim().replace(',', '.');
  const b = second.trim().replace(',', '.');
  if (!a) return '';
  if (operator === 'between') return b ? `${a}-${b}` : '';
  if (operator === '=') return `=${a}`;
  return `${operator}${a}`;
}

/** Secondary numeric comparator: real numbers (including 0) before null/undefined. */
function compareInventoryNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1
): number {
  const ha = typeof a === 'number' && Number.isFinite(a);
  const hb = typeof b === 'number' && Number.isFinite(b);
  if (ha && hb) return (a - b) * dir;
  if (ha && !hb) return -1;
  if (!ha && hb) return 1;
  return 0;
}

const TOOLTIP_CI_REFRESH =
  'Πλήρης συγχρονισμός connectors (GMC, Meta Ad Library κ.λπ.): καθημερινά ~06:00 (Europe/Athens). Στη σελίδα: cache Price Benchmarks ~10 λεπτά, Ad Monitoring ~5 λεπτά. Για άμεση ενημέρωση: Sync GMC ή Scan τώρα.';

const TOOLTIP_BENCHMARK_UPDATED =
  'Ημερομηνία/ώρα από το νεότερο αποθηκευμένο SKU benchmark (τελευταία επιτυχημένη εγγραφή στη βάση). Προγραμματισμένος συγχρονισμός connectors ~06:00 Europe/Athens ισχύει όταν το GMC είναι συνδεδεμένο — αν η ημερομηνία μένει παλιά, πατήστε «Sync GMC» (Συνδέσεις). Προβολή σελίδας: cache ~10 λεπτά.';

const TOOLTIP_INSIGHTS_SOURCE =
  'Βάση: τελευταία 7 ημέρες GMC. Ανανέωση δεδομένων: ίδιο πρόγραμμα με τα benchmarks (ημερήσιο ~06:00 + Sync GMC).';

const TOOLTIP_ADS_LAST_SCAN =
  'Τελευταίος έλεγχος Meta Ad Library. Πλήρης ανανέωση: καθημερινά ~06:00 Europe/Athens + «Scan τώρα». Προβολή: cache ~5 λεπτά. Οι διαφημίσεις φιλτράρονται κατά χώρα reach — βλ. πεδίο χωρών παρακάτω.';

/** Single-line KPI date/time (avoid wrapping in el-GR). */
function formatKpiDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Display text + technical detail for old/stored warnings carrying raw JSON from Meta. */
function parseAdLibraryWarningLine(raw: string): {
  friendly: string;
  technical?: string;
  isPermission: boolean;
} {
  const t = raw.trim();

  let competitor = '';
  const mHttp = t.match(/Ad Library API error for ([^(]+?)\s*\(\s*400\s*\)/i);
  const mGraph = t.match(/Ad Library API \(([^)]+)\)/);
  const mGreek = t.match(/για\s*[«"]([^»"]+)[»"]/u);
  if (mHttp) competitor = mHttp[1].trim();
  else if (mGraph) competitor = mGraph[1].trim();
  else if (mGreek) competitor = mGreek[1].trim();

  const who = competitor ? `για «${competitor}» ` : '';

  /** Handle 2332004 first: the old "META_APP_ID" early-return hid the JSON and showed the wrong text. */
  const isAppRole2332004 =
    /2332004|"error_subcode"\s*:\s*2332004|app role required/i.test(t);

  if (isAppRole2332004) {
    return {
      isPermission: true,
      friendly: `Δεν είναι δυνατή η παρακολούθηση διαφημίσεων ανταγωνιστών ${who}(Meta σφάλμα 2332004 — «App role required»): ο λογαριασμός Facebook με τον οποίο κάνατε «Σύνδεση Meta» στις Συνδέσεις πρέπει να έχει ρόλο Administrator ή Developer στην ίδια εφαρμογή (developers.facebook.com → App → App roles) — όχι μόνο διαχειριστής Business Manager. Αν άλλος έκανε τη σύνδεση, προσθέστε τον στους ρόλους ή ξανασυνδεθείτε με εκείνον τον λογαριασμό· μετά «Scan τώρα». Το app token μόνο (META_APP_ID/SECRET) συχνά απορρίπτεται για Ad Library — χρειάζεται έγκυρο user token.`,
      technical: t.length > 80 && (t.includes('{') || t.includes('error')) ? t : undefined,
    };
  }

  /* Already-updated message from the Cloud Function (post-deploy) */
  if (t.includes('Κωδικός σφάλματος Meta 2332004') || t.includes('Κωδικός 2332004:')) {
    return { isPermission: true, friendly: t, technical: undefined };
  }

  const lower = t.toLowerCase();
  const permission =
    lower.includes('does not have permission') ||
    lower.includes('application does not have') ||
    (lower.includes('permission') &&
      (lower.includes('ad library') || lower.includes('ads_archive') || lower.includes('(400)')));

  if (permission) {
    return {
      isPermission: true,
      friendly: `Δεν είναι δυνατή η παρακολούθηση διαφημίσεων ανταγωνιστών ${who}από την εφαρμογή: ελέγξτε Live mode, App roles για τον λογαριασμό που συνδέει το Meta στις Συνδέσεις, permissions (ads_read) και σύνδεση Meta. Το META_APP_ID/SECRET πρέπει να αντιστοιχεί στο ίδιο app.`,
      technical: t.length > 80 && (t.includes('{') || t.includes('error')) ? t : undefined,
    };
  }

  /* Old stored text (without raw JSON) — upgrade the display */
  if (t.includes('Δεν είναι δυνατή η παρακολούθηση') && t.includes('META_APP_ID')) {
    return {
      isPermission: true,
      friendly: `Δεν είναι δυνατή η παρακολούθηση διαφημίσεων ανταγωνιστών ${who}από την εφαρμογή: ελέγξτε Live mode και ότι ο λογαριασμός Facebook της «Σύνδεσης Meta» έχει ρόλο Admin/Developer στα App roles. Αν εμφανίζεται σφάλμα 2332004, δείτε το τεχνικό απόσπασμα παρακάτω ή κάντε νέο «Scan τώρα» μετά deploy.`,
      technical: t.length > 80 ? t : undefined,
    };
  }

  return { isPermission: false, friendly: t, technical: undefined };
}

// ── Data fetchers ────────────────────────────────────────

async function fetchSettings(brandId: string): Promise<CompetitorSettings> {
  const docRef = doc(db, 'competitor_settings', brandId);
  const snap = await getDoc(docRef);
  if (snap.exists()) return snap.data() as CompetitorSettings;
  return { competitors: [] };
}

async function saveSettings(brandId: string, settings: CompetitorSettings) {
  const docRef = doc(db, 'competitor_settings', brandId);
  await setDoc(docRef, settings, { merge: true });
}

async function fetchAds(brandId: string): Promise<CompetitorAd[]> {
  const colRef = collection(db, 'competitor_ads', brandId, 'ads');
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => d.data() as CompetitorAd);
}

// ── Main Component ───────────────────────────────────────

export function CompetitorInsights() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('pricing');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [competitorSyncWarnings, setCompetitorSyncWarnings] = useState<string[] | null>(null);
  const [dismissedAdWarnings, setDismissedAdWarnings] = useState(false);
  const [reachCountriesInput, setReachCountriesInput] = useState('');
  const [savingCountries, setSavingCountries] = useState(false);
  const [competitiveInventoryRefreshStarted, setCompetitiveInventoryRefreshStarted] = useState(false);

  // Price benchmarks
  const {
    benchmarks,
    isLoading: benchmarksLoading,
    isError: benchmarksQueryError,
    error: benchmarksError,
    refetch: refetchBenchmarks,
    count: benchmarkCount,
    lastBenchmarkSyncedAt,
  } = usePriceBenchmarks({ maxDocs: COMPETITIVE_BENCHMARK_LIMIT });

  // Inventory/sales enrichment for the benchmarks table. Priority: 1) products/ERP (Megaventory)
  // for authoritative stock; 2) ecommerce_summary.skuStats for sales + stock only when ERP has no value.
  const { skuStats } = useEcommerceSummary();
  const { data: competitiveInventory = {}, isLoading: competitiveInventoryLoading } = useQuery<Record<string, SkuInventoryRow>>({
    queryKey: ['productIntelligenceInventory', brandId],
    queryFn: () => (brandId ? fetchProductIntelligenceInventory(brandId) : Promise.resolve({})),
    enabled: !!brandId,
    staleTime: Infinity,
    gcTime: COMPETITIVE_CACHE_TTL,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });
  const skuInventoryMap = useMemo(() => {
    const map = new Map<string, SkuInventoryRow>();
    const mergeInventory = (key: string, next: SkuInventoryRow, preferExistingStock = false) => {
      for (const normalized of inventoryKeyVariants(key)) {
        const prev = map.get(normalized);
        map.set(normalized, {
          stock: preferExistingStock ? (prev?.stock ?? next.stock) : (next.stock ?? prev?.stock ?? null),
          sold: next.sold ?? prev?.sold ?? null,
        });
      }
    };

    // Full server-side lookup from Product Intelligence: Megaventory stock + sku_stats sales.
    for (const [key, row] of Object.entries(competitiveInventory)) {
      mergeInventory(key, {
        stock: parseInventoryField(row.stock),
        sold: parseInventoryField(row.sold),
      });
    }

    // E-shop stats enrich sales, but never zero out ERP stock.
    for (const [sku, s] of Object.entries(skuStats || {})) {
      mergeInventory(sku, {
        stock: parseInventoryField(s.stock),
        sold: parseInventoryField(s.sold),
      }, true);
    }
    return map;
  }, [competitiveInventory, skuStats]);

  /** GMC productId is usually `online:el:GR:SKU123` — try offerId, base SKU, GTIN and compact variants. */
  const benchmarkKeyCandidates = (productId: string, gtin: string): string[] => {
    const candidates = new Set<string>();
    for (const value of [productId, gtin]) {
      for (const key of inventoryKeyVariants(value)) candidates.add(key);
    }
    return [...candidates];
  };
  const lookupInventory = useCallback(
    (productId: string, gtin: string) => {
      for (const k of benchmarkKeyCandidates(productId, gtin)) {
        const hit = skuInventoryMap.get(k);
        if (hit) return hit;
      }
      return null;
    },
    [skuInventoryMap]
  );

  const stockedBenchmarks = useMemo(
    () => benchmarks.filter((b) => (lookupInventory(b.productId, b.gtin)?.stock ?? 0) > 0),
    [benchmarks, lookupInventory]
  );
  const stockedWithMarket = useMemo(
    () => stockedBenchmarks.filter((b) => b.benchmarkPrice > 0),
    [stockedBenchmarks]
  );
  const stockedBenchmarkCount = stockedBenchmarks.length;
  const hasBenchmarkRows = benchmarks.length > 0;
  const isBenchmarkInitialLoading =
    !hasBenchmarkRows && (benchmarksLoading || competitiveInventoryLoading);
  const stockedAboveMarket = stockedWithMarket.filter((b) => b.priceDiff > 0).length;
  const stockedBelowMarket = stockedWithMarket.filter((b) => b.priceDiff < 0).length;
  const stockedAvgDiff =
    stockedWithMarket.length > 0
      ? Math.round((stockedWithMarket.reduce((s, b) => s + b.priceDiff, 0) / stockedWithMarket.length) * 10) / 10
      : 0;
  // Price insights
  const {
    insights: priceInsights,
    isLoading: insightsLoading,
    count: insightsCount,
    withSuggestionCount,
    avgConvLift,
    hasData: hasInsightsData,
    sellerName: priceInsightsSellerName,
  } = usePriceInsights();
  const [insightsSearch, setInsightsSearch] = useState('');
  const [insightColFilters, setInsightColFilters] = useState<InsightColumnFilters>({});
  const [insightSortCol, setInsightSortCol] = useState<InsightCol | null>(null);
  const [insightSortDir, setInsightSortDir] = useState<SortDir>('desc');
  const setInsightSort = useCallback((col: string, dir: SortDir) => {
    setInsightSortCol(col as InsightCol);
    setInsightSortDir(dir);
  }, []);

  useEffect(() => {
    if (!brandId || competitiveInventoryLoading || competitiveInventoryRefreshStarted) return;
    if (Object.keys(competitiveInventory).length > 0) return;
    if (benchmarks.length === 0 && priceInsights.length === 0) return;

    setCompetitiveInventoryRefreshStarted(true);
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`${FUNCTIONS_BASE}/refreshCompetitiveInventory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(await getAppCheckHeader()) },
          body: JSON.stringify({ brandId }),
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ['productIntelligenceInventory', brandId] });
        }
      } catch (error) {
        logger.warn('[CompetitiveInventory] refresh failed', { err: error });
      }
    })();
  }, [
    brandId,
    competitiveInventory,
    competitiveInventoryLoading,
    competitiveInventoryRefreshStarted,
    benchmarks.length,
    priceInsights.length,
    queryClient,
  ]);

  // Competitor ads
  const { data: settings } = useQuery({
    queryKey: ['competitorSettings', brandId],
    queryFn: () => (brandId ? fetchSettings(brandId) : Promise.resolve({ competitors: [] })),
    enabled: !!brandId,
  });

  const { data: ads = [], isPending: adsLoading } = useQuery({
    queryKey: ['competitorAds', brandId],
    queryFn: () => (brandId ? fetchAds(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
  });

  const competitors = settings?.competitors ?? [];

  useEffect(() => {
    if (!settings?.reachedCountries?.length) {
      setReachCountriesInput('');
      return;
    }
    setReachCountriesInput(settings.reachedCountries.join(', '));
  }, [settings?.reachedCountries]);

  useEffect(() => {
    setDismissedAdWarnings(false);
  }, [settings?.lastSyncAt]);

  const adLibraryWarningsList = useMemo(() => {
    if (competitorSyncWarnings !== null) return competitorSyncWarnings;
    return settings?.lastAdLibraryWarnings?.length ? settings.lastAdLibraryWarnings : null;
  }, [competitorSyncWarnings, settings?.lastAdLibraryWarnings]);

  const saveReachCountries = useCallback(async () => {
    if (!brandId) return;
    const raw = reachCountriesInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    const unique = [...new Set(raw)];
    setSavingCountries(true);
    try {
      await saveSettings(brandId, {
        ...(settings ?? { competitors: [] }),
        competitors: settings?.competitors ?? [],
        reachedCountries: unique,
      });
      queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
      toast.success(
        unique.length > 0 ? `Χώρες reach: ${unique.join(', ')}` : 'Προεπιλογή server: GR, CY, US, GB'
      );
    } catch {
      toast.error('Αποτυχία αποθήκευσης χωρών');
    } finally {
      setSavingCountries(false);
    }
  }, [brandId, reachCountriesInput, settings, queryClient, toast]);

  const addCompetitor = useMutation({
    mutationFn: async () => {
      if (!brandId) return;
      const updated: CompetitorSettings = {
        ...settings,
        competitors: [
          ...(settings?.competitors ?? []),
          { pageId: newPageId.trim(), name: newName.trim(), platform: 'meta' },
        ],
      };
      await saveSettings(brandId, updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
      toast.success('Ο ανταγωνιστής προστέθηκε');
      setNewName('');
      setNewPageId('');
      setShowAddForm(false);
    },
    onError: () => {
      toast.error('Σφάλμα κατά την προσθήκη ανταγωνιστή');
    },
  });

  const removeCompetitor = useCallback(
    async (pageId: string) => {
      if (!brandId || !settings) return;
      if (!confirm('Αφαίρεση ανταγωνιστή;')) return;
      try {
        const updated: CompetitorSettings = {
          ...settings,
          competitors: settings.competitors.filter((c) => c.pageId !== pageId),
        };
        await saveSettings(brandId, updated);
        queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
        toast.success('Αφαιρέθηκε');
      } catch {
        toast.error('Σφάλμα κατά την αφαίρεση ανταγωνιστή');
      }
    },
    [brandId, settings, queryClient, toast]
  );

  const handleSync = async (provider: 'merchant' | 'competitor') => {
    if (!brandId) return;
    setSyncing(provider);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${FUNCTIONS_BASE}/connectorSync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(await getAppCheckHeader()) },
        body: JSON.stringify({ brandId, provider }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        if (provider === 'merchant') {
          const imp = result.imported ?? 0;
          const wm = typeof result.withMarketBenchmark === 'number' ? result.withMarketBenchmark : undefined;
          if (imp === 0) {
            toast.info('GMC: 0 προϊόντα από ProductView — έλεγξε feed και Merchant ID.');
          } else if (wm === 0) {
            toast.info(
              `GMC: ${imp} SKUs στο catalog — κανένα με benchmark τιμάς αγοράς ακόμα (GTIN / Price competitiveness στο Merchant Center).`
            );
          } else {
            toast.success(`GMC: ${imp} SKUs (${wm} με benchmark αγοράς)`);
          }
          queryClient.invalidateQueries({ queryKey: ['priceBenchmarks', brandId] });
          queryClient.invalidateQueries({ queryKey: ['priceInsights', brandId] });
          queryClient.invalidateQueries({ queryKey: ['productIntelligenceInventory', brandId] });
          await Promise.all([
            queryClient.refetchQueries({ queryKey: ['priceBenchmarks', brandId] }),
            queryClient.refetchQueries({ queryKey: ['priceInsights', brandId] }),
            queryClient.refetchQueries({ queryKey: ['productIntelligenceInventory', brandId] }),
          ]);
        } else {
          setCompetitorSyncWarnings(result.warnings?.length ? result.warnings : null);
          toast.success(`Βρέθηκαν ${result.totalAds} ads (${result.newAds} νέες)`);
          queryClient.invalidateQueries({ queryKey: ['competitorAds', brandId] });
          queryClient.invalidateQueries({ queryKey: ['competitorSettings', brandId] });
        }
      } else {
        if (provider === 'competitor') setCompetitorSyncWarnings(null);
        toast.error(result.error || 'Sync failed');
      }
    } catch {
      toast.error(`Σφάλμα sync ${provider === 'merchant' ? 'benchmarks' : 'ανταγωνιστών'}`);
    } finally {
      setSyncing(null);
    }
  };

  const filteredAds = useMemo(() => {
    if (!searchQuery) return ads;
    const q = searchQuery.toLowerCase();
    return ads.filter(
      (a) =>
        a.competitorName.toLowerCase().includes(q) ||
        a.adText.toLowerCase().includes(q)
    );
  }, [ads, searchQuery]);

  const activeAds = ads.filter((a) => a.isActive);

  // Benchmark search + column filters (xlsx-style) + column sort
  const [benchmarkSearch, setBenchmarkSearch] = useState('');
  const [colFilters, setColFilters] = useState<BenchmarkColumnFilters>({});
  const [sortCol, setSortCol] = useState<BenchmarkCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [benchmarkQuickFilter, setBenchmarkQuickFilter] = useState<'all' | 'aboveMarket' | 'belowMarket'>('all');
  const setBenchmarkSort = useCallback((col: string, dir: SortDir) => {
    setSortCol(col as BenchmarkCol);
    setSortDir(dir);
  }, []);

  /** Unique brands for the categorical "Brand" filter. */
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of stockedBenchmarks) set.add(((b.brand || '').trim()) || '—');
    return [...set].sort((a, b) => a.localeCompare(b, 'el'));
  }, [stockedBenchmarks]);

  const hasActiveColumnFilters = useMemo(() => {
    const f = colFilters;
    const brandActive = Boolean(f.brand && f.brand.size < brandOptions.length);
    return Boolean(
      f.title || f.gtin || f.yourPrice || f.benchmarkPrice || f.priceDiff || f.stock || f.sold || f.salesStockRatio || brandActive
    );
  }, [colFilters, brandOptions.length]);

  const clearColumnFilters = useCallback(() => setColFilters({}), []);

  const updateColFilter = useCallback(<K extends keyof BenchmarkColumnFilters>(key: K, value: BenchmarkColumnFilters[K]) => {
    setColFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleBrand = useCallback((brand: string) => {
    setColFilters((prev) => {
      const current = prev.brand ? new Set(prev.brand) : new Set(brandOptions);
      if (current.has(brand)) current.delete(brand); else current.add(brand);
      return { ...prev, brand: current };
    });
  }, [brandOptions]);

  const filteredBenchmarks = useMemo(() => {
    let list = [...stockedBenchmarks];

    if (benchmarkQuickFilter === 'aboveMarket') {
      list = list.filter((b) => (b.priceDiff || 0) > 0);
    } else if (benchmarkQuickFilter === 'belowMarket') {
      list = list.filter((b) => (b.priceDiff || 0) < 0);
    }

    if (benchmarkSearch) {
      const q = benchmarkSearch.toLowerCase();
      list = list.filter(
        (b) => b.title.toLowerCase().includes(q) || b.productId.toLowerCase().includes(q) || b.gtin.toLowerCase().includes(q) || (b.brand || '').toLowerCase().includes(q)
      );
    }

    const f = colFilters;
    if (f.title) {
      const q = f.title.toLowerCase();
      list = list.filter((b) => b.title.toLowerCase().includes(q) || b.productId.toLowerCase().includes(q));
    }
    if (f.gtin) {
      const q = f.gtin.toLowerCase();
      list = list.filter((b) => (b.gtin || '').toLowerCase().includes(q));
    }
    if (f.brand && f.brand.size < brandOptions.length) {
      list = list.filter((b) => f.brand!.has(((b.brand || '').trim()) || '—'));
    }
    if (f.yourPrice) list = list.filter((b) => matchNumericExpr(b.yourPrice, f.yourPrice!));
    if (f.benchmarkPrice) list = list.filter((b) => matchNumericExpr(b.benchmarkPrice, f.benchmarkPrice!));
    if (f.priceDiff) list = list.filter((b) => matchNumericExpr(b.priceDiff, f.priceDiff!));
    if (f.stock) {
      list = list.filter((b) => {
        const inv = lookupInventory(b.productId, b.gtin);
        return matchNumericExpr(inv?.stock, f.stock!);
      });
    }
    if (f.sold) {
      list = list.filter((b) => {
        const inv = lookupInventory(b.productId, b.gtin);
        return matchNumericExpr(inv?.sold, f.sold!);
      });
    }
    if (f.salesStockRatio) {
      list = list.filter((b) => {
        const inv = lookupInventory(b.productId, b.gtin);
        return matchNumericExpr(salesStockRatio(inv), f.salesStockRatio!);
      });
    }

    // Sort: a column sort takes precedence; otherwise default (benchmark > priceDiff desc).
    if (sortCol) {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortCol === 'salesStockRatio') {
        list.sort((a, b) => {
          const invA = lookupInventory(a.productId, a.gtin);
          const invB = lookupInventory(b.productId, b.gtin);
          return compareInventoryNumber(salesStockRatio(invA), salesStockRatio(invB), dir);
        });
      } else if (sortCol === 'stock' || sortCol === 'sold') {
        list.sort((a, b) => {
          const invA = lookupInventory(a.productId, a.gtin);
          const invB = lookupInventory(b.productId, b.gtin);
          const ta = stockSoldRelationTier(invA);
          const tb = stockSoldRelationTier(invB);
          if (ta !== tb) return (ta - tb) * dir;
          const va = sortCol === 'stock' ? invA?.stock : invA?.sold;
          const vb = sortCol === 'stock' ? invB?.stock : invB?.sold;
          return compareInventoryNumber(va, vb, dir);
        });
      } else {
        const getVal = (b: (typeof benchmarks)[number]): string | number => {
          switch (sortCol) {
            case 'title': return (b.title || b.productId || '').toLowerCase();
            case 'brand': return (b.brand || '').toLowerCase();
            case 'yourPrice': return b.yourPrice || 0;
            case 'benchmarkPrice': return b.benchmarkPrice || 0;
            case 'priceDiff': return b.priceDiff || 0;
            case 'gtin': return (b.gtin || '').toLowerCase();
          }
        };
        list.sort((a, b) => {
          const va = getVal(a); const vb = getVal(b);
          if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'el') * dir;
          return ((va as number) - (vb as number)) * dir;
        });
      }
    } else {
      list.sort((a, b) => {
        if (benchmarkQuickFilter === 'belowMarket') {
          return a.priceDiff - b.priceDiff;
        }
        const ab = a.benchmarkPrice > 0;
        const bb = b.benchmarkPrice > 0;
        if (ab !== bb) return ab ? -1 : 1;
        return b.priceDiff - a.priceDiff;
      });
    }

    return list;
  }, [stockedBenchmarks, benchmarkQuickFilter, benchmarkSearch, colFilters, sortCol, sortDir, brandOptions.length, lookupInventory]);
  const visibleBenchmarks = useMemo(
    () => filteredBenchmarks.slice(0, COMPETITIVE_BENCHMARK_RENDER_LIMIT),
    [filteredBenchmarks]
  );
  const hiddenBenchmarkRows = Math.max(0, filteredBenchmarks.length - visibleBenchmarks.length);

  const insightsSellerLabel = useMemo(() => {
    const raw = (priceInsightsSellerName || '').trim();
    const brandName = (currentBrand?.name || '').trim();
    const looksLikePlaceholder =
      !raw ||
      /^account$/i.test(raw) ||
      /^account\s+\d+$/i.test(raw.replace(/\u00a0/g, ' '));
    if (looksLikePlaceholder) return brandName || raw || '—';
    return raw || brandName || '—';
  }, [priceInsightsSellerName, currentBrand?.name]);

  const insightBrandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of priceInsights) set.add(((i.brand || '').trim()) || '—');
    return [...set].sort((a, b) => a.localeCompare(b, 'el'));
  }, [priceInsights]);

  const hasInsightActiveColumnFilters = useMemo(() => {
    const f = insightColFilters;
    const brandActive = Boolean(f.brand && f.brand.size < insightBrandOptions.length);
    return Boolean(
      f.title ||
        f.seller ||
        f.stock ||
        f.sold ||
        f.currentPrice ||
        f.suggestedPrice ||
        f.priceDiffPercent ||
        f.predImpr ||
        f.predClicks ||
        f.predConv ||
        brandActive
    );
  }, [insightColFilters, insightBrandOptions.length]);

  const clearInsightColumnFilters = useCallback(() => setInsightColFilters({}), []);

  const updateInsightColFilter = useCallback(<K extends keyof InsightColumnFilters>(key: K, value: InsightColumnFilters[K]) => {
    setInsightColFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleInsightBrand = useCallback(
    (brand: string) => {
      setInsightColFilters((prev) => {
        const current = prev.brand ? new Set(prev.brand) : new Set(insightBrandOptions);
        if (current.has(brand)) current.delete(brand);
        else current.add(brand);
        return { ...prev, brand: current };
      });
    },
    [insightBrandOptions]
  );

  const filteredInsights = useMemo(() => {
    let list = [...priceInsights];
    if (insightsSearch) {
      const q = insightsSearch.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.productId.toLowerCase().includes(q) ||
          (i.brand || '').toLowerCase().includes(q) ||
          insightsSellerLabel.toLowerCase().includes(q)
      );
    }

    const f = insightColFilters;
    if (f.title) {
      const q = f.title.toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(q) || i.productId.toLowerCase().includes(q));
    }
    if (f.seller) {
      const q = f.seller.toLowerCase();
      if (!insightsSellerLabel.toLowerCase().includes(q)) list = [];
    }
    if (f.brand && f.brand.size < insightBrandOptions.length) {
      list = list.filter((i) => f.brand!.has(((i.brand || '').trim()) || '—'));
    }
    if (f.stock) {
      list = list.filter((i) => {
        const inv = lookupInventory(i.productId, '');
        return matchNumericExpr(inv?.stock, f.stock!);
      });
    }
    if (f.sold) {
      list = list.filter((i) => {
        const inv = lookupInventory(i.productId, '');
        return matchNumericExpr(inv?.sold, f.sold!);
      });
    }
    if (f.currentPrice) list = list.filter((i) => matchNumericExpr(i.currentPrice, f.currentPrice!));
    if (f.suggestedPrice) list = list.filter((i) => matchNumericExpr(i.suggestedPrice, f.suggestedPrice!));
    if (f.priceDiffPercent) list = list.filter((i) => matchNumericExpr(i.priceDiffPercent, f.priceDiffPercent!));
    if (f.predImpr) list = list.filter((i) => matchNumericExpr(i.predictedImpressionsChange, f.predImpr!));
    if (f.predClicks) list = list.filter((i) => matchNumericExpr(i.predictedClicksChange, f.predClicks!));
    if (f.predConv) list = list.filter((i) => matchNumericExpr(i.predictedConversionsChange, f.predConv!));

    const dir = insightSortDir === 'asc' ? 1 : -1;

    if (insightSortCol === 'stock' || insightSortCol === 'sold') {
      list.sort((a, b) => {
        const invA = lookupInventory(a.productId, '');
        const invB = lookupInventory(b.productId, '');
        const ta = stockSoldRelationTier(invA);
        const tb = stockSoldRelationTier(invB);
        if (ta !== tb) return (ta - tb) * dir;
        const va = insightSortCol === 'stock' ? invA?.stock : invA?.sold;
        const vb = insightSortCol === 'stock' ? invB?.stock : invB?.sold;
        return compareInventoryNumber(va, vb, dir);
      });
    } else if (insightSortCol) {
      const getVal = (i: (typeof priceInsights)[number]): string | number => {
        switch (insightSortCol) {
          case 'title':
            return (i.title || i.productId || '').toLowerCase();
          case 'seller':
            return insightsSellerLabel.toLowerCase();
          case 'brand':
            return (i.brand || '').toLowerCase();
          case 'currentPrice':
            return i.currentPrice || 0;
          case 'suggestedPrice':
            return i.suggestedPrice || 0;
          case 'priceDiffPercent':
            return i.priceDiffPercent || 0;
          case 'predImpr':
            return i.predictedImpressionsChange || 0;
          case 'predClicks':
            return i.predictedClicksChange || 0;
          case 'predConv':
            return i.predictedConversionsChange || 0;
          default:
            return 0;
        }
      };
      list.sort((a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'el') * dir;
        return ((va as number) - (vb as number)) * dir;
      });
    } else {
      list.sort((a, b) => b.predictedConversionsChange - a.predictedConversionsChange);
    }

    return list;
  }, [
    priceInsights,
    insightsSearch,
    insightsSellerLabel,
    insightColFilters,
    insightBrandOptions.length,
    insightSortCol,
    insightSortDir,
    lookupInventory,
  ]);

  const exportBrandSlug = useMemo(() => safeBrandName(currentBrand?.name), [currentBrand?.name]);

  const handleExportBenchmarks = useCallback(
    async (fmt: 'csv' | 'xlsx') => {
      if (filteredBenchmarks.length === 0) {
        toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `price_benchmarks_${exportBrandSlug}_${stamp}`;
      try {
        if (fmt === 'csv') {
          exportBenchmarksCsv(filteredBenchmarks, lookupInventory, `${base}.csv`);
        } else {
          await exportBenchmarksXlsx(filteredBenchmarks, lookupInventory, `${base}.xlsx`);
        }
        toast.success(`Εξαγωγή ${fmt === 'csv' ? 'CSV' : 'Excel'}: ${filteredBenchmarks.length} γραμμές.`);
      } catch (e) {
        logger.error('benchmarks export failed', { err: e });
        toast.error('Αποτυχία εξαγωγής.');
      }
    },
    [filteredBenchmarks, lookupInventory, exportBrandSlug, toast]
  );

  const handleExportInsights = useCallback(
    async (fmt: 'csv' | 'xlsx') => {
      if (filteredInsights.length === 0) {
        toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `price_insights_${exportBrandSlug}_${stamp}`;
      try {
        if (fmt === 'csv') {
          exportInsightsCsv(filteredInsights, insightsSellerLabel, lookupInventory, `${base}.csv`);
        } else {
          await exportInsightsXlsx(filteredInsights, insightsSellerLabel, lookupInventory, `${base}.xlsx`);
        }
        toast.success(`Εξαγωγή ${fmt === 'csv' ? 'CSV' : 'Excel'}: ${filteredInsights.length} γραμμές.`);
      } catch (e) {
        logger.error('insights export failed', { err: e });
        toast.error('Αποτυχία εξαγωγής.');
      }
    },
    [filteredInsights, insightsSellerLabel, lookupInventory, exportBrandSlug, toast]
  );

  if (!brandId) return null;

  const tabs: { id: Tab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'pricing', label: 'Price Benchmarks', count: stockedBenchmarkCount, icon: <ShoppingCart size={15} /> },
    { id: 'insights', label: 'Price Insights', count: insightsCount, icon: <TrendingUp size={15} /> },
    { id: 'ads', label: 'Ad Monitoring', count: ads.length, icon: <Eye size={15} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1A1A1A] sm:text-2xl">
            <Search size={22} className="shrink-0 text-[var(--nts-accent-text)] sm:h-6 sm:w-6" />
            <span>Competitive Intelligence</span>
            <Tooltip content={TOOLTIP_CI_REFRESH} size={18} />
          </h2>
        }
        description={
          <p className="text-sm text-[var(--text-secondary)] sm:text-base">
            Price benchmarking (Google Merchant Center) & Ad monitoring (Meta Ad Library)
          </p>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#F3F4F6] p-1 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6B7280] hover:text-[#374151]'
            }`}
          >
            {tab.icon}
            {tab.label}
            {(tab.count ?? 0) > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                activeTab === tab.id ? 'bg-[var(--nts-accent)] text-white' : 'bg-[#E5E7EB] text-[#6B7280]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════ PRICING TAB ════════════════ */}
      {activeTab === 'pricing' && (
        <>
          {benchmarksQueryError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-medium">Αποτυχία φόρτωσης benchmarks από Firestore</p>
                <p className="text-xs text-red-800/90 mt-1">
                  {benchmarksError?.message ||
                    'Έλεγξε σύνδεση· αν το σφάλμα αναφέρει «permission», επιβεβαίωσε ότι είσαι μέλος του brand (brands/…/members).'}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => refetchBenchmarks()}>
                Επανάληψη
              </Button>
            </div>
          )}

          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiBox
              label="SKUs με benchmark"
              value={stockedBenchmarkCount > 0 ? String(stockedBenchmarkCount) : '—'}
              tooltip="Προϊόντα για τα οποία το Google Merchant Center επέστρεψε πραγματική τιμή αγοράς (benchmarkPrice > 0). Τα SKUs χωρίς benchmark δεν φορτώνονται σε αυτή την προβολή."
              icon={<ShoppingCart size={18} />}
              color="#6366F1"
            />
            <KpiBox
              label="Πάνω από αγορά"
              value={String(stockedAboveMarket)}
              tooltip="SKUs με τιμή ακριβότερη από τη μέση αγοράς."
              icon={<ArrowUp size={18} />}
              color="#EF4444"
              clickable
              active={benchmarkQuickFilter === 'aboveMarket'}
              onClick={() =>
                setBenchmarkQuickFilter((prev) => (prev === 'aboveMarket' ? 'all' : 'aboveMarket'))
              }
            />
            <KpiBox
              label="Κάτω από αγορά"
              value={String(stockedBelowMarket)}
              tooltip="SKUs με τιμή φθηνότερη από τη μέση αγοράς."
              icon={<ArrowDown size={18} />}
              color="#22C55E"
              clickable
              active={benchmarkQuickFilter === 'belowMarket'}
              onClick={() =>
                setBenchmarkQuickFilter((prev) => (prev === 'belowMarket' ? 'all' : 'belowMarket'))
              }
            />
            <KpiBox
              label="Μέση απόκλιση"
              value={`${stockedAvgDiff > 0 ? '+' : ''}${stockedAvgDiff}%`}
              tooltip="Μέσος όρος τιμολογιακής απόκλισης σε σχέση με benchmark. Θετικό = ακριβότεροι."
              icon={<BarChart3 size={18} />}
              color={stockedAvgDiff > 0 ? '#EF4444' : '#22C55E'}
            />
            <KpiBox
              label="Τελ. ενημέρωση"
              value={lastBenchmarkSyncedAt ? formatKpiDateTime(lastBenchmarkSyncedAt) : '—'}
              tooltip={TOOLTIP_BENCHMARK_UPDATED}
              icon={<Calendar size={18} />}
              color="#8B5CF6"
            />
          </div>


          {/* Sync + Filters */}
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-[#1A1A1A]">Price Benchmarks — Google Merchant Center</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {benchmarkQuickFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setBenchmarkQuickFilter('all')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--nts-accent-text)] bg-[var(--nts-accent)]/5 hover:bg-[var(--nts-accent)]/10 border border-[var(--nts-accent)]/30 rounded-lg transition-colors"
                      title="Καθαρισμός quick filter benchmark"
                    >
                      <XIcon size={12} />
                      {benchmarkQuickFilter === 'aboveMarket' ? 'Πάνω από αγορά' : 'Κάτω από αγορά'}
                    </button>
                  )}
                  {hasActiveColumnFilters && (
                    <button
                      type="button"
                      onClick={clearColumnFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--nts-accent-text)] bg-[var(--nts-accent)]/5 hover:bg-[var(--nts-accent)]/10 border border-[var(--nts-accent)]/30 rounded-lg transition-colors"
                      title="Καθαρισμός όλων των φίλτρων στηλών"
                    >
                      <XIcon size={12} />
                      Καθαρισμός φίλτρων
                    </button>
                  )}
                  {!isBenchmarkInitialLoading && !benchmarksQueryError && stockedBenchmarkCount > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={filteredBenchmarks.length === 0}
                        onClick={() => void handleExportBenchmarks('csv')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none"
                        title="Φιλτραρισμένα αποτελέσματα πίνακα. CSV UTF-8."
                      >
                        <FileText size={13} />
                        .csv
                      </button>
                      <button
                        type="button"
                        disabled={filteredBenchmarks.length === 0}
                        onClick={() => void handleExportBenchmarks('xlsx')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none"
                        title="Φιλτραρισμένα αποτελέσματα πίνακα. Excel."
                      >
                        <FileSpreadsheet size={13} />
                        .xlsx
                      </button>
                    </>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={benchmarkSearch}
                      onChange={(e) => setBenchmarkSearch(e.target.value)}
                      placeholder="Αναζήτηση SKU..."
                      className="pl-8 pr-3 py-1.5 bg-[#F5F5F5] border border-transparent rounded-lg text-xs focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all w-48"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSync('merchant')}
                    disabled={syncing !== null}
                  >
                    {syncing === 'merchant' ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                    Sync GMC
                  </Button>
                </div>
              </div>

              {benchmarkQuickFilter !== 'all' && (
                <p className="mb-3 text-xs text-[#6B7280]">
                  Εμφανίζονται μόνο προϊόντα{' '}
                  <span className="font-medium text-[#111827]">
                    {benchmarkQuickFilter === 'aboveMarket' ? 'πάνω από αγορά' : 'κάτω από αγορά'}
                  </span>
                  .
                </p>
              )}

              {isBenchmarkInitialLoading ? (
                <div className="py-8 flex justify-center">
                  <Spinner size="md" label="Φόρτωση benchmarks..." />
                </div>
              ) : benchmarksQueryError ? (
                <div className="text-center py-10 text-sm text-[#9CA3AF]">
                  Δεν εμφανίζονται δεδομένα λόγω σφάλματος ανάγνωσης. Πατήστε «Επανάληψη» παραπάνω ή ανανεώστε τη σελίδα.
                </div>
              ) : benchmarkCount === 0 ? (
                <div className="text-center py-10">
                  <ShoppingCart size={40} className="mx-auto text-[#D1D5DB] mb-3" />
                  <p className="text-sm text-[#9CA3AF] mb-1">Δεν υπάρχουν προϊόντα με διαθέσιμο benchmark τιμής.</p>
                  <p className="text-xs text-[#D1D5DB]">Πατήστε «Sync GMC» ή ελέγξτε στο Merchant Center αν υπάρχουν δεδομένα στο Growth › Price competitiveness.</p>
                </div>
              ) : stockedBenchmarkCount === 0 ? (
                <div className="text-center py-10">
                  <ShoppingCart size={40} className="mx-auto text-[#D1D5DB] mb-3" />
                  <p className="text-sm text-[#9CA3AF] mb-1">Υπάρχουν benchmarks, αλλά όχι για προϊόντα με διαθέσιμο stock.</p>
                  <p className="text-xs text-[#D1D5DB]">Η προβολή κρατά μόνο benchmarked προϊόντα που αντιστοιχούν σε διαθέσιμο απόθεμα.</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="data-table w-full text-left">
                    <thead className="sticky top-0 bg-[var(--card-bg)] z-10">
                      <tr className="text-xs text-[#6B7280] uppercase tracking-wider">
                        <th className="px-3 py-2.5 font-medium whitespace-nowrap">
                          <HeaderFilter label="Προϊόν" col="title" kind="text" align="left"
                            textValue={colFilters.title ?? ''} onTextChange={(v) => updateColFilter('title', v || undefined)}
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.title)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">
                          <HeaderFilter label="Brand" col="brand" kind="categorical" align="left"
                            options={brandOptions}
                            selected={colFilters.brand}
                            onToggle={toggleBrand}
                            onSelectAll={() => updateColFilter('brand', undefined)}
                            onClearSelection={() => updateColFilter('brand', new Set<string>())}
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.brand && colFilters.brand.size < brandOptions.length)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Στοκ" col="stock" kind="number" align="right"
                            textValue={colFilters.stock ?? ''} onTextChange={(v) => updateColFilter('stock', v || undefined)}
                            hint="Φίλτρο: απόθεμα e-shop. Ταξ.: φθίνουσα → πρώτα στοκ>πωλήσεις (κόκκινο)· αύξουσα → πρώτα πωλήσεις>στοκ (πράσινο)."
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.stock)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Πωλήσεις" col="sold" kind="number" align="right"
                            textValue={colFilters.sold ?? ''} onTextChange={(v) => updateColFilter('sold', v || undefined)}
                            hint="Φίλτρο: πωλήσεις (=0, >10…). Το =0 ισχύει μόνο όταν υπάρχει πραγματικό 0, όχι για κενό SKU. Ταξ.: ίδια ομαδοποίηση με Στοκ."
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.sold)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Πωλ./Στοκ" col="salesStockRatio" kind="number" align="right"
                            textValue={colFilters.salesStockRatio ?? ''} onTextChange={(v) => updateColFilter('salesStockRatio', v || undefined)}
                            hint="Λόγος πωλήσεων προς τρέχον στοκ. Π.χ. >1 σημαίνει ότι πούλησε περισσότερα από όσα έχει τώρα σε stock, 0.2-1 εύρος."
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.salesStockRatio)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Η τιμή σας" col="yourPrice" kind="number" align="right"
                            textValue={colFilters.yourPrice ?? ''} onTextChange={(v) => updateColFilter('yourPrice', v || undefined)}
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.yourPrice)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Benchmark" col="benchmarkPrice" kind="number" align="right"
                            textValue={colFilters.benchmarkPrice ?? ''} onTextChange={(v) => updateColFilter('benchmarkPrice', v || undefined)}
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.benchmarkPrice)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter label="Διαφ. τιμής" col="priceDiff" kind="number" align="right"
                            textValue={colFilters.priceDiff ?? ''} onTextChange={(v) => updateColFilter('priceDiff', v || undefined)}
                            hint="Σε %. Π.χ. >0 (ακριβότερα), <-10 (10% φθηνότερα)."
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.priceDiff)} />
                        </th>
                        <th className="px-3 py-2.5 font-medium hidden lg:table-cell whitespace-nowrap">
                          <HeaderFilter label="GTIN" col="gtin" kind="text" align="left"
                            textValue={colFilters.gtin ?? ''} onTextChange={(v) => updateColFilter('gtin', v || undefined)}
                            sortCol={sortCol} sortDir={sortDir} setSort={setBenchmarkSort}
                            isActive={Boolean(colFilters.gtin)} />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {visibleBenchmarks.map((b) => (
                        <BenchmarkRow
                          key={b.productId}
                          item={b}
                          inventory={lookupInventory(b.productId, b.gtin)}
                        />
                      ))}
                    </tbody>
                  </table>
                  {filteredBenchmarks.length === 0 && benchmarkSearch && (
                    <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
                  )}
                  {hiddenBenchmarkRows > 0 && (
                    <p className="px-3 py-3 text-center text-xs text-[#6B7280]">
                      Εμφανίζονται οι πρώτες {visibleBenchmarks.length.toLocaleString('el-GR')} γραμμές από{' '}
                      {filteredBenchmarks.length.toLocaleString('el-GR')} αποτελέσματα για ταχύτητα. Χρησιμοποιήστε αναζήτηση/φίλτρα ή export για πλήρη λίστα.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ════════════════ INSIGHTS TAB ════════════════ */}
      {activeTab === 'insights' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiBox label="Προϊόντα με insights" value={String(insightsCount)} tooltip="Πλήθος SKUs με προτάσεις τιμής από Google." icon={<ShoppingCart size={18} />} color="#6366F1" />
            <KpiBox label="Με πρόταση τιμής" value={String(withSuggestionCount)} tooltip="SKUs όπου η Google προτείνει διαφορετική τιμή." icon={<TrendingUp size={18} />} color="#F59E0B" />
            <KpiBox label="Μέσο conv. lift" value={avgConvLift > 0 ? `+${avgConvLift}%` : `${avgConvLift}%`} tooltip="Μέση εκτιμώμενη αύξηση μετατροπών αν εφαρμόσετε τις προτεινόμενες τιμές." icon={<BarChart3 size={18} />} color="#22C55E" />
            <KpiBox label="Πηγή" value="GMC 7d" tooltip={TOOLTIP_INSIGHTS_SOURCE} icon={<Calendar size={18} />} color="#8B5CF6" />
          </div>

          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-[#1A1A1A]">Price Insights — Προτάσεις Τιμολόγησης</h3>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">Predicted impact αν εφαρμοστεί η προτεινόμενη τιμή (τελ. 7 ημέρες)</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {hasInsightActiveColumnFilters && (
                    <button
                      type="button"
                      onClick={clearInsightColumnFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--nts-accent-text)] bg-[var(--nts-accent)]/5 hover:bg-[var(--nts-accent)]/10 border border-[var(--nts-accent)]/30 rounded-lg transition-colors"
                      title="Καθαρισμός όλων των φίλτρων στηλών"
                    >
                      <XIcon size={12} />
                      Καθαρισμός φίλτρων
                    </button>
                  )}
                  {!insightsLoading && hasInsightsData && insightsCount > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={filteredInsights.length === 0}
                        onClick={() => void handleExportInsights('csv')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none"
                        title="Όλες οι φιλτραρισμένες γραμμές (όχι μόνο οι 300 στην οθόνη). CSV UTF-8."
                      >
                        <FileText size={13} />
                        .csv
                      </button>
                      <button
                        type="button"
                        disabled={filteredInsights.length === 0}
                        onClick={() => void handleExportInsights('xlsx')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none"
                        title="Όλες οι φιλτραρισμένες γραμμές (όχι μόνο οι 300 στην οθόνη). Excel."
                      >
                        <FileSpreadsheet size={13} />
                        .xlsx
                      </button>
                    </>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                    <input
                      type="text"
                      value={insightsSearch}
                      onChange={e => setInsightsSearch(e.target.value)}
                      placeholder="Αναζήτηση..."
                      className="pl-8 pr-3 py-1.5 bg-[#F5F5F5] border border-transparent rounded-lg text-xs focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all w-48"
                    />
                  </div>
                  <Button variant="primary" size="sm" onClick={() => handleSync('merchant')} disabled={syncing !== null}>
                    {syncing === 'merchant' ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                    Sync GMC
                  </Button>
                </div>
              </div>

              {insightsLoading ? (
                <div className="py-8 flex justify-center"><Spinner size="md" label="Φόρτωση insights..." /></div>
              ) : !hasInsightsData || insightsCount === 0 ? (
                <div className="text-center py-10">
                  <TrendingUp size={40} className="mx-auto text-[#D1D5DB] mb-3" />
                  <p className="text-sm text-[#9CA3AF] mb-1">Δεν υπάρχουν Price Insights.</p>
                  <p className="text-xs text-[#D1D5DB]">Πατήστε "Sync GMC" — τα insights φέρνονται αυτόματα μαζί με τα benchmarks.</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="data-table w-full text-left">
                    <thead className="sticky top-0 bg-[var(--card-bg)] z-10">
                      <tr className="text-xs text-[#6B7280] uppercase tracking-wider">
                        <th className="px-3 py-2.5 font-medium whitespace-nowrap">
                          <HeaderFilter
                            label="Προϊόν"
                            col="title"
                            kind="text"
                            align="left"
                            textValue={insightColFilters.title ?? ''}
                            onTextChange={(v) => updateInsightColFilter('title', v || undefined)}
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.title)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">
                          <HeaderFilter
                            label="Πωλητής"
                            col="seller"
                            kind="text"
                            align="left"
                            textValue={insightColFilters.seller ?? ''}
                            onTextChange={(v) => updateInsightColFilter('seller', v || undefined)}
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.seller)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">
                          <HeaderFilter
                            label="Brand"
                            col="brand"
                            kind="categorical"
                            align="left"
                            options={insightBrandOptions}
                            selected={insightColFilters.brand}
                            onToggle={toggleInsightBrand}
                            onSelectAll={() => updateInsightColFilter('brand', undefined)}
                            onClearSelection={() => updateInsightColFilter('brand', new Set<string>())}
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.brand && insightColFilters.brand.size < insightBrandOptions.length)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Στοκ"
                            col="stock"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.stock ?? ''}
                            onTextChange={(v) => updateInsightColFilter('stock', v || undefined)}
                            hint="Φίλτρο: απόθεμα e-shop. Ταξ.: φθίνουσα → πρώτα στοκ>πωλήσεις (κόκκινο)· αύξουσα → πρώτα πωλήσεις>στοκ (πράσινο)."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.stock)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Πωλήσεις"
                            col="sold"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.sold ?? ''}
                            onTextChange={(v) => updateInsightColFilter('sold', v || undefined)}
                            hint="Φίλτρο: πωλήσεις (=0, >10…). Το =0 μόνο για πραγματικό 0. Ταξ.: ίδια ομαδοποίηση με Στοκ."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.sold)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Τρέχουσα"
                            col="currentPrice"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.currentPrice ?? ''}
                            onTextChange={(v) => updateInsightColFilter('currentPrice', v || undefined)}
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.currentPrice)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Προτεινόμενη"
                            col="suggestedPrice"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.suggestedPrice ?? ''}
                            onTextChange={(v) => updateInsightColFilter('suggestedPrice', v || undefined)}
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.suggestedPrice)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Δ τιμής"
                            col="priceDiffPercent"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.priceDiffPercent ?? ''}
                            onTextChange={(v) => updateInsightColFilter('priceDiffPercent', v || undefined)}
                            hint="Σε %. Π.χ. <-5 (φθηνότερη πρόταση)."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.priceDiffPercent)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Impr."
                            col="predImpr"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.predImpr ?? ''}
                            onTextChange={(v) => updateInsightColFilter('predImpr', v || undefined)}
                            hint="Κλάσμα από GMC (π.χ. 2 = +200%). Π.χ. >1."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.predImpr)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Clicks"
                            col="predClicks"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.predClicks ?? ''}
                            onTextChange={(v) => updateInsightColFilter('predClicks', v || undefined)}
                            hint="Κλάσμα από GMC. Π.χ. >0.5."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.predClicks)}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          <HeaderFilter
                            label="Conv."
                            col="predConv"
                            kind="number"
                            align="right"
                            textValue={insightColFilters.predConv ?? ''}
                            onTextChange={(v) => updateInsightColFilter('predConv', v || undefined)}
                            hint="Κλάσμα από GMC. Προεπιλογή ταξιν.: φθίνουσα conv. lift."
                            sortCol={insightSortCol}
                            sortDir={insightSortDir}
                            setSort={setInsightSort}
                            isActive={Boolean(insightColFilters.predConv)}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredInsights.slice(0, 300).map((item) => (
                        <InsightRow
                          key={item.productId}
                          item={item}
                          sellerLabel={insightsSellerLabel}
                          inventory={lookupInventory(item.productId, '')}
                        />
                      ))}
                    </tbody>
                  </table>
                  {filteredInsights.length === 0 && (insightsSearch || hasInsightActiveColumnFilters) && (
                    <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
                  )}
                  {filteredInsights.length > 300 && (
                    <p className="text-xs text-[#9CA3AF] text-center py-3">Εμφανίζονται τα πρώτα 300 από {filteredInsights.length}</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ════════════════ ADS TAB ════════════════ */}
      {activeTab === 'ads' && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiBox
              label="Ανταγωνιστές"
              value={String(competitors.length)}
              tooltip="Πλήθος ανταγωνιστών υπό παρακολούθηση."
              icon={<Eye size={18} />}
              color="#6366F1"
            />
            <KpiBox
              label="Ενεργές ads"
              value={String(activeAds.length)}
              tooltip="Διαφημίσεις που τρέχουν τώρα σε Meta."
              icon={<Activity size={18} />}
              color="#22C55E"
            />
            <KpiBox
              label="Σύνολο ads"
              value={String(ads.length)}
              tooltip="Συνολικές διαφημίσεις ανταγωνιστών (ενεργές + ανενεργές)."
              icon={<TrendingUp size={18} />}
              color="#F59E0B"
            />
            <KpiBox
              label="Τελευταίο scan"
              value={settings?.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleDateString('el-GR') : '—'}
              tooltip={TOOLTIP_ADS_LAST_SCAN}
              icon={<Calendar size={18} />}
              color="#8B5CF6"
            />
          </div>

          {adLibraryWarningsList && adLibraryWarningsList.length > 0 && !dismissedAdWarnings && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-950">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-2">
                  <p className="font-semibold text-sm text-amber-950">
                    {adLibraryWarningsList.some((w) => parseAdLibraryWarningLine(w).isPermission)
                      ? 'Περιορισμός πρόσβασης — δεν φορτώνονται διαφημίσεις ανταγωνιστών'
                      : 'Σημείωση Meta Ad Library'}
                  </p>
                  <ul className="space-y-2 text-xs leading-snug">
                    {adLibraryWarningsList.map((w, i) => {
                      const p = parseAdLibraryWarningLine(w);
                      return (
                        <li key={i} className="break-words">
                          <p>{p.friendly}</p>
                          {p.technical && (
                            <details className="mt-1 text-[10px] text-amber-900/80">
                              <summary className="cursor-pointer select-none hover:underline">
                                Τεχνικές λεπτομέρειες (από Meta)
                              </summary>
                              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-amber-200/80 bg-amber-100/40 p-2 font-mono">
                                {p.technical}
                              </pre>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <button
                  type="button"
                  className="text-xs text-amber-800 underline shrink-0"
                  onClick={() => {
                    setDismissedAdWarnings(true);
                    setCompetitorSyncWarnings(null);
                  }}
                >
                  Κλείσιμο
                </button>
              </div>
            </div>
          )}

          <Card>
            <div className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 min-w-0">
                  <label className="flex items-center gap-1 text-xs font-medium text-[#374151] mb-1">
                    Φίλτρο χωρών (reach)
                    <Tooltip
                      content="Φιλτράρει κατά χώρα που η Meta καταγράφει ως «reached». Με μία μόνο χώρα (π.χ. GR) πολλές καμπάνιες εμφανίζονται ως 0 — άδειασε το πεδίο και Αποθήκευση για πλήρη λίστα (GR, EU, US…). Έλεγξε το ίδιο Page ID στο facebook.com/ads/library."
                      size={11}
                    />
                  </label>
                  <input
                    type="text"
                    value={reachCountriesInput}
                    onChange={(e) => setReachCountriesInput(e.target.value)}
                    placeholder="Κενό = προεπιλογή (GR+EU+US…). Μόνο GR συχνά → 0 ads· άδειασμα πεδίου + Αποθήκευση"
                    className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-transparent"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void saveReachCountries()}
                  disabled={savingCountries}
                >
                  {savingCountries ? <Spinner size="sm" /> : 'Αποθήκευση χωρών'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Competitor Settings */}
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-[#1A1A1A]">Ανταγωνιστές υπό παρακολούθηση</h3>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                    <Plus size={14} className="mr-1" />
                    Προσθήκη
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSync('competitor')}
                    disabled={syncing !== null || competitors.length === 0}
                  >
                    {syncing === 'competitor' ? <Spinner size="sm" className="mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                    Scan τώρα
                  </Button>
                </div>
              </div>

              <AnimatePresence>
                {showAddForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-end gap-3 mb-4 p-4 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-[#374151] mb-1">Όνομα ανταγωνιστή</label>
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="π.χ. Competitor Brand"
                          className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-transparent"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-[#374151] mb-1">
                          Facebook Page ID
                          <Tooltip content="Αριθμητικό ID σελίδας. Βρείτε το μέσω facebook.com/page_name → About → Page transparency → Page ID, ή μέσω lookup-id.com." size={12} />
                        </label>
                        <input
                          type="text"
                          value={newPageId}
                          onChange={(e) => setNewPageId(e.target.value)}
                          placeholder="π.χ. 123456789012345"
                          className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-transparent"
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => addCompetitor.mutate()}
                        disabled={!newName.trim() || !newPageId.trim() || addCompetitor.isPending}
                      >
                        {addCompetitor.isPending ? <Spinner size="sm" /> : 'Αποθήκευση'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {competitors.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] text-center py-6">
                  Δεν έχετε προσθέσει ανταγωνιστές. Πατήστε "Προσθήκη" για να ξεκινήσετε.
                </p>
              ) : (
                <div className="space-y-2">
                  {competitors.map((c) => (
                    <div
                      key={c.pageId}
                      className="flex items-center justify-between px-4 py-3 bg-white border border-[#E5E7EB] rounded-lg hover:border-[var(--nts-accent)] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">📘</span>
                        <div>
                          <p className="text-sm font-medium text-[#111827]">{c.name}</p>
                          <p className="text-xs text-[#9CA3AF]">Page ID: {c.pageId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#6B7280]">
                          {ads.filter((a) => a.competitorPageId === c.pageId).length} ads
                        </span>
                        <button
                          onClick={() => removeCompetitor(c.pageId)}
                          className="p-1.5 hover:bg-red-50 rounded-md text-[#9CA3AF] hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Ads Activity */}
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-[#1A1A1A]">Διαφημιστική δραστηριότητα</h3>
                <div className="relative w-64">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Αναζήτηση..."
                    className="w-full pl-9 pr-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
                  />
                </div>
              </div>

              {adsLoading ? (
                <div className="py-8 flex justify-center">
                  <Spinner size="md" label="Φόρτωση ads..." />
                </div>
              ) : ads.length === 0 ? (
                <p className="text-sm text-[#9CA3AF] text-center py-8">Δεν υπάρχουν δεδομένα. Προσθέστε ανταγωνιστές και πατήστε "Scan τώρα".</p>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {filteredAds
                    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
                    .map((ad) => (
                      <AdCard key={ad.adId} ad={ad} />
                    ))}
                  {filteredAds.length === 0 && (
                    <p className="text-sm text-[#9CA3AF] text-center py-6">Δεν βρέθηκαν αποτελέσματα.</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function KpiBox({
  label,
  value,
  tooltip,
  icon,
  color,
  clickable = false,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  tooltip: string;
  icon: React.ReactNode;
  color: string;
  clickable?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card padding="md" hover className={clickable ? 'cursor-pointer' : undefined}>
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className={`flex w-full items-center gap-2 sm:gap-3 min-w-0 text-left ${
          clickable ? 'focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-2 rounded-lg' : 'cursor-default'
        }`}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: active ? `${color}22` : `${color}15` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[#6B7280] flex items-center gap-1 leading-tight">
            {label}
            <Tooltip content={tooltip} size={11} />
          </p>
          <p
            className="text-base sm:text-lg font-bold text-[#1A1A1A] font-mono leading-tight whitespace-normal break-words [overflow-wrap:anywhere]"
            title={value}
          >
            {value}
          </p>
        </div>
      </button>
    </Card>
  );
}

const fmtEur = (v: number) =>
  v.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BenchmarkRow({
  item,
  inventory,
}: {
  item: { productId: string; title: string; brand?: string; gtin: string; yourPrice: number; benchmarkPrice: number; priceDiff: number; currency: string };
  inventory?: SkuInventoryRow | null;
}) {
  const diffColor = item.priceDiff > 5 ? '#EF4444' : item.priceDiff < -5 ? '#22C55E' : '#6B7280';
  const diffBg = item.priceDiff > 5 ? '#FEF2F2' : item.priceDiff < -5 ? '#F0FDF4' : '#F9FAFB';
  const stock = inventory?.stock;
  const sold = inventory?.sold;
  const canCompareStockSold =
    typeof stock === 'number' && typeof sold === 'number' && Number.isFinite(stock) && Number.isFinite(sold);
  const stockOverSold = canCompareStockSold && stock > sold;
  const soldOverStock = canCompareStockSold && sold > stock;
  const ratio = salesStockRatio(inventory);

  return (
    <tr className="hover:bg-[var(--surface-2)] transition-colors">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-[#111827] line-clamp-1 max-w-xs">{item.title || item.productId}</p>
        <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{item.productId}</p>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="text-xs text-[#374151]">{item.brand || '—'}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {typeof stock === 'number' ? (
          <span
            className={`text-sm font-mono ${stockOverSold ? 'text-[#EF4444] font-semibold' : 'text-[#111827]'}`}
            title={stockOverSold ? 'Στοκ μεγαλύτερο από πωλήσεις περιόδου' : undefined}
          >
            {stock}
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {typeof sold === 'number' ? (
          <span
            className={`text-sm font-mono ${soldOverStock ? 'text-[#22C55E] font-semibold' : 'text-[#111827]'}`}
            title={soldOverStock ? 'Πωλήσεις μεγαλύτερες από τρέχον στοκ' : undefined}
          >
            {sold}
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {typeof ratio === 'number' ? (
          <span
            className={`text-sm font-mono ${ratio > 1 ? 'text-[#22C55E] font-semibold' : ratio < 0.25 ? 'text-[#EF4444] font-semibold' : 'text-[#111827]'}`}
            title="Πωλήσεις / τρέχον στοκ"
          >
            {ratio.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-mono text-[#1A1A1A]">{fmtEur(item.yourPrice)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-mono text-[#6B7280]">
          {item.benchmarkPrice > 0 ? fmtEur(item.benchmarkPrice) : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {item.benchmarkPrice > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ color: diffColor, backgroundColor: diffBg }}
          >
            {item.priceDiff > 0 ? <ArrowUp size={11} /> : item.priceDiff < 0 ? <ArrowDown size={11} /> : null}
            {item.priceDiff > 0 ? '+' : ''}{item.priceDiff}%
          </span>
        ) : (
          <span className="text-[10px] text-[#9CA3AF]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-[11px] font-mono text-[#9CA3AF]">{item.gtin || '—'}</span>
      </td>
    </tr>
  );
}

function InsightRow({
  item,
  sellerLabel,
  inventory,
}: {
  item: PriceInsight;
  sellerLabel: string;
  inventory?: SkuInventoryRow | null;
}) {
  const hasSuggestion = item.suggestedPrice > 0 && item.suggestedPrice !== item.currentPrice;
  const priceLower = item.suggestedPrice < item.currentPrice;

  const fmtPct = (v: number) => {
    const pct = Math.round(v * 100);
    if (pct === 0) return <span className="text-[#9CA3AF]">—</span>;
    const color = pct > 0 ? '#22C55E' : '#EF4444';
    const bg = pct > 0 ? '#F0FDF4' : '#FEF2F2';
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ color, backgroundColor: bg }}>
        {pct > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
        {pct > 0 ? '+' : ''}{pct}%
      </span>
    );
  };

  const stock = inventory?.stock;
  const sold = inventory?.sold;
  const canCompareStockSold =
    typeof stock === 'number' && typeof sold === 'number' && Number.isFinite(stock) && Number.isFinite(sold);
  const stockOverSold = canCompareStockSold && stock > sold;
  const soldOverStock = canCompareStockSold && sold > stock;

  return (
    <tr className="hover:bg-[var(--surface-2)] transition-colors">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-[#111827] line-clamp-1 max-w-xs">{item.title || item.productId}</p>
        <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{item.productId}</p>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="text-xs text-[#374151] line-clamp-2 max-w-[10rem]" title={sellerLabel || undefined}>
          {sellerLabel || '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="text-xs text-[#374151]">{item.brand || '—'}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {typeof stock === 'number' ? (
          <span
            className={`text-sm font-mono ${stockOverSold ? 'text-[#EF4444] font-semibold' : 'text-[#111827]'}`}
            title={stockOverSold ? 'Στοκ μεγαλύτερο από πωλήσεις περιόδου' : undefined}
          >
            {stock}
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {typeof sold === 'number' ? (
          <span
            className={`text-sm font-mono ${soldOverStock ? 'text-[#22C55E] font-semibold' : 'text-[#111827]'}`}
            title={soldOverStock ? 'Πωλήσεις μεγαλύτερες από τρέχον στοκ' : undefined}
          >
            {sold}
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-mono text-[#1A1A1A]">{fmtEur(item.currentPrice)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {hasSuggestion ? (
          <span className={`text-sm font-mono font-semibold ${priceLower ? 'text-[#22C55E]' : 'text-[#F59E0B]'}`}>
            {fmtEur(item.suggestedPrice)}
          </span>
        ) : (
          <span className="text-sm font-mono text-[#9CA3AF]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {hasSuggestion ? (
          <span className="text-xs font-mono text-[#6B7280]">
            {item.priceDiffPercent > 0 ? '+' : ''}{item.priceDiffPercent}%
          </span>
        ) : <span className="text-[#9CA3AF]">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right">{fmtPct(item.predictedImpressionsChange)}</td>
      <td className="px-3 py-2.5 text-right">{fmtPct(item.predictedClicksChange)}</td>
      <td className="px-3 py-2.5 text-right">{fmtPct(item.predictedConversionsChange)}</td>
    </tr>
  );
}

// ── Excel-style column filter popover (Price Benchmarks) ────────────

interface HeaderFilterProps {
  label: string;
  /** Column — `BenchmarkCol` or `InsightCol` (string for the shared UI). */
  col: string;
  kind: 'text' | 'number' | 'categorical';
  align?: 'left' | 'right';
  /** text/number */
  textValue?: string;
  onTextChange?: (v: string) => void;
  hint?: string;
  /** categorical */
  options?: string[];
  selected?: Set<string>;
  onToggle?: (v: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  /** sort */
  sortCol: string | null;
  sortDir: SortDir;
  setSort: (col: string, dir: SortDir) => void;
  isActive: boolean;
}

function HeaderFilter(props: HeaderFilterProps) {
  const {
    label, col, kind, align = 'left',
    textValue, onTextChange, hint,
    options = [], selected, onToggle, onSelectAll, onClearSelection,
    sortCol, sortDir, setSort, isActive,
  } = props;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [catSearch, setCatSearch] = useState('');
  const [customOperator, setCustomOperator] = useState('>');
  const [customValue, setCustomValue] = useState('');
  const [customValueTo, setCustomValueTo] = useState('');
  const numericPresets = useMemo(() => (kind === 'number' ? numericFilterPresets(col) : []), [kind, col]);

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const popWidth = 260;
      let left = align === 'right' ? rect.right - popWidth : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - popWidth - 8));
      setPos({ top: rect.bottom + 4, left });
    }
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, align]);

  const sortedHere = sortCol === col;
  const filteredOptions = useMemo(() => {
    if (!catSearch) return options;
    const q = catSearch.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, catSearch]);

  return (
    <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span>{label}</span>
      {sortedHere && (
        sortDir === 'asc'
          ? <ArrowUp size={10} className="text-[var(--nts-accent-text)]" />
          : <ArrowDown size={10} className="text-[var(--nts-accent-text)]" />
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center p-0.5 rounded transition-colors ${
          isActive
            ? 'text-[var(--nts-accent-text)] bg-[var(--nts-accent)]/10'
            : 'text-[#9CA3AF] hover:text-[#4B5563] hover:bg-[#E5E7EB]'
        }`}
        aria-label={`Φίλτρο ${label}`}
      >
        <Filter size={11} />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 260, zIndex: 60 }}
          className="bg-white border border-[#E5E7EB] rounded-lg shadow-xl p-3 normal-case tracking-normal"
        >
          <div className="flex items-center gap-1 mb-2 pb-2 border-b border-[#F3F4F6]">
            <button
              type="button"
              onClick={() => { setSort(col, 'asc'); setOpen(false); }}
              className={`flex-1 inline-flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--surface-2)] ${
                sortedHere && sortDir === 'asc' ? 'bg-[#F5F5F5] font-semibold text-[#111827]' : 'text-[#4B5563]'
              }`}
            >
              <ArrowUp size={11} /> Αύξουσα
            </button>
            <button
              type="button"
              onClick={() => { setSort(col, 'desc'); setOpen(false); }}
              className={`flex-1 inline-flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-[var(--surface-2)] ${
                sortedHere && sortDir === 'desc' ? 'bg-[#F5F5F5] font-semibold text-[#111827]' : 'text-[#4B5563]'
              }`}
            >
              <ArrowDown size={11} /> Φθίνουσα
            </button>
          </div>

          {kind === 'categorical' ? (
            <div>
              <div className="relative mb-1.5">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  type="text"
                  autoFocus
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder="Αναζήτηση τιμής…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-[#E5E7EB] rounded focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                />
              </div>
              <div className="flex items-center justify-between mb-1">
                <button type="button" onClick={onSelectAll} className="text-[10px] text-[var(--nts-accent-text)] hover:underline">Επιλογή όλων</button>
                <button type="button" onClick={onClearSelection} className="text-[10px] text-[#9CA3AF] hover:underline">Αποεπιλογή</button>
              </div>
              <div className="max-h-44 overflow-y-auto border border-[#F3F4F6] rounded p-1.5 space-y-0.5">
                {filteredOptions.length === 0 && (
                  <p className="text-[10px] text-[#9CA3AF] px-1 py-0.5">Χωρίς τιμές</p>
                )}
                {filteredOptions.map((v) => {
                  const checked = selected ? selected.has(v) : true;
                  return (
                    <label key={v} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-[var(--surface-2)] px-1 py-0.5 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle?.(v)}
                        className="accent-[var(--nts-accent)]"
                      />
                      <span className="truncate" title={v}>{v}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              {kind === 'number' && (
                <div className="mb-3 space-y-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                      Προεπιλογές
                    </label>
                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        onTextChange?.(e.target.value);
                        setOpen(false);
                      }}
                      className="w-full rounded border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                    >
                      <option value="">Επιλέξτε preset…</option>
                      {numericPresets.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-md border border-[#F3F4F6] bg-[#FAFAFA] p-2">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                      Custom filter
                    </p>
                    <div className="grid grid-cols-[88px_1fr] gap-1.5">
                      <select
                        value={customOperator}
                        onChange={(e) => setCustomOperator(e.target.value)}
                        className="rounded border border-[#E5E7EB] bg-white px-1.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                      >
                        <option value="=">Equals</option>
                        <option value="!=">Does not equal</option>
                        <option value=">">Greater than</option>
                        <option value=">=">Greater/equal</option>
                        <option value="<">Less than</option>
                        <option value="<=">Less/equal</option>
                        <option value="between">Between</option>
                      </select>
                      <input
                        type="number"
                        step="any"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        placeholder="τιμή"
                        className="rounded border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                      />
                    </div>
                    {customOperator === 'between' && (
                      <input
                        type="number"
                        step="any"
                        value={customValueTo}
                        onChange={(e) => setCustomValueTo(e.target.value)}
                        placeholder="έως"
                        className="mt-1.5 w-full rounded border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const expr = buildCustomNumericExpression(customOperator, customValue, customValueTo);
                        if (!expr) return;
                        onTextChange?.(expr);
                        setOpen(false);
                      }}
                      className="mt-2 w-full rounded bg-[var(--nts-accent)] px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Εφαρμογή custom filter
                    </button>
                  </div>
                </div>
              )}
              <input
                type="text"
                autoFocus
                value={textValue ?? ''}
                onChange={(e) => onTextChange?.(e.target.value)}
                placeholder={kind === 'number' ? 'Γρήγορο φίλτρο: >10, <5, 5-20, =8' : 'περιέχει…'}
                className="w-full px-2 py-1.5 text-xs border border-[#E5E7EB] rounded focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
              />
              <p className="text-[10px] text-[#9CA3AF] mt-1 leading-tight">
                {hint || (kind === 'number' ? 'Υποστηρίζεται: >, <, >=, <=, εύρος (5-10), ίσο (=8).' : 'Αναζήτηση που περιέχει το κείμενο.')}
              </p>
              {textValue && (
                <button
                  type="button"
                  onClick={() => onTextChange?.('')}
                  className="mt-2 text-[10px] text-[var(--nts-accent-text)] hover:underline"
                >
                  Καθαρισμός φίλτρου
                </button>
              )}
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

function AdCard({ ad }: { ad: CompetitorAd }) {
  return (
    <div className="p-4 border border-[#E5E7EB] rounded-lg hover:border-[#D1D5DB] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#111827]">{ad.competitorName}</span>
          <Badge variant={ad.isActive ? 'success' : 'default'} size="sm">
            {ad.isActive ? 'Ενεργή' : 'Ανενεργή'}
          </Badge>
        </div>
        <span className="text-xs text-[#9CA3AF]">{ad.daysRunning} ημέρες</span>
      </div>
      <p className="text-sm text-[#374151] line-clamp-3 mb-2">
        {ad.adText || <span className="italic text-[#9CA3AF]">Χωρίς κείμενο</span>}
      </p>
      <div className="flex items-center gap-4 text-xs text-[#9CA3AF]">
        <span>Έναρξη: {ad.startDate ? new Date(ad.startDate).toLocaleDateString('el-GR') : '—'}</span>
        {ad.endDate && <span>Λήξη: {new Date(ad.endDate).toLocaleDateString('el-GR')}</span>}
        {ad.platforms.length > 0 && <span>Platforms: {ad.platforms.join(', ')}</span>}
      </div>
    </div>
  );
}
