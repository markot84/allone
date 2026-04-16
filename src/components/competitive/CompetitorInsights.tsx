import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { useBrand } from '../../hooks/useBrand';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { usePriceInsights, type PriceInsight } from '../../hooks/usePriceInsights';
import { useProducts } from '../../hooks/useProducts';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_URL ||
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net';

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

const TOOLTIP_CI_REFRESH =
  'Πλήρης συγχρονισμός connectors (GMC, Meta Ad Library κ.λπ.): καθημερινά ~06:00 (Europe/Athens). Στη σελίδα: cache Price Benchmarks ~10 λεπτά, Ad Monitoring ~5 λεπτά. Για άμεση ενημέρωση: Sync GMC ή Scan τώρα.';

const TOOLTIP_BENCHMARK_UPDATED =
  'Ημερομηνία/ώρα από το νεότερο αποθηκευμένο SKU benchmark (τελευταία επιτυχημένη εγγραφή στη βάση). Προγραμματισμένος συγχρονισμός connectors ~06:00 Europe/Athens ισχύει όταν το GMC είναι συνδεδεμένο — αν η ημερομηνία μένει παλιά, πατήστε «Sync GMC» (Συνδέσεις). Προβολή σελίδας: cache ~10 λεπτά.';

const TOOLTIP_INSIGHTS_SOURCE =
  'Βάση: τελευταία 7 ημέρες GMC. Ανανέωση δεδομένων: ίδιο πρόγραμμα με τα benchmarks (ημερήσιο ~06:00 + Sync GMC).';

const TOOLTIP_ADS_LAST_SCAN =
  'Τελευταίος έλεγχος Meta Ad Library. Πλήρης ανανέωση: καθημερινά ~06:00 Europe/Athens + «Scan τώρα». Προβολή: cache ~5 λεπτά. Οι διαφημίσεις φιλτράρονται κατά χώρα reach — βλ. πεδίο χωρών παρακάτω.';

