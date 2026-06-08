/**
 * GrowthPlayPanel — Εμφανίζεται στο Channel Activation όταν ο χρήστης έρθει
 * από AI insight με play context (cross_sell, upsell, winback).
 *
 * Αξιοποιεί το marketingBrief (AI-generated, ήδη αποθηκευμένο στο channelPlaybook)
 * + category_affinity από RFM segments για να παράγει ολοκληρωμένες προτάσεις.
 */

import { useState, useMemo } from 'react';
import {
  ChevronDown, ChevronUp, Download, Target, ShoppingBag,
  TrendingUp, Megaphone, BarChart3, X,
} from 'lucide-react';
import type { RFMSegment, ChannelRecommendation } from '../../types';

export type PlayContext = 'cross_sell' | 'upsell' | 'winback' | null;

interface RecommendedSegmentFull {
  name: string;
  fit: 'ideal' | 'good';
  rationale: string;
  color: string;
  count: number;
  revenueShare: number;
}

interface GrowthPlayPanelProps {
  play: PlayContext;
  onDismiss: () => void;
  recommendedSegments: RecommendedSegmentFull[];
  rfmSegments: RFMSegment[];
  channelRecommendation: ChannelRecommendation | null;
  strategyName?: string | null;
  brandName?: string;
}

const PLAY_CONFIG: Record<
  NonNullable<PlayContext>,
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  cross_sell: {
    label: 'Cross-Sell Growth Play',
    icon: <ShoppingBag size={16} />,
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  upsell: {
    label: 'Upsell & Retention Play',
    icon: <TrendingUp size={16} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  winback: {
    label: 'Win-Back Campaign Play',
    icon: <Target size={16} />,
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
};

export function GrowthPlayPanel({
  play,
  onDismiss,
  recommendedSegments,
  rfmSegments,
  channelRecommendation,
  strategyName,
  brandName,
}: GrowthPlayPanelProps) {
  const [expandedSegment, setExpandedSegment] = useState<string | null>(
    recommendedSegments[0]?.name ?? null
  );

  const config = play ? PLAY_CONFIG[play] : null;
  if (!config || !play) return null;

  return (
    <div className={`rounded-2xl border ${config.border} ${config.bg} p-4 mb-6 shadow-sm`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${config.bg} ${config.color} border ${config.border}`}>
            {config.icon}
          </div>
          <div>
            <div className={`text-sm font-semibold ${config.color}`}>{config.label}</div>
            {strategyName && (
              <div className="text-[11px] text-[#6B7280] mt-0.5">
                Στρατηγική: <span className="font-medium">{strategyName}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            play={play}
            recommendedSegments={recommendedSegments}
            rfmSegments={rfmSegments}
            channelRecommendation={channelRecommendation}
            brandName={brandName}
          />
          <button
            onClick={onDismiss}
            className="p-1 rounded-lg hover:bg-white/60 transition-colors text-[#9CA3AF] hover:text-[#6B7280]"
            title="Κλείσιμο"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Context description */}
      <PlayDescription play={play} segments={recommendedSegments} />

      {/* Segment cards */}
      <div className="mt-4 space-y-3">
        {recommendedSegments.map((seg) => (
          <SegmentProposalCard
            key={seg.name}
            play={play}
            segment={seg}
            rfmSegment={rfmSegments.find((s) => s.name === seg.name)}
            channelRecommendation={channelRecommendation}
            isExpanded={expandedSegment === seg.name}
            onToggle={() =>
              setExpandedSegment((prev) => (prev === seg.name ? null : seg.name))
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── Play description ────────────────────────────────────────────────────────

function PlayDescription({
  play,
  segments,
}: {
  play: NonNullable<PlayContext>;
  segments: RecommendedSegmentFull[];
}) {
  const topSeg = segments[0];
  const segNames = segments.map((s) => s.name).join(', ');

  if (play === 'cross_sell') {
    return (
      <p className="text-xs text-[#4A4A4A] leading-relaxed">
        Ανάλυση cross-sell ευκαιριών για{' '}
        <strong>{segments.length} segments</strong> ({segNames}). Κάθε πρόταση
        περιλαμβάνει τις κατηγορίες προϊόντων που αξίζουν ενεργοποίηση, campaign
        brief και προτεινόμενη κατανομή budget.
      </p>
    );
  }
  if (play === 'upsell') {
    return (
      <p className="text-xs text-[#4A4A4A] leading-relaxed">
        Upsell πρόταση για{' '}
        <strong>{topSeg?.name ?? 'κορυφαίο'} segment</strong>
        {topSeg?.revenueShare > 0
          ? ` (${topSeg.revenueShare.toFixed(1)}% των εσόδων)`
          : ''}
        . Εστίαση σε premium προϊόντα, VIP επικοινωνία και διατήρηση top πελατών.
      </p>
    );
  }
  return (
    <p className="text-xs text-[#4A4A4A] leading-relaxed">
      Win-back καμπάνια για <strong>{segNames}</strong>. Στόχος η επανενεργοποίηση
      πελατών με στοχευμένες προσφορές και εξατομικευμένη επικοινωνία.
    </p>
  );
}

// ── Per-segment proposal card ────────────────────────────────────────────────

interface SegmentProposalCardProps {
  play: NonNullable<PlayContext>;
  segment: RecommendedSegmentFull;
  rfmSegment?: RFMSegment;
  channelRecommendation: ChannelRecommendation | null;
  isExpanded: boolean;
  onToggle: () => void;
}

function SegmentProposalCard({
  play,
  segment,
  rfmSegment,
  channelRecommendation,
  isExpanded,
  onToggle,
}: SegmentProposalCardProps) {
  // Get top categories for this segment
  const topCategories = useMemo(() => {
    const affinity =
      rfmSegment?.behavioral?.category_affinity_catalog ??
      rfmSegment?.behavioral?.category_affinity ??
      [];
    return affinity
      .filter((c) => c.affinity > 0)
      .sort((a, b) => (b.revenue_eur ?? b.affinity) - (a.revenue_eur ?? a.affinity))
      .slice(0, 5);
  }, [rfmSegment]);

  // Get playbook entries for this segment from channelRecommendation
  const playbookEntries = useMemo(() => {
    if (!channelRecommendation?.channelPlaybook) return [];
    return channelRecommendation.channelPlaybook.filter(
      (e) =>
        e.segment?.toLowerCase().trim() === segment.name.toLowerCase().trim() &&
        e.marketingBrief
    );
  }, [channelRecommendation, segment.name]);

  const primaryPlaybook = playbookEntries.find((e) => e.priority === 'primary') ?? playbookEntries[0];

  return (
    <div className="rounded-xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: segment.color }}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#1A1A1A] truncate">{segment.name}</div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              {segment.count > 0 && `${segment.count.toLocaleString('el-GR')} πελάτες`}
              {segment.revenueShare > 0 && ` · ${segment.revenueShare.toFixed(1)}% εσόδων`}
              {segment.rationale && ` · ${segment.rationale}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {playbookEntries.length > 0 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
              {playbookEntries.length} κανάλι{playbookEntries.length !== 1 ? 'α' : ''}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp size={14} className="text-[#9CA3AF]" />
          ) : (
            <ChevronDown size={14} className="text-[#9CA3AF]" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[#F3F4F6] px-4 pb-4 pt-3 space-y-4">
          {/* Category opportunities */}
          {topCategories.length > 0 && (
            <CategoryOpportunitiesSection
              play={play}
              categories={topCategories}
            />
          )}

          {/* Channel campaign briefs */}
          {playbookEntries.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#374151] uppercase tracking-wider">
                <Megaphone size={11} />
                Campaign Briefs
              </div>
              {playbookEntries.map((entry, i) => (
                <CampaignBriefCard key={i} entry={entry} />
              ))}
            </div>
          ) : primaryPlaybook ? null : (
            <div className="text-xs text-[#9CA3AF] italic">
              Δεν υπάρχει AI campaign brief για αυτό το segment. Ενεργοποιήστε AI
              σύσταση στο Channel Activation.
            </div>
          )}

          {/* Budget summary */}
          {playbookEntries.length > 0 && (
            <BudgetSummaryRow entries={playbookEntries} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Category opportunities ────────────────────────────────────────────────────

function CategoryOpportunitiesSection({
  play,
  categories,
}: {
  play: NonNullable<PlayContext>;
  categories: { name: string; affinity: number; avg_order?: number; revenue_eur?: number; revenue_share_pct?: number }[];
}) {
  const label =
    play === 'cross_sell'
      ? 'Κατηγορίες για cross-sell'
      : play === 'upsell'
      ? 'Top κατηγορίες για upsell'
      : 'Κατηγορίες επανεμπλοκής';

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#374151] uppercase tracking-wider mb-2">
        <ShoppingBag size={11} />
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <div
            key={cat.name}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-xs"
          >
            <span className="font-medium text-[#1A1A1A] truncate max-w-[120px]">{cat.name}</span>
            {cat.revenue_share_pct != null && cat.revenue_share_pct > 0 && (
              <span className="text-[#6B7280] text-[10px]">{cat.revenue_share_pct.toFixed(1)}%</span>
            )}
            {cat.avg_order != null && cat.avg_order > 0 && (
              <span className="text-[#6B7280] text-[10px]">
                AOV €{cat.avg_order.toFixed(0)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Campaign brief card ────────────────────────────────────────────────────────

function CampaignBriefCard({
  entry,
}: {
  entry: { channel: string; message: string; marketingBrief: string; priority?: 'primary' | 'secondary'; budgetSharePct?: number };
}) {
  const [showBrief, setShowBrief] = useState(false);
  const isPrimary = entry.priority === 'primary';

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] overflow-hidden">
      <div className="flex items-start justify-between px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
              isPrimary
                ? 'bg-[var(--nts-accent,#F97316)] text-white border-transparent'
                : 'bg-white text-[#6B7280] border-[#E5E7EB]'
            }`}
          >
            {isPrimary ? 'Primary' : 'Secondary'}
          </span>
          <span className="text-xs font-semibold text-[#1A1A1A] truncate">{entry.channel}</span>
          {entry.budgetSharePct != null && entry.budgetSharePct > 0 && (
            <span className="text-[10px] text-[#6B7280] flex-shrink-0">Budget: {entry.budgetSharePct}%</span>
          )}
        </div>
        {entry.marketingBrief && (
          <button
            onClick={() => setShowBrief((v) => !v)}
            className="text-[10px] font-medium text-[var(--nts-accent,#F97316)] hover:underline flex-shrink-0 ml-2"
          >
            {showBrief ? 'Απόκρυψη' : 'Brief →'}
          </button>
        )}
      </div>

      {/* Customer-facing message */}
      {entry.message && (
        <div className="mx-3 mb-2.5 flex items-start gap-2 p-2.5 rounded-lg bg-[#F5F3FF] border border-[#E9D5FF]">
          <Megaphone size={12} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#4A4A4A] leading-snug italic">"{entry.message}"</p>
        </div>
      )}

      {/* Marketing brief (agency-level) */}
      {showBrief && entry.marketingBrief && (
        <div className="mx-3 mb-2.5 flex items-start gap-2 p-2.5 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE]">
          <BarChart3 size={12} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-1">
              Marketing Brief (Agency)
            </div>
            <p className="text-[11px] text-[#374151] leading-relaxed">{entry.marketingBrief}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Budget summary row ────────────────────────────────────────────────────────

function BudgetSummaryRow({
  entries,
}: {
  entries: { channel: string; budgetSharePct?: number; priority?: 'primary' | 'secondary' }[];
}) {
  const withBudget = entries.filter((e) => e.budgetSharePct != null && e.budgetSharePct > 0);
  if (withBudget.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 text-[11px] font-semibold text-[#374151] uppercase tracking-wider">
        <BarChart3 size={11} />
        Budget split
      </div>
      {withBudget.map((e) => (
        <div
          key={e.channel}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB]"
        >
          <span className="font-medium text-[#1A1A1A]">{e.channel}</span>
          <span className="text-[#6B7280]">{e.budgetSharePct}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Export button ────────────────────────────────────────────────────────────

function ExportButton({
  play,
  recommendedSegments,
  rfmSegments,
  channelRecommendation,
  brandName,
}: {
  play: NonNullable<PlayContext>;
  recommendedSegments: RecommendedSegmentFull[];
  rfmSegments: RFMSegment[];
  channelRecommendation: ChannelRecommendation | null;
  brandName?: string;
}) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      const playLabels: Record<NonNullable<PlayContext>, string> = {
        cross_sell: 'Cross-Sell',
        upsell: 'Upsell-Retention',
        winback: 'Win-Back',
      };
      const playLabel = playLabels[play];
      const date = new Date().toISOString().split('T')[0];
      const brand = brandName?.replace(/[\s/\\]+/g, '_') || 'Brand';

      for (const seg of recommendedSegments) {
        const rfmSeg = rfmSegments.find((s) => s.name === seg.name);
        const categories =
          rfmSeg?.behavioral?.category_affinity_catalog ??
          rfmSeg?.behavioral?.category_affinity ??
          [];
        const topCats = categories
          .filter((c) => c.affinity > 0)
          .sort((a, b) => (b.revenue_eur ?? b.affinity) - (a.revenue_eur ?? a.affinity))
          .slice(0, 8);

        const playbookEntries = (channelRecommendation?.channelPlaybook ?? []).filter(
          (e) => e.segment?.toLowerCase().trim() === seg.name.toLowerCase().trim()
        );

        const rows: (string | number)[][] = [];
        rows.push([`${playLabel} PLAY — ${seg.name}`, '', '', '']);
        rows.push([`Πελάτες: ${seg.count.toLocaleString('el-GR')}`, `Έσοδα: ${seg.revenueShare.toFixed(1)}%`, `Fit: ${seg.fit}`, '']);
        rows.push([seg.rationale || '', '', '', '']);
        rows.push(['']);

        if (topCats.length > 0) {
          rows.push(['TOP ΚΑΤΗΓΟΡΙΕΣ', 'Revenue Share %', 'Avg Order €', 'Affinity']);
          for (const c of topCats) {
            rows.push([c.name, c.revenue_share_pct?.toFixed(1) ?? '', c.avg_order?.toFixed(0) ?? '', c.affinity.toFixed(2)]);
          }
          rows.push(['']);
        }

        if (playbookEntries.length > 0) {
          rows.push(['CAMPAIGN BRIEFS', 'Priority', 'Budget %', '']);
          for (const e of playbookEntries) {
            rows.push([e.channel, e.priority ?? '', e.budgetSharePct ?? '', '']);
            if (e.message) rows.push(['Message:', e.message, '', '']);
            if (e.marketingBrief) rows.push(['Brief:', e.marketingBrief, '', '']);
            rows.push(['']);
          }
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(wb, ws, seg.name.substring(0, 28).replace(/[[\]:*?/\\]/g, ''));
      }

      XLSX.writeFile(wb, `${brand}_${playLabel}_GrowthPlay_${date}.xlsx`);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] transition-all disabled:opacity-50"
    >
      <Download size={12} />
      {exporting ? 'Εξαγωγή...' : 'Export XLSX'}
    </button>
  );
}

// ── Hook: parse play context from URL hash ────────────────────────────────────

export function usePlayContext(): PlayContext {
  const getPlay = (): PlayContext => {
    try {
      const hash = window.location.hash; // e.g. "#channels?play=cross_sell"
      const qIndex = hash.indexOf('?');
      if (qIndex === -1) return null;
      const params = new URLSearchParams(hash.slice(qIndex + 1));
      const play = params.get('play');
      if (play === 'cross_sell' || play === 'upsell' || play === 'winback') return play;
    } catch { /* ignore */ }
    return null;
  };

  const [play, setPlay] = useState<PlayContext>(getPlay);

  // Re-read on hash change (navigation from AI insights)
  useState(() => {
    const handler = () => setPlay(getPlay());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  return play;
}
