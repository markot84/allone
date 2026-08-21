import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Zap,
  MessageCircle,
  Lightbulb,
  AlertTriangle,
  Target,
  ArrowRight,
} from 'lucide-react';
import { Button, useToast, PageHeader } from '../common';
import type { AIInsight } from '../../types';
import { AIAssistant } from './AIAssistant';
import { InsightCard } from './InsightCard';
import { APPLY_ALL_PRIORITY, INSIGHT_NAV } from './aiInsightsConfig';
import { useAiInsightsData } from './useAiInsightsData';

const FILTER_LABELS: Record<'all' | 'opportunity' | 'warning' | 'recommendation', string> = {
  all: 'Όλα',
  opportunity: 'Ευκαιρίες',
  warning: 'Προειδοποιήσεις',
  recommendation: 'Συστάσεις',
};

interface AIInsightsPageProps {
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
}

export function AIInsightsPage({ onSectionChange }: AIInsightsPageProps) {
  const toast = useToast();
  const { aiInsights } = useAiInsightsData();
  const [filter, setFilter] = useState<'all' | 'opportunity' | 'warning' | 'recommendation'>('all');
  const [assistantOpen, setAssistantOpen] = useState(false);

  const filteredInsights = useMemo(
    () => aiInsights.filter((insight) => filter === 'all' || insight.type === filter),
    [aiInsights, filter]
  );

  const countByType = useMemo(
    () => ({
      all: aiInsights.length,
      opportunity: aiInsights.filter((i) => i.type === 'opportunity').length,
      warning: aiInsights.filter((i) => i.type === 'warning').length,
      recommendation: aiInsights.filter((i) => i.type === 'recommendation').length,
    }),
    [aiInsights]
  );

  const highImpactCount = useMemo(() => aiInsights.filter((i) => i.impact === 'high').length, [aiInsights]);

  const navigateForInsight = (insight: AIInsight) => {
    const key = insight.insightKey;
    if (!key || !onSectionChange) return;
    const nav = INSIGHT_NAV[key];
    if (!nav) return;
    onSectionChange(nav.section, nav.hashQuery ? { hashQuery: nav.hashQuery } : undefined);
  };

  const handleApplyAll = () => {
    if (!onSectionChange || aiInsights.length === 0) return;
    const keys = new Set(aiInsights.map((i) => i.insightKey).filter(Boolean));
    for (const k of APPLY_ALL_PRIORITY) {
      if (!keys.has(k)) continue;
      const nav = INSIGHT_NAV[k];
      if (nav) {
        onSectionChange(nav.section, nav.hashQuery ? { hashQuery: nav.hashQuery } : undefined);
        toast.success(
          'Μεταφορά στο σχετικό τμήμα. Δείτε τις υπόλοιπες κάρτες για επιπλέον ενέργειες.'
        );
        return;
      }
    }
    toast.info('Δεν βρέθηκε συνδεδεμένη ενέργεια.');
  };

  return (
    <div className="min-h-0 flex flex-col">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col gap-8 pb-10">
        <PageHeader
          toolbarAriaLabel="Ενέργειες AI Insights"
          title={<h1 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">AI Insights</h1>}
          description={
            <p className="text-sm text-[#4A5568] sm:text-base max-w-2xl">
              Αυτόματες αναλύσεις από προϊόντα, segments, e-commerce και RFM, με σύνδεση στις σχετικές ενότητες για άμεση συνέχεια εργασίας.
            </p>
          }
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<MessageCircle size={16} />}
              onClick={() => setAssistantOpen(true)}
              className="min-h-[36px]"
            >
              Ρώτησε τον βοηθό
            </Button>
          }
        />

        {/* Hero metrics */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-[#E8E8ED] bg-gradient-to-br from-white via-[#FAFBFC] to-[#F4F6F9] px-6 py-8 sm:px-10 sm:py-10 shadow-sm"
        >
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[var(--nts-accent)]/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-sky-400/5 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[var(--nts-accent)]/10 border border-[var(--nts-accent)]/20 flex items-center justify-center shrink-0 shadow-sm">
                <Sparkles size={28} className="text-[var(--nts-accent-text)]" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--nts-accent-text)]">Σύνοψη</p>
                <h2 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[#1A1A1A]">
                  Έξυπνες προτάσεις για την ομάδα σας
                </h2>
                <p className="mt-2 text-sm text-[#6B7280] max-w-xl leading-relaxed">
                  Κάθε κάρτα οδηγεί στη σχετική ενότητα της πλατφόρμας, ώστε η ανάλυση να μετατρέπεται άμεσα σε πρακτική ενέργεια.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <div className="rounded-xl bg-white border border-[#E5E7EB] px-5 py-4 min-w-[120px] shadow-sm">
                <p className="text-[11px] uppercase tracking-wide text-[#9CA3AF]">Insights</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-[#1A1A1A]">{aiInsights.length}</p>
              </div>
              <div className="rounded-xl bg-white border border-[#E5E7EB] px-5 py-4 min-w-[120px] shadow-sm">
                <p className="text-[11px] uppercase tracking-wide text-[#9CA3AF]">Υψηλής προτεραιότητας</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-amber-600">{highImpactCount}</p>
              </div>
            </div>
          </div>
        </motion.section>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          <div className="xl:col-span-8 space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {(['all', 'opportunity', 'warning', 'recommendation'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all border ${
                    filter === type
                      ? 'btn-gold text-white border-[var(--nts-accent)] shadow-sm'
                      : 'bg-white text-[#4A5568] border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F9FAFB]'
                  }`}
                >
                  {type === 'opportunity' && <Lightbulb size={15} className="opacity-80" />}
                  {type === 'warning' && <AlertTriangle size={15} className="opacity-80" />}
                  {type === 'recommendation' && <Target size={15} className="opacity-80" />}
                  {FILTER_LABELS[type]}{' '}
                  <span className="tabular-nums opacity-80">({countByType[type]})</span>
                </button>
              ))}
            </div>

            {/* List */}
            <div className="space-y-4">
              {filteredInsights.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#FAFAFA] px-8 py-16 text-center">
                  <Sparkles className="mx-auto text-[#9CA3AF] mb-3" size={36} />
                  <p className="text-[#4A5568] font-medium">Δεν υπάρχουν insights σε αυτό το φίλτρο</p>
                  <p className="text-sm text-[#9CA3AF] mt-1">Δοκιμάστε το φίλτρο «Όλα» ή εμπλουτίστε τα διαθέσιμα δεδομένα.</p>
                </div>
              ) : (
                filteredInsights.map((insight, index) => (
                  <InsightCard
                    key={insight.insightKey ?? index}
                    insight={insight}
                    index={index}
                    onAction={() => navigateForInsight(insight)}
                    canNavigate={!!insight.insightKey && !!onSectionChange && !!INSIGHT_NAV[insight.insightKey]}
                  />
                ))
              )}
            </div>

            {/* Apply all */}
            <div className="rounded-xl border border-[#E8E8ED] bg-[#FAFBFC] p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="font-semibold text-[#1A1A1A]">Εφαρμογή προτεραιότητας</p>
                  <p className="text-xs text-[#6B7280] mt-1 max-w-md leading-snug">
                    Μεταφέρει στην πρώτη διαθέσιμη ενότητα με βάση τη σειρά προτεραιότητας των σημαντικότερων ευρημάτων.
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={<Zap size={16} />}
                  onClick={handleApplyAll}
                  disabled={!onSectionChange || aiInsights.length === 0}
                  className="shrink-0 min-h-[44px] px-6"
                >
                  Μετάβαση στην πρώτη προτεραιότητα
                </Button>
              </div>
            </div>
          </div>

          {/* Side column */}
          <aside className="xl:col-span-4 space-y-4 xl:sticky xl:top-4">
            <div className="rounded-2xl border border-[#E8E8ED] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--nts-accent)]/20 to-violet-500/10 flex items-center justify-center overflow-hidden border border-[#F0F0F0]">
                  <img
                    src="/mark.png"
                    alt=""
                    className="w-9 h-9 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1A1A1A]">Βοηθός & γνωσιακή βάση</h3>
                  <p className="text-xs text-[#6B7280]">Ερωτήσεις για τη χρήση της πλατφόρμας</p>
                </div>
              </div>
              <p className="text-sm text-[#4A5568] leading-relaxed mb-4">
                Ανοίξτε τη συνομιλία για πρακτικές απαντήσεις σχετικά με connectors, αναφορές και workflows της πλατφόρμας.
              </p>
              <Button variant="primary" className="w-full justify-center" icon={<MessageCircle size={16} />} onClick={() => setAssistantOpen(true)}>
                Άνοιγμα συνομιλίας
              </Button>
            </div>

            <div className="rounded-2xl border border-[#E8E8ED] bg-[#F9FAFB] p-5 text-sm text-[#4A5568]">
              <p className="font-semibold text-[#1A1A1A] mb-3 text-xs uppercase tracking-wide">Υπόμνημα τύπων</p>
              <ul className="space-y-3">
                <li className="flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-[#1A1A1A]">Ευκαιρία</strong>: αξιοποίηση τάσης ή δυναμικού που δεν έχει ακόμη αξιοποιηθεί επαρκώς
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-[#1A1A1A]">Προειδοποίηση</strong>: ρίσκο που απαιτεί άμεση προσοχή
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                  <span>
                    <strong className="text-[#1A1A1A]">Σύσταση</strong>: επόμενο βήμα βελτιστοποίησης ή οργάνωσης
                  </span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => onSectionChange?.('help')}
              className="w-full flex items-center justify-between rounded-xl border border-[#E8E8ED] bg-white px-4 py-3 text-sm font-medium text-[#4A5568] hover:bg-[#FAFAFA] transition-colors"
            >
              Μετάβαση στο Help
              <ArrowRight size={16} className="text-[#9CA3AF]" />
            </button>
          </aside>
        </div>
      </div>

      <AIAssistant isOpen={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}