/** Μία γραμμή στα KPI (αποφυγή wrap ημερομηνίας/ώρας σε el-GR). */
function formatKpiDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Εμφανίσιμο κείμενο + τεχνικό απόθεμα για παλιές/αποθηκευμένες προειδοποιήσεις με raw JSON από Meta. */
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

  /** Πρώτα 2332004: το παλιό early-return «META_APP_ID» έκρυβε το JSON και έδειχνε λάθος κείμενο. */
  const isAppRole2332004 =
    /2332004|"error_subcode"\s*:\s*2332004|app role required/i.test(t);

  if (isAppRole2332004) {
    return {
      isPermission: true,
      friendly: `Δεν είναι δυνατή η παρακολούθηση διαφημίσεων ανταγωνιστών ${who}(Meta σφάλμα 2332004 — «App role required»): ο λογαριασμός Facebook με τον οποίο κάνατε «Σύνδεση Meta» στις Συνδέσεις πρέπει να έχει ρόλο Administrator ή Developer στην ίδια εφαρμογή (developers.facebook.com → App → App roles) — όχι μόνο διαχειριστής Business Manager. Αν άλλος έκανε τη σύνδεση, προσθέστε τον στους ρόλους ή ξανασυνδεθείτε με εκείνον τον λογαριασμό· μετά «Scan τώρα». Το app token μόνο (META_APP_ID/SECRET) συχνά απορρίπτεται για Ad Library — χρειάζεται έγκυρο user token.`,
      technical: t.length > 80 && (t.includes('{') || t.includes('error')) ? t : undefined,
    };
  }

  /* Ήδη ενημερωμένο μήνυμα από Cloud Function (μετά deploy) */
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

  /* Παλιό αποθηκευμένο κείμενο (χωρίς raw JSON) — αναβάθμιση εμφάνισης */
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

  // Price benchmarks
  const {
    benchmarks,
    isLoading: benchmarksLoading,
    isError: benchmarksQueryError,
    error: benchmarksError,
    refetch: refetchBenchmarks,
    count: benchmarkCount,
    aboveMarket,
    belowMarket,
    avgDiff,
    lastBenchmarkSyncedAt,
  } = usePriceBenchmarks();

  // Inventory/sales enrichment για τον πίνακα benchmarks.
  // Πηγές (με προτεραιότητα):
  //   1) ecommerce_summary.skuStats (Shopify/Woo/OpenCart/Magento — live stock + sold)
  //   2) products collection (manual import) — stock_level / qty_sold_period
  const { products } = useProducts();
  const { skuStats } = useEcommerceSummary();
  const skuInventoryMap = useMemo(() => {
    const map = new Map<string, { stock: number; sold: number }>();
    // Τοποθέτησε πρώτα τα manual imports…
    for (const p of products) {
      const key = (p.sku || '').trim().toLowerCase();
      if (!key) continue;
      map.set(key, {
        stock: Number(p.stock_level) || 0,
        sold: Number(p.qty_sold_period) || 0,
      });
    }
    // …και μετά άφησε τα live e-shop stats να υπερισχύσουν.
    for (const [sku, s] of Object.entries(skuStats || {})) {
      const key = (sku || '').trim().toLowerCase();
      if (!key) continue;
      map.set(key, { stock: Number(s.stock) || 0, sold: Number(s.sold) || 0 });
    }
    return map;
  }, [products, skuStats]);

  /** GMC productId συνήθως είναι `online:el:GR:SKU123` — δοκιμάζουμε όλα τα τμήματα. */
  const benchmarkKeyCandidates = (productId: string, gtin: string): string[] => {
    const raw = (productId || '').trim();
    const parts = raw ? raw.split(':').map((s) => s.trim()).filter(Boolean) : [];
    const candidates = [raw, ...parts, gtin || ''];
    return candidates.map((k) => k.toLowerCase()).filter(Boolean);
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
  const [insightsSort, setInsightsSort] = useState<'conv' | 'diff' | 'name'>('conv');

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
          await queryClient.refetchQueries({ queryKey: ['priceBenchmarks', brandId] });
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

  // Benchmark sorting / filtering
  const [benchmarkSearch, setBenchmarkSearch] = useState('');
  const [benchmarkSort, setBenchmarkSort] = useState<'diff' | 'price' | 'name'>('diff');

  const filteredBenchmarks = useMemo(() => {
    let list = [...benchmarks];
    if (benchmarkSearch) {
      const q = benchmarkSearch.toLowerCase();
      list = list.filter(
        (b) => b.title.toLowerCase().includes(q) || b.productId.toLowerCase().includes(q) || b.gtin.toLowerCase().includes(q) || (b.brand || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (benchmarkSort === 'diff') {
        const ab = a.benchmarkPrice > 0;
        const bb = b.benchmarkPrice > 0;
        if (ab !== bb) return ab ? -1 : 1;
        return b.priceDiff - a.priceDiff;
      }
      if (benchmarkSort === 'price') return b.yourPrice - a.yourPrice;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [benchmarks, benchmarkSearch, benchmarkSort]);

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

  const filteredInsights = useMemo(() => {
    let list = [...priceInsights];
    if (insightsSearch) {
      const q = insightsSearch.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.brand || '').toLowerCase().includes(q) ||
          insightsSellerLabel.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (insightsSort === 'conv') return b.predictedConversionsChange - a.predictedConversionsChange;
      if (insightsSort === 'diff') return Math.abs(b.priceDiffPercent) - Math.abs(a.priceDiffPercent);
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [priceInsights, insightsSearch, insightsSort, insightsSellerLabel]);

  if (!brandId) return null;

  const tabs: { id: Tab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'pricing', label: 'Price Benchmarks', count: benchmarkCount, icon: <ShoppingCart size={15} /> },
    { id: 'insights', label: 'Price Insights', count: insightsCount, icon: <TrendingUp size={15} /> },
    { id: 'ads', label: 'Ad Monitoring', count: ads.length, icon: <Eye size={15} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#1A1A1A] sm:text-2xl">
            <Search size={22} className="shrink-0 text-[var(--nts-accent)] sm:h-6 sm:w-6" />
            <span>Competitive Intelligence</span>
            <Tooltip content={TOOLTIP_CI_REFRESH} size={18} />
          </h2>
        }
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
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
              label="Σύνολο SKUs (GMC)"
              value={benchmarkCount > 0 ? String(benchmarkCount) : '—'}
              tooltip="Προϊόντα από την αναφορά ProductView του Merchant Center μετά το sync. Περιλαμβάνει όλο τον κατάλογο που επιστρέφει η Google — όχι μόνο όσα έχουν benchmark."
              icon={<ShoppingCart size={18} />}
              color="#6366F1"
            />
            <KpiBox
              label="Πάνω από αγορά"
              value={String(aboveMarket)}
              tooltip="SKUs με τιμή ακριβότερη από τη μέση αγοράς."
              icon={<ArrowUp size={18} />}
              color="#EF4444"
            />
            <KpiBox
              label="Κάτω από αγορά"
              value={String(belowMarket)}
              tooltip="SKUs με τιμή φθηνότερη από τη μέση αγοράς."
              icon={<ArrowDown size={18} />}
              color="#22C55E"
            />
            <KpiBox
              label="Μέση απόκλιση"
              value={`${avgDiff > 0 ? '+' : ''}${avgDiff}%`}
              tooltip="Μέσος όρος τιμολογιακής απόκλισης σε σχέση με benchmark. Θετικό = ακριβότεροι."
              icon={<BarChart3 size={18} />}
              color={avgDiff > 0 ? '#EF4444' : '#22C55E'}
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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-[#1A1A1A]">Price Benchmarks — Google Merchant Center</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={benchmarkSort}
                    onChange={(e) => setBenchmarkSort(e.target.value as any)}
                    className="px-3 py-1.5 border border-[#D1D5DB] rounded-lg text-xs bg-white focus:ring-2 focus:ring-[var(--nts-accent)]"
                  >
                    <option value="diff">Ταξινόμηση: Απόκλιση ↓</option>
                    <option value="price">Ταξινόμηση: Τιμή ↓</option>
                    <option value="name">Ταξινόμηση: Όνομα A-Z</option>
                  </select>
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

              {benchmarksLoading ? (
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
                  <p className="text-sm text-[#9CA3AF] mb-1">Δεν υπάρχουν δεδομένα benchmarking.</p>
                  <p className="text-xs text-[#D1D5DB]">Συνδέστε Google Merchant Center από τις <strong className="text-[#9CA3AF]">Συνδέσεις</strong> (sidebar) και πατήστε «Sync GMC».</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-[#F9FAFB] z-10">
                      <tr className="text-xs text-[#6B7280] uppercase tracking-wider">
                        <th className="px-3 py-2.5 font-medium whitespace-nowrap">Προϊόν</th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">Brand</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Η τιμή σας</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Benchmark</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          Διαφ.&nbsp;τιμής
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap" title="Διαθέσιμο απόθεμα e-shop">
                          Στοκ
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap" title="Πωλήσεις περιόδου (από import αποθεμάτων/παραγγελιών)">
                          Πωλήσεις
                        </th>
                        <th className="px-3 py-2.5 font-medium hidden lg:table-cell whitespace-nowrap">GTIN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredBenchmarks.map((b) => (
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
                <div className="flex items-center gap-2">
                  <select
                    value={insightsSort}
                    onChange={e => setInsightsSort(e.target.value as any)}
                    className="px-3 py-1.5 border border-[#D1D5DB] rounded-lg text-xs bg-white focus:ring-2 focus:ring-[var(--nts-accent)]"
                  >
                    <option value="conv">Conv. lift ↓</option>
                    <option value="diff">Απόκλιση τιμής ↓</option>
                    <option value="name">Όνομα A-Z</option>
                  </select>
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
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-[#F9FAFB] z-10">
                      <tr className="text-xs text-[#6B7280] uppercase tracking-wider">
                        <th className="px-3 py-2.5 font-medium whitespace-nowrap">Προϊόν</th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">Πωλητής</th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell whitespace-nowrap">Brand</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Τρέχουσα</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Προτεινόμενη</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                          Δ&nbsp;τιμής
                        </th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Impr.</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Clicks</th>
                        <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Conv.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredInsights.slice(0, 300).map((item) => (
                        <InsightRow key={item.productId} item={item} sellerLabel={insightsSellerLabel} />
                      ))}
                    </tbody>
                  </table>
                  {filteredInsights.length === 0 && insightsSearch && (
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
}: {
  label: string;
  value: string;
  tooltip: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card padding="md" hover>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[#6B7280] flex items-center gap-1 leading-tight">
            {label}
            <Tooltip content={tooltip} size={11} />
          </p>
          <p
            className="text-base sm:text-lg font-bold text-[#1A1A1A] font-mono leading-tight whitespace-nowrap truncate"
            title={value}
          >
            {value}
          </p>
        </div>
      </div>
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
  inventory?: { stock: number; sold: number } | null;
}) {
  const diffColor = item.priceDiff > 5 ? '#EF4444' : item.priceDiff < -5 ? '#22C55E' : '#6B7280';
  const diffBg = item.priceDiff > 5 ? '#FEF2F2' : item.priceDiff < -5 ? '#F0FDF4' : '#F9FAFB';
  const stock = inventory?.stock;
  const sold = inventory?.sold;

  return (
    <tr className="hover:bg-[#FAFAFA] transition-colors">
      <td className="px-3 py-2.5">
        <p className="text-sm font-medium text-[#111827] line-clamp-1 max-w-xs">{item.title || item.productId}</p>
        <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{item.productId}</p>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="text-xs text-[#374151]">{item.brand || '—'}</span>
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
      <td className="px-3 py-2.5 text-right">
        {stock != null ? (
          <span
            className={`text-sm font-mono ${stock === 0 ? 'text-[#EF4444]' : stock <= 5 ? 'text-[#F59E0B]' : 'text-[#111827]'}`}
            title={stock === 0 ? 'Εκτός αποθέματος' : stock <= 5 ? 'Χαμηλό απόθεμα' : 'Απόθεμα e-shop'}
          >
            {stock}
          </span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {sold != null ? (
          <span className="text-sm font-mono text-[#111827]">{sold}</span>
        ) : (
          <span className="text-[10px] text-[#D1D5DB]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-[11px] font-mono text-[#9CA3AF]">{item.gtin || '—'}</span>
      </td>
    </tr>
  );
}

function InsightRow({ item, sellerLabel }: { item: PriceInsight; sellerLabel: string }) {
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

  return (
    <tr className="hover:bg-[#FAFAFA] transition-colors">
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
