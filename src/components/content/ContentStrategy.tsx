import { useState, useMemo } from 'react';
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
import { Card, Badge, Spinner, FormattedProse, toPlainProseText, PageHeader } from '../common';
// Data is now read from activeStrategy.contentSuggestions (persisted on strategy save)
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useBrand } from '../../hooks/useBrand';

const channelIcons: Record<string, React.ReactNode> = {
  'Email': <Mail size={16} className="text-[#4A4A4A]" />,
  'Blog': <Globe size={16} className="text-[#22C55E]" />,
  'Blog/SEO': <Globe size={16} className="text-[#22C55E]" />,
  'Social Media': <Share2 size={16} className="text-[#E91E8D]" />,
  'Newsletter': <Newspaper size={16} className="text-[#8B5CF6]" />,
  'LinkedIn': <Briefcase size={16} className="text-[#0A66C2]" />,
};

function getChannelIcon(channel: string) {
  for (const [key, icon] of Object.entries(channelIcons)) {
    if (channel.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return <Globe size={16} className="text-[#4A4A4A]" />;
}

export function ContentStrategy() {
  const { currentBrand } = useBrand();
  const { activeStrategy, getStrategyName, isLoading: strategyLoading } = useActiveStrategy();
  const [showExamples, setShowExamples] = useState(true);
  const [briefCopied, setBriefCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);

  // Read persisted content suggestions from strategy (AI runs only on strategy save)
  const saved = activeStrategy?.contentSuggestions;
  const suggestions = saved?.actions ?? [];
  const directions = saved?.directions ?? [];
  const brief = saved?.brief ?? '';
  const suggestionsLoading = strategyLoading;
  const hasStrategy = !!activeStrategy && !activeStrategy.id.startsWith('default_');

  const handleCopyBrief = () => {
    if (!brief) return;
    navigator.clipboard.writeText(toPlainProseText(brief)).then(() => {
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 2000);
    });
  };

  const strategyName = activeStrategy ? getStrategyName(activeStrategy.scenarioId) : '';

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
    navigator.clipboard.writeText(buildFullExportText).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2500);
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Εξαγωγή περιεχομένου"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Στρατηγική Περιεχομένου</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            {strategyLoading
              ? 'Φόρτωση στρατηγικής...'
              : activeStrategy
              ? `Θεματικές κατευθύνσεις & παραδείγματα βάσει: ${strategyName}`
              : 'Πήγαινε στην Εμπορική Στρατηγική για να ορίσεις ενεργή στρατηγική'}
          </p>
        }
        actions={
          hasStrategy && !suggestionsLoading && buildFullExportText ? (
            <button
              type="button"
              onClick={handleCopyAll}
              className="flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#F5F5F5] px-3 py-1.5 text-xs font-medium text-[#1A1A1A] transition-all hover:bg-[#E5E5E5] sm:w-auto"
              title="Αντιγραφή όλου του περιεχομένου για αποστολή"
            >
              {allCopied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
              {allCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή όλων'}
            </button>
          ) : null
        }
      />

      {/* Content Brief for Marketing Team — πρώτο περιεχόμενο όταν υπάρχει */}
      {hasStrategy && !suggestionsLoading && brief && (
        <Card padding="lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#F5F5F5] rounded-xl flex items-center justify-center">
                <Send size={20} className="text-[#4A4A4A]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1A1A1A]">Brief για ομάδα marketing</h3>
                <p className="text-sm text-[#4A4A4A]">
                  Κείμενο κατευθύνσεων για αποστολή σε marketing team ή agency
                </p>
              </div>
            </div>
            <button
              onClick={handleCopyBrief}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-[#F5F5F5] hover:bg-[#E5E5E5] text-[#1A1A1A]"
            >
              {briefCopied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
              {briefCopied ? 'Αντιγράφηκε!' : 'Αντιγραφή'}
            </button>
          </div>

          <div className="p-5 bg-gradient-to-br from-[#FAFAFA] to-white border border-[#E5E5E5] rounded-xl">
            <FormattedProse content={brief} variant="default" />
          </div>
        </Card>
      )}

      {/* Loading state */}
      {hasStrategy && suggestionsLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" label="Φόρτωση..." />
        </div>
      )}

      {/* Empty state when strategy exists but no content suggestions saved */}
      {hasStrategy && !suggestionsLoading && !saved && (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles size={32} className="text-[#9CA3AF] mb-3" />
            <p className="text-sm text-[#4A4A4A] font-medium">Δεν υπάρχουν προτάσεις περιεχομένου</p>
            <p className="text-xs text-[#9CA3AF] mt-1">Αποθηκεύστε (ξανά) τη στρατηγική στο Commercial Strategy για να δημιουργηθούν αυτόματα</p>
          </div>
        </Card>
      )}

      {/* Thematic Directions per Channel */}
      {hasStrategy && !suggestionsLoading && directions.length > 0 && (
        <Card padding="lg">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-[#F5F5F5] rounded-xl flex items-center justify-center">
              <Sparkles size={20} className="text-[#1A1A1A]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#1A1A1A]">Θεματικές κατευθύνσεις ανά κανάλι</h3>
              <p className="text-sm text-[#4A4A4A]">
                Βάσει στρατηγικής «{strategyName}», segments & κατηγοριών προϊόντων
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {directions.map((dir, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="rounded-xl border border-[#E5E5E5] bg-white overflow-hidden hover:shadow-sm transition-shadow"
              >
                <div className="px-4 py-3 bg-[#FAFAFA] flex items-center gap-2.5 border-b border-[#E5E5E5]">
                  <div className="w-8 h-8 rounded-lg bg-white border border-[#E5E5E5] flex items-center justify-center flex-shrink-0">
                    {getChannelIcon(dir.channel)}
                  </div>
                  <h4 className="font-semibold text-[#1A1A1A] text-sm">{dir.channel}</h4>
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm text-[#1A1A1A] font-medium mb-1.5">{dir.theme}</p>
                  <p className="text-xs text-[#4A4A4A] leading-relaxed">{dir.reasoning}</p>

                  {((dir.targetSegments && dir.targetSegments.length > 0) || (dir.suggestedCategories && dir.suggestedCategories.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#F0F0F0]">
                      {dir.targetSegments && dir.targetSegments.length > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#F5F3FF] rounded-md">
                          <Users size={11} className="text-[#8B5CF6]" />
                          <span className="text-[11px] text-[#4A4A4A]">
                            {dir.targetSegments.join(', ')}
                          </span>
                        </div>
                      )}
                      {dir.suggestedCategories && dir.suggestedCategories.length > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#FEF3C7] rounded-md">
                          <Tag size={11} className="text-[#D97706]" />
                          <span className="text-[11px] text-[#4A4A4A]">
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
        <Card padding="lg">
          <button
            onClick={() => setShowExamples(!showExamples)}
            className="flex items-center justify-between w-full text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#EDE9FE] rounded-xl flex items-center justify-center">
                <FileText size={20} className="text-[#8B5CF6]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1A1A1A]">Παραδείγματα ενεργειών</h3>
                <p className="text-sm text-[#4A4A4A]">
                  {suggestions.length} ιδέες περιεχομένου ως εφαρμογή των κατευθύνσεων
                </p>
              </div>
            </div>
            {showExamples ? <ChevronUp size={20} className="text-[#9CA3AF]" /> : <ChevronDown size={20} className="text-[#9CA3AF]" />}
          </button>

          <AnimatePresence>
            {showExamples && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
                  {suggestions.map((action, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-4 bg-white border border-[#E5E5E5] rounded-xl hover:border-[#8B5CF6]/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Badge
                          variant={action.priority === 'high' ? 'success' : 'default'}
                          size="sm"
                        >
                          {action.type}
                        </Badge>
                        <span className="text-xs text-[#9CA3AF] capitalize">{action.priority}</span>
                      </div>
                      <h4 className="font-semibold text-[#1A1A1A] text-sm mb-1">{action.title}</h4>
                      <p className="text-xs text-[#4A4A4A] mb-2">{action.description}</p>
                      <p className="text-xs text-[#9CA3AF] mb-2">Κανάλι: {action.channel}</p>
                      {action.headline_suggestion && (
                        <div className="p-2 bg-[#F5F5F5] rounded text-xs text-[#4A4A4A] italic">
                          "{action.headline_suggestion}"
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
        <Card padding="lg">
          <div className="text-center py-12">
            <Sparkles size={32} className="text-[#9CA3AF] mx-auto mb-3" />
            <p className="text-[#4A4A4A] font-medium">Δεν υπάρχει ενεργή στρατηγική</p>
            <p className="text-sm text-[#9CA3AF] mt-1">
              Πήγαινε στην Εμπορική Στρατηγική για να ορίσεις ενεργή στρατηγική και να λάβεις κατευθύνσεις περιεχομένου.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
