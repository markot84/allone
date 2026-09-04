import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Sparkles, ArrowRight, AlertTriangle, CalendarClock, Clock, Minus, TrendingDown, TrendingUp, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, FormattedProse, toPlainProseText } from '../common';
import type { BriefingInventory, BriefingResult, BriefingYearOverYear } from '../../services/morningBriefing';
import {
  BRIEFING_CACHE_VERSION,
  briefingHeadlineRevenue,
  collectBriefingData,
  generateMorningBriefing,
  getCachedBriefing,
  getLocalDateKey,
  briefingResultFromCache,
  computeBriefingDataHash,
} from '../../services/morningBriefing';
import { calculateCampaignMetrics } from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';
import type { Campaign, RFMSegment, AutomationAlert } from '../../types';
import { guessRoute } from './guessRoute';

interface MorningBriefingProps {
  brandId: string;
  brandName: string;
  /** Stock figures from Product Intelligence — never recounted here. Null ⇒ no stock section. */
  inventory?: BriefingInventory | null;
  campaigns: Campaign[];
  /** False while the campaign query is in flight — keeps the briefing from reading an empty
   * list as "no advertising ran". */
  campaignsLoaded?: boolean;
  segments: RFMSegment[];
  totalOrganicRevenue: number;
  ga4: {
    totals: { sessions: number; users: number; newUsers: number; bounceRate: number; conversions: number };
    weeklyChange: { sessions: number | null; users: number | null; conversions: number | null } | null;
    hasData: boolean;
  };
  alerts: AutomationAlert[];
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
  /** Same window one year back (see `computeBriefingYearOverYear`). Feeds the prompt and the
   * deterministic comparison strip under the narrative. */
  yearOverYear?: BriefingYearOverYear;
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
  hasAnyData: boolean;
  /** Selected dashboard period key (e.g. 'current_month'). Scopes cache & prompt. */
  period?: string;
  /** Human-readable label for the period (e.g. 'Last 30 days'). */
  periodLabel?: string;
  /** True once dashboard KPIs have settled (e-shop items from summary → raw history);
   * avoids an AI briefing reporting zero revenue while orders are still loading. */
  metricsReady?: boolean;
  /** Fingerprint of the values feeding the briefing — when it changes, dataHash is checked and regeneration happens if needed. */
  financeKey?: string;
}

const SIGNIFICANCE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
/** Small delay after stable KPIs; the heavy work waits on `metricsReady`. */
const INIT_DELAY_MS = 150;

const BRIEFING_STORAGE_PREFIX = `perf-plus-ai-briefing-v${BRIEFING_CACHE_VERSION}:`;

function briefingStorageKey(brandId: string, period = 'current_month') {
  return `${BRIEFING_STORAGE_PREFIX}${brandId}:${getLocalDateKey()}:${period}`;
}

/** Drop briefings written under an older prompt so they cannot be re-read after a version bump. */
function dropStaleBriefingStorage() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('perf-plus-ai-briefing-v') && !key.startsWith(BRIEFING_STORAGE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* private mode / quota — nothing to clean up then. */
  }
}

if (typeof window !== 'undefined') dropStaleBriefingStorage();

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

type YoyValueFormat = 'currency' | 'number' | 'ratio';

interface YoyRow {
  key: string;
  label: string;
  current: number;
  previous: number;
  format: YoyValueFormat;
  /** Ad spend is not "better" when it rises — it stays neutral instead of green/red. */
  directional: boolean;
  /** False when the current side was never measured for this window (no GA4 days, no campaigns).
   * Such a row is dropped: "-100% vs last year" would read as a collapse, not a data gap. */
  measured: boolean;
}

function formatYoyValue(value: number, format: YoyValueFormat): string {
  if (format === 'currency') return formatCurrencyCompact(value);
  if (format === 'ratio') return `${formatNumber(value, 1)}x`;
  return formatNumber(value);
}

