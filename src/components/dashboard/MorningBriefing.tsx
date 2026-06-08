import { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, AlertTriangle, Clock, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, FormattedProse, toPlainProseText } from '../common';
import type { BriefingResult } from '../../services/morningBriefing';
import {
  collectBriefingData,
  generateMorningBriefing,
  getCachedBriefing,
  getLocalDateKey,
  briefingResultFromCache,
  computeBriefingDataHash,
} from '../../services/morningBriefing';
import type { Product, Campaign, RFMSegment, AutomationAlert } from '../../types';

interface MorningBriefingProps {
  brandId: string;
  brandName: string;
  products: Product[];
  campaigns: Campaign[];
  segments: RFMSegment[];
  totalOrganicRevenue: number;
  ga4: {
    totals: { sessions: number; users: number; newUsers: number; bounceRate: number; conversions: number };
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
    hasData: boolean;
  };
  alerts: AutomationAlert[];
  supplierTodMap?: Map<string, number>;
  ecommerce?: {
    hasData: boolean;
    totalRevenue: number;
    orderCount: number;
    aov: number;
    connectedPlatforms: string[];
    platformBreakdown: { platform: string; revenue: number; orders: number }[];
    dataFreshness?: {
      latestPositiveRevenueDay: string | null;
      daysSinceLatestRevenue: number | null;
      aggregateSyncedHoursAgo?: number | null;
      suspectedSyncGap: boolean;
    };
  };
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
  hasAnyData: boolean;
  /** Selected dashboard period key (e.g. 'current_month'). Scopes cache & prompt. */
  period?: string;
  /** Human-readable label for the period (e.g. 'Τελευταίες 30ημ.'). */
  periodLabel?: string;
  /**
   * Μόλις true τα KPI του dashboard (είδη e-shop από summary → raw ιστορικό) έχουν «στεγνώσει».
   * Γλιτώνει AI briefing που μιλά για μηδενικά έσοδα όσο τα orders ακόμη φορτώνουν.
   */
  metricsReady?: boolean;
  /** Fingerprint τιμών που τροφοδοτούν το briefing — όταν αλλάζει, ελέγχουται dataHash και ανα δημιουργία αν χρειάζεται. */
  financeKey?: string;
}

/** Πραγματικές ενότητες εφαρμογής — όχι `inventory` (δεν υπάρχει route). */
type GuessResult = { section: string; hashQuery?: string };

function guessRoute(action: string): GuessResult {
  const lower = action.toLowerCase();
  if (lower.includes('ecom') || lower.includes('eshop') || lower.includes('παραγγελι') || lower.includes('aov') || lower.includes('true roas')) {
    return { section: 'ecommerce' };
  }
  if (lower.includes('dead') || lower.includes('νεκρ')) {
    return { section: 'products', hashQuery: 'stock=dead' };
  }
  if (lower.includes('excess') || lower.includes('πλεόνασμα')) {
    return { section: 'products', hashQuery: 'stock=excess' };
  }
  if (lower.includes('high-margin') || lower.includes('high margin') || lower.includes('αναπλήρωση')) {
    return { section: 'products', hashQuery: 'filter=high-margin-low-stock' };
  }
  const pairs: [string, GuessResult][] = [
    ['campaign', { section: 'campaigns' }],
    ['καμπάνι', { section: 'campaigns' }],
    ['stock', { section: 'products' }],
    ['απόθεμα', { section: 'products' }],
    ['inventory', { section: 'products' }],
    ['segment', { section: 'rfm' }],
    ['at risk', { section: 'rfm' }],
    ['champions', { section: 'rfm' }],
    ['rfm', { section: 'rfm' }],
    ['content', { section: 'calendar' }],
    ['strategy', { section: 'strategy' }],
    ['budget', { section: 'channels' }],
    ['roas', { section: 'roi' }],
    ['roi', { section: 'roi' }],
  ];
  for (const [keyword, route] of pairs) {
    if (lower.includes(keyword)) return route;
  }
  return { section: 'dashboard' };
}

const SIGNIFICANCE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
/** Μικρή καθυστέρηση μετά τα σταθερά KPI· το βαρύ work περιμένει `metricsReady`. */
const INIT_DELAY_MS = 150;

