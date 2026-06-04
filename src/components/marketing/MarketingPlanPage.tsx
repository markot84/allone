import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Calendar, ChevronDown, ChevronRight, ChevronUp, Megaphone, PackagePlus,
  Sparkles, Tag, TrendingUp, Users, ArrowUpRight, ArrowDownRight,
  CheckCircle2, Circle, MessageSquareText,
} from 'lucide-react';
import { Card, CardHeader, Button, PageHeader, Badge, Spinner } from '../common';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useProcurementSignals } from '../../hooks/useProcurementSignals';
import { useProducts } from '../../hooks/useProducts';
import { useSegments } from '../../hooks/useSegments';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import {
  buildMarketingPlanDraft,
  buildFallbackCoreMessage,
  resolvePlanPeriod,
  type MarketingPlanDraft,
  type MarketingPlanPresetId,
  type MarketingPlanCoreMessage,
  type CampaignRecommendation,
  type RfmTactic,
  type PriceBenchmarkAlert,
} from '../../services/marketingPlanEngine';
import {
  buildMarketingPlanInsight,
  shiftIsoDateByYears,
  type MarketingPlanReorderGroup,
  type MarketingPlanSkuSuggestion,
} from '../../services/marketingPlanInsights';
import { generateMarketingPlanMessage } from '../../services/marketingPlanMessage';
import { fetchDataAnalysisOrders, fetchEcommercePlatformOrders } from '../../services/ecommerceRawOrders';
import { buildCommercialLearnings, type CommercialLearning } from '../../services/commercialLearnings';
import { shiftIsoDate } from '../../services/commercialScenarioMetrics';
import { buildSalesForecast, type ForecastGroupInput } from '../../services/salesForecast';
import { formatCommercialInfoForPrompt } from '../../services/commercialInfo';
import { resolveParentSku } from '../../utils/parentSku';
import { useCommercialInfo } from '../../hooks/useCommercialInfo';
import type { Campaign } from '../../types';
import { FirestoreService } from '../../services/firestore';
import { useBrand } from '../../hooks/useBrand';
import { formatCurrency, formatNumber } from '../../utils/format';

const PRESETS: { id: MarketingPlanPresetId; label: string }[] = [
  { id: 'next_month', label: 'Επόμενος μήνας' },
  { id: 'next_quarter', label: 'Επόμενο τρίμηνο' },
  { id: 'black_friday', label: 'Black Friday' },
  { id: 'christmas', label: 'Χριστούγεννα' },
  { id: 'january_sales', label: 'Εκπτώσεις Ιανουαρίου' },
  { id: 'back_to_school', label: 'Back to School' },
];

type SectionKey = 'analysis' | 'inventory' | 'paid' | 'organic' | 'audience' | 'pricing' | 'message';

type PlanStage = {
  id: string;
  label: string;
  detail?: string;
  meta?: string;
  done: boolean;
  active: boolean;
};

// ── Daily plan cache (localStorage) ──────────────────────────────────────────
// Το draft υπολογίζεται μία φορά την ημέρα ανά brand/preset και διατηρείται, ώστε η
// πλοήγηση μέσα στην εφαρμογή να ΜΗΝ ξανατρέχει τη βαριά ανάλυση + AI κάθε φορά.
const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
type PlanCacheEntry = { savedAt: number; plan: MarketingPlanDraft };

// v2: το draft περιλαμβάνει πλέον per-group SKU (για τα expandable reorder cards) — bump
// ώστε παλιά cached drafts χωρίς `skus` να ξαναϋπολογιστούν.
function planCacheStorageKey(brandId: string, preset: string, sig = ''): string {
  // Το sig (υπογραφή εμπορικών πληροφοριών) εξασφαλίζει recompute όταν αλλάζουν οι πληροφορίες.
  return `mp_draft_v2_${brandId}_${preset}${sig ? `_${hashSig(sig)}` : ''}`;
}

function hashSig(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readPlanCacheEntry(brandId: string | null, preset: string, sig = ''): PlanCacheEntry | null {
  if (!brandId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(planCacheStorageKey(brandId, preset, sig));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlanCacheEntry;
    if (!parsed?.savedAt || !parsed.plan) return null;
    if (Date.now() - parsed.savedAt > PLAN_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePlanCache(brandId: string, preset: string, plan: MarketingPlanDraft, sig = ''): void {
  if (typeof localStorage === 'undefined') return;
  const key = planCacheStorageKey(brandId, preset, sig);
  const payload = JSON.stringify({ savedAt: Date.now(), plan });
  try {
    localStorage.setItem(key, payload);
  } catch {
    // Quota exceeded → καθάρισε ΑΛΛΑ mp_draft entries (άλλων brand/preset) και ξαναδοκίμασε.
    // Έτσι το dedicated cache δεν αποτυγχάνει σιωπηλά (που οδηγούσε σε ξανατρέξιμο της ανάλυσης).
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('mp_draft_') && k !== key)
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, payload);
    } catch {
      /* ακόμη γεμάτο — μη μπλοκάρεις το UI (το in-memory cache καλύπτει την πλοήγηση) */
    }
  }
}

function clearPlanCache(brandId: string, preset: string, sig = ''): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(planCacheStorageKey(brandId, preset, sig));
  } catch {
    /* noop */
  }
}

