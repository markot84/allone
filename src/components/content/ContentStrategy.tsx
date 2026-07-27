import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Copy,
  Check,
  Mail,
  Globe,
  Share2,
  Newspaper,
  Briefcase,
  Users,
  Tag,
  ChevronDown,
  ChevronUp,
  FileText,
  Send,
  PenLine,
} from 'lucide-react';
import { Card, Badge, Spinner, FormattedProse, toPlainProseText, PageHeader } from '../common';
import { logger } from '../../utils/logger';
import { sanitizeClipboardText } from '../../utils/spreadsheetSafe';
// Data is now read from activeStrategy.contentSuggestions (persisted on strategy save)
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useBrand } from '../../hooks/useBrand';
import { useProductSource } from '../../hooks/useProductSource';
import { useSegments } from '../../hooks/useSegments';
import { generateContentSuggestions } from '../../services/aiContentSuggestions';
import { formatBrandProfileForPrompt, hashBrandProfilePromptText } from '../../services/brandProfile';

const channelIcons: Record<string, React.ReactNode> = {
  Email: <Mail size={16} className="text-amber-700" />,
  Blog: <Globe size={16} className="text-emerald-600" />,
  'Blog/SEO': <Globe size={16} className="text-emerald-600" />,
  'Social Media': <Share2 size={16} className="text-pink-600" />,
  Newsletter: <Newspaper size={16} className="text-violet-600" />,
  LinkedIn: <Briefcase size={16} className="text-sky-700" />,
};

