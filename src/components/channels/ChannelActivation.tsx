import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  Eye,
  Settings,
  X,
  FileSpreadsheet,
  FileText,
  FileDown,
  CheckCircle2,
  Clock,
  Circle,
  ChevronDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Pause,
  Minus,
  Users,
  MessageSquare,
  Sparkles,
  ChevronUp,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import { Card, CardHeader, Badge, Button, Spinner, FormattedProse, PageHeader, ModalHeader } from '../common';
import { useToast } from '../common/Toast';
import { useProductSource, useCampaigns, useBrand, useSegments, useActiveStrategy, useChannelActivations } from '../../hooks';
import { exportSegmentActionPack, exportAllSegmentActionPacks, exportStrategyPlan, exportAllSegmentCustomerLists } from '../../services/segmentActionPack';
import { derivePredictiveMetrics } from '../../services/behavioralEngine';
import { getStockAgeDays } from '../../utils/productUtils';
import { safeBrandName } from '../../services/reportExport';
import { formatCurrency, formatNumber, formatPercent } from '../../utils/format';
import { scenarios } from '../../data';
import { generateChannelRecommendations } from '../../services/aiChannelRecommendations';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelRecommendation, BudgetAction, MarketingCostLine } from '../../types';
import { MarketingCostLinesEditor } from './MarketingCostLinesEditor';

const COLORS = ['var(--nts-accent)', '#78716C', '#22C55E', '#8B5CF6', '#F59E0B', '#3B82F6', '#EC4899'];

const FUNNEL_STAGE: Record<string, { label: string; color: string }> = {
  'google search ads': { label: 'Πωλήσεις', color: '#22C55E' },
  'google shopping': { label: 'Πωλήσεις', color: '#22C55E' },
  'google performance max': { label: 'Πωλήσεις', color: '#22C55E' },
  'meta ads (facebook/instagram)': { label: 'Επίγνωση', color: '#3B82F6' },
  'meta ads': { label: 'Επίγνωση', color: '#3B82F6' },
  'youtube ads': { label: 'Σκέψη', color: '#F97316' },
  'google display network': { label: 'Επίγνωση', color: '#3B82F6' },
  'email marketing': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'sms marketing': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'sms': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'push notifications': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'loyalty programs': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'dynamic remarketing': { label: 'Πωλήσεις', color: '#22C55E' },
  'meta retargeting': { label: 'Πωλήσεις', color: '#22C55E' },
  'google remarketing': { label: 'Πωλήσεις', color: '#22C55E' },
  'remarketing': { label: 'Πωλήσεις', color: '#22C55E' },
  'organic social media': { label: 'Επίγνωση', color: '#3B82F6' },
  'influencer marketing': { label: 'Σκέψη', color: '#F97316' },
  'content marketing/seo': { label: 'Σκέψη', color: '#F97316' },
  'content marketing': { label: 'Σκέψη', color: '#F97316' },
  'seo': { label: 'Σκέψη', color: '#F97316' },
  'seo (on-page & technical)': { label: 'Σκέψη', color: '#F97316' },
  'blog / editorial content': { label: 'Σκέψη', color: '#F97316' },
  'product content optimization': { label: 'Σκέψη', color: '#F97316' },
  'marketplace ads (skroutz, amazon)': { label: 'Πωλήσεις', color: '#22C55E' },
  'marketplace ads (skroutz)': { label: 'Πωλήσεις', color: '#22C55E' },
  'affiliate marketing': { label: 'Πωλήσεις', color: '#22C55E' },
  'tiktok ads': { label: 'Επίγνωση', color: '#3B82F6' },
  'pinterest ads': { label: 'Σκέψη', color: '#F97316' },
  'whatsapp business': { label: 'Αφοσίωση', color: '#8B5CF6' },
  'ugc (user-generated content)': { label: 'Σκέψη', color: '#F97316' },
  'video/connected tv': { label: 'Επίγνωση', color: '#3B82F6' },
  'programmatic display': { label: 'Επίγνωση', color: '#3B82F6' },
};