export function MarketingPlanPage({ onSectionChange }: { onSectionChange?: (s: string) => void } = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { activeStrategy } = useActiveStrategy();
  const { campaigns } = useCampaigns();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const procurementSignals = useProcurementSignals();
  const { products: inventoryProducts, isLoading: inventoryLoading } = useProducts();
  const segments = useSegments({ variant: 'data_analysis', skipOrderHydration: true });
  const { benchmarks: priceBenchmarks } = usePriceBenchmarks({ maxDocs: 200 });
  const commercialInfo = useCommercialInfo();
  const queryClient = useQueryClient();

  // Ενεργές εμπορικές πληροφορίες — τροφοδοτούν AI μήνυμα + πρόβλεψη πωλήσεων.
  const activeInfo = useMemo(
    () => commercialInfo.items.filter((i) => i.status === 'active'),
    [commercialInfo.items]
  );
  const activeInfoText = useMemo(() => formatCommercialInfoForPrompt(activeInfo), [activeInfo]);
  const markPlanContext = useMemo(
    () => activeInfo.filter((i) => i.source === 'mark' && (i.markContext?.summaryBullets?.length || i.summary)),
    [activeInfo]
  );
  // Υπογραφή για το queryKey: το draft ξαναϋπολογίζεται όταν αλλάζουν οι πληροφορίες.
  const infoSig = useMemo(
    () => activeInfo.map((i) => `${i.id}:${i.direction}:${i.magnitude}`).sort().join('|'),
    [activeInfo]
  );

  const [preset, setPreset] = useState<MarketingPlanPresetId>('next_month');
  const [learningsOpen, setLearningsOpen] = useState(false);
  /**
   * Το (δευτερεύον) learnings fetch είναι βαρύ. Το τρέχουμε ΜΟΝΟ αφού ετοιμαστεί το plan draft,
   * ώστε στο αρχικό load να μην ανταγωνίζεται το κρίσιμο «Περσινές πωλήσεις» για bandwidth/CPU
   * (σε high-volume brands π.χ. e-tennis αυτό πάγωνε τη σελίδα για λεπτά).
   */
  const [planDraftReady, setPlanDraftReady] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    new Set(['analysis', 'inventory', 'paid', 'organic', 'audience', 'pricing', 'message'])
  );

  const period = useMemo(() => ({ presetId: preset, ...resolvePlanPeriod(preset) }), [preset]);
  const lastYearFrom = shiftIsoDateByYears(period.fromDate, -1);
  const lastYearTo = shiftIsoDateByYears(period.toDate, -1);

  const lastYearOrdersQuery = useQuery({
    queryKey: ['marketingPlanLastYearOrders', brandId, lastYearFrom, lastYearTo, [...ecomm.connectedPlatforms].sort().join('|')],
    queryFn: () =>
      brandId
        ? fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, {
            sinceDate: lastYearFrom,
            untilDate: lastYearTo,
            cacheFirst: true,
            revenueMode: 'all',
          })
        : Promise.resolve([]),
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Μαθήματα από προηγούμενες αποφάσεις (trailing 90 ημέρες, ανεξάρτητα από τη μελλοντική περίοδο plan).
  const learnTo = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const learnFrom = useMemo(() => shiftIsoDate(learnTo, -90), [learnTo]);
  const learningsQuery = useQuery({
    queryKey: ['marketingPlanLearnings', brandId, learnFrom, learnTo, [...ecomm.connectedPlatforms].sort().join('|'), campaigns.length, Object.keys(procurementSignals.signalsBySku).length],
    queryFn: async () => {
      if (!brandId) return null;
      // Orders από windowFrom-30 (price baseline) έως σήμερα· platform-only.
      // ΟΧΙ fetchAll: bounded στις πιο πρόσφατες ~5.000 παραγγελίες του παραθύρου. Το πλήρες
      // pagination (έως 40k docs) μονοπωλούσε δίκτυο/CPU και πάγωνε τη σελίδα σε high-volume brands.
      const orders = await fetchEcommercePlatformOrders(brandId, ecomm.connectedPlatforms, {
        sinceDate: shiftIsoDate(learnFrom, -30),
        untilDate: learnTo,
        cacheFirst: true,
        revenueMode: 'all',
      });
      // Κόστος ανά SKU από procurement signals → margin-aware learnings.
      const costBySku = new Map<string, number>();
      for (const [sku, sig] of Object.entries(procurementSignals.signalsBySku)) {
        const cost = (sig as { cost_unit?: number }).cost_unit;
        if (typeof cost === 'number' && cost > 0) costBySku.set(sku, cost);
      }
      return buildCommercialLearnings({
        campaigns: campaigns as Campaign[],
        orders,
        windowFrom: learnFrom,
        windowTo: learnTo,
        costBySku: costBySku.size > 0 ? costBySku : undefined,
      });
    },
    enabled: !!brandId && planDraftReady,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const savedQuery = useQuery({
    queryKey: ['marketing_plans', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      return FirestoreService.getDocuments<{ id: string; plan: MarketingPlanDraft; savedAt: string }>(
        'marketing_plans', [], brandId
      );
    },
    enabled: !!brandId,
    staleTime: 30 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (plan: MarketingPlanDraft) => {
      if (!brandId) throw new Error('No brand');
      const id = `mp_${Date.now()}`;
      await FirestoreService.setDocument('marketing_plans', id, { id, brandId, plan, savedAt: new Date().toISOString() });
      return id;
    },
    onSuccess: () => {
      if (brandId) queryClient.invalidateQueries({ queryKey: ['marketing_plans', brandId] });
    },
  });

  // Base data έτοιμα → το plan υπολογίζεται μία φορά (ανά brand/preset/ημέρα) και διατηρείται.
  const baseDataReady = !!brandId && !lastYearOrdersQuery.isLoading && !inventoryLoading && !procurementSignals.isLoading;
  const loadingContext = lastYearOrdersQuery.isLoading || inventoryLoading || procurementSignals.isLoading;

  // Το plan draft ζει στο React Query cache (επιβιώνει της πλοήγησης) + localStorage (επιβιώνει reload),
  // με daily staleTime. Έτσι ΔΕΝ ξανατρέχει η βαριά ανάλυση + AI σε κάθε είσοδο στη σελίδα.
  const planQuery = useQuery<MarketingPlanDraft>({
    queryKey: ['marketingPlanDraft', 'v2', brandId, preset, infoSig],
    enabled: baseDataReady,
    staleTime: PLAN_CACHE_TTL_MS,
    gcTime: PLAN_CACHE_TTL_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    initialData: () => readPlanCacheEntry(brandId, preset, infoSig)?.plan,
    initialDataUpdatedAt: () => readPlanCacheEntry(brandId, preset, infoSig)?.savedAt,
    queryFn: async () => {
      const insight = buildMarketingPlanInsight({
        period,
        lastYearOrders: lastYearOrdersQuery.data ?? [],
        inventoryProducts,
        procurementSignals: procurementSignals.signalsBySku,
      });
      const assemble = (coreMessage: MarketingPlanCoreMessage) =>
      buildMarketingPlanDraft({
        presetId: preset,
        monthlyBudget: activeStrategy?.monthlyBudget,
        campaigns: campaigns as never[],
        storeRevenue12m: ecomm.totalRevenue,
        hasGa4: ga4.hasData,
          insight,
          coreMessage,
          segments: segments.segments,
          priceBenchmarks: priceBenchmarks.map((b) => ({ title: b.title, yourPrice: b.yourPrice, benchmarkPrice: b.benchmarkPrice, priceDiff: b.priceDiff })),
          ga4TrafficSources: ga4.trafficSources.map((s) => ({ channel: s.channel, sessions: s.sessions, totalRevenue: s.totalRevenue })),
        });

      // 1) Άμεσο draft με deterministic fallback μήνυμα: γράφεται στο cache + εμφανίζεται ΤΩΡΑ,
      //    ώστε ΑΚΟΜΗ κι αν ο χρήστης κάνει reload όσο τρέχει το (αργό) AI, να μην ξαναρχίζει η ανάλυση.
      const fastDraft = assemble(buildFallbackCoreMessage(insight));
      if (brandId) writePlanCache(brandId, preset, fastDraft, infoSig);
      queryClient.setQueryData(['marketingPlanDraft', 'v2', brandId, preset, infoSig], fastDraft);

      // 2) Μη-μπλοκαριστικό AI enhancement: ενσωματώνει και τις εμπορικές πληροφορίες.
      const coreMessage = await generateMarketingPlanMessage({
        insight,
        brandName: currentBrand?.name,
        commercialInfoText: activeInfo.length > 0 ? activeInfoText : undefined,
      });
      const built = coreMessage.source === 'ai' ? assemble(coreMessage) : fastDraft;
      if (brandId) writePlanCache(brandId, preset, built, infoSig);
      return built;
    },
  });

  const draft = planQuery.data ?? null;
  const generating = planQuery.isFetching;

  // Σε αλλαγή brand, ξανακλειδώνουμε το learnings μέχρι να ετοιμαστεί το νέο draft.
  useEffect(() => {
    setPlanDraftReady(false);
  }, [brandId]);

  // Μόλις υπάρξει draft (έστω το fast/cached), ξεκλειδώνουμε το δευτερεύον learnings fetch.
  useEffect(() => {
    if (draft && !planDraftReady) setPlanDraftReady(true);
  }, [draft, planDraftReady]);

  // Πρόβλεψη πωλήσεων σε επίπεδο Κατηγορίας / Parent SKU με baseline το περσινό αντίστοιχο
  // διάστημα (από το reorderPlan/skuSuggestions) και προσαρμογή από τις εμπορικές πληροφορίες.
  const forecast = useMemo(() => {
    if (!draft) return null;
    const catMap = new Map<string, ForecastGroupInput>();
    for (const row of draft.reorderPlan) {
      const cat = row.category || 'Λοιπά';
      const cur = catMap.get(cat) ?? { category: cat, pastRevenue: 0, pastUnits: 0 };
      cur.pastRevenue += row.lastYearRevenue || 0;
      cur.pastUnits += row.lastYearUnits || 0;
      catMap.set(cat, cur);
    }

    const pskMap = new Map<string, ForecastGroupInput>();
    for (const s of draft.skuSuggestions) {
      const parent = resolveParentSku(s.sku);
      if (!parent) continue;
      const cat = s.category || 'Λοιπά';
      const key = `${cat}__${parent}`;
      const cur = pskMap.get(key) ?? { category: cat, parentSku: parent, pastRevenue: 0, pastUnits: 0 };
      cur.pastRevenue += s.lastYearRevenue || 0;
      cur.pastUnits += s.lastYearUnits || 0;
      pskMap.set(key, cur);
    }

    return buildSalesForecast({
      categoryGroups: [...catMap.values()].filter((g) => g.pastRevenue > 0 || g.pastUnits > 0),
      parentSkuGroups: [...pskMap.values()].filter((g) => g.pastRevenue > 0 || g.pastUnits > 0),
      activeInfo,
    });
  }, [draft, activeInfo]);
  const generateError = planQuery.isError
    ? (planQuery.error instanceof Error ? planQuery.error.message : 'Αποτυχία δημιουργίας plan. Δοκίμασε ξανά.')
    : null;

  // Manual «Επαναδημιουργία»: καθάρισε το daily cache και ξανατρέξε τον υπολογισμό.
  const regenerate = () => {
    if (!brandId) return;
    clearPlanCache(brandId, preset, infoSig);
    void planQuery.refetch();
  };

  const skuCoverage = useMemo(() => {
    const signalCount = Object.keys(procurementSignals.signalsBySku).length;
    return signalCount > 0 ? signalCount : null;
  }, [procurementSignals.signalsBySku]);

  // Στάδια φόρτωσης/ανάλυσης για τον progress loader (ώστε ο χρήστης να βλέπει πρόοδο, όχι αόριστο spinner).
  const planStages = useMemo<PlanStage[]>(() => {
    const salesDone = !lastYearOrdersQuery.isLoading;
    const inventoryDone = !inventoryLoading;
    const erpDone = !procurementSignals.isLoading;
    const synthesisDone = !!draft;
    const raw: Omit<PlanStage, 'active'>[] = [
      {
        id: 'sales',
        label: 'Περσινές πωλήσεις βάσης',
        detail: `${lastYearFrom} → ${lastYearTo}`,
        meta: salesDone && lastYearOrdersQuery.data ? `${formatNumber(lastYearOrdersQuery.data.length)} παραγγελίες` : undefined,
        done: salesDone,
      },
      {
        id: 'inventory',
        label: 'Τρέχον απόθεμα (product catalog)',
        meta: inventoryDone ? `${formatNumber(inventoryProducts.length)} προϊόντα` : undefined,
        done: inventoryDone,
      },
      {
        id: 'erp',
        label: 'Σήματα προμηθειών / ERP',
        meta: erpDone && skuCoverage ? `${formatNumber(skuCoverage)} SKU` : undefined,
        done: erpDone,
      },
      {
        id: 'synthesis',
        label: 'Σύνθεση πλάνου & AI core message',
        done: synthesisDone,
      },
    ];
    let activeAssigned = false;
    return raw.map((s) => {
      let active = false;
      if (s.id === 'synthesis') {
        active = generating && !synthesisDone;
      } else if (!s.done && !activeAssigned) {
        active = true;
        activeAssigned = true;
      }
      return { ...s, active };
    });
  }, [
    lastYearOrdersQuery.isLoading, lastYearOrdersQuery.data, inventoryLoading,
    inventoryProducts.length, procurementSignals.isLoading, skuCoverage,
    draft, generating, lastYearFrom, lastYearTo,
  ]);

  const planProgressPct = useMemo(() => {
    const weights: Record<string, number> = { sales: 30, inventory: 25, erp: 20, synthesis: 25 };
    let pct = 0;
    for (const s of planStages) {
      if (s.done) pct += weights[s.id] ?? 0;
      else if (s.id === 'synthesis' && generating) pct += (weights.synthesis ?? 0) * 0.5;
    }
    return Math.min(100, Math.round(pct));
  }, [planStages, generating]);

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Marketing Plan</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Εμπορικό πλάνο δράσης από περσινές πωλήσεις, τρέχον απόθεμα, καμπάνιες, κοινό και ανταγωνισμό.
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('strategy')}>Strategy</Button>
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('calendar')}>Content calendar</Button>
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('coordination')}>Coordination</Button>
          </div>
        }
      />

      <Card padding="lg" className="border border-[var(--nts-accent)]/20 bg-[var(--nts-accent)]/5">
        <CardHeader
          title="Context από Mark"
          subtitle="Σημαντικά συμπεράσματα από τον διάλογο που τροφοδοτούν αυτό το Marketing Plan."
          icon={<MessageSquareText size={18} className="text-[var(--nts-accent)]" />}
        />
        {markPlanContext.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--nts-accent)]/25 bg-white/70 p-3">
            <p className="text-sm font-medium text-[#1A1A1A]">Δεν έχει συνδεθεί ακόμη διάλογος Mark με αυτό το Marketing Plan.</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Ρώτησε τον Mark για εμπορικό σενάριο και πάτησε «Καταχώριση & άνοιγμα Marketing Plan» ώστε να αποθηκευτούν εδώ τα βασικά συμπεράσματα.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {markPlanContext.slice(0, 3).map((info) => (
              <div key={info.id} className="rounded-xl border border-white/70 bg-white/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="orange">{info.factorType}</Badge>
                  <span className="text-xs text-[#6B7280]">
                    ένταση {info.magnitude} · εμπιστοσύνη {info.confidence}
                    {(info.horizonFrom || info.horizonTo) ? ` · ${info.horizonFrom ?? '…'} → ${info.horizonTo ?? '…'}` : ''}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[#1A1A1A]">{info.summary}</p>
                {info.markContext?.summaryBullets && info.markContext.summaryBullets.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-[#4A4A4A]">
                    {info.markContext.summaryBullets.map((bullet, idx) => (
                      <li key={`${info.id}-${idx}`} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nts-accent)]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Period selector */}
      <Card padding="lg">
        <CardHeader title="Περίοδος & δεδομένα βάσης" icon={<Calendar size={18} className="text-[var(--nts-accent)]" />} />
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                preset === p.id
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]'
                  : 'border-[#E5E7EB] text-[#4A4A4A] hover:border-[var(--nts-accent)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ContextPill label="Νέα περίοδος" value={`${period.fromDate} → ${period.toDate}`} />
          <ContextPill label="Βάση σύγκρισης" value={`${lastYearFrom} → ${lastYearTo}`} />
          <ContextPill
            label="SKU coverage"
            value={skuCoverage ? `${formatNumber(skuCoverage)} SKU` : 'Χωρίς procurement data'}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={generating ? <Spinner size="sm" /> : <Sparkles size={16} />}
            onClick={regenerate}
            disabled={!brandId || generating}
          >
            {generating ? 'Δημιουργία…' : draft ? 'Επαναδημιουργία plan' : 'Δημιουργία enriched plan'}
        </Button>
          {loadingContext && !draft && (
            <span className="text-xs text-[#6B7280]">Φόρτωση δεδομένων βάσης (περσινές πωλήσεις & απόθεμα)…</span>
          )}
          {generateError && (
            <span className="text-xs font-medium text-rose-600">⚠ {generateError} · πάτησε «Δημιουργία» ξανά.</span>
          )}
        </div>
      </Card>

      {/* Staged progress loader ενόσω φορτώνουν τα base data / συντίθεται το plan */}
      {!draft && (generating || (loadingContext && !generateError)) && (
        <PlanProgress stages={planStages} pct={planProgressPct} generating={generating} />
      )}

      {/* 7-section plan output */}
      {draft && (
        <>
          {/* Section 1: Ανάλυση βάσης */}
          <PlanSection
            id="analysis"
            title="Ανάλυση βάσης"
            icon={<BarChart3 size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('analysis')}
            onToggle={() => toggleSection('analysis')}
            badge={draft.evidence ? `${formatCurrency(draft.evidence.revenue, 0)} τζίρος περσινής περιόδου` : undefined}
          >
            {draft.evidence && (
              <div className="grid gap-3 sm:grid-cols-5">
                <Metric label="Τζίρος πέρυσι" value={formatCurrency(draft.evidence.revenue, 0)} />
                <Metric label="Παραγγελίες" value={formatNumber(draft.evidence.orders)} />
                <Metric label="Τεμάχια" value={formatNumber(draft.evidence.units)} />
                <Metric label="AOV" value={formatCurrency(draft.evidence.aov, 0)} />
                <Metric label="SKU match" value={`${draft.dataQuality?.lineItemCoveragePct ?? 0}%`} color={
                  (draft.dataQuality?.lineItemCoveragePct ?? 0) >= 70 ? 'green' : (draft.dataQuality?.lineItemCoveragePct ?? 0) >= 30 ? 'amber' : 'red'
                } />
            </div>
            )}
            {draft.totalSkusCovered != null && (
              <p className="mt-3 text-xs text-[#6B7280]">
                Κάλυψη αποθέματος: <span className="font-semibold text-[#374151]">{formatNumber(draft.totalSkusCovered)} SKU</span> από procurement signals
              </p>
            )}
            {draft.risks.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {draft.risks.map((r) => <li key={r}>⚠ {r}</li>)}
              </ul>
            )}
          </PlanSection>

          {/* Section 2: Απόθεμα & Παραγγελίες */}
          <PlanSection
            id="inventory"
            title="Απόθεμα & Παραγγελίες"
            icon={<PackagePlus size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('inventory')}
            onToggle={() => toggleSection('inventory')}
            badge={
              draft.reorderPlan.length === 0
                ? undefined
                : draft.reorderPlan.filter((r) => r.action === 'increase').length > 0
                  ? `${draft.reorderPlan.filter((r) => r.action === 'increase').length} κατηγορίες χρειάζονται παραγγελία`
                  : 'Επαρκή αποθέματα — χωρίς άμεση παραγγελία'
            }
          >
            {draft.reorderPlan.length === 0 ? (
              <p className="text-sm text-[#6B7280]">Δεν υπάρχουν αρκετά περσινά δεδομένα για πρόταση παραγγελίας.</p>
            ) : (
              <>
                <div className="grid gap-3 lg:grid-cols-2">
                  {draft.reorderPlan.slice(0, 8).map((row) => <ReorderCard key={row.key} row={row} />)}
                </div>
                {draft.skuSuggestions.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">SKU opportunities ({draft.skuSuggestions.length})</p>
                    <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
                      <table className="w-full text-sm">
                        <thead className="bg-[#F9FAFB] text-xs text-[#6B7280]">
                          <tr>
                            <th className="px-3 py-2 text-left">SKU</th>
                            <th className="px-3 py-2 text-left">Προϊόν</th>
                            <th className="px-3 py-2 text-right">Πέρυσι τεμ.</th>
                            <th className="px-3 py-2 text-right">Stock</th>
                            <th className="px-3 py-2 text-right">Margin</th>
                            <th className="px-3 py-2 text-right">Πρόταση</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.skuSuggestions.slice(0, 20).map((row) => <SkuRow key={row.sku} row={row} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </PlanSection>

          {/* Πρόβλεψη πωλήσεων (Κατηγορία / Parent SKU) */}
          {forecast && forecast.categories.length > 0 && (
            <Card>
              <CardHeader
                title="Πρόβλεψη πωλήσεων — Κατηγορίες & Parent SKU"
                subtitle={
                  forecast.appliedInfoCount > 0
                    ? `Baseline περσινής περιόδου + προσαρμογή από ${forecast.appliedInfoCount} εμπορικές πληροφορίες`
                    : 'Baseline περσινής αντίστοιχης περιόδου (καμία ενεργή εμπορική πληροφορία)'
                }
              />
              <div className="p-4 pt-0 space-y-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div>
                    <span className="text-[#6B7280]">Baseline: </span>
                    <span className="font-mono font-semibold">{formatCurrency(forecast.totalBaselineRevenue, 0)}</span>
                  </div>
                  <ArrowUpRight size={16} className="text-[#9CA3AF]" />
                  <div>
                    <span className="text-[#6B7280]">Πρόβλεψη: </span>
                    <span className="font-mono font-semibold text-[var(--nts-charcoal)]">{formatCurrency(forecast.totalForecastRevenue, 0)}</span>
                  </div>
                  {forecast.totalBaselineRevenue > 0 && (
                    <Badge variant={forecast.totalForecastRevenue >= forecast.totalBaselineRevenue ? 'success' : 'warning'}>
                      {forecast.totalForecastRevenue >= forecast.totalBaselineRevenue ? '+' : ''}
                      {Math.round(((forecast.totalForecastRevenue - forecast.totalBaselineRevenue) / forecast.totalBaselineRevenue) * 100)}%
                    </Badge>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F9FAFB] text-xs text-[#6B7280]">
                      <tr>
                        <th className="px-3 py-2 text-left">Κατηγορία</th>
                        <th className="px-3 py-2 text-right">Baseline</th>
                        <th className="px-3 py-2 text-right">Προσαρμογή</th>
                        <th className="px-3 py-2 text-right">Πρόβλεψη</th>
                        <th className="px-3 py-2 text-left">Σήμα</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.categories.slice(0, 12).map((r) => (
                        <tr key={r.key} className="border-t border-[#E5E7EB]">
                          <td className="px-3 py-2 font-medium">{r.category}</td>
                          <td className="px-3 py-2 text-right font-mono text-[#6B7280]">{formatCurrency(r.baselineRevenue, 0)}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {r.upliftPct === 0 ? (
                              <span className="text-[#9CA3AF]">—</span>
                            ) : (
                              <span className={r.upliftPct > 0 ? 'text-emerald-600' : 'text-red-500'}>
                                {r.upliftPct > 0 ? '+' : ''}
                                {Math.round(r.upliftPct * 100)}%
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(r.forecastRevenue, 0)}</td>
                          <td className="px-3 py-2 text-xs text-[#6B7280] max-w-[220px] truncate" title={r.drivers.join(' · ')}>
                            {r.drivers.length > 0 ? r.drivers[0] : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {forecast.parentSkus.filter((r) => r.upliftPct !== 0).length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Parent SKU με σήμα από εμπορική πληροφορία</p>
                    <div className="flex flex-wrap gap-2">
                      {forecast.parentSkus
                        .filter((r) => r.upliftPct !== 0)
                        .slice(0, 10)
                        .map((r) => (
                          <span
                            key={r.key}
                            className="text-xs px-2 py-1 rounded-full bg-[#F3F4F6] text-[var(--nts-charcoal)]"
                            title={r.drivers.join(' · ')}
                          >
                            {r.parentSku} <span className={r.upliftPct > 0 ? 'text-emerald-600' : 'text-red-500'}>{r.upliftPct > 0 ? '+' : ''}{Math.round(r.upliftPct * 100)}%</span>
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {forecast.appliedInfoCount === 0 && (
                  <button
                    onClick={() => onSectionChange?.('commercial-info')}
                    className="text-xs text-[var(--nts-accent)] hover:underline"
                  >
                    + Πρόσθεσε εμπορική πληροφορία για πιο ακριβή πρόβλεψη
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* Section 3: Paid Media */}
          <PlanSection
            id="paid"
            title="Paid Media"
            icon={<Megaphone size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('paid')}
            onToggle={() => toggleSection('paid')}
            badge={draft.budgetSplitSource === 'data' ? 'Budget split βάσει πραγματικών δεδομένων' : 'Budget split (default)'}
          >
            {/* Budget split */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">
                Κατανομή budget
                {draft.budgetSplitSource === 'data' && <span className="ml-2 text-emerald-600 normal-case font-normal">· από πραγματικές καμπάνιες</span>}
              </p>
              <div className="grid grid-cols-4 gap-3">
                <BudgetPill label="Google Ads" pct={draft.budgetSplit.googleAds} monthlyBudget={activeStrategy?.monthlyBudget} />
                <BudgetPill label="Meta" pct={draft.budgetSplit.meta} monthlyBudget={activeStrategy?.monthlyBudget} />
                <BudgetPill label="Organic" pct={draft.budgetSplit.organic} monthlyBudget={activeStrategy?.monthlyBudget} />
                {draft.budgetSplit.other > 0 && <BudgetPill label="Other" pct={draft.budgetSplit.other} monthlyBudget={activeStrategy?.monthlyBudget} />}
              </div>
            </div>

            {/* Campaign recommendations */}
            {draft.campaignRecommendations.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Campaign recommendations</p>
                <div className="space-y-2">
                  {draft.campaignRecommendations.map((c) => <CampaignRec key={c.id} rec={c} />)}
                </div>
              </div>
            )}

            {/* Performance actions */}
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Ενέργειες</p>
              <ul className="space-y-2">
                {draft.performance.map((item) => <ActionItem key={item.id} item={item} />)}
              </ul>
            </div>
          </PlanSection>

          {/* Section 4: Organic */}
          <PlanSection
            id="organic"
            title="Οργανικές Ενέργειες"
            icon={<TrendingUp size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('organic')}
            onToggle={() => toggleSection('organic')}
            badge={ga4.hasData ? 'GA4 connected' : 'GA4 not connected'}
          >
            {draft.ga4ChannelSummary.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Κανάλια επισκεψιμότητας</p>
                <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F9FAFB] text-xs text-[#6B7280]">
                      <tr>
                        <th className="px-3 py-2 text-left">Κανάλι</th>
                        <th className="px-3 py-2 text-right">Sessions</th>
                        {draft.ga4ChannelSummary.some((s) => s.revenue > 0) && <th className="px-3 py-2 text-right">Revenue</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.ga4ChannelSummary.map((s) => (
                        <tr key={s.channel} className="border-t border-[#E5E7EB]">
                          <td className="px-3 py-2 font-medium">{s.channel}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatNumber(s.sessions)}</td>
                          {draft.ga4ChannelSummary.some((x) => x.revenue > 0) && (
                            <td className="px-3 py-2 text-right font-mono">{s.revenue > 0 ? formatCurrency(s.revenue, 0) : '—'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <ul className="space-y-2">
              {draft.organic.map((item) => <ActionItem key={item.id} item={item} />)}
            </ul>
          </PlanSection>

          {/* Section 5: Κοινό & CRM */}
          <PlanSection
            id="audience"
            title="Κοινό & CRM"
            icon={<Users size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('audience')}
            onToggle={() => toggleSection('audience')}
            badge={draft.rfmTactics.length > 0 ? `${draft.rfmTactics.reduce((s, t) => s + t.size, 0).toLocaleString('el-GR')} πελάτες στα segments` : 'RFM data'}
          >
            {draft.rfmTactics.length === 0 ? (
              <p className="text-sm text-[#6B7280]">Δεν υπάρχουν RFM δεδομένα. Πήγαινε στο <span className="text-[var(--nts-accent)]">RFM Segmentation</span> για να δεις τα segments σου.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {draft.rfmTactics.map((tactic) => <RfmTacticCard key={tactic.segmentName} tactic={tactic} />)}
              </div>
            )}
          </PlanSection>

          {/* Section 6: Τιμολόγηση */}
          <PlanSection
            id="pricing"
            title="Τιμολόγηση & Ανταγωνισμός"
            icon={<Tag size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('pricing')}
            onToggle={() => toggleSection('pricing')}
            badge={draft.priceBenchmarkAlerts.length > 0 ? `${draft.priceBenchmarkAlerts.length} SKU με σημαντική απόκλιση` : 'Price benchmarks'}
          >
            {draft.priceBenchmarkAlerts.length === 0 ? (
              <p className="text-sm text-[#6B7280]">Δεν υπάρχουν δεδομένα σύγκρισης τιμών. Σύνδεσε Google Merchant Center για price benchmarks.</p>
            ) : (
              <>
                {draft.priceBenchmarkAlerts.filter((a) => a.direction === 'above').length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase text-rose-600">Πάνω από market ({draft.priceBenchmarkAlerts.filter((a) => a.direction === 'above').length} SKU)</p>
                    <div className="space-y-2">
                      {draft.priceBenchmarkAlerts.filter((a) => a.direction === 'above').map((alert) => (
                        <PriceAlert key={alert.title} alert={alert} />
                      ))}
                    </div>
                  </div>
                )}
                {draft.priceBenchmarkAlerts.filter((a) => a.direction === 'below').length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase text-emerald-600">Κάτω από market ({draft.priceBenchmarkAlerts.filter((a) => a.direction === 'below').length} SKU)</p>
                    <div className="space-y-2">
                      {draft.priceBenchmarkAlerts.filter((a) => a.direction === 'below').map((alert) => (
                        <PriceAlert key={alert.title} alert={alert} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </PlanSection>

          {/* Section 7: AI Core Message */}
          <PlanSection
            id="message"
            title="AI Core Message"
            icon={<Sparkles size={18} className="text-[var(--nts-accent)]" />}
            open={openSections.has('message')}
            onToggle={() => toggleSection('message')}
            badge={draft.coreMessage.source === 'ai' ? 'Gemini AI' : 'Fallback'}
          >
            <p className="text-base font-semibold text-[#1A1A1A]">{draft.coreMessage.headline}</p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4A4A]">{draft.coreMessage.campaignAngle}</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                <p className="text-xs font-semibold uppercase text-[#9CA3AF]">Proof points</p>
                <ul className="mt-2 space-y-1 text-sm text-[#374151]">
                  {draft.coreMessage.proofPoints.map((point) => <li key={point}>• {point}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                <p className="text-xs font-semibold uppercase text-[#9CA3AF]">CTA ideas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {draft.coreMessage.ctaIdeas.map((cta) => <Badge key={cta} variant="info" size="sm">{cta}</Badge>)}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => void saveMutation.mutateAsync(draft)}
              >
                {saveMutation.isPending ? 'Αποθήκευση…' : 'Αποθήκευση plan'}
              </Button>
              {saveMutation.isSuccess && <span className="text-xs text-emerald-600 self-center">✓ Αποθηκεύτηκε</span>}
            </div>
          </PlanSection>
        </>
      )}

      {/* Βοηθητικό: μαθήματα από προηγούμενες αποφάσεις (κάτω από το plan, collapsed by default) */}
      <LearningsCard
        open={learningsOpen}
        onToggle={() => setLearningsOpen((v) => !v)}
        loading={learningsQuery.isLoading}
        learnings={learningsQuery.data ?? null}
        windowLabel={`${learnFrom} → ${learnTo}`}
      />

      {/* Saved plans */}
      {savedQuery.data && savedQuery.data.length > 0 && (
        <Card padding="md">
          <p className="mb-3 text-xs font-semibold uppercase text-[#9CA3AF]">Αποθηκευμένα plans</p>
          <ul className="divide-y divide-[#E5E7EB]">
            {savedQuery.data.slice(0, 8).map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm font-medium text-[#1A1A1A]">{row.plan?.periodLabel}</span>
                  <span className="ml-2 text-xs text-[#9CA3AF]">{row.savedAt?.slice(0, 10)}</span>
                  {row.plan?.fromDate && (
                    <span className="ml-2 text-xs text-[#9CA3AF]">{row.plan.fromDate} – {row.plan.toDate}</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (row.plan && brandId) {
                      queryClient.setQueryData(['marketingPlanDraft', 'v2', brandId, preset], row.plan);
                      setOpenSections(new Set(['analysis', 'inventory', 'paid', 'organic', 'audience', 'pricing', 'message']));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                >
                  Φόρτωση
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PlanSection({
  id, title, icon, open, onToggle, badge, children,
}: {
  id: SectionKey;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="lg" className="overflow-hidden">
      <button
        type="button"
        id={`plan-section-${id}`}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls={`plan-content-${id}`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-[#1A1A1A]">{title}</span>
          {badge && <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]">{badge}</span>}
        </div>
        {open ? <ChevronUp size={16} className="text-[#9CA3AF]" /> : <ChevronDown size={16} className="text-[#9CA3AF]" />}
      </button>
      {open && <div id={`plan-content-${id}`} className="mt-4">{children}</div>}
    </Card>
  );
}

function PlanProgress({ stages, pct, generating }: { stages: PlanStage[]; pct: number; generating: boolean }) {
  const doneCount = stages.filter((s) => s.done).length;
  return (
    <Card padding="lg">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--nts-accent)]" />
          <span className="font-semibold text-[#1A1A1A]">
            {generating ? 'Σύνθεση enriched plan…' : 'Φόρτωση & ανάλυση δεδομένων…'}
          </span>
        </div>
        <span className="font-mono text-sm font-bold text-[var(--nts-accent)]">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
        <div
          className="h-full rounded-full bg-[var(--nts-accent)] transition-all duration-500 ease-out"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[#9CA3AF]">{doneCount}/{stages.length} βήματα ολοκληρώθηκαν</p>

      {/* Stage checklist */}
      <ul className="mt-4 space-y-2.5">
        {stages.map((s) => {
          const stateClass = s.done ? 'text-emerald-600' : s.active ? 'text-[var(--nts-accent)]' : 'text-[#9CA3AF]';
          return (
            <li key={s.id} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {s.done ? (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                ) : s.active ? (
                  <Spinner size="sm" />
                ) : (
                  <Circle size={18} className="text-[#D1D5DB]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={`text-sm font-medium ${s.done ? 'text-[#1A1A1A]' : stateClass}`}>{s.label}</span>
                  {s.meta && <span className="text-xs text-[#6B7280]">· {s.meta}</span>}
                </div>
                {s.detail && <p className="text-xs text-[#9CA3AF]">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ContextPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function LearningItem({ item }: { item: CommercialLearning }) {
  const Icon = item.verdict === 'positive' ? ArrowUpRight : ArrowDownRight;
  const tone = item.verdict === 'positive' ? 'text-emerald-600' : 'text-rose-600';
  return (
    <li className="flex items-start gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
      <Icon size={14} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-[#1A1A1A]">{item.title}</p>
        <p className="text-xs leading-relaxed text-[#6B7280]">{item.detail}</p>
      </div>
    </li>
  );
}

function LearningsCard({
  open,
  onToggle,
  loading,
  learnings,
  windowLabel,
}: {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  learnings: { wins: CommercialLearning[]; misses: CommercialLearning[]; priceWins: CommercialLearning[] } | null;
  windowLabel: string;
}) {
  const total = learnings ? learnings.wins.length + learnings.misses.length + learnings.priceWins.length : 0;
  return (
    <Card padding="lg" className="overflow-hidden">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-[var(--nts-accent)]" />
          <span className="font-semibold text-[#1A1A1A]">Μαθήματα από προηγούμενες αποφάσεις</span>
          <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]">{windowLabel}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-[#9CA3AF]" /> : <ChevronDown size={16} className="text-[#9CA3AF]" />}
      </button>
      {open && (
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Spinner size="sm" /> Ανάλυση αποφάσεων…</div>
          ) : total === 0 ? (
            <p className="text-sm text-[#6B7280]">
              Δεν εντοπίστηκαν σαφείς αποφάσεις (αλλαγές budget/τιμών) στις τελευταίες 90 ημέρες. Μόλις γίνουν ουσιαστικές αλλαγές, θα εμφανιστούν εδώ ως ιδέες.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-emerald-700">Τι λειτούργησε — επανέλαβε ({learnings!.wins.length})</p>
                {learnings!.wins.length === 0 ? (
                  <p className="text-xs text-[#9CA3AF]">—</p>
                ) : (
                  <ul className="space-y-2">{learnings!.wins.map((i) => <LearningItem key={i.id} item={i} />)}</ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-rose-700">Τι απέτυχε — απόφυγε/διόρθωσε ({learnings!.misses.length})</p>
                {learnings!.misses.length === 0 ? (
                  <p className="text-xs text-[#9CA3AF]">—</p>
                ) : (
                  <ul className="space-y-2">{learnings!.misses.map((i) => <LearningItem key={i.id} item={i} />)}</ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Αλλαγές τιμών που απέδωσαν ({learnings!.priceWins.length})</p>
                {learnings!.priceWins.length === 0 ? (
                  <p className="text-xs text-[#9CA3AF]">—</p>
                ) : (
                  <ul className="space-y-2">{learnings!.priceWins.map((i) => <LearningItem key={i.id} item={i} />)}</ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: 'green' | 'amber' | 'red' }) {
  const textColor = color === 'green' ? 'text-emerald-600' : color === 'amber' ? 'text-amber-600' : color === 'red' ? 'text-rose-600' : 'text-[#1A1A1A]';
  return (
    <div className="rounded-lg border border-[#E5E7EB] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${textColor}`}>{value}</p>
    </div>
  );
}

function BudgetPill({ label, pct, monthlyBudget }: { label: string; pct: number; monthlyBudget?: number }) {
  const euro = monthlyBudget && monthlyBudget > 0 ? Math.round((monthlyBudget * pct) / 100) : null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="font-mono text-xl font-bold text-[#1A1A1A]">{pct}%</p>
      {euro != null && <p className="font-mono text-xs text-[#6B7280]">{formatCurrency(euro, 0)}/μήνα</p>}
    </div>
  );
}

function ReorderCard({ row }: { row: MarketingPlanReorderGroup }) {
  const [expanded, setExpanded] = useState(false);
  const tone = row.action === 'increase' ? 'success' : row.action === 'maintain' ? 'warning' : row.action === 'reduce' ? 'info' : 'default';
  const actionLabel = row.action === 'increase' ? 'Παράγγειλε' : row.action === 'maintain' ? 'Διατήρησε' : row.action === 'reduce' ? 'Μείωσε' : 'Αποφύγει';
  const marginTone =
    row.marginPct == null ? '' : row.marginPct >= 30 ? 'text-emerald-600' : row.marginPct >= 15 ? 'text-amber-600' : 'text-rose-600';
  const skus = row.skus ?? [];
  const canExpand = skus.length > 0;
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`flex w-full items-start justify-between gap-3 text-left ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-[#1A1A1A]">
            {canExpand && (
              <ChevronRight size={14} className={`shrink-0 text-[#9CA3AF] transition-transform ${expanded ? 'rotate-90' : ''}`} />
            )}
            <span className="truncate">{row.subcategory || row.category}</span>
          </p>
          <p className="text-xs text-[#6B7280]">{[row.category, row.brand].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={tone} size="sm">{actionLabel}</Badge>
          <div className="flex items-center gap-1.5">
            {row.marginPct != null && (
              <span className={`text-[10px] font-semibold ${marginTone}`}>Margin {row.marginPct}%</span>
            )}
            {row.daysOfCover != null && (
              <span className="text-[10px] text-[#9CA3AF]">· {formatNumber(row.daysOfCover)}ημ.</span>
            )}
          </div>
        </div>
      </button>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-[#F9FAFB] px-2 py-1.5 text-center">
          <p className="text-[10px] text-[#9CA3AF]">Πέρυσι</p>
          <p className="font-mono text-sm font-bold text-[#1A1A1A]">{formatNumber(row.lastYearUnits)} τεμ.</p>
        </div>
        <div className="rounded-lg bg-[#F9FAFB] px-2 py-1.5 text-center">
          <p className="text-[10px] text-[#9CA3AF]">Stock</p>
          <p className={`font-mono text-sm font-bold ${row.currentStock < row.lastYearUnits * 0.35 ? 'text-rose-600' : 'text-[#1A1A1A]'}`}>{formatNumber(row.currentStock)}</p>
        </div>
        <div className="rounded-lg bg-[#F9FAFB] px-2 py-1.5 text-center">
          <p className="text-[10px] text-[#9CA3AF]">Πρόταση{row.reorderQtySource === 'erp' ? ' · ERP' : ''}</p>
          <p className="font-mono text-sm font-bold text-[var(--nts-accent)]">{formatNumber(row.estimatedReorderQty)}</p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#6B7280]">{row.rationale}</p>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] font-medium text-[var(--nts-accent)] hover:underline"
        >
          {expanded ? 'Απόκρυψη SKU' : `Ανάλυση ${formatNumber(skus.length)} SKU →`}
        </button>
      )}
      {expanded && canExpand && (
        <div className="mt-2 overflow-hidden rounded-lg border border-[#E5E7EB]">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wide text-[#9CA3AF]">
              <tr>
                <th className="px-2 py-1.5 font-medium">SKU</th>
                <th className="px-2 py-1.5 font-medium">Προϊόν</th>
                <th className="px-2 py-1.5 text-right font-medium">Πέρυσι</th>
                <th className="px-2 py-1.5 text-right font-medium">Stock</th>
                <th className="px-2 py-1.5 text-right font-medium">Margin</th>
                <th className="px-2 py-1.5 text-right font-medium">Πρόταση</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku} className="border-t border-[#F0F0F0] hover:bg-[#FAFAFA]">
                  <td className="px-2 py-1.5 font-mono text-[#6B7280]">{s.sku}</td>
                  <td className="px-2 py-1.5">
                    <p className="truncate font-medium text-[#1A1A1A]" title={s.name}>{s.name}</p>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatNumber(s.lastYearUnits)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${s.currentStock < s.lastYearUnits * 0.35 ? 'text-rose-600' : 'text-[#1A1A1A]'}`}>{formatNumber(s.currentStock)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${
                    s.marginPct == null ? 'text-[#9CA3AF]' : s.marginPct >= 30 ? 'text-emerald-600' : s.marginPct >= 15 ? 'text-amber-600' : 'text-rose-600'
                  }`}>{s.marginPct == null ? '—' : `${s.marginPct}%`}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-semibold text-[var(--nts-accent)]">
                    {formatNumber(s.estimatedReorderQty)}
                    {s.reorderQtySource === 'erp' && <span className="ml-1 text-[9px] font-normal text-[#9CA3AF]">ERP</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkuRow({ row }: { row: MarketingPlanSkuSuggestion }) {
  return (
    <tr className="border-t border-[#E5E7EB] hover:bg-[#FAFAFA]">
      <td className="px-3 py-2 font-mono text-xs text-[#1A1A1A]">{row.sku}</td>
      <td className="px-3 py-2">
        <p className="font-medium text-[#1A1A1A]">{row.name}</p>
        <p className="text-xs text-[#6B7280]">{[row.category, row.brand].filter(Boolean).join(' · ')}</p>
      </td>
      <td className="px-3 py-2 text-right font-mono">{formatNumber(row.lastYearUnits)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatNumber(row.currentStock)}</td>
      <td className={`px-3 py-2 text-right font-mono ${
        row.marginPct == null ? 'text-[#9CA3AF]' : row.marginPct >= 30 ? 'text-emerald-600' : row.marginPct >= 15 ? 'text-amber-600' : 'text-rose-600'
      }`}>{row.marginPct == null ? '—' : `${row.marginPct}%`}</td>
      <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--nts-accent)]">
        {formatNumber(row.estimatedReorderQty)}
        {row.reorderQtySource === 'erp' && <span className="ml-1 text-[9px] font-normal text-[#9CA3AF]">ERP</span>}
      </td>
    </tr>
  );
}

function CampaignRec({ rec }: { rec: CampaignRecommendation }) {
  const actionColor = rec.action === 'scale' ? 'text-emerald-700 bg-emerald-50' : rec.action === 'pause' ? 'text-rose-700 bg-rose-50' : 'text-amber-700 bg-amber-50';
  const actionLabel = rec.action === 'scale' ? '↑ Scale' : rec.action === 'pause' ? '⏸ Pause' : '⦿ Monitor';
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2.5">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${actionColor}`}>{actionLabel}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#1A1A1A]">{rec.title}</p>
        <p className="mt-0.5 text-xs text-[#6B7280]">{rec.rationale}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm font-bold text-[#1A1A1A]">{rec.currentRoas}x</p>
        <p className="text-[10px] text-[#9CA3AF]">ROAS</p>
      </div>
    </div>
  );
}

function RfmTacticCard({ tactic }: { tactic: RfmTactic }) {
  const segmentColor: Record<RfmTactic['segment'], string> = {
    vip: 'border-l-emerald-500',
    at_risk: 'border-l-amber-500',
    lapsed: 'border-l-rose-500',
    new: 'border-l-blue-500',
    other: 'border-l-gray-400',
  };
  const channelLabel: Record<RfmTactic['channel'], string> = { email: 'Email', paid: 'Paid', organic: 'Organic' };
  return (
    <div className={`rounded-xl border border-[#E5E7EB] border-l-4 ${segmentColor[tactic.segment]} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#1A1A1A]">{tactic.segmentName}</p>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]">{channelLabel[tactic.channel]}</span>
          {tactic.revenueShare > 0 && (
            <span className="text-[10px] text-[#9CA3AF]">{tactic.revenueShare.toFixed(1)}% revenue</span>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-[#6B7280]">{formatNumber(tactic.size)} πελάτες</p>
      <p className="mt-2 text-sm text-[#374151]">{tactic.action}</p>
    </div>
  );
}

function PriceAlert({ alert }: { alert: PriceBenchmarkAlert }) {
  const isAbove = alert.direction === 'above';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#1A1A1A]">{alert.title}</p>
        <p className="text-xs text-[#6B7280]">
          Τιμή σου: {formatCurrency(alert.yourPrice, 2)} · Benchmark: {formatCurrency(alert.benchmarkPrice, 2)}
        </p>
      </div>
      <div className={`flex items-center gap-1 text-sm font-bold ${isAbove ? 'text-rose-600' : 'text-emerald-600'}`}>
        {isAbove ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {Math.abs(alert.priceDiff).toFixed(1)}%
      </div>
    </div>
  );
}

function ActionItem({ item }: { item: { id: string; channel: string; title: string; detail: string; priority: string } }) {
  return (
    <li className="flex gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
        item.priority === 'high' ? 'bg-rose-100 text-rose-700' : item.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
      }`}>
        {item.channel}
      </span>
      <div>
        <p className="font-medium text-[#1A1A1A]">{item.title}</p>
        <p className="mt-0.5 text-xs text-[#6B7280]">{item.detail}</p>
      </div>
    </li>
  );
}
