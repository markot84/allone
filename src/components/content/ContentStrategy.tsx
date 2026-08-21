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
} from 'lucide-react';
import { Button, Card, Badge, Spinner, FormattedProse, toPlainProseText, PageHeader } from '../common';
import { useFullBleedCanvas } from '../layout/AppChrome';
import { PageCanvas } from '../layout/ChromeControls';
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
  Newsletter: <Newspaper size={16} className="text-[var(--seg-potential)]" />,
  LinkedIn: <Briefcase size={16} className="text-sky-700" />,
};

function getChannelIcon(channel: string) {
  for (const [key, icon] of Object.entries(channelIcons)) {
    if (channel.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return <Globe size={16} className="text-[var(--text-muted)]" />;
}

export function ContentStrategy() {
  // The page draws its own gutters, so the shell drops its padded wrapper.
  useFullBleedCanvas();

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
    lines.push(`— Δημιουργήθηκε από allone | ${new Date().toLocaleDateString('el-GR')}`);

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
    <PageCanvas>
      {/* The "warm hero" this replaces was a gradient mesh with two blurred colour blobs — the exact
          decoration the brief rules out. The page still opens on its own name; it just says it in
          the board's voice. */}
      <PageHeader
        toolbarAriaLabel="Εξαγωγή περιεχομένου"
        eyebrow="Content & storytelling"
        title="Στρατηγική Περιεχομένου"
        description={
          strategyLoading
            ? 'Φόρτωση στρατηγικής...'
            : activeStrategy
              ? `Ιδέες, τόνος και κατευθύνσεις βασισμένες στη στρατηγική σας — ώστε το marketing να «μιλάει» με τη φωνή του brand. (${strategyName})`
              : 'Ξεκίνα από την Εμπορική Στρατηγική για να ενεργοποιηθούν οι προτάσεις περιεχομένου.'
        }
        actions={
          hasStrategy && !suggestionsLoading && buildFullExportText ? (
            <Button
              variant="primary"
              size="sm"
              icon={allCopied ? <Check size={16} /> : <Copy size={16} />}
              onClick={handleCopyAll}
              title="Αντιγραφή όλου του περιεχομένου για αποστολή"
            >
              {allCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή όλων'}
            </Button>
          ) : null
        }
      />

      {/* Content Brief for Marketing Team — shown first when present */}
      {hasStrategy && !suggestionsLoading && brief && (
        <Card padding="lg" className="border border-[var(--orange-100)] bg-white shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-1)] ring-1 ring-[var(--border)]">
                <Send size={22} className="text-[var(--nts-accent-text)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Brief για ομάδα marketing</h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  Έτοιμο κείμενο για agency ή in-house team — αντίγραψέ το με ένα κλικ
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyBrief}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--orange-100)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-all hover:bg-[var(--gold-50)] hover:border-[var(--orange-100)]"
            >
              {briefCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} className="text-[var(--text-secondary)]" />}
              {briefCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή'}
            </button>
          </div>

          <div className="rounded-2xl border border-[var(--orange-100)] bg-[var(--surface-1)] p-5 sm:p-6 ">
            <FormattedProse content={brief} variant="default" />
          </div>
        </Card>
      )}

      {/* Loading state */}
      {hasStrategy && suggestionsLoading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--orange-100)] bg-[var(--surface-1)] py-20">
          <Spinner size="lg" label="Φόρτωση ιδεών περιεχομένου..." />
        </div>
      )}

      {/* Empty state when strategy exists but no content suggestions saved */}
      {hasStrategy && !suggestionsLoading && !hasSavedContent && (
        <Card padding="lg" className="border border-dashed border-[var(--orange-100)] bg-[var(--surface-1)]">
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[var(--border)]">
              <Sparkles size={30} className="text-[var(--nts-accent-text)]" />
            </div>
            <p className="text-base font-semibold text-[var(--text-primary)]">Δεν υπάρχουν ακόμα προτάσεις περιεχομένου</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
              Αποθήκευσε ξανά τη στρατηγική στο <span className="font-medium text-[var(--text-secondary)]">Commercial Strategy</span> — το σύστημα θα γεμίσει αυτόματα τις ιδέες για κανάλια και καμπάνιες.
            </p>
          </div>
        </Card>
      )}

      {/* Thematic Directions per Channel */}
      {hasStrategy && !suggestionsLoading && directions.length > 0 && (
        <Card padding="lg" className="border border-[var(--orange-100)] bg-white shadow-sm">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-1)] ring-1 ring-[var(--border)]">
              <Sparkles size={22} className="text-[var(--seg-potential)]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Θεματικές κατευθύνσεις ανά κανάλι</h3>
              <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
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
                className="group overflow-hidden rounded-2xl border border-[var(--orange-100)] bg-white shadow-sm transition-all hover:border-[var(--orange-100)] hover:shadow-md"
              >
                <div className="flex items-center gap-3 border-b border-[var(--orange-100)] bg-[var(--surface-1)] px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-[var(--border)]">
                    {getChannelIcon(dir.channel)}
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">{dir.channel}</h4>
                </div>
                <div className="px-4 py-4">
                  <p className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">{dir.theme}</p>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{dir.reasoning}</p>

                  {((dir.targetSegments && dir.targetSegments.length > 0) || (dir.suggestedCategories && dir.suggestedCategories.length > 0)) && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--orange-100)] pt-3">
                      {dir.targetSegments && dir.targetSegments.length > 0 && (
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--navy-50)] px-2.5 py-1 ring-1 ring-[var(--border)]">
                          <Users size={11} className="text-[var(--seg-potential)]" />
                          <span className="text-[11px] font-medium text-[var(--seg-potential)]/80">
                            {dir.targetSegments.join(', ')}
                          </span>
                        </div>
                      )}
                      {dir.suggestedCategories && dir.suggestedCategories.length > 0 && (
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gold-50)] px-2.5 py-1 ring-1 ring-[var(--border)]">
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
        <Card padding="lg" className="border border-[var(--navy-100)] bg-[var(--surface-0)] shadow-sm">
          <button
            type="button"
            onClick={() => setShowExamples(!showExamples)}
            className="flex w-full items-center justify-between gap-3 rounded-xl text-left transition-colors hover:bg-[var(--navy-50)] -m-1 p-1"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-1)] ring-1 ring-[var(--border)]">
                <FileText size={22} className="text-[var(--seg-potential)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Παραδείγματα ενεργειών</h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  {suggestions.length} ιδέες — από headline μέχρι καμπάνια
                </p>
              </div>
            </div>
            {showExamples ? <ChevronUp size={22} className="shrink-0 text-[var(--seg-potential)]" /> : <ChevronDown size={22} className="shrink-0 text-[var(--seg-potential)]" />}
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
                      <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{action.title}</h4>
                      <p className="mb-2 text-xs leading-relaxed text-[var(--text-secondary)]">{action.description}</p>
                      <p className="mb-2 text-xs font-medium text-[var(--nts-accent-text)]">Κανάλι: {action.channel}</p>
                      {action.headline_suggestion && (
                        <div className="rounded-lg border border-[var(--orange-100)] bg-[var(--gold-50)] px-3 py-2 text-xs italic leading-snug text-[var(--text-secondary)]">
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
        <Card padding="lg" className="border border-[var(--orange-100)] bg-[var(--surface-1)]">
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[var(--border)]">
              <Sparkles size={30} className="text-[var(--nts-accent-text)]" />
            </div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">Χρειάζεσαι πρώτα εμπορική στρατηγική</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
              Η Content Strategy τροφοδοτείται από το ενεργό σενάριο στο <span className="font-medium text-[var(--text-primary)]">Commercial Strategy</span>. Όρισέ την εκεί για να εμφανιστούν κατευθύνσεις και ιδέες.
            </p>
          </div>
        </Card>
      )}
    </PageCanvas>
  );
}
