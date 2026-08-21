import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Sparkles, ArrowRight, AlertTriangle, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, toPlainProseText } from '../common';
import { BriefingNarrative } from './BriefingNarrative';
import type { BriefingResult } from '../../services/morningBriefing';
import {
  MAX_DAILY_GENERATIONS,
  collectBriefingData,
  generateMorningBriefing,
  getCachedBriefing,
  getLocalDateKey,
  briefingResultFromCache,
  computeBriefingDataHash,
} from '../../services/morningBriefing';
import type { Product, Campaign, RFMSegment, AutomationAlert } from '../../types';
import { isSectionHidden } from '../../config/modules';

const MONO = "'JetBrains Mono', monospace";

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
  /** Human-readable label for the period (e.g. 'Last 30 days'). */
  periodLabel?: string;
  /** True once dashboard KPIs have settled (e-shop items from summary → raw history);
   * avoids an AI briefing reporting zero revenue while orders are still loading. */
  metricsReady?: boolean;
  /** Fingerprint of the values feeding the briefing — when it changes, dataHash is checked and regeneration happens if needed. */
  financeKey?: string;
}

/** Real app sections — not `inventory` (no such route). */
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
    // A keyword pointing at a section switched off for this build falls through to the next
    // match (and ultimately to the dashboard) instead of producing a dead action.
    if (lower.includes(keyword) && !isSectionHidden(route.section)) return route;
  }
  return { section: 'dashboard' };
}

const SIGNIFICANCE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
/** Small delay after stable KPIs; the heavy work waits on `metricsReady`. */
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

/**
 * The staggered reveal is for the first read of the day, not for every return to the dashboard.
 * The flag is written the moment it is claimed, so a second mount in the same session (tab switch,
 * period change) already reads it as spent.
 */
function claimFirstReadOfDay(brandId: string): boolean {
  if (!brandId) return false;
  const key = `perf-plus-briefing-read:${brandId}:${getLocalDateKey()}`;
  try {
    if (localStorage.getItem(key) === '1') return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    // No storage means no way to remember — treat it as already read rather than animating forever.
    return false;
  }
}

/** Collapsed is the default: expanded, the card runs the full height of the dashboard hero row
 *  before anyone has asked to read it. Only an explicit expand (stored as '0') opens it. */