function briefingStorageKey(brandId: string, period = 'current_month') {
  return `perf-plus-ai-briefing-v4:${brandId}:${getLocalDateKey()}:${period}`;
}

function loadBriefingFromStorage(brandId: string, period = 'current_month'): BriefingResult | null {
  try {
    const raw = localStorage.getItem(briefingStorageKey(brandId, period));
    if (!raw) return null;
    const p = JSON.parse(raw) as BriefingResult;
    if (typeof p.narrative !== 'string' || typeof p.generatedAt !== 'string') return null;
    if (!Array.isArray(p.actions)) p.actions = [];
    return p;
  } catch {
    return null;
  }
}

function saveBriefingToStorage(brandId: string, b: BriefingResult, period = 'current_month') {
  try {
    localStorage.setItem(briefingStorageKey(brandId, period), JSON.stringify(b));
  } catch {
    /* quota */
  }
}

function loadCollapsedPref(brandId: string): boolean {
  try {
    return localStorage.getItem(`perf-plus-briefing-collapsed:${brandId}`) === '1';
  } catch {
    return false;
  }
}

export function MorningBriefing(props: MorningBriefingProps) {
  const { brandId, brandName, hasAnyData, onSectionChange } = props;
  const period = props.period ?? 'current_month';
  const periodLabel = props.periodLabel ?? 'Τρέχων Μήνας';
  const metricsReady = props.metricsReady ?? true;
  // financeKey prop διατηρείται για backward compat αλλά δεν χρησιμοποιείται πλέον εσωτερικά
  void props.financeKey;

  const [briefing, setBriefing] = useState<BriefingResult | null>(() =>
    brandId ? loadBriefingFromStorage(brandId, period) : null
  );
  const [collapsed, setCollapsed] = useState(() => (brandId ? loadCollapsedPref(brandId) : false));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ref: παρακολουθεί αν έγινε ήδη auto-regen για τη συγκεκριμένη metricsReady→true μετάβαση. */
  const metricsReadyRegenRef = useRef(false);
  const initRef = useRef<string | null>(null);
  const checkInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const briefingLatestRef = useRef<BriefingResult | null>(null);
  briefingLatestRef.current = briefing;

  const buildData = useCallback(() => collectBriefingData({
    products: props.products,
    campaigns: props.campaigns,
    segments: props.segments,
    totalOrganicRevenue: props.totalOrganicRevenue,
    ga4: props.ga4,
    alerts: props.alerts,
    brandName,
    supplierTodMap: props.supplierTodMap,
    ecommerce: props.ecommerce
      ? {
          hasData: props.ecommerce.hasData,
          totalRevenue: props.ecommerce.totalRevenue,
          orderCount: props.ecommerce.orderCount,
          aov: props.ecommerce.aov,
          connectedPlatforms: props.ecommerce.connectedPlatforms,
          topPlatform: props.ecommerce.platformBreakdown?.[0]?.platform,
          dataFreshness: props.ecommerce.dataFreshness,
        }
      : undefined,
  }), [props.products, props.campaigns, props.segments, props.totalOrganicRevenue, props.ga4, props.alerts, brandName, props.supplierTodMap, props.ecommerce]);

  const buildDataRef = useRef(buildData);
  buildDataRef.current = buildData;
  const periodRef = useRef(period);
  periodRef.current = period;
  const periodLabelRef = useRef(periodLabel);
  periodLabelRef.current = periodLabel;

  // Reset when brand changes.
  useEffect(() => {
    if (!brandId) return;
    setCollapsed(loadCollapsedPref(brandId));
    setBriefing(loadBriefingFromStorage(brandId, periodRef.current));
    setError(null);
    initRef.current = null;
    metricsReadyRegenRef.current = false;
  }, [brandId]);

  // Reset + trigger new briefing when period changes.
  useEffect(() => {
    if (!brandId) return;
    setBriefing(loadBriefingFromStorage(brandId, period));
    setError(null);
    initRef.current = null;
    metricsReadyRegenRef.current = false;
  }, [brandId, period]);

  // Firestore: sync με server — per brand + period
  useEffect(() => {
    if (!brandId) return;

    (async () => {
      const cached = await getCachedBriefing(brandId, period);
      if (!cached) return;
      const result = briefingResultFromCache(cached);
      setBriefing((prev) => {
        if (!prev) {
          saveBriefingToStorage(brandId, result, period);
          return result;
        }
        const tNew = new Date(result.generatedAt).getTime();
        const tPrev = new Date(prev.generatedAt).getTime();
        if (tNew >= tPrev) {
          saveBriefingToStorage(brandId, result, period);
          return result;
        }
        return prev;
      });
    })();
  }, [brandId, period]);

  // Αποθήκευση τοπικά ανά ημερολογιακή ημέρα + period
  useEffect(() => {
    if (!brandId || !briefing) return;
    saveBriefingToStorage(brandId, briefing, period);
  }, [brandId, briefing, period]);

  // Πρώτη γεννήτρια μόνο αν δεν υπάρχει briefing για σήμερα + period
  const hasSubstantiveData =
    props.products.length > 0 ||
    props.campaigns.length > 0 ||
    Boolean(props.ecommerce?.connectedPlatforms?.length);

  useEffect(() => {
    const cacheKey = `${brandId}:${period}`;
    if (!brandId || !hasAnyData || !hasSubstantiveData || !metricsReady || briefing || initRef.current === cacheKey)
      return;
    initRef.current = cacheKey;

    const timer = setTimeout(() => {
      const p = periodRef.current;
      const pl = periodLabelRef.current;
      (async () => {
        const cached = await getCachedBriefing(brandId, p);
        if (cached) {
          setBriefing(briefingResultFromCache(cached));
          return;
        }
        const local = loadBriefingFromStorage(brandId, p);
        if (local) {
          setBriefing(local);
          return;
        }
        setLoading(true);
        try {
          const result = await generateMorningBriefing(brandId, buildDataRef.current(), { period: p, periodLabel: pl });
          setBriefing(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Η δημιουργία του briefing δεν ολοκληρώθηκε.');
        }
        setLoading(false);
      })();
    }, INIT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [brandId, hasAnyData, hasSubstantiveData, metricsReady, briefing, period]);

  // Αυτόματη αναγέννηση όταν τα metrics σταθεροποιηθούν (metricsReady → true).
  // Πυροδοτεί μία φορά ανά brand/period/metricsReady-transition, αφού σταθεροποιηθούν τα δεδομένα.
  useEffect(() => {
    if (!brandId || !metricsReady) {
      metricsReadyRegenRef.current = false;
      return;
    }
    if (metricsReadyRegenRef.current) return; // ήδη έγινε regen για αυτή τη μετάβαση
    metricsReadyRegenRef.current = true;

    const live = briefingLatestRef.current;
    if (!live) return; // δεν υπάρχει briefing — η αρχική γεννήτρια το χειρίζεται

    let cancelled = false;
    // Μικρή αναμονή για να σταθεροποιηθούν οι τελευταίες αλλαγές στα KPI
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const b = briefingLatestRef.current;
      if (!b) return;
      const d = buildDataRef.current();
      const expected = computeBriefingDataHash(d);
      if (expected === b.dataHash) return; // δεδομένα αμετάβλητα — δεν χρειάζεται αναγέννηση

      void (async () => {
        setLoading(true);
        try {
          const result = await generateMorningBriefing(brandId, d, {
            period: periodRef.current,
            periodLabel: periodLabelRef.current,
            updateReason: 'Αυτόματη ενημέρωση μετά τη φόρτωση δεδομένων',
          });
          if (!cancelled) setBriefing(result);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Η δημιουργία δεν ολοκληρώθηκε.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 500); // σύντομο debounce: το readiness gate έχει ήδη κρατήσει τα κρίσιμα inputs

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [brandId, metricsReady, period]);

  // Έλεγχος σημαντικής αλλαγής (κανόνες) — μόνο όταν το tab είναι ορατό
  useEffect(() => {
    if (!brandId || !hasAnyData || !briefing) return;

    if (checkInterval.current) clearInterval(checkInterval.current);

    checkInterval.current = setInterval(async () => {
      if (document.hidden) return;
      try {
        const { checkAndAutoUpdate } = await import('../../services/morningBriefing');
        const { updated, result } = await checkAndAutoUpdate(
          brandId,
          buildDataRef.current(),
          periodRef.current,
          periodLabelRef.current,
        );
        if (updated && result) setBriefing(result);
      } catch { /* silent */ }
    }, SIGNIFICANCE_CHECK_INTERVAL);

    return () => {
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, [brandId, hasAnyData, briefing]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(`perf-plus-briefing-collapsed:${brandId}`, next ? '1' : '0');
      } catch { /* */ }
      return next;
    });
  }, [brandId]);

  /** Χρησιμοποιείται μόνο σε retry μετά από σφάλμα. */
  const handleRetry = useCallback(async () => {
    if (!brandId || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await generateMorningBriefing(
        brandId,
        buildDataRef.current(),
        { period: periodRef.current, periodLabel: periodLabelRef.current },
      );
      setBriefing(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Η δημιουργία του briefing δεν ολοκληρώθηκε.');
    }
    setLoading(false);
  }, [brandId, loading]);

  /** Φόρτωση πλήρους ιστορικού παραγγελιών — τα KPI ανεβαίνουν αλλά το κείμενο δεν πρέπει να προηγείται. */
  const awaitingEcommMetrics =
    !metricsReady && ((props.ecommerce?.connectedPlatforms?.length ?? 0) > 0);
  const briefingPending = !briefing && !loading && !error;

  const timeLabel = briefing?.generatedAt
    ? new Date(briefing.generatedAt).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const isUpdated = briefing?.urgency === 'updated';

  const borderClass = isUpdated
    ? 'border-amber-300/60'
    : 'border-[var(--nts-accent)]/20';

  const gradientLine = isUpdated
    ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-red-400'
    : 'bg-gradient-to-r from-[var(--nts-accent)] via-[#8B5CF6] to-[#06B6D4]';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className={`relative overflow-hidden rounded-2xl border ${borderClass} bg-gradient-to-br from-white via-white to-[var(--nts-accent)]/5 shadow-sm`}>
        <div className={`absolute top-0 left-0 right-0 h-[3px] ${gradientLine}`} />

        <div className={collapsed ? 'px-4 py-3' : 'p-6'}>
          {/* Header */}
          <div className={`flex items-start justify-between gap-2 ${collapsed ? 'mb-0' : 'mb-4'}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--nts-accent)] to-[#8B5CF6] flex items-center justify-center shadow-sm shrink-0">
                <Sparkles size={18} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[15px] font-semibold text-[var(--nts-charcoal)] flex items-center gap-1">
                    AI Briefing{' '}
                    <Tooltip
                      content="Το briefing της ημέρας αποθηκεύεται τοπικά και παραμένει διαθέσιμο όταν αλλάζετε σελίδα ή κάνετε ανανέωση. Ανανεώνεται μόνο όταν προκύπτει ουσιαστική μεταβολή στα δεδομένα, όπως έσοδα, διαφημιστική απόδοση ή κρίσιμες ειδοποιήσεις. Γίνονται έως 4 ενημερώσεις ημερησίως, με έλεγχο περίπου ανά 15 λεπτά όταν το tab είναι ανοιχτό."
                      size={13}
                    />
                  </h3>
                  {isUpdated && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 animate-pulse">
                      <Zap size={9} /> Ενημερώθηκε
                    </span>
                  )}
                  {loading && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--nts-accent)] animate-pulse" /> Σύνταξη briefing...
                    </span>
                  )}
                  {awaitingEcommMetrics && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 text-slate-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" /> Στοίχιση με KPI…
                    </span>
                  )}
                </div>
                {timeLabel && !awaitingEcommMetrics && (
                  <p className="text-[11px] text-[var(--nts-medium-gray)] flex items-center gap-1 mt-0.5">
                    <Clock size={10} /> {timeLabel}
                    <span className="ml-1 px-1.5 py-0 rounded bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] text-[10px] font-medium">{periodLabel}</span>
                    {briefing?.updateReason && !collapsed && (
                      <span className="ml-1 text-amber-600">· {briefing.updateReason}</span>
                    )}
                  </p>
                )}
                {collapsed && awaitingEcommMetrics && (
                  <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1 line-clamp-2">
                    Συγχρονίζουμε τον τζίρο και τις παραγγελίες από το ηλεκτρονικό κατάστημα με τον πίνακα ελέγχου…
                  </p>
                )}
                {collapsed && briefingPending && !awaitingEcommMetrics && (
                  <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1 line-clamp-1">
                    Το briefing θα εμφανιστεί αυτόματα μόλις είναι διαθέσιμα τα πρώτα αξιόπιστα δεδομένα.
                  </p>
                )}
                {collapsed && !awaitingEcommMetrics && briefing && (
                  <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1 line-clamp-1">
                    {toPlainProseText(briefing.narrative)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="shrink-0 p-2 rounded-lg hover:bg-[#F3F4F6] text-[var(--nts-medium-gray)] transition-colors"
              aria-expanded={!collapsed}
              title={collapsed ? 'Ανάπτυξη' : 'Σύμπτυξη'}
            >
              {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
          </div>

          {/* Content */}
          {!collapsed && awaitingEcommMetrics && (
            <motion.div
              key="await-ecomm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-4 text-[13px] leading-relaxed text-[var(--nts-medium-gray)]"
            >
              <p className="text-[var(--nts-charcoal)]">Αναμονή για ενημέρωση των δεδομένων…</p>
            </motion.div>
          )}
          {!collapsed && !awaitingEcommMetrics && (
          <AnimatePresence mode="wait">
            {loading && !briefing && (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="h-4 bg-[#F3F4F6] rounded-md w-full animate-pulse" />
                <div className="h-4 bg-[#F3F4F6] rounded-md w-[90%] animate-pulse" />
                <div className="h-4 bg-[#F3F4F6] rounded-md w-[75%] animate-pulse" />
                <div className="flex gap-2 mt-4">
                  <div className="h-8 bg-[#F3F4F6] rounded-lg w-1/3 animate-pulse" />
                  <div className="h-8 bg-[#F3F4F6] rounded-lg w-1/3 animate-pulse" />
                  <div className="h-8 bg-[#F3F4F6] rounded-lg w-1/3 animate-pulse" />
                </div>
              </motion.div>
            )}

            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-start justify-between gap-3 p-3 bg-red-50 border border-red-100 rounded-xl"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="shrink-0 flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-900 bg-red-100 hover:bg-red-200 rounded-lg px-2 py-1 transition-colors"
                >
                  Δοκίμασε ξανά
                </button>
              </motion.div>
            )}

            {briefingPending && (
              <motion.div
                key="pending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-4 text-[13px] leading-relaxed text-[var(--nts-medium-gray)]"
              >
                <p className="font-medium text-[var(--nts-charcoal)]">Προετοιμασία briefing…</p>
                <p className="mt-1">
                  Το Dashboard εμφανίζεται άμεσα και το AI Briefing θα δημιουργηθεί αυτόματα μόλις φορτωθούν τα πρώτα αξιόπιστα στοιχεία του brand.
                </p>
              </motion.div>
            )}

            {briefing && (
              <motion.div
                key={briefing.generatedAt}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="mb-4 text-[14px] leading-relaxed text-[var(--nts-charcoal)]">
                  <FormattedProse content={briefing.narrative} variant="compact" className="[&_p]:text-[14px] [&_li]:text-[14px]" />
                </div>

                {briefing.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {briefing.actions.map((action, i) => {
                      const target = guessRoute(action);
                      return (
                        <button
                          key={i}
                          onClick={() =>
                            onSectionChange?.(
                              target.section,
                              target.hashQuery ? { hashQuery: target.hashQuery } : undefined
                            )
                          }
                          className="group flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--nts-charcoal)] bg-white border border-[var(--nts-border-gray)] rounded-lg hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent)] transition-all shadow-sm"
                        >
                          <span className="w-4 h-4 rounded-full bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="line-clamp-1">{action}</span>
                          <ArrowRight size={12} className="text-[var(--nts-medium-gray)] group-hover:text-[var(--nts-accent)] transition-colors flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </div>
      </div>
    </motion.div>
  );
}
