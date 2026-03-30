import { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, AlertTriangle, Clock, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '../common';
import type { BriefingResult } from '../../services/morningBriefing';
import { collectBriefingData, generateMorningBriefing, getCachedBriefing, checkAndAutoUpdate } from '../../services/morningBriefing';
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
  onSectionChange?: (section: string) => void;
  hasAnyData: boolean;
}

const ACTION_ROUTES: Record<string, string> = {
  'campaign': 'campaigns',
  'καμπάνι': 'campaigns',
  'stock': 'inventory',
  'απόθεμα': 'inventory',
  'dead': 'inventory',
  'segment': 'rfm',
  'at risk': 'rfm',
  'champions': 'rfm',
  'rfm': 'rfm',
  'content': 'calendar',
  'strategy': 'strategy',
  'budget': 'channels',
  'roas': 'roi',
  'roi': 'roi',
};

function guessRoute(action: string): string {
  const lower = action.toLowerCase();
  for (const [keyword, route] of Object.entries(ACTION_ROUTES)) {
    if (lower.includes(keyword)) return route;
  }
  return 'dashboard';
}

const SIGNIFICANCE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const INIT_DELAY_MS = 3_000; // defer init so KPIs paint first

export function MorningBriefing(props: MorningBriefingProps) {
  const { brandId, brandName, hasAnyData, onSectionChange } = props;
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef<string | null>(null);
  const checkInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildData = useCallback(() => collectBriefingData({
    products: props.products,
    campaigns: props.campaigns,
    segments: props.segments,
    totalOrganicRevenue: props.totalOrganicRevenue,
    ga4: props.ga4,
    alerts: props.alerts,
    brandName,
    supplierTodMap: props.supplierTodMap,
  }), [props.products, props.campaigns, props.segments, props.totalOrganicRevenue, props.ga4, props.alerts, brandName, props.supplierTodMap]);

  const buildDataRef = useRef(buildData);
  buildDataRef.current = buildData;

  const cacheLoadedRef = useRef<string | null>(null);

  // Step 1: Load cached briefing immediately (fast — single Firestore read)
  useEffect(() => {
    if (!brandId || cacheLoadedRef.current === brandId) return;
    cacheLoadedRef.current = brandId;
    initRef.current = null;

    (async () => {
      const cached = await getCachedBriefing(brandId);
      if (cached) setBriefing(cached);
    })();
  }, [brandId]);

  // Step 2: Generate only if no cache AND data is substantively loaded
  const hasSubstantiveData = props.products.length > 0 || props.campaigns.length > 0;

  useEffect(() => {
    if (!brandId || !hasAnyData || !hasSubstantiveData || briefing || initRef.current === brandId) return;
    initRef.current = brandId;

    const timer = setTimeout(() => {
      (async () => {
        const cached = await getCachedBriefing(brandId);
        if (cached) {
          setBriefing(cached);
          return;
        }
        setLoading(true);
        try {
          const result = await generateMorningBriefing(brandId, buildDataRef.current());
          setBriefing(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Briefing generation failed');
        }
        setLoading(false);
      })();
    }, INIT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [brandId, hasAnyData, hasSubstantiveData, briefing]);

  // Periodic significance check
  useEffect(() => {
    if (!brandId || !hasAnyData || !briefing) return;

    if (checkInterval.current) clearInterval(checkInterval.current);

    checkInterval.current = setInterval(async () => {
      try {
        const { updated, result } = await checkAndAutoUpdate(brandId, buildData());
        if (updated && result) setBriefing(result);
      } catch { /* silent */ }
    }, SIGNIFICANCE_CHECK_INTERVAL);

    return () => {
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, [brandId, hasAnyData, briefing, buildData]);

  if (!hasAnyData) return null;

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

        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--nts-accent)] to-[#8B5CF6] flex items-center justify-center shadow-sm">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-[var(--nts-charcoal)] flex items-center gap-1">AI Briefing <Tooltip content="Αυτόματη ενημέρωση AI μία φορά την ημέρα κατά την πρώτη σας είσοδο. Ενημερώνεται αυτόματα αν εντοπιστεί σημαντική αλλαγή (π.χ. μεγάλη μεταβολή εσόδων, πτώση ROAS, νέο critical alert). Μέγιστο 4 ενημερώσεις ανά ημέρα." size={13} /></h3>
                  {isUpdated && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 animate-pulse">
                      <Zap size={9} /> Ενημερώθηκε
                    </span>
                  )}
                  {loading && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--nts-accent)] animate-pulse" /> Generating...
                    </span>
                  )}
                </div>
                {timeLabel && (
                  <p className="text-[11px] text-[var(--nts-medium-gray)] flex items-center gap-1">
                    <Clock size={10} /> {timeLabel}
                    {briefing?.updateReason && (
                      <span className="ml-1 text-amber-600">— {briefing.updateReason}</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
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
                className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl"
              >
                <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </motion.div>
            )}

            {briefing && (
              <motion.div
                key={briefing.generatedAt}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-[14px] leading-relaxed text-[var(--nts-charcoal)] mb-4">
                  {briefing.narrative}
                </p>

                {briefing.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {briefing.actions.map((action, i) => {
                      const route = guessRoute(action);
                      return (
                        <button
                          key={i}
                          onClick={() => onSectionChange?.(route)}
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
        </div>
      </div>
    </motion.div>
  );
}
