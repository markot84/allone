import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronDown, ChevronUp,
  Target, Users, BarChart3, FileDown, Link2,
  Sparkles, Share2, Loader2
} from 'lucide-react';
import { scenarios } from '../../data';
import { useToast } from '../common/Toast';
import { useAuth } from '../../hooks';
import { openPackagePdf } from '../../services/strategyPackagePdf';
import { saveSharedPackage, type SharedPackageData } from '../../services/strategyPackageShare';
import type { ChannelRecommendation } from '../../types';
import type { ScoredSegment } from '../../utils/segmentRelevance';
import { logger } from '../../utils/logger';

interface StrategyPackageProps {
  scenarioId: string | null;
  weights: Record<string, number>;
  duration: number | 'ongoing';
  brandName?: string;
  rankedSegments: ScoredSegment[];
  channelRecommendation: ChannelRecommendation | null;
  aiRationale?: string;
  mixConfig?: { scenarioA: string; scenarioB: string; percentA: number; percentB: number } | null;
}

function buildSharedData(props: StrategyPackageProps, strategyName: string): SharedPackageData {
  const { weights, duration, brandName, rankedSegments, channelRecommendation } = props;
  return {
    brandName,
    strategyName,
    duration: duration === 'ongoing' ? 'Συνεχής' : `${duration} ημέρες`,
    weights,
    idealSegments: rankedSegments.filter(rs => rs.fit === 'ideal').map(rs => rs.segment.name),
    goodSegments: rankedSegments.filter(rs => rs.fit === 'good').map(rs => rs.segment.name),
    primaryChannels: channelRecommendation?.primary ?? [],
    secondaryChannels: channelRecommendation?.secondary ?? [],
    budgetAllocation: channelRecommendation?.budget_allocation ?? {},
    rationale: channelRecommendation?.rationale,
  };
}

export function StrategyPackage(props: StrategyPackageProps) {
  const {
    scenarioId, duration,
    rankedSegments, channelRecommendation, mixConfig
  } = props;

  const [expanded, setExpanded] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const toast = useToast();
  const { user } = useAuth();

  const scenario = scenarios.find(s => s.id === scenarioId);
  const strategyName = useMemo(() => {
    if (mixConfig) {
      const a = scenarios.find(s => s.id === mixConfig.scenarioA)?.name ?? mixConfig.scenarioA;
      const b = scenarios.find(s => s.id === mixConfig.scenarioB)?.name ?? mixConfig.scenarioB;
      return `Μικτή: ${a} ${mixConfig.percentA}% / ${b} ${mixConfig.percentB}%`;
    }
    return scenario?.name ?? 'Custom';
  }, [scenarioId, mixConfig, scenario]);

  const durText = duration === 'ongoing' ? 'Συνεχής' : `${duration} ημέρες`;

  const idealSegs = useMemo(() =>
    rankedSegments.filter(rs => rs.fit === 'ideal').map(rs => rs.segment.name),
    [rankedSegments]
  );

  const primaryCh = Array.isArray(channelRecommendation?.primary) ? channelRecommendation.primary : [];
  const secondaryCh = Array.isArray(channelRecommendation?.secondary) ? channelRecommendation.secondary : [];

  const handlePdf = useCallback(() => {
    const data = buildSharedData(props, strategyName);
    openPackagePdf(data);
  }, [props, strategyName]);

  const handleShareLink = useCallback(async () => {
    setLinkLoading(true);
    try {
      const data = buildSharedData(props, strategyName);
      const id = await saveSharedPackage(data, user?.uid);
      const baseUrl = window.location.origin + window.location.pathname;
      const link = `${baseUrl}#shared/${id}`;
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      toast.success('Link αντιγράφηκε');
      setTimeout(() => setLinkCopied(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logger.error('[StrategyPackage] saveSharedPackage failed', { err });
      toast.error(`Αποτυχία δημιουργίας link — ${msg}`);
    } finally {
      setLinkLoading(false);
    }
  }, [props, strategyName, user, toast]);

  if (!scenarioId) return null;

  return (
    <div className="rounded-xl border border-[#E5E5E5] bg-white overflow-hidden">
      {/* Compact header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0">
            <Share2 size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#1A1A1A] truncate">{strategyName}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F5F5F5] text-[#4A4A4A] flex-shrink-0">
                {durText}
              </span>
            </div>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">
              {idealSegs.length > 0 && `${idealSegs.join(', ')}`}
              {channelRecommendation && ` · ${primaryCh.length + secondaryCh.length} κανάλια`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handlePdf}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#4A4A4A] hover:bg-[#F5F5F5] transition-colors"
            title="Λήψη ως PDF"
          >
            <FileDown size={13} />
            <span className="hidden sm:inline">PDF</span>
          </button>
          <button
            onClick={handleShareLink}
            disabled={linkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1A1A1A] text-white hover:bg-[#333] transition-colors disabled:opacity-50"
            title="Δημιουργία & αντιγραφή link"
          >
            {linkLoading ? <Loader2 size={13} className="animate-spin" /> : linkCopied ? <Check size={13} /> : <Link2 size={13} />}
            <span className="hidden sm:inline">{linkCopied ? 'Αντιγράφηκε' : 'Link'}</span>
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#4A4A4A] hover:bg-[#F5F5F5] transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expandable preview */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-[#F5F5F5]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div className="p-3 rounded-lg bg-[#FAFAFA]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Target size={12} className="text-[var(--nts-accent-text)]" />
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Στρατηγική</span>
                  </div>
                  <p className="text-sm font-medium text-[#1A1A1A]">{strategyName}</p>
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">{durText}</p>
                </div>

                <div className="p-3 rounded-lg bg-[#FAFAFA]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Users size={12} className="text-[#8B5CF6]" />
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Τμήματα πελατών</span>
                  </div>
                  {idealSegs.length > 0 && (
                    <p className="text-sm text-[#1A1A1A]">{idealSegs.join(', ')}</p>
                  )}
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                    {rankedSegments.filter(rs => rs.fit === 'good').length} ακόμη κατάλληλα
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-[#FAFAFA]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BarChart3 size={12} className="text-[#22C55E]" />
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Κανάλια</span>
                  </div>
                  {channelRecommendation && (
                    <>
                      <p className="text-sm text-[#1A1A1A]">
                        {primaryCh.slice(0, 2).join(', ')}
                        {primaryCh.length > 2 && ` +${primaryCh.length - 2}`}
                      </p>
                      <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                        +{secondaryCh.length} δευτερεύοντα
                      </p>
                    </>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-[#FAFAFA]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={12} className="text-[#1A1A1A]" />
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">AI ανάλυση</span>
                  </div>
                  <p className="text-sm text-[#1A1A1A]">
                    {channelRecommendation?.rationale ? 'Ολοκληρώθηκε' : 'Δεν είναι διαθέσιμη'}
                  </p>
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                    {channelRecommendation?.rationale ? 'Περιλαμβάνεται στο package' : 'Ενεργοποίησε AI'}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