function getFunnelStage(channel: string) {
  const key = channel.toLowerCase().trim();
  if (FUNNEL_STAGE[key]) return FUNNEL_STAGE[key];
  for (const [k, v] of Object.entries(FUNNEL_STAGE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  if (key.includes('ads') || key.includes('search') || key.includes('shopping') || key.includes('remarketing')) return { label: 'Πωλήσεις', color: '#22C55E' };
  if (key.includes('display') || key.includes('video') || key.includes('social') || key.includes('tiktok')) return { label: 'Επίγνωση', color: '#3B82F6' };
  if (key.includes('content') || key.includes('seo') || key.includes('influencer') || key.includes('blog')) return { label: 'Σκέψη', color: '#F97316' };
  if (key.includes('email') || key.includes('sms') || key.includes('push') || key.includes('loyalty') || key.includes('crm')) return { label: 'Αφοσίωση', color: '#8B5CF6' };
  return { label: 'Επίγνωση', color: '#3B82F6' };
}

function getBudgetForChannel(channel: string, allocation: Record<string, number>): number | null {
  const lower = channel.toLowerCase().trim();
  for (const [key, val] of Object.entries(allocation)) {
    const k = key.toLowerCase();
    if (k === lower) return val;
    if (lower.includes(k) || k.includes(lower.split(' ')[0])) return val;
    const normalized = lower.replace(/[^a-z]/g, '');
    const normalizedKey = k.replace(/[^a-z]/g, '');
    if (normalized.startsWith(normalizedKey) || normalizedKey.startsWith(normalized.slice(0, 5))) return val;
  }
  return null;
}

const STATUS_CONFIG = {
  pending: { label: 'Εκκρεμεί', icon: Circle, color: '#9CA3AF', bg: '#F5F5F5' },
  in_progress: { label: 'Σε εξέλιξη', icon: Clock, color: '#F97316', bg: '#FFF7ED' },
  done: { label: 'Ολοκληρώθηκε', icon: CheckCircle2, color: '#22C55E', bg: '#F0FDF4' },
} as const;

const ACTION_TYPE_CONFIG = {
  increase: { label: 'Αύξηση', icon: ArrowUpRight, color: '#22C55E', bg: '#F0FDF4' },
  decrease: { label: 'Μείωση', icon: ArrowDownRight, color: '#EF4444', bg: '#FEF2F2' },
  push: { label: 'Push', icon: Zap, color: '#F97316', bg: '#FFF7ED' },
  pause: { label: 'Παύση', icon: Pause, color: '#9CA3AF', bg: '#F5F5F5' },
  maintain: { label: 'Διατήρηση', icon: Minus, color: '#6B7280', bg: '#F9FAFB' },
} as const;

type ChannelStatus = 'pending' | 'in_progress' | 'done';

interface ChannelActivationProps {
  onSectionChange?: (section: string) => void;
}

export function ChannelActivation({ onSectionChange }: ChannelActivationProps = {}) {
  const { currentBrand } = useBrand();
  const { products, count: productsCount } = useProductSource();
  const { isLoading: campaignsLoading, hasImported: hasCampaigns } = useCampaigns();
  const { segments: rfmSegments } = useSegments();
  const {
    activeStrategy,
    getStrategyName,
    updateBudget,
    isSavingBudget,
    updateMarketingCostLines,
    isSavingMarketingCostLines,
  } = useActiveStrategy();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [previewFeed, setPreviewFeed] = useState<string | null>(null);
  const [showExportAllModal, setShowExportAllModal] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [editingBudget, setEditingBudget] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showAiBrief, setShowAiBrief] = useState(true);
  const monthlyBudget = activeStrategy?.monthlyBudget ?? null;

  const strategyId = activeStrategy?.id ?? null;
  const scenarioId = activeStrategy?.scenarioId ?? null;

  // Read detailed activation recommendation (generated on strategy save, context: 'activation')
  const aiRecommendation = activeStrategy?.activationRecommendation ?? activeStrategy?.channelRecommendation ?? null;
  const aiLoading = aiGenerating;

  // Auto-generate AI recommendation if strategy exists but recommendation is missing
  const hasRealStrategyId = !!strategyId && !strategyId.startsWith('default_') && !!scenarioId;
  const autoGenTriggered = useRef(false);

  const generateRecommendation = useCallback(async () => {
    if (!strategyId || !scenarioId || !currentBrand) return;
    const scenario = scenarios.find(s => s.id === scenarioId) ?? scenarios[0];
    const segment = rfmSegments[0];
    if (!segment) return;

    setAiGenerating(true);
    try {
      const topCats = [...new Set(products.map(p => p.category).filter(Boolean))].slice(0, 5);
      const rec = await generateChannelRecommendations({
        scenario,
        segment,
        fitLevel: 'good',
        brandContext: { brandName: currentBrand.name, brandType: currentBrand.type, topCategories: topCats },
        context: 'activation',
      });

      const clean = JSON.parse(JSON.stringify(rec));
        await FirestoreService.setDocument('active_strategies', strategyId, {
          activationRecommendation: clean,
          updatedAt: new Date().toISOString(),
        } as Record<string, unknown>);
        queryClient.invalidateQueries({ queryKey: ['activeStrategy'] });
        toast.success('AI συστάσεις δημιουργήθηκαν');
    } catch (err) {
      console.error('[ChannelActivation] AI generation failed:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`AI error: ${msg}`);
    } finally {
      setAiGenerating(false);
    }
  }, [strategyId, scenarioId, currentBrand, rfmSegments, products, queryClient, toast]);

  useEffect(() => {
    if (autoGenTriggered.current) return;
    if (!hasRealStrategyId || aiRecommendation || aiGenerating) return;
    if (rfmSegments.length === 0) return;
    autoGenTriggered.current = true;
    generateRecommendation();
  }, [hasRealStrategyId, aiRecommendation, aiGenerating, rfmSegments, generateRecommendation]);

  const { getStatus, getNote, updateActivation, isSaving } = useChannelActivations(strategyId);

  // Build channel list from AI recommendations
  const allChannels = useMemo(() => {
    if (!aiRecommendation) return [];
    const channels: { name: string; isPrimary: boolean; budget: number | null }[] = [];
    for (const ch of aiRecommendation.primary) {
      channels.push({ name: ch, isPrimary: true, budget: getBudgetForChannel(ch, aiRecommendation.budget_allocation) });
    }
    for (const ch of aiRecommendation.secondary) {
      channels.push({ name: ch, isPrimary: false, budget: getBudgetForChannel(ch, aiRecommendation.budget_allocation) });
    }
    return channels;
  }, [aiRecommendation]);

  // Pie chart data from AI allocation
  const aiPieData = useMemo(() => {
    if (!aiRecommendation) return [];
    return Object.entries(aiRecommendation.budget_allocation)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([channel, pct]) => ({ channel, percentage: pct }));
  }, [aiRecommendation]);

  const handleStatusChange = useCallback(async (channel: string, status: ChannelStatus) => {
    await updateActivation({ channel, status });
    toast.success(`${channel}: ${STATUS_CONFIG[status].label}`);
  }, [updateActivation, toast]);

  const handleNoteSave = useCallback(async (channel: string) => {
    await updateActivation({ channel, note: noteText });
    setEditingNote(null);
    setNoteText('');
  }, [updateActivation, noteText]);

  const handleExportBrief = useCallback(() => {
    if (!aiRecommendation || !activeStrategy) return;
    const briefData = buildBriefData(aiRecommendation, activeStrategy, currentBrand?.name, allChannels, getStatus, getNote, monthlyBudget);
    openBriefPdf(briefData);
  }, [aiRecommendation, activeStrategy, currentBrand, allChannels, getStatus, getNote, monthlyBudget]);

  const handleBudgetSave = useCallback(async () => {
    const parsed = parseFloat(budgetInput.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      toast.error('Εισάγετε ένα έγκυρο ποσό');
      return;
    }
    try {
      await updateBudget(parsed);
      toast.success(`Budget €${parsed.toLocaleString('el-GR')} αποθηκεύτηκε`);
      setEditingBudget(false);
    } catch {
      toast.error('Σφάλμα κατά την αποθήκευση');
    }
  }, [budgetInput, updateBudget, toast]);

  const getActionForChannel = useCallback((channelName: string): BudgetAction | null => {
    if (!aiRecommendation?.actions) return null;
    const lower = channelName.toLowerCase().trim();
    return aiRecommendation.actions.find(a => {
      const aLower = a.channel.toLowerCase().trim();
      return aLower === lower || lower.includes(aLower) || aLower.includes(lower.split(' ')[0]);
    }) ?? null;
  }, [aiRecommendation]);

  // Feed export
  const exportFeed = async (feedType: string, format: 'csv' | 'xlsx') => {
    if (products.length === 0) { toast.error('Δεν υπάρχουν προϊόντα για export'); return; }
    let headers: string[] = [];
    let rows: any[][] = [];
    switch (feedType) {
      case 'Google Shopping':
        headers = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'brand', 'condition', 'google_product_category'];
        rows = products.map(p => [p.sku || p.id, p.name || '', `${p.name || ''} - ${p.category || ''}`, `https://yoursite.com/products/${p.sku || p.id}`, '', `${formatCurrency(p.price || 0, 2)} EUR`, (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock', '', 'new', p.category || '']);
        break;
      case 'Meta Catalog':
        headers = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
        rows = products.map(p => [p.sku || p.id, p.name || '', `${p.name || ''} - ${p.category || ''}`, (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock', 'new', `${formatCurrency(p.price || 0, 2)} EUR`, `https://yoursite.com/products/${p.sku || p.id}`, '', '']);
        break;
      default:
        headers = ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Capacity', 'Stock Age Days', 'Priority Tag'];
        rows = products.map(p => [p.sku || '', p.name || '', p.category || '', formatCurrency(p.price || 0, 2), formatPercent(p.margin_percentage || 0, 1).replace('%', ''), p.stock_level || 0, p.stock_capacity || 0, getStockAgeDays(p), p.priority_tag || '']);
        break;
    }
    const brand = safeBrandName(currentBrand?.name);
    const date = new Date().toISOString().split('T')[0];
    if (format === 'csv') {
      const csvContent = [['Brand', currentBrand?.name || '—'].join(','), ['Generated', date].join(','), ['Feed Type', feedType].join(','), '', headers.join(','), ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `${brand}_${feedType.toLowerCase().replace(/\s+/g, '_')}_export_${date}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      try {
        const XLSX = await import('xlsx');
        const metaRows = [['Brand', currentBrand?.name || '—'], ['Generated', date], ['Feed Type', feedType], [''], headers];
        const ws = XLSX.utils.aoa_to_sheet([...metaRows, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Products');
        XLSX.writeFile(wb, `${brand}_${feedType.toLowerCase().replace(/\s+/g, '_')}_export_${date}.xlsx`);
      } catch { toast.error('Σφάλμα κατά την εξαγωγή Excel. Δοκιμάστε CSV.'); }
    }
  };

  const getFeedPreviewTable = useCallback(
    (feedType: string) => {
      const slice = products.slice(0, 8);
      if (feedType === 'Google Shopping') {
        const headers = ['id', 'title', 'description', 'link', 'price', 'availability'];
        const rows = slice.map((p) => [
          p.sku || p.id,
          p.name || '',
          `${p.name || ''} - ${p.category || ''}`,
          `https://yoursite.com/products/${p.sku || p.id}`,
          `${formatCurrency(p.price || 0, 2)} EUR`,
          (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock',
        ]);
        return { headers, rows };
      }
      if (feedType === 'Meta Catalog') {
        const headers = ['id', 'title', 'availability', 'price', 'link'];
        const rows = slice.map((p) => [
          p.sku || p.id,
          p.name || '',
          (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock',
          `${formatCurrency(p.price || 0, 2)} EUR`,
          `https://yoursite.com/products/${p.sku || p.id}`,
        ]);
        return { headers, rows };
      }
      const headers = ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock', 'Priority'];
      const rows = slice.map((p) => [
        p.sku || '',
        p.name || '',
        p.category || '',
        formatCurrency(p.price || 0, 2),
        formatPercent(p.margin_percentage || 0, 1).replace('%', ''),
        p.stock_level || 0,
        p.priority_tag || '',
      ]);
      return { headers, rows };
    },
    [products]
  );

  const hasRealStrategy = !!activeStrategy?.id && !activeStrategy.id.startsWith('default_') && !!scenarioId;
  const strategyName = scenarioId ? getStrategyName(scenarioId) : null;
  const durationLabel = activeStrategy?.duration === 'ongoing' ? 'Συνεχής' : activeStrategy?.duration ? `${activeStrategy.duration} ημ.` : null;

  // Progress summary
  const progressSummary = useMemo(() => {
    if (allChannels.length === 0) return null;
    const total = allChannels.length;
    const done = allChannels.filter(c => getStatus(c.name) === 'done').length;
    const inProgress = allChannels.filter(c => getStatus(c.name) === 'in_progress').length;
    return { total, done, inProgress, pending: total - done - inProgress };
  }, [allChannels, getStatus]);

  if (!hasRealStrategy) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Ενεργοποίηση καναλιών</h2>}
          description={
            <p className="text-sm text-[#4A4A4A] sm:text-base">Μίξη καναλιών με AI βάσει εμπορικής στρατηγικής</p>
          }
        />
        <Card padding="lg">
          <div className="text-center py-20">
            <Settings size={48} className="mx-auto text-[var(--nts-medium-gray)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-2">Απαιτείται Εμπορική Στρατηγική</h3>
            <p className="text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Επιλέξτε και αποθηκεύστε μια εμπορική στρατηγική στο Commercial Strategy για να ενεργοποιηθεί η ανάλυση καναλιών και οι AI συστάσεις.
            </p>
            <Button
              variant="primary"
              icon={<Settings size={16} />}
              onClick={() => onSectionChange?.('strategy')}
            >
              Commercial Strategy →
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Channel activation"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Ενεργοποίηση καναλιών</h2>}
        description={
          <p className="text-[#4A4A4A]">
            <span className="font-medium text-[#1A1A1A]">{strategyName}</span>
            {durationLabel && <span className="text-[#9CA3AF]"> · {durationLabel}</span>}
          </p>
        }
        actions={
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-end sm:gap-3">
            <div className="flex min-w-0 items-center gap-2 sm:justify-end">
              <Wallet size={16} className="shrink-0 text-[#9CA3AF]" />
              {editingBudget ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-initial">
                  <span className="text-sm text-[#4A4A4A]">€</span>
                  <input
                    type="text"
                    value={budgetInput}
                    onChange={e => setBudgetInput(e.target.value)}
                    placeholder="π.χ. 5000"
                    className="min-w-0 flex-1 rounded-lg border border-[#E5E5E5] px-2 py-1.5 font-mono text-sm focus:border-[var(--nts-accent)] focus:outline-none sm:w-24 sm:flex-initial"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleBudgetSave();
                      if (e.key === 'Escape') { setEditingBudget(false); setBudgetInput(''); }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleBudgetSave}
                    disabled={isSavingBudget}
                    className="rounded-lg bg-[#1A1A1A] px-3 py-1.5 text-xs text-white hover:bg-[#333] disabled:opacity-50"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBudgetInput(monthlyBudget ? String(monthlyBudget) : '');
                    setEditingBudget(true);
                  }}
                  className="min-h-[36px] rounded-lg border border-[#E5E5E5] px-3 py-1.5 text-left text-sm font-medium transition-colors hover:border-[var(--nts-accent)]"
                >
                  {monthlyBudget
                    ? <span className="font-mono">€{monthlyBudget.toLocaleString('el-GR')}<span className="font-normal text-[#9CA3AF]">/μήνα</span></span>
                    : <span className="text-[#9CA3AF]">Ορισμός budget</span>
                  }
                </button>
              )}
            </div>

            {aiRecommendation && activeStrategy && (
              <Button
                variant="primary"
                size="sm"
                className="min-h-[36px] w-full sm:w-auto"
                icon={<FileDown size={16} />}
                onClick={handleExportBrief}
              >
                Εξαγωγή brief
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[36px] w-full sm:w-auto"
              icon={<Download size={16} />}
              onClick={() => setShowExportAllModal(true)}
            >
              Εξαγωγή feeds
            </Button>
          </div>
        }
      />

      <MarketingCostLinesEditor
        key={activeStrategy.id}
        initialLines={activeStrategy.marketingCostLines}
        monthlyBudget={monthlyBudget}
        disabled={activeStrategy.id.startsWith('default_')}
        isSaving={isSavingMarketingCostLines}
        onSave={async (lines: MarketingCostLine[]) => {
          await updateMarketingCostLines(lines);
          toast.success('Αποθηκεύτηκαν τα επιπλέον κόστη marketing');
        }}
      />

      {/* Progress bar */}
      {progressSummary && progressSummary.total > 0 && (
        <div className="flex items-center gap-4 px-4 py-3 bg-[#FAFAFA] rounded-xl border border-[#E5E5E5]">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-[#4A4A4A]">Πρόοδος ενεργοποίησης</span>
              <span className="text-xs text-[#9CA3AF]">{progressSummary.done}/{progressSummary.total} κανάλια</span>
            </div>
            <div className="h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden flex">
              {progressSummary.done > 0 && (
                <div className="h-full bg-[#22C55E] rounded-full" style={{ width: `${(progressSummary.done / progressSummary.total) * 100}%` }} />
              )}
              {progressSummary.inProgress > 0 && (
                <div className="h-full bg-[#F97316]" style={{ width: `${(progressSummary.inProgress / progressSummary.total) * 100}%` }} />
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22C55E]" />{progressSummary.done} ολοκληρώθηκαν</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F97316]" />{progressSummary.inProgress} σε εξέλιξη</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#9CA3AF]" />{progressSummary.pending} εκκρεμούν</span>
          </div>
        </div>
      )}

      {/* Main Grid: Pie + Brief Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel Mix Pie */}
        <Card padding="lg">
          <CardHeader
            title="Μίξη καναλιών"
            subtitle={hasCampaigns ? 'Πραγματική κατανομή budget' : 'Κατανομή προτεινόμενη από AI'}
            icon={<PieChartIcon size={20} className="text-[var(--nts-accent)]" />}
          />
          {(aiLoading || campaignsLoading) ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" label="Φόρτωση..." />
            </div>
          ) : aiPieData.length > 0 ? (
            <>
              <div className="w-full flex items-center justify-center" style={{ width: '100%', height: '256px', minHeight: '256px', position: 'relative' }}>
                <PieChart width={300} height={256}>
                  <Pie
                    data={aiPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="percentage"
                    nameKey="channel"
                    labelLine={false}
                  >
                    {aiPieData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5E5', borderRadius: '8px', padding: '8px 12px' }}
                    formatter={(value: number | string | undefined, name: string | undefined) => [
                      formatPercent(typeof value === 'number' ? value : 0, 1), name || 'Κανάλι'
                    ]}
                  />
                </PieChart>
              </div>
              <div className="space-y-2 mt-4">
                {aiPieData.map((item, index) => {
                  const eurAmount = monthlyBudget ? Math.round((item.percentage / 100) * monthlyBudget) : null;
                  return (
                    <div key={item.channel} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        <span className="text-[#4A4A4A] truncate max-w-[120px]">{item.channel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {eurAmount !== null && (
                          <span className="font-mono text-[11px] text-[#9CA3AF]">€{eurAmount.toLocaleString('el-GR')}</span>
                        )}
                        <span className="font-mono text-[#1A1A1A]">{formatPercent(item.percentage, 0)}</span>
                      </div>
                    </div>
                  );
                })}
                {monthlyBudget && (
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-[#E5E5E5]">
                    <span className="text-[#9CA3AF]">Μηνιαίο budget</span>
                    <span className="font-mono font-semibold text-[#1A1A1A]">€{monthlyBudget.toLocaleString('el-GR')}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν AI συστάσεις για αυτή τη στρατηγική</p>
                <p className="text-xs text-[#9CA3AF] mt-1 mb-3">Πατήστε για δημιουργία συστάσεων AI</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={generateRecommendation}
                  disabled={aiGenerating}
                >
                  {aiGenerating ? <><Spinner size="sm" className="mr-1" /> Δημιουργία...</> : 'Δημιουργία AI Συστάσεων'}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Channel Brief Cards */}
        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            title="Σύνοψη καναλιών"
            subtitle={aiRecommendation ? `${allChannels.length} κανάλια — προτεινόμενα από AI` : 'Αναμονή στρατηγικής'}
            action={
              aiRecommendation && (
                <Badge variant="default" size="md">
                  {allChannels.filter(c => c.isPrimary).length} κύρια · {allChannels.filter(c => !c.isPrimary).length} δευτερεύοντα
                </Badge>
              )
            }
          />

          {aiLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" label="Ανάλυση AI…" />
            </div>
          ) : allChannels.length > 0 ? (
            <div className="space-y-3">
              {allChannels.map((ch, index) => {
                const funnel = getFunnelStage(ch.name);
                const status = getStatus(ch.name);
                const note = getNote(ch.name);
                const statusCfg = STATUS_CONFIG[status];
                const StatusIcon = statusCfg.icon;
                const isEditing = editingNote === ch.name;
                const eurAmount = (ch.budget !== null && monthlyBudget) ? Math.round((ch.budget / 100) * monthlyBudget) : null;
                const action = getActionForChannel(ch.name);

                return (
                  <motion.div
                    key={ch.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="p-4 rounded-xl border border-[#E5E5E5] hover:border-[#D4D4D4] transition-colors"
                    style={{ borderLeftWidth: 3, borderLeftColor: funnel.color }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-[#1A1A1A] text-sm">{ch.name}</h4>
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: funnel.color + '18', color: funnel.color }}
                          >
                            {funnel.label}
                          </span>
                          {!ch.isPrimary && (
                            <span className="text-[10px] text-[#9CA3AF] border border-[#E5E5E5] px-1.5 py-0.5 rounded">secondary</span>
                          )}
                          {action && (() => {
                            const cfg = ACTION_TYPE_CONFIG[action.type];
                            const ActionIcon = cfg.icon;
                            return (
                              <span
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 cursor-help"
                                style={{ backgroundColor: cfg.bg, color: cfg.color }}
                                title={action.reason}
                              >
                                <ActionIcon size={10} />
                                {cfg.label}{action.suggestedChange ? ` ${action.type === 'decrease' || action.type === 'pause' ? '-' : '+'}${action.suggestedChange}%` : ''}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {ch.budget !== null && (
                            <span className="text-xs text-[#4A4A4A]">
                              Budget: <span className="font-semibold text-[#1A1A1A]">{ch.budget}%</span>
                              {eurAmount !== null && (
                                <span className="font-mono ml-1 text-[#1A1A1A] font-semibold">· €{eurAmount.toLocaleString('el-GR')}</span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Note display / edit */}
                        {isEditing ? (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              value={noteText}
                              onChange={e => setNoteText(e.target.value)}
                              placeholder="Σημείωση για την ομάδα..."
                              className="flex-1 text-xs px-3 py-1.5 border border-[#E5E5E5] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleNoteSave(ch.name); if (e.key === 'Escape') { setEditingNote(null); setNoteText(''); } }}
                            />
                            <button onClick={() => handleNoteSave(ch.name)} disabled={isSaving} className="text-xs px-3 py-1.5 bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-50">
                              Save
                            </button>
                          </div>
                        ) : note ? (
                          <button
                            onClick={() => { setEditingNote(ch.name); setNoteText(note); }}
                            className="mt-1.5 text-xs text-[#4A4A4A] bg-[#FAFAFA] px-2.5 py-1 rounded-md hover:bg-[#F5F5F5] text-left w-full truncate"
                          >
                            {note}
                          </button>
                        ) : (
                          <button
                            onClick={() => { setEditingNote(ch.name); setNoteText(''); }}
                            className="mt-1.5 text-[11px] text-[#9CA3AF] hover:text-[#4A4A4A]"
                          >
                            + Σημείωση
                          </button>
                        )}
                      </div>

                      {/* Status dropdown */}
                      <div className="relative group flex-shrink-0">
                        <button
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}
                        >
                          <StatusIcon size={13} />
                          {statusCfg.label}
                          <ChevronDown size={11} />
                        </button>
                        <div className="absolute right-0 top-full mt-1 bg-white border border-[#E5E5E5] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[140px]">
                          {(Object.entries(STATUS_CONFIG) as [ChannelStatus, typeof STATUS_CONFIG.pending][]).map(([key, cfg]) => {
                            const Icon = cfg.icon;
                            return (
                              <button
                                key={key}
                                onClick={() => handleStatusChange(ch.name, key)}
                                className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-[#FAFAFA] first:rounded-t-lg last:rounded-b-lg"
                                style={{ color: cfg.color }}
                              >
                                <Icon size={13} />
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}

            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <p className="text-sm text-[#4A4A4A]">Αναμονή AI συστάσεων...</p>
                <p className="text-xs text-[#9CA3AF] mt-1 mb-3">Δημιουργήστε channel briefs βάσει της στρατηγικής σας</p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={generateRecommendation}
                  disabled={aiGenerating}
                >
                  {aiGenerating ? <><Spinner size="sm" className="mr-1" /> Δημιουργία...</> : 'Δημιουργία AI Briefs'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* AI Strategy Brief — full-width collapsible */}
      {aiRecommendation?.rationale && (() => {
        const parts = aiRecommendation.rationale.split('||').map(s => s.trim());
        const hasStructure = parts.length >= 3 && parts[0].startsWith('Πελάτες:');
        const sections = [
          { icon: Users, color: '#8B5CF6', label: 'Πελάτες' },
          { icon: MessageSquare, color: '#3B82F6', label: 'Κανάλια' },
          { icon: TrendingUp, color: '#22C55E', label: 'Αποτέλεσμα' },
        ];
        return (
          <Card padding="none">
            <button
              onClick={() => setShowAiBrief(!showAiBrief)}
              className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[#FAFAFA] transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <Sparkles size={13} className="text-[var(--nts-accent)]" />
                AI Strategy Brief
              </span>
              <ChevronUp size={16} className={`text-[#9CA3AF] transition-transform ${showAiBrief ? '' : 'rotate-180'}`} />
            </button>
            <AnimatePresence>
              {showAiBrief && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 border-t border-[#F0F0F0]">
                    {hasStructure ? (
                      <div className="space-y-5 pt-4">
                        {parts.slice(0, 3).map((part, i) => {
                          const s = sections[i];
                          const text = part.replace(/^(Πελάτες|Κανάλια|Αποτέλεσμα):\s*/i, '');
                          const Icon = s.icon;
                          const cleaned = text.replace(/—/g, ',');
                          return (
                            <div key={i}>
                              <div className="flex items-center gap-2 mb-2">
                                <div
                                  className="w-6 h-6 rounded-md flex items-center justify-center"
                                  style={{ backgroundColor: `${s.color}15` }}
                                >
                                  <Icon size={13} style={{ color: s.color }} />
                                </div>
                                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.label}</span>
                              </div>
                              <FormattedProse content={cleaned} variant="compact" />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="pt-4">
                        <FormattedProse content={aiRecommendation.rationale.replace(/—/g, ',')} variant="compact" />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })()}

      {/* Downloads Hub */}
      <DownloadsHub
        segments={rfmSegments}
        brandName={currentBrand?.name}
        brandId={currentBrand?.id}
        channelRecommendation={aiRecommendation}
        activeStrategy={activeStrategy}
        scenarioId={scenarioId}
        monthlyBudget={monthlyBudget}
        toast={toast}
      />

      {/* Feed Generation */}
      <Card padding="lg">
        <CardHeader title="Δημιουργία feeds" subtitle="Προεπισκόπηση και εξαγωγή product feeds" icon={<Settings size={20} className="text-[var(--nts-accent)]" />} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].map((feed, index) => (
            <motion.div key={feed} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} className="p-4 border border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:shadow-md transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-[#1A1A1A]">{feed}</h4>
                <Badge variant="success" size="sm">Ενεργό</Badge>
              </div>
              <div className="space-y-2 text-sm text-[#4A4A4A]">
                <div className="flex justify-between"><span>Products</span><span className="font-mono">{formatNumber(productsCount)}</span></div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="ghost" size="sm" icon={<Eye size={14} />} className="flex-1" onClick={(e) => { e.stopPropagation(); setPreviewFeed(feed); }}>Προεπισκόπηση</Button>
                <Button variant="secondary" size="sm" icon={<Download size={14} />} className="flex-1" onClick={(e) => { e.stopPropagation(); setSelectedFeed(feed); setShowExportModal(true); }}>Εξαγωγή</Button>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>

      {/* Export Format Modal */}
      <AnimatePresence>
        {showExportModal && selectedFeed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowExportModal(false); setSelectedFeed(null); }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <ModalHeader
                toolbarAriaLabel="Κλείσιμο"
                title={<h2 className="text-xl font-bold text-[#1A1A1A]">Επιλογή Format</h2>}
                actions={
                  <button type="button" onClick={() => { setShowExportModal(false); setSelectedFeed(null); }} className="rounded-lg p-2 transition-colors hover:bg-[#F5F5F5]">
                    <X size={20} className="text-[#4A4A4A]" />
                  </button>
                }
              />
              <div className="p-6 space-y-3">
                <p className="text-sm text-[#4A4A4A] mb-4">Επιλέξτε format για <strong>{selectedFeed}</strong></p>
                <button onClick={() => { exportFeed(selectedFeed, 'xlsx'); setShowExportModal(false); setSelectedFeed(null); }} className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group">
                  <div className="p-3 bg-[#22C55E]/10 rounded-lg group-hover:bg-[#22C55E]/20 transition-colors"><FileSpreadsheet size={24} className="text-[#22C55E]" /></div>
                  <div className="flex-1"><h3 className="font-semibold text-[#1A1A1A]">Excel (.xlsx)</h3><p className="text-xs text-[#4A4A4A]">Λήψη ως αρχείο Excel</p></div>
                </button>
                <button onClick={() => { exportFeed(selectedFeed, 'csv'); setShowExportModal(false); setSelectedFeed(null); }} className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group">
                  <div className="p-3 bg-[#F5F5F5] rounded-lg group-hover:bg-[#E5E5E5] transition-colors"><FileText size={24} className="text-[#4A4A4A]" /></div>
                  <div className="flex-1"><h3 className="font-semibold text-[#1A1A1A]">CSV (.csv)</h3><p className="text-xs text-[#4A4A4A]">Λήψη ως αρχείο CSV</p></div>
                </button>
              </div>
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end"><Button variant="ghost" onClick={() => { setShowExportModal(false); setSelectedFeed(null); }}>Ακύρωση</Button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feed preview modal */}
      <AnimatePresence>
        {previewFeed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setPreviewFeed(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <ModalHeader
                className="flex-shrink-0"
                toolbarAriaLabel="Κλείσιμο"
                title={<h2 className="text-xl font-bold text-[#1A1A1A]">Προεπισκόπηση feed</h2>}
                description={
                  <p className="text-sm text-[#4A4A4A]">
                    {previewFeed} · {formatNumber(productsCount)} προϊόντα · δείγμα {Math.min(8, productsCount)} γραμμών
                  </p>
                }
                actions={
                  <button type="button" onClick={() => setPreviewFeed(null)} className="rounded-lg p-2 transition-colors hover:bg-[#F5F5F5]" aria-label="Κλείσιμο">
                    <X size={20} className="text-[#4A4A4A]" />
                  </button>
                }
              />
              <div className="p-6 overflow-auto flex-1 min-h-0">
                {products.length === 0 ? (
                  <p className="text-sm text-[#4A4A4A] text-center py-8">Δεν υπάρχουν προϊόντα στο catalog για προεπισκόπηση.</p>
                ) : (
                  (() => {
                    const { headers, rows } = getFeedPreviewTable(previewFeed);
                    return (
                      <div className="overflow-x-auto border border-[#E5E5E5] rounded-xl">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="bg-[#FAFAFA] border-b border-[#E5E5E5]">
                              {headers.map((h) => (
                                <th key={h} className="px-3 py-2 font-semibold text-[#1A1A1A] whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, ri) => (
                              <tr key={ri} className="border-b border-[#F0F0F0] last:border-0">
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-3 py-2 text-[#4A4A4A] max-w-[200px] truncate" title={String(cell)}>
                                    {String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </div>
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end gap-2 flex-shrink-0">
                <Button variant="ghost" onClick={() => setPreviewFeed(null)}>Κλείσιμο</Button>
                <Button
                  variant="secondary"
                  icon={<Download size={14} />}
                  onClick={() => {
                    setSelectedFeed(previewFeed);
                    setPreviewFeed(null);
                    setShowExportModal(true);
                  }}
                >
                  Export…
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export All Modal */}
      <AnimatePresence>
        {showExportAllModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowExportAllModal(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <ModalHeader
                toolbarAriaLabel="Κλείσιμο"
                title={<h2 className="text-xl font-bold text-[#1A1A1A]">Εξαγωγή όλων των feeds</h2>}
                actions={
                  <button type="button" onClick={() => setShowExportAllModal(false)} className="rounded-lg p-2 transition-colors hover:bg-[#F5F5F5]">
                    <X size={20} className="text-[#4A4A4A]" />
                  </button>
                }
              />
              <div className="p-6 space-y-3">
                <button onClick={() => { ['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].forEach((f, i) => { setTimeout(() => exportFeed(f, 'xlsx'), i * 500); }); setShowExportAllModal(false); toast.success('Export όλων των feeds ξεκίνησε'); }} className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group">
                  <div className="p-3 bg-[#22C55E]/10 rounded-lg"><FileSpreadsheet size={24} className="text-[#22C55E]" /></div>
                  <div className="flex-1"><h3 className="font-semibold text-[#1A1A1A]">Excel (.xlsx)</h3><p className="text-xs text-[#4A4A4A]">Εξαγωγή όλων των feeds ως Excel</p></div>
                </button>
                <button onClick={() => { ['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].forEach((f, i) => { setTimeout(() => exportFeed(f, 'csv'), i * 500); }); setShowExportAllModal(false); toast.success('Export όλων των feeds ξεκίνησε'); }} className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group">
                  <div className="p-3 bg-[#F5F5F5] rounded-lg"><FileText size={24} className="text-[#4A4A4A]" /></div>
                  <div className="flex-1"><h3 className="font-semibold text-[#1A1A1A]">CSV (.csv)</h3><p className="text-xs text-[#4A4A4A]">Εξαγωγή όλων των feeds ως CSV</p></div>
                </button>
              </div>
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end"><Button variant="ghost" onClick={() => setShowExportAllModal(false)}>Ακύρωση</Button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Downloads Hub ───────────────────────────────────────────────────────────

interface DownloadsHubProps {
  segments: import('../../types').RFMSegment[];
  brandName?: string;
  channelRecommendation: ChannelRecommendation | null;
  activeStrategy: ReturnType<typeof useActiveStrategy>['activeStrategy'];
  scenarioId: string | null;
  monthlyBudget: number | null;
  toast: ReturnType<typeof useToast>;
  brandId?: string;
}

function DownloadsHub({ segments, brandName, channelRecommendation, activeStrategy, scenarioId, monthlyBudget, toast, brandId }: DownloadsHubProps) {
  const [exporting, setExporting] = useState<string | null>(null);
  const hasSegments = segments.length > 0;

  type Fmt = 'xlsx' | 'csv';

  const handleExportCustomerLists = async (fmt: Fmt = 'csv') => {
    if (!brandId || !hasSegments) return;
    setExporting('customers');
    try {
      const { count } = await exportAllSegmentCustomerLists(brandId, segments, brandName, fmt);
      toast.success(`${count} customers exported (.${fmt})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
    setExporting(null);
  };

  const handleExportAllPacks = async (fmt: Fmt = 'xlsx') => {
    if (!hasSegments) return;
    setExporting('all-packs');
    try {
      await exportAllSegmentActionPacks(segments, brandName, channelRecommendation, fmt);
      toast.success(`All Segment Action Packs (.${fmt})`);
    } catch { toast.error('Export failed'); }
    setExporting(null);
  };

  const handleExportStrategy = async (fmt: Fmt = 'xlsx') => {
    if (!scenarioId || !activeStrategy) return;
    setExporting('strategy');
    try {
      const strategyName = scenarios.find(s => s.id === scenarioId)?.name || scenarioId;
      await exportStrategyPlan({
        brandName,
        scenarioName: strategyName,
        duration: activeStrategy.duration === 'ongoing' ? 'Ongoing' : activeStrategy.duration ? `${activeStrategy.duration} ημέρες` : undefined,
        monthlyBudget,
        segments,
        channelRecommendation,
        format: fmt,
      });
      toast.success(`Strategy Plan (.${fmt})`);
    } catch { toast.error('Export failed'); }
    setExporting(null);
  };

  const handleExportSegment = async (seg: import('../../types').RFMSegment, fmt: Fmt = 'xlsx') => {
    setExporting(seg.id);
    try {
      await exportSegmentActionPack(seg, brandName, channelRecommendation, fmt);
      toast.success(`Action Pack: ${seg.name} (.${fmt})`);
    } catch { toast.error('Export failed'); }
    setExporting(null);
  };

  if (!hasSegments) return null;

  const topSegments = segments.slice(0, 6);

  return (
    <Card padding="lg">
      <CardHeader
        title="Downloads Hub"
        subtitle="Έτοιμα action plans & templates για άμεση εκτέλεση"
        icon={<FileDown size={20} className="text-[var(--nts-accent)]" />}
      />

      {/* Quick exports row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 mb-5">
        <div className="p-4 border-2 border-[#E5E5E5] rounded-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--nts-accent)]/10 rounded-lg">
              <Users size={22} className="text-[var(--nts-accent)]" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#1A1A1A] text-sm">All Segments Action Pack</h3>
              <p className="text-xs text-[#4A4A4A] mt-0.5">
                {segments.length} segments · Profile, Channel Plan & Templates
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => handleExportAllPacks('xlsx')} disabled={exporting === 'all-packs'} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all disabled:opacity-50">
              <FileSpreadsheet size={13} className="text-[#22C55E]" /> .xlsx
            </button>
            <button onClick={() => handleExportAllPacks('csv')} disabled={exporting === 'all-packs'} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all disabled:opacity-50">
              <FileText size={13} className="text-[#4A4A4A]" /> .csv
            </button>
          </div>
        </div>

        {scenarioId && activeStrategy && (
          <div className="p-4 border-2 border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#3B82F6]/10 rounded-lg">
                <Sparkles size={22} className="text-[#3B82F6]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[#1A1A1A] text-sm">Strategy Execution Plan</h3>
                <p className="text-xs text-[#4A4A4A] mt-0.5">
                  Channel mix, budget & campaign templates
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => handleExportStrategy('xlsx')} disabled={exporting === 'strategy'} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all disabled:opacity-50">
                <FileSpreadsheet size={13} className="text-[#22C55E]" /> .xlsx
              </button>
              <button onClick={() => handleExportStrategy('csv')} disabled={exporting === 'strategy'} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all disabled:opacity-50">
                <FileText size={13} className="text-[#4A4A4A]" /> .csv
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Customer Lists */}
      {brandId && (
        <div className="p-4 border-2 border-[#10B981]/30 bg-[#10B981]/5 rounded-xl mb-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#10B981]/10 rounded-lg">
              <Users size={22} className="text-[#10B981]" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#1A1A1A] text-sm">Customer Lists ανά Segment</h3>
              <p className="text-xs text-[#4A4A4A] mt-0.5">
                Customer IDs, emails, RFM scores — έτοιμα για Custom Audiences & email campaigns
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleExportCustomerLists('csv')} disabled={exporting === 'customers'} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#10B981]/30 hover:border-[#10B981] hover:bg-[#10B981]/10 transition-all disabled:opacity-50">
                <FileText size={13} className="text-[#10B981]" /> .csv
              </button>
              <button onClick={() => handleExportCustomerLists('xlsx')} disabled={exporting === 'customers'} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#10B981]/30 hover:border-[#10B981] hover:bg-[#10B981]/10 transition-all disabled:opacity-50">
                <FileSpreadsheet size={13} className="text-[#10B981]" /> .xlsx
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-segment quick downloads */}
      <div>
        <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Per Segment</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {topSegments.map(seg => {
            const predictive = derivePredictiveMetrics(seg);
            return (
              <div
                key={seg.id}
                className="p-3 rounded-xl border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:shadow-sm transition-all text-left disabled:opacity-50"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-xs font-semibold text-[#1A1A1A] truncate">{seg.name}</span>
                </div>
                <div className="space-y-0.5 text-[10px] text-[#9CA3AF]">
                  <div>{formatNumber(seg.count)} customers</div>
                  <div>Churn: {predictive.churn_risk}%</div>
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => handleExportSegment(seg, 'xlsx')} disabled={exporting === seg.id} className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[10px] font-medium rounded border border-[#E5E5E5] hover:border-[var(--nts-accent)] transition-colors disabled:opacity-50">
                    <FileSpreadsheet size={10} className="text-[#22C55E]" /> xlsx
                  </button>
                  <button onClick={() => handleExportSegment(seg, 'csv')} disabled={exporting === seg.id} className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[10px] font-medium rounded border border-[#E5E5E5] hover:border-[var(--nts-accent)] transition-colors disabled:opacity-50">
                    <FileText size={10} className="text-[#9CA3AF]" /> csv
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {segments.length > 6 && (
          <p className="text-xs text-[#9CA3AF] mt-2 text-center">
            +{segments.length - 6} segments · χρησιμοποιήστε "All Segments" για πλήρες export
          </p>
        )}
      </div>
    </Card>
  );
}

// Brief PDF generation
interface BriefData {
  brandName: string;
  strategyName: string;
  duration: string;
  monthlyBudget: number | null;
  channels: { name: string; isPrimary: boolean; budget: number | null; budgetEur: number | null; funnel: string; funnelColor: string; status: string; note: string }[];
  rationale: string;
  date: string;
}

function buildBriefData(
  rec: ChannelRecommendation,
  strategy: { scenarioId: string; duration?: number | 'ongoing' },
  brandName: string | undefined,
  channels: { name: string; isPrimary: boolean; budget: number | null }[],
  getStatus: (ch: string) => string,
  getNote: (ch: string) => string,
  monthlyBudget: number | null,
): BriefData {
  const scenario = scenarios.find(s => s.id === strategy.scenarioId);
  return {
    brandName: brandName || '',
    strategyName: scenario?.name || strategy.scenarioId,
    duration: strategy.duration === 'ongoing' ? 'Ongoing' : strategy.duration ? `${strategy.duration} ημέρες` : '—',
    monthlyBudget,
    channels: channels.map(ch => {
      const f = getFunnelStage(ch.name);
      const eurAmt = (ch.budget !== null && monthlyBudget) ? Math.round((ch.budget / 100) * monthlyBudget) : null;
      return { name: ch.name, isPrimary: ch.isPrimary, budget: ch.budget, budgetEur: eurAmt, funnel: f.label, funnelColor: f.color, status: getStatus(ch.name), note: getNote(ch.name) };
    }),
    rationale: rec.rationale || '',
    date: new Date().toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

function openBriefPdf(data: BriefData) {
  const channelRows = data.channels.map(ch => {
    const statusLabel = STATUS_CONFIG[ch.status as ChannelStatus]?.label || ch.status;
    const statusColor = STATUS_CONFIG[ch.status as ChannelStatus]?.color || '#9CA3AF';
    const budgetDisplay = ch.budget !== null
      ? `${ch.budget}%${ch.budgetEur !== null ? ` · €${ch.budgetEur.toLocaleString('el-GR')}` : ''}`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#FAFAFA;border-radius:10px;margin:4px 0;border-left:3px solid ${ch.funnelColor}">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1A1A1A">${ch.name}</div>
          <div style="font-size:11px;color:#4A4A4A;margin-top:2px">
            ${ch.funnel}${budgetDisplay ? ` · ${budgetDisplay}` : ''}${!ch.isPrimary ? ' · secondary' : ''}
          </div>
          ${ch.note ? `<div style="font-size:11px;color:#4A4A4A;margin-top:4px;font-style:italic">${ch.note}</div>` : ''}
        </div>
        <span style="font-size:11px;font-weight:600;color:${statusColor}">${statusLabel}</span>
      </div>`;
  }).join('');

  const rationaleHtml = data.rationale
    ? data.rationale.split('||').map(p => `<p style="margin:6px 0;font-size:12px;color:#4A4A4A;line-height:1.6">${p.trim()}</p>`).join('')
    : '';

  const html = `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="UTF-8">
<title>Channel Brief${data.brandName ? ` — ${data.brandName}` : ''}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none !important; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1A1A1A; max-width: 700px; margin: 0 auto; padding: 40px 32px; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #F97316; padding-bottom: 16px; margin-bottom: 24px; }
  .brand-name { font-size: 22px; font-weight: 700; }
  .date { font-size: 12px; color: #9CA3AF; margin-top: 4px; }
  .logo { font-size: 28px; font-weight: 800; color: #F97316; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .meta-card { padding: 14px; background: #FAFAFA; border-radius: 10px; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #9CA3AF; font-weight: 600; }
  .meta-value { font-size: 15px; font-weight: 600; margin-top: 4px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #9CA3AF; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #F5F5F5; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #E5E5E5; display: flex; justify-content: space-between; align-items: center; }
  .footer-text { font-size: 11px; color: #9CA3AF; }
  .footer-brand { font-size: 14px; font-weight: 700; color: #F97316; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand-name">${data.brandName || 'Channel Brief'}</div>
      <div class="date">${data.date}</div>
    </div>
    <div class="logo">≠</div>
  </div>

  <div class="meta-grid"${data.monthlyBudget ? ' style="grid-template-columns:1fr 1fr 1fr"' : ''}>
    <div class="meta-card">
      <div class="meta-label">Στρατηγική</div>
      <div class="meta-value">${data.strategyName}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Διάρκεια</div>
      <div class="meta-value">${data.duration}</div>
    </div>
    ${data.monthlyBudget ? `<div class="meta-card">
      <div class="meta-label">Μηνιαίο Budget</div>
      <div class="meta-value">€${data.monthlyBudget.toLocaleString('el-GR')}</div>
    </div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Channel Plan (${data.channels.length} κανάλια)</div>
    ${channelRows}
  </div>

  ${rationaleHtml ? `
  <div class="section">
    <div class="section-title">AI Analysis</div>
    ${rationaleHtml}
  </div>` : ''}

  <div class="footer">
    <div class="footer-text">Channel Brief — Performance+ | notthesame.ai</div>
    <div class="footer-brand">≠</div>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