function getChannelIcon(channel: string) {
  for (const [key, icon] of Object.entries(channelIcons)) {
    if (channel.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return <Globe size={16} className="text-stone-500" />;
}

export function ContentStrategy() {
  const { currentBrand } = useBrand();
  const { activeStrategy, getStrategyName, isLoading: strategyLoading, saveContentSuggestions } = useActiveStrategy();
  const { products } = useProductSource();
  const { segments: rfmSegments, dataCoverage } = useSegments();
  const [showExamples, setShowExamples] = useState(true);
  const [briefCopied, setBriefCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);
  const [contentGenerating, setContentGenerating] = useState(false);
  const autoGenerateKeyRef = useRef<string | null>(null);

  // Read persisted content suggestions from strategy (AI runs only on strategy save)
  const saved = activeStrategy?.contentSuggestions;
  const suggestions = saved?.actions ?? [];
  const directions = saved?.directions ?? [];
  const brief = saved?.brief ?? '';
  const brandProfileText = useMemo(
    () => formatBrandProfileForPrompt(currentBrand?.brandProfile),
    [currentBrand?.brandProfile]
  );
  const brandProfileContextSig = useMemo(
    () => hashBrandProfilePromptText(brandProfileText),
    [brandProfileText]
  );
  const hasContentPayload = suggestions.length > 0 || directions.length > 0 || Boolean(brief);
  const hasSavedContent = hasContentPayload && saved?.brandProfileContextSig === brandProfileContextSig;
  const suggestionsLoading = strategyLoading || contentGenerating;
  const hasStrategy = !!activeStrategy && !activeStrategy.id.startsWith('default_');

  const handleCopyBrief = () => {
    if (!brief) return;
    navigator.clipboard.writeText(sanitizeClipboardText(toPlainProseText(brief))).then(() => {
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 2000);
    });
  };

  const strategyName = activeStrategy ? getStrategyName(activeStrategy.scenarioId) : '';

  useEffect(() => {
    if (!hasStrategy || !activeStrategy || hasSavedContent || contentGenerating) return;
    const generationKey = `${activeStrategy.id}:${activeStrategy.updatedAt}:${brandProfileText}`;
    if (autoGenerateKeyRef.current === generationKey) return;
    autoGenerateKeyRef.current = generationKey;

    const scenarioId = activeStrategy.scenarioId;
    const scenarioName = getStrategyName(scenarioId);
    const topCategories = [...new Set(products.map((p) => p.category).filter(Boolean))].slice(0, 5) as string[];
    const segmentNames = rfmSegments.length > 0
      ? rfmSegments.map((segment) => segment.name || segment.id).slice(0, 6)
      : ['All Customers'];

    queueMicrotask(() => setContentGenerating(true));
    generateContentSuggestions({
      scenarioId,
      scenarioName,
      weights: activeStrategy.weights,
      brandName: currentBrand?.name,
      brandProfileText,
      topCategories,
      segmentNames,
      audience: dataCoverage,
    })
      .then(async (result) => {
        if (result && (result.actions.length > 0 || result.directions.length > 0 || result.brief)) {
          await saveContentSuggestions(result);
        }
      })
      .catch((error) => {
        logger.error('[ContentStrategy] content generation failed:', { err: error });
      })
      .finally(() => setContentGenerating(false));
  }, [
    activeStrategy,
    contentGenerating,
    currentBrand?.name,
    brandProfileText,
    brandProfileContextSig,
    dataCoverage,
    getStrategyName,
    hasStrategy,
    products,
    rfmSegments,
    saveContentSuggestions,
    hasSavedContent,
  ]);

  const buildFullExportText = useMemo(() => {
    if (!directions.length && !suggestions.length && !brief) return '';

    const lines: string[] = [];
    const brandLabel = currentBrand?.name || 'Brand';

    lines.push(`📋 ΣΤΡΑΤΗΓΙΚΗ ΠΕΡΙΕΧΟΜΕΝΟΥ — ${brandLabel}`);
    lines.push(`Βάσει στρατηγικής: ${strategyName}`);
    lines.push(`Ημερομηνία: ${new Date().toLocaleDateString('el-GR')}`);
    lines.push('');

    if (directions.length > 0) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('ΘΕΜΑΤΙΚΕΣ ΚΑΤΕΥΘΥΝΣΕΙΣ ΑΝΑ ΚΑΝΑΛΙ');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      directions.forEach((dir, i) => {
        lines.push(`${i + 1}. ${dir.channel}`);
        lines.push(`   Θεματική: ${dir.theme}`);
        lines.push(`   Γιατί: ${dir.reasoning}`);
        if (dir.targetSegments?.length) lines.push(`   Segments: ${dir.targetSegments.join(', ')}`);
        if (dir.suggestedCategories?.length) lines.push(`   Κατηγορίες: ${dir.suggestedCategories.join(', ')}`);
        lines.push('');
      });
    }

    if (suggestions.length > 0) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('ΠΑΡΑΔΕΙΓΜΑΤΑ ΕΝΕΡΓΕΙΩΝ');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      suggestions.forEach((action, i) => {
        lines.push(`${i + 1}. [${action.type}] ${action.title} (${action.priority})`);
        lines.push(`   ${action.description}`);
        lines.push(`   Κανάλι: ${action.channel}`);
        if (action.headline_suggestion) lines.push(`   Headline: "${action.headline_suggestion}"`);
        lines.push('');
      });
    }

    if (brief) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('BRIEF ΓΙΑ ΟΜΑΔΑ MARKETING');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      lines.push(toPlainProseText(brief));
    }

    lines.push('');
    lines.push(`— Δημιουργήθηκε από Performance+ | ${new Date().toLocaleDateString('el-GR')}`);

    return lines.join('\n');
  }, [directions, suggestions, brief, strategyName, currentBrand?.name]);

  const handleCopyAll = () => {
    if (!buildFullExportText) return;
    navigator.clipboard.writeText(sanitizeClipboardText(buildFullExportText)).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2500);
    });
  };

  return (
    <div className="space-y-8">
      {/* Warm hero — the app's content hub */}
      <div className="relative overflow-hidden rounded-2xl border border-orange-200/55 bg-gradient-to-br from-amber-50 via-orange-50/70 to-[#FFF7ED] shadow-[0_8px_32px_-8px_rgba(234,88,12,0.18)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[var(--nts-accent)]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-rose-300/20 blur-3xl" />
        <div className="relative px-5 py-7 sm:px-8 sm:py-9">
          <PageHeader
            toolbarAriaLabel="Εξαγωγή περιεχομένου"
            className="!gap-5"
            title={
              <div className="space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-900/85 shadow-sm ring-1 ring-orange-200/80">
                  <PenLine size={14} className="text-[var(--nts-accent)]" aria-hidden />
                  Content &amp; storytelling
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Στρατηγική Περιεχομένου
                </h2>
              </div>
            }
            description={
              <p className="max-w-2xl text-[15px] leading-relaxed text-stone-600 sm:text-base">
                {strategyLoading
                  ? 'Φόρτωση στρατηγικής...'
                  : activeStrategy
                  ? (
                    <>
                      Ιδέες, τόνος και κατευθύνσεις βασισμένες στη στρατηγική σας — ώστε το marketing να «μιλάει» με τη φωνή του brand.{' '}
                      <span className="font-medium text-stone-700">({strategyName})</span>
                    </>
                  )
                  : 'Ξεκίνα από την Εμπορική Στρατηγική για να ενεργοποιηθούν οι προτάσεις περιεχομένου.'}
              </p>
            }
            actions={
              hasStrategy && !suggestionsLoading && buildFullExportText ? (
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--nts-accent)] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:brightness-105 active:scale-[0.98] sm:w-auto"
                  title="Αντιγραφή όλου του περιεχομένου για αποστολή"
                >
                  {allCopied ? <Check size={16} className="text-white" /> : <Copy size={16} />}
                  {allCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή όλων'}
                </button>
              ) : null
            }
          />
        </div>
      </div>

      {/* Content Brief for Marketing Team — shown first when present */}
      {hasStrategy && !suggestionsLoading && brief && (
        <Card padding="lg" className="border border-orange-100/90 bg-white shadow-md shadow-orange-500/[0.06]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 ring-2 ring-orange-200/50">
                <Send size={22} className="text-[var(--nts-accent)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900">Brief για ομάδα marketing</h3>
                <p className="text-sm text-stone-600">
                  Έτοιμο κείμενο για agency ή in-house team — αντίγραψέ το με ένα κλικ
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyBrief}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-orange-200/80 bg-white px-4 py-2 text-sm font-semibold text-stone-800 shadow-sm transition-all hover:bg-amber-50/90 hover:border-orange-300"
            >
              {briefCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} className="text-stone-600" />}
              {briefCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή'}
            </button>
          </div>

          <div className="rounded-2xl border border-orange-100/70 bg-gradient-to-b from-[#FFFBF7] to-white p-5 sm:p-6 shadow-inner">
            <FormattedProse content={brief} variant="default" />
          </div>
        </Card>
      )}

      {/* Loading state */}
      {hasStrategy && suggestionsLoading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-orange-100/80 bg-gradient-to-b from-amber-50/30 to-white py-20">
          <Spinner size="lg" label="Φόρτωση ιδεών περιεχομένου..." />
        </div>
      )}

      {/* Empty state when strategy exists but no content suggestions saved */}
      {hasStrategy && !suggestionsLoading && !hasSavedContent && (
        <Card padding="lg" className="border border-dashed border-orange-200 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md shadow-orange-500/10 ring-2 ring-orange-100">
              <Sparkles size={30} className="text-[var(--nts-accent)]" />
            </div>
            <p className="text-base font-semibold text-stone-800">Δεν υπάρχουν ακόμα προτάσεις περιεχομένου</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-stone-600">
              Αποθήκευσε ξανά τη στρατηγική στο <span className="font-medium text-stone-700">Commercial Strategy</span> — το σύστημα θα γεμίσει αυτόματα τις ιδέες για κανάλια και καμπάνιες.
            </p>
          </div>
        </Card>
      )}

      {/* Thematic Directions per Channel */}
      {hasStrategy && !suggestionsLoading && directions.length > 0 && (
        <Card padding="lg" className="border border-orange-100/80 bg-white shadow-md shadow-orange-500/[0.05]">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-50 ring-2 ring-violet-100">
              <Sparkles size={22} className="text-violet-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-900">Θεματικές κατευθύνσεις ανά κανάλι</h3>
              <p className="mt-0.5 text-sm text-stone-600">
                Συνδέονται με «{strategyName}» — segments &amp; κατηγορίες προϊόντων
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {directions.map((dir, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="group overflow-hidden rounded-2xl border border-orange-100/80 bg-white shadow-sm transition-all hover:border-orange-200 hover:shadow-md"
              >
                <div className="flex items-center gap-3 border-b border-orange-100/60 bg-gradient-to-r from-amber-50/90 to-orange-50/40 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-orange-100">
                    {getChannelIcon(dir.channel)}
                  </div>
                  <h4 className="text-sm font-semibold text-stone-900">{dir.channel}</h4>
                </div>
                <div className="px-4 py-4">
                  <p className="mb-1.5 text-sm font-semibold text-stone-900">{dir.theme}</p>
                  <p className="text-xs leading-relaxed text-stone-600">{dir.reasoning}</p>

                  {((dir.targetSegments && dir.targetSegments.length > 0) || (dir.suggestedCategories && dir.suggestedCategories.length > 0)) && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-orange-50 pt-3">
                      {dir.targetSegments && dir.targetSegments.length > 0 && (
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 ring-1 ring-violet-100">
                          <Users size={11} className="text-violet-600" />
                          <span className="text-[11px] font-medium text-violet-950/80">
                            {dir.targetSegments.join(', ')}
                          </span>
                        </div>
                      )}
                      {dir.suggestedCategories && dir.suggestedCategories.length > 0 && (
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 ring-1 ring-amber-100">
                          <Tag size={11} className="text-amber-700" />
                          <span className="text-[11px] font-medium text-amber-950/80">
                            {dir.suggestedCategories.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}

      {/* Example Content Actions (collapsible) */}
      {hasStrategy && !suggestionsLoading && suggestions.length > 0 && (
        <Card padding="lg" className="border border-violet-100/90 bg-gradient-to-b from-white to-violet-50/20 shadow-md shadow-violet-500/[0.04]">
          <button
            type="button"
            onClick={() => setShowExamples(!showExamples)}
            className="flex w-full items-center justify-between gap-3 rounded-xl text-left transition-colors hover:bg-violet-50/50 -m-1 p-1"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-50 ring-2 ring-violet-100">
                <FileText size={22} className="text-violet-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900">Παραδείγματα ενεργειών</h3>
                <p className="text-sm text-stone-600">
                  {suggestions.length} ιδέες — από headline μέχρι καμπάνια
                </p>
              </div>
            </div>
            {showExamples ? <ChevronUp size={22} className="shrink-0 text-violet-400" /> : <ChevronDown size={22} className="shrink-0 text-violet-400" />}
          </button>

          <AnimatePresence>
            {showExamples && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {suggestions.map((action, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm transition-all hover:border-[var(--nts-accent)]/35 hover:shadow-md"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <Badge
                          variant={action.priority === 'high' ? 'success' : 'default'}
                          size="sm"
                        >
                          {action.type}
                        </Badge>
                        <span className="text-xs capitalize text-stone-400">{action.priority}</span>
                      </div>
                      <h4 className="mb-1 text-sm font-semibold text-stone-900">{action.title}</h4>
                      <p className="mb-2 text-xs leading-relaxed text-stone-600">{action.description}</p>
                      <p className="mb-2 text-xs font-medium text-[var(--nts-accent)]">Κανάλι: {action.channel}</p>
                      {action.headline_suggestion && (
                        <div className="rounded-lg border border-orange-100 bg-amber-50/80 px-3 py-2 text-xs italic leading-snug text-stone-700">
                          &ldquo;{action.headline_suggestion}&rdquo;
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {/* No strategy fallback */}
      {!hasStrategy && !strategyLoading && (
        <Card padding="lg" className="border border-orange-100 bg-gradient-to-br from-amber-50/40 to-white">
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg shadow-orange-500/10 ring-2 ring-orange-100">
              <Sparkles size={30} className="text-[var(--nts-accent)]" />
            </div>
            <p className="text-lg font-semibold text-stone-800">Χρειάζεσαι πρώτα εμπορική στρατηγική</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-stone-600">
              Η Content Strategy τροφοδοτείται από το ενεργό σενάριο στο <span className="font-medium text-stone-800">Commercial Strategy</span>. Όρισέ την εκεί για να εμφανιστούν κατευθύνσεις και ιδέες.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