/** Percent change against last year, or null when there is no base to divide by. */
function yoyChangePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function YoyComparisonStrip({ label, rows }: { label: string; rows: YoyRow[] }) {
  return (
    <div className="mb-4 rounded-xl border border-[var(--nts-border-gray)] bg-[var(--nts-bg-subtle)] px-3 py-2.5">
      <p className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--nts-medium-gray)]">
        <CalendarClock size={12} className="shrink-0" />
        Σύγκριση με πέρσι
        <span className="font-normal normal-case tracking-normal">· {label}</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => {
          const pct = yoyChangePct(row.current, row.previous);
          const flat = pct !== null && Math.abs(pct) < 0.05;
          const up = pct !== null && !flat && pct > 0;
          const down = pct !== null && !flat && pct < 0;
          const DeltaIcon = up ? TrendingUp : down ? TrendingDown : Minus;
          const deltaColor = !row.directional || pct === null || flat
            ? 'text-[var(--nts-medium-gray)]'
            : up
              ? 'text-[var(--success)]'
              : 'text-[var(--danger)]';
          return (
            <div key={row.key} className="min-w-0">
              <dt className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--nts-medium-gray)]">
                {row.label}
              </dt>
              <dd className="mt-0.5 text-[13px] font-semibold leading-tight text-[var(--nts-charcoal)]">
                {formatYoyValue(row.current, row.format)}
              </dd>
              <dd className={`mt-0.5 flex items-center gap-1 text-[11px] leading-tight ${deltaColor}`}>
                <DeltaIcon size={11} className="shrink-0" />
                <span className="font-medium">
                  {pct === null
                    ? 'χωρίς περσινή βάση'
                    : `${pct > 0 ? '+' : ''}${formatNumber(pct, 1)}%`}
                </span>
                <span className="truncate text-[var(--nts-medium-gray)]">
                  πέρσι {formatYoyValue(row.previous, row.format)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function MorningBriefing(props: MorningBriefingProps) {
  const { brandId, brandName, hasAnyData, onSectionChange } = props;
  const period = props.period ?? 'current_month';
  const periodLabel = props.periodLabel ?? 'Τρέχων Μήνας';
  const metricsReady = props.metricsReady ?? true;
  // financeKey prop kept for backward compat but no longer used internally
  void props.financeKey;

  const [briefing, setBriefing] = useState<BriefingResult | null>(() =>
    brandId ? loadBriefingFromStorage(brandId, period) : null
  );
  const [collapsed, setCollapsed] = useState(() => (brandId ? loadCollapsedPref(brandId) : false));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ref: tracks whether auto-regen already ran for this metricsReady→true transition. */
  const metricsReadyRegenRef = useRef(false);
  const initRef = useRef<string | null>(null);
  const checkInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const briefingLatestRef = useRef<BriefingResult | null>(null);
  briefingLatestRef.current = briefing;

  const buildData = useCallback(() => collectBriefingData({
    campaigns: props.campaigns,
    campaignsLoaded: props.campaignsLoaded,
    segments: props.segments,
    totalOrganicRevenue: props.totalOrganicRevenue,
    ga4: props.ga4,
    alerts: props.alerts,
    brandName,
    inventory: props.inventory,
    yearOverYear: props.yearOverYear,
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
  }), [props.campaigns, props.campaignsLoaded, props.segments, props.totalOrganicRevenue, props.ga4, props.alerts, brandName, props.inventory, props.ecommerce, props.yearOverYear]);

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

  // Firestore: sync with server — per brand + period
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

  // Persist locally per calendar day + period
  useEffect(() => {
    if (!brandId || !briefing) return;
    saveBriefingToStorage(brandId, briefing, period);
  }, [brandId, briefing, period]);

  // First generation only if no briefing exists for today + period
  const hasSubstantiveData =
    (props.inventory?.totalProducts ?? 0) > 0 ||
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

  // Auto-regenerate once metrics settle (metricsReady → true); once per brand/period/transition.
  useEffect(() => {
    if (!brandId || !metricsReady) {
      metricsReadyRegenRef.current = false;
      return;
    }
    if (metricsReadyRegenRef.current) return; // regen already done for this transition
    metricsReadyRegenRef.current = true;

    const live = briefingLatestRef.current;
    if (!live) return; // no briefing — the initial generation handles it

    let cancelled = false;
    // Brief wait to let the latest KPI changes settle
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const b = briefingLatestRef.current;
      if (!b) return;
      const d = buildDataRef.current();
      const expected = computeBriefingDataHash(d);
      if (expected === b.dataHash) return; // data unchanged — no regeneration needed

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
    }, 500); // short debounce: the readiness gate already held the critical inputs

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [brandId, metricsReady, period]);

  // Significant-change check (rules) — only while the tab is visible
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

  /** Used only on retry after an error. */
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

  /** The narrative is cached; the figures under it are live. When the data has moved since the
   * text was written, the two can contradict each other — a briefing generated while campaigns
   * were still empty announced "απουσία δεδομένων από τις διαφημιστικές καμπάνιες" above a strip
   * showing €9K of spend. Cheap to compute: collectBriefingData no longer walks the catalogue. */
  const narrativeStale = useMemo(() => {
    if (!briefing) return false;
    try {
      return computeBriefingDataHash(buildData()) !== briefing.dataHash;
    } catch {
      return false;
    }
  }, [briefing, buildData]);

  /** Deterministic YoY block: the model is told NOT to narrate the comparison, we render it. */
  const yoyComparison = useMemo(() => {
    const yoy = props.yearOverYear;
    if (!yoy?.hasPreviousData) return null;

    const metrics = calculateCampaignMetrics(props.campaigns);
    const storeRevenue = props.ecommerce?.totalRevenue ?? 0;
    const current = {
      revenue: briefingHeadlineRevenue({
        ecommerceSourceActive: Boolean(props.ecommerce?.hasData),
        storeRevenue,
        organicRevenue: props.totalOrganicRevenue,
        campaignRevenue: metrics.totalRevenue,
      }),
      orders: props.ecommerce?.orderCount ?? 0,
      spend: metrics.totalSpend,
      // True ROAS: e-shop turnover ÷ ad spend — same measure as the previous-year side.
      trueRoas: metrics.totalSpend > 0 ? storeRevenue / metrics.totalSpend : 0,
      sessions: props.ga4.totals.sessions,
    };

    // No campaigns overlap this window ⇒ ad cost was not measured, it is not "zero spend".
    const adsMeasured = props.campaigns.length > 0;
    const trafficMeasured = props.ga4.hasData;

    const allRows: YoyRow[] = [
      { key: 'revenue', label: 'Έσοδα', current: current.revenue, previous: yoy.previous.revenue, format: 'currency', directional: true, measured: true },
      { key: 'orders', label: 'Παραγγελίες', current: current.orders, previous: yoy.previous.orders, format: 'number', directional: true, measured: true },
      { key: 'spend', label: 'Διαφ. δαπάνη', current: current.spend, previous: yoy.previous.spend, format: 'currency', directional: false, measured: adsMeasured },
      // Labelled ROAS at the user's request. The field keeps the name `trueRoas` because
      // `revenue.roas` already exists and means the platforms' attributed ratio — one label,
      // two distinct values, so the code has to stay able to tell them apart.
      { key: 'trueRoas', label: 'ROAS', current: current.trueRoas, previous: yoy.previous.trueRoas, format: 'ratio', directional: true, measured: adsMeasured },
      { key: 'sessions', label: 'Επισκέψεις', current: current.sessions, previous: yoy.previous.sessions, format: 'number', directional: true, measured: trafficMeasured },
    ];
    const rows = allRows.filter((row) => row.measured && (row.current > 0 || row.previous > 0));

    return rows.length > 0 ? { label: yoy.previousPeriodLabel, rows } : null;
  }, [props.yearOverYear, props.campaigns, props.ecommerce, props.totalOrganicRevenue, props.ga4.hasData, props.ga4.totals.sessions]);

  /** Loading the full order history — KPIs climb but the text must not run ahead. */
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
                {narrativeStale && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Τα δεδομένα άλλαξαν αφότου γράφτηκε αυτό το κείμενο — τα νούμερα παρακάτω είναι τα τρέχοντα.
                      Το briefing ξαναγράφεται.
                    </span>
                  </div>
                )}
                <div
                  className={`mb-4 text-[14px] leading-relaxed text-[var(--nts-charcoal)] ${narrativeStale ? 'opacity-60' : ''}`}
                >
                  <FormattedProse content={briefing.narrative} variant="compact" className="[&_p]:text-[14px] [&_li]:text-[14px]" />
                </div>

                {yoyComparison && (
                  <YoyComparisonStrip label={yoyComparison.label} rows={yoyComparison.rows} />
                )}

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