function loadCollapsedPref(brandId: string): boolean {
  try {
    return localStorage.getItem(`perf-plus-briefing-collapsed:${brandId}`) !== '0';
  } catch {
    return true;
  }
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
  const [collapsed, setCollapsed] = useState(() => (brandId ? loadCollapsedPref(brandId) : true));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ref: tracks whether auto-regen already ran for this metricsReady→true transition. */
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

  /** Same collection the prompt is built from — the tokenizer matches the narrative against it, so
   *  it has to be the identical data, not a re-derivation. */
  const briefingData = useMemo(() => (hasAnyData ? buildData() : null), [buildData, hasAnyData]);
  const [firstReadOfDay] = useState(() => claimFirstReadOfDay(brandId));

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

  /** Loading the full order history — KPIs climb but the text must not run ahead. */
  const awaitingEcommMetrics =
    !metricsReady && ((props.ecommerce?.connectedPlatforms?.length ?? 0) > 0);
  const briefingPending = !briefing && !loading && !error;

  const isUpdated = briefing?.urgency === 'updated';

  /** How many of the day's regenerations have been spent. Lives on the cached doc, so it is read
   *  rather than derived — the cap is shared with the auto-update check in the service. */
  const [genCount, setGenCount] = useState<number | null>(null);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getCachedBriefing(brandId, period)
      .then((cached) => {
        if (!cancelled) setGenCount(cached?._genCount ?? null);
      })
      .catch(() => {
        if (!cancelled) setGenCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, period, briefing?.generatedAt]);

  /** "17.08 · 2 από 4 ενημερώσεις" — the day it speaks for, then how much of the budget is used. */
  const metaLabel = useMemo(() => {
    const parts: string[] = [];
    if (briefing?.generatedAt) {
      const at = new Date(briefing.generatedAt);
      parts.push(
        `${String(at.getDate()).padStart(2, '0')}.${String(at.getMonth() + 1).padStart(2, '0')}`
      );
      parts.push(at.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }));
    }
    if (genCount !== null) parts.push(`${genCount} από ${MAX_DAILY_GENERATIONS} ενημερώσεις`);
    else if (parts.length === 0) parts.push(periodLabel);
    return parts.join(' · ');
  }, [briefing?.generatedAt, genCount, periodLabel]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--navy-100)',
        borderRadius: 16,
        // The orange edge is the card's signature: it is the only briefing on the board, and the
        // one card that speaks rather than measures.
        borderLeft: `4px solid ${isUpdated ? 'var(--gold-500)' : 'var(--orange-500)'}`,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: 'var(--elev-card, 0 4px 8px -2px rgba(16,24,40,0.08))',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 22,
            height: 22,
            flex: 'none',
            borderRadius: 6,
            background: 'var(--orange-500)',
            color: 'var(--surface-0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sparkles size={13} />
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-heading)' }}>
          Morning Briefing
        </span>
        <Tooltip
          content="Το briefing της ημέρας αποθηκεύεται τοπικά και παραμένει διαθέσιμο όταν αλλάζετε σελίδα ή κάνετε ανανέωση. Ανανεώνεται μόνο όταν προκύπτει ουσιαστική μεταβολή στα δεδομένα, όπως έσοδα, διαφημιστική απόδοση ή κρίσιμες ειδοποιήσεις. Γίνονται έως 4 ενημερώσεις ημερησίως, με έλεγχο περίπου ανά 15 λεπτά όταν το tab είναι ανοιχτό."
          size={12}
        />
        {isUpdated && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '3px 7px',
              borderRadius: 999,
              background: 'var(--gold-100)',
              color: 'var(--gold-700)',
            }}
          >
            <Zap size={9} /> Ενημερώθηκε
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)' }}>
          {metaLabel}
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Ανάπτυξη' : 'Σύμπτυξη'}
          className="briefing-collapse"
          style={{
            flex: 'none',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>

      {collapsed ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {briefing
            ? toPlainProseText(briefing.narrative)
            : awaitingEcommMetrics
              ? 'Συγχρονίζουμε τον τζίρο και τις παραγγελίες από το ηλεκτρονικό κατάστημα με τον πίνακα ελέγχου…'
              : 'Το briefing θα εμφανιστεί αυτόματα μόλις είναι διαθέσιμα τα πρώτα αξιόπιστα δεδομένα.'}
        </p>
      ) : awaitingEcommMetrics ? (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          Αναμονή για ενημέρωση των δεδομένων…
        </p>
      ) : (
        <AnimatePresence mode="wait">
          {loading && !briefing && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {/* Fixed heights — the card must not resize under the grid when the text lands. */}
              <div className="animate-pulse" style={{ height: 14, borderRadius: 6, background: 'var(--surface-2)' }} />
              <div className="animate-pulse" style={{ height: 14, width: '92%', borderRadius: 6, background: 'var(--surface-2)' }} />
              <div className="animate-pulse" style={{ height: 14, width: '76%', borderRadius: 6, background: 'var(--surface-2)' }} />
              <div className="animate-pulse" style={{ height: 38, borderRadius: 8, background: 'var(--surface-2)', marginTop: 4 }} />
            </motion.div>
          )}

          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--danger-light)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                <AlertTriangle size={15} style={{ color: 'var(--danger-600)', flex: 'none', marginTop: 2 }} />
                <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
              </span>
              <button
                type="button"
                onClick={handleRetry}
                style={{
                  flex: 'none',
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--danger-600)',
                  background: 'var(--surface-0)',
                  border: '1px solid var(--danger-600)',
                  borderRadius: 999,
                  padding: '6px 11px',
                  cursor: 'pointer',
                }}
              >
                Δοκίμασε ξανά
              </button>
            </motion.div>
          )}

          {briefingPending && (
            <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Προετοιμασία briefing…</strong>{' '}
                Το Dashboard εμφανίζεται άμεσα και το AI Briefing θα δημιουργηθεί αυτόματα μόλις φορτωθούν τα πρώτα
                αξιόπιστα στοιχεία του brand.
              </p>
            </motion.div>
          )}

          {briefing && (
            <motion.div
              key={briefing.generatedAt}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}
            >
              <BriefingNarrative
                narrative={toPlainProseText(briefing.narrative)}
                data={briefingData}
                segments={props.segments}
                campaigns={props.campaigns}
                platforms={props.ecommerce?.connectedPlatforms}
                onNavigate={onSectionChange}
                animate={firstReadOfDay}
              />

              {briefing.actions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {briefing.actions.map((action, i) => {
                    const target = guessRoute(action);
                    // The lead action is tinted; the rest are neutral. One emphasis per card.
                    const lead = i === 0;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          onSectionChange?.(
                            target.section,
                            target.hashQuery ? { hashQuery: target.hashQuery } : undefined
                          )
                        }
                        className="briefing-action"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          textAlign: 'left',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 600,
                          background: lead ? 'var(--orange-50)' : 'var(--surface-2)',
                          color: lead ? 'var(--orange-700)' : 'var(--text-heading)',
                          padding: '10px 12px',
                          borderRadius: 8,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: MONO,
                            fontSize: 11,
                            flex: 'none',
                            color: lead ? 'var(--orange-700)' : 'var(--text-muted)',
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {action}
                        </span>
                        <ArrowRight size={13} style={{ marginLeft: 'auto', flex: 'none' }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
}
