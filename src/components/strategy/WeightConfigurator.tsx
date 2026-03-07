import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Send,
  Download,
  Sparkles,
  AlertCircle,
  Eye,
  Euro,
  Package,
  Target,
  TrendingUp,
  Users,
  GitCompare,
  X,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Card, CardHeader, Button, Slider, Badge, Spinner } from '../common';
import { ScenarioSelector } from './ScenarioSelector';
import { ChannelRecommendations } from './ChannelRecommendations';
import { ApprovalWorkflow } from './ApprovalWorkflow';
import { StrategyImpactPreview } from './StrategyImpactPreview';
import { CustomToolsCard } from './CustomToolsCard';
import { CompareScenariosModal } from './CompareScenariosModal';
import { useProducts, useSegments, useBrand } from '../../hooks';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useAuth } from '../../hooks';
import {
  scenarios,
  defaultWeights,
  weightFactors
} from '../../data';
import { useAIChannelRecommendations } from '../../hooks/useAIChannelRecommendations';
import { getPreviewConfig, type PreviewColumnId } from '../../data/strategyPreviewConfig';
import { calculateCompositeScore } from '../../utils/compositeScore';
import { getStockAgeDays } from '../../utils/productUtils';
import { safeBrandName } from '../../services/reportExport';
import { useToast } from '../common/Toast';
import { Tooltip } from '../common';
import type { Product } from '../../types';

type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'implementing';

const PreviewCell = memo(function PreviewCell({
  columnId,
  product,
  rank,
}: {
  columnId: PreviewColumnId;
  product: Product & { composite_score?: number };
  rank: number;
}) {
  const cap = product.stock_capacity || 1;
  const ratio = (product.stock_level || 0) / cap;
  const isScore = columnId === 'score';
  const alignRight = isScore ? 'text-right' : '';

  switch (columnId) {
    case 'rank':
      return (
        <td className="py-3">
          <span className="w-6 h-6 rounded-full bg-[#F5F5F5] flex items-center justify-center text-xs font-medium">
            {rank}
          </span>
        </td>
      );
    case 'product':
      return (
        <td className="py-3">
          <div>
            <p className="text-sm font-medium text-[#1A1A1A] truncate max-w-[200px]">{product.name}</p>
            <p className="text-xs text-[#9CA3AF]">{product.sku}</p>
          </div>
        </td>
      );
    case 'category':
      return (
        <td className="py-3">
          <span className="text-sm text-[#4A4A4A]">{product.category}</span>
        </td>
      );
    case 'margin':
      return (
        <td className="py-3">
          <Badge
            variant={
              product.margin_tier === 'high' ? 'success' : product.margin_tier === 'medium' ? 'warning' : 'danger'
            }
          >
            {(product.margin_percentage ?? 0).toFixed(1)}%
          </Badge>
        </td>
      );
    case 'stock':
      return (
        <td className="py-3">
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${ratio * 100}%`,
                  backgroundColor: ratio > 0.8 ? '#EF4444' : ratio > 0.5 ? '#F59E0B' : '#22C55E',
                }}
              />
            </div>
            <span className="text-xs text-[#4A4A4A] font-mono">{product.stock_level ?? 0}</span>
          </div>
        </td>
      );
    case 'stock_age':
      return (
        <td className="py-3">
          <span className="text-sm text-[#4A4A4A]">{product.stock_age_days ?? 0} days</span>
        </td>
      );
    case 'excess_pct': {
      const excess = Math.max(0, (product.stock_level ?? 0) - cap);
      const pct = cap > 0 ? ((excess / cap) * 100).toFixed(0) : '0';
      return (
        <td className="py-3">
          <span className="text-sm font-medium text-[#4A4A4A]">{pct}%</span>
        </td>
      );
    }
    case 'priority_tag':
      return (
        <td className="py-3">
          <Badge variant="default" size="sm">
            {product.priority_tag ?? '-'}
          </Badge>
        </td>
      );
    case 'revenue_potential': {
      const val = (product.price ?? 0) * (product.stock_level ?? 0);
      const fmt = val >= 1000 ? `€${(val / 1000).toFixed(1)}K` : `€${val.toFixed(0)}`;
      return (
        <td className="py-3">
          <span className="text-sm font-mono text-[#1A1A1A]">{fmt}</span>
        </td>
      );
    }
    case 'score':
      return (
        <td className={`py-3 ${alignRight}`}>
          <motion.span
            key={product.composite_score}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="text-lg font-bold text-[var(--nts-accent)] font-mono"
          >
            {product.composite_score?.toFixed(1)}
          </motion.span>
        </td>
      );
    default:
      return <td className="py-3" />;
  }
});

export function WeightConfigurator() {
  const { currentBrand } = useBrand();
  const { products, hasImported } = useProducts();
  const { segments: rfmSegments } = useSegments();
  const { user } = useAuth();
  const { activeStrategy, saveActiveStrategy, isLoading: strategyLoading } = useActiveStrategy();
  const toast = useToast();
  
  // Initialize from active strategy if available, otherwise no default
  const [selectedScenario, setSelectedScenario] = useState<string | null>(() => {
    if (activeStrategy) return activeStrategy.scenarioId;
    return null; // No default scenario - user must select
  });
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    if (activeStrategy) return activeStrategy.weights;
    return defaultWeights; // Empty weights, user must select scenario
  });
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(() => {
    if (activeStrategy) return activeStrategy.approvalStatus;
    return 'draft';
  });
  const [selectedSegment, setSelectedSegment] = useState('champions');
  const [showImpactPreview, setShowImpactPreview] = useState(false);
  const [pendingScenarioChange, setPendingScenarioChange] = useState<string | null>(null);
  const [previewTargetScenario, setPreviewTargetScenario] = useState<string | null>(null); // For manual preview
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showFeedFormatModal, setShowFeedFormatModal] = useState(false);
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const PREVIEW_PAGE_SIZE = 10;

  // Refs must be declared before other hooks
  const debounceTimerRef = useRef<number | null>(null);
  
  // Debounced weights for expensive calculations
  const [debouncedWeights, setDebouncedWeights] = useState(weights);

  const getWeightsForScenario = useCallback((scenarioId: string | null) => {
    if (!scenarioId || scenarioId === 'custom') return weights;
    const scenario = scenarios.find((s) => s.id === scenarioId);
    return scenario?.weights ?? defaultWeights;
  }, [weights]);

  // Calculate total weight early to avoid reference errors
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  // Get current weights for comparison
  const getCurrentWeights = useCallback(() => {
    if (!selectedScenario || selectedScenario === 'custom') return weights;
    const scenario = scenarios.find((s) => s.id === selectedScenario);
    return scenario?.weights ?? weights;
  }, [selectedScenario, weights]);

  // Handle scenario change with impact preview (NO auto-save)
  const handleScenarioChange = useCallback((scenarioId: string) => {
    // If selecting the same scenario, do nothing
    if (scenarioId === selectedScenario) {
      return;
    }
    
    // Just update the UI - no auto-save
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (scenario) {
      const newWeights = scenario.weights || defaultWeights;
      setWeights(newWeights);
      setSelectedScenario(scenarioId);
      setApprovalStatus('draft');
    }
    
    // Show preview when changing strategy
    setPendingScenarioChange(scenarioId);
    setShowImpactPreview(true);
  }, [selectedScenario]);

  // Apply the scenario change and SAVE it
  const applyScenarioChange = useCallback((scenarioId: string) => {
    setSelectedScenario(scenarioId);
    const scenario = scenarios.find((s) => s.id === scenarioId);
    const newWeights = scenario?.weights || defaultWeights;
    setWeights(newWeights);
    setApprovalStatus('draft');
    setShowImpactPreview(false);
    setPendingScenarioChange(null);
    setPreviewTargetScenario(null);
    
    // Save the strategy when user confirms the change
    if (!user) {
      toast.error('Πρέπει να είσαι συνδεδεμένος');
      return;
    }
    
    const scenarioName = scenario?.name || (scenarioId === 'custom' ? 'Custom' : 'Unknown');
    
    saveActiveStrategy({
      scenarioId: scenarioId,
      weights: newWeights,
      approvalStatus: 'draft',
      approvedBy: user.email || user.displayName || 'User',
    }).then(() => {
      toast.success(`Στρατηγική "${scenarioName}" αποθηκεύτηκε`);
    }).catch((error) => {
      console.error('Error saving strategy:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, saveActiveStrategy, toast]);

  // Confirm strategy change after impact preview
  const confirmStrategyChange = useCallback(() => {
    if (pendingScenarioChange) {
      applyScenarioChange(pendingScenarioChange);
    } else if (previewTargetScenario) {
      applyScenarioChange(previewTargetScenario);
    }
  }, [pendingScenarioChange, previewTargetScenario, applyScenarioChange]);

  const previewConfig = getPreviewConfig(selectedScenario || 'profit_max', weights);

  // NO auto-save for custom weights - user must click "Save Strategy" button

  // Handle individual weight change with proportional adjustment
  const handleWeightChange = useCallback(
    (factorId: string, newValue: number) => {
      const oldValue = weights[factorId];
      const diff = newValue - oldValue;

      if (diff === 0) return;

      // Get other factors to adjust
      const otherFactors = weightFactors.filter((f) => f.id !== factorId);
      const otherTotal = otherFactors.reduce((sum, f) => sum + weights[f.id], 0);

      if (otherTotal === 0) return;

      const newWeights = { ...weights, [factorId]: newValue };

      // Proportionally adjust other weights
      otherFactors.forEach((factor) => {
        const proportion = weights[factor.id] / otherTotal;
        const adjustment = -diff * proportion;
        newWeights[factor.id] = Math.max(
          0,
          Math.min(100, Math.round(weights[factor.id] + adjustment))
        );
      });

      // Ensure total is exactly 100
      const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
      if (total !== 100) {
        const largest = otherFactors.reduce((a, b) =>
          newWeights[a.id] > newWeights[b.id] ? a : b
        );
        newWeights[largest.id] += 100 - total;
      }

      setWeights(newWeights);
      setSelectedScenario('custom');
      setApprovalStatus('draft');
      
      // Debounce expensive calculations
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        setDebouncedWeights(newWeights);
      }, 150);
    },
    [weights]
  );
  
  // Sync debounced weights when weights change externally (scenario selection)
  useEffect(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    setDebouncedWeights(weights);
  }, [selectedScenario]); // Only when scenario changes, not on every weight change

  // Reset to default
  const handleReset = useCallback(() => {
    setWeights(defaultWeights);
    setSelectedScenario('custom');
    setApprovalStatus('draft');
  }, []);

  // Calculate prioritized products (strategy-specific score logic)
  // Use debounced weights for expensive calculations, limit to top 100 for preview
  const prioritizedProducts = useMemo(() => {
    if (!selectedScenario) return [];
    const strategyId = selectedScenario === 'custom' ? undefined : selectedScenario;
    const scored = products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, debouncedWeights, undefined, strategyId)
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));
    
    // Return top 100 for preview (full list only needed for export)
    return scored.slice(0, 100);
  }, [products, debouncedWeights, selectedScenario]);

  const previewTotalPages = Math.max(1, Math.ceil(prioritizedProducts.length / PREVIEW_PAGE_SIZE));
  const paginatedPreviewProducts = prioritizedProducts.slice(
    (currentPreviewPage - 1) * PREVIEW_PAGE_SIZE,
    currentPreviewPage * PREVIEW_PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPreviewPage(1);
  }, [selectedScenario, debouncedWeights]);

  // Full list for export (only calculated when needed)
  const allPrioritizedProducts = useMemo(() => {
    if (!selectedScenario) return [];
    const strategyId = selectedScenario === 'custom' ? undefined : selectedScenario;
    return products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, debouncedWeights, undefined, strategyId)
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));
  }, [products, debouncedWeights, selectedScenario]);

  // Generate product feed function
  const generateProductFeed = async (format: 'csv' | 'xlsx') => {
    if (allPrioritizedProducts.length === 0) {
      toast.error('Δεν υπάρχουν προϊόντα για feed generation');
      return;
    }

    // Use all prioritized products (sorted by composite score)
    const feedProducts = allPrioritizedProducts;

    // Standard product feed format
    const headers = ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Capacity', 'Stock Age Days', 'Composite Score', 'Priority Tag'];
    const rows = feedProducts.map(p => [
      p.sku || '',
      p.name || '',
      p.category || '',
      (p.price || 0).toFixed(2),
      (p.margin_percentage || 0).toFixed(1),
      p.stock_level || 0,
      p.stock_capacity || 0,
      getStockAgeDays(p),
      p.composite_score || 0,
      p.priority_tag || ''
    ]);

    const brand = safeBrandName(currentBrand?.name);
    const date = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csvContent = [
        ['Brand', currentBrand?.name || '—'].join(','),
        ['Generated', date].join(','),
        ['Scenario', selectedScenario || '—'].join(','),
        '',
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${brand}_product_feed_${selectedScenario}_${date}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Product feed downloaded successfully');
    } else if (format === 'xlsx') {
      try {
        const XLSX = await import('xlsx');
        const metaRows = [['Brand', currentBrand?.name || '—'], ['Generated', date], ['Scenario', selectedScenario || '—'], [''], headers];
        const ws = XLSX.utils.aoa_to_sheet([...metaRows, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Products');
        XLSX.writeFile(wb, `${brand}_product_feed_${selectedScenario}_${date}.xlsx`);
        toast.success('Product feed downloaded successfully');
      } catch (error) {
        console.error('Excel export error:', error);
        toast.error('Σφάλμα κατά την εξαγωγή Excel. Δοκιμάστε CSV.');
      }
    }
    
    setShowFeedFormatModal(false);
  };

  // AI-powered channel recommendations (fallback to static on error/disabled)
  const {
    currentRecommendations,
    isLoading: aiRecLoading,
    error: aiRecError,
    aiEnabled,
    toggleAI,
    isAIGenerated
  } = useAIChannelRecommendations({
    selectedScenarioId: selectedScenario,
    segments: rfmSegments,
    selectedSegmentId: selectedSegment,
    useAI: true
  });

  // Load saved strategy from Firestore on mount/refresh
  useEffect(() => {
    if (!strategyLoading && activeStrategy) {
      setSelectedScenario(activeStrategy.scenarioId);
      setWeights(activeStrategy.weights);
      setApprovalStatus(activeStrategy.approvalStatus);
    }
  }, [activeStrategy?.id, strategyLoading]);

  // NO auto-save default strategy - user must select and save manually


  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between max-w-full overflow-x-hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight">
            Strategy Weights Configurator
          </h2>
          <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
            Προσαρμογή παραγόντων προτεραιοποίησης προϊόντων για τα marketing campaigns σας
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip content="Συγκρίνετε δύο στρατηγικές: weights, Top N προϊόντα (τα N με τα υψηλότερα scores), revenue/margin, αλλαγές θέσης.">
            <Button
              variant="secondary"
              size="sm"
              icon={<GitCompare size={16} />}
              onClick={() => setShowCompareModal(true)}
              className="!border-[var(--nts-accent)]/50 hover:!border-[var(--nts-accent)]"
            >
              Σύγκριση
            </Button>
          </Tooltip>
          <ApprovalWorkflow
            status={approvalStatus}
            onStatusChange={setApprovalStatus}
          />
        </div>
      </div>

      {/* Scenario Selector */}
      <ScenarioSelector
        selectedScenario={selectedScenario}
        onScenarioChange={handleScenarioChange}
      />

      {/* Custom Tools - when Custom is selected */}
      {selectedScenario === 'custom' && (
        <Card padding="lg" className="border-l-4 border-l-[#8B5CF6]">
          <CardHeader
            title="Custom Tools"
            subtitle="Clone, αποθήκευση presets, σύγκριση, export/import"
          />
          <CustomToolsCard
            weights={weights}
            onWeightsChange={setWeights}
            onCompareClick={() => setShowCompareModal(true)}
          />
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-full overflow-x-hidden">
        {/* Weight Sliders */}
        <Card className="xl:col-span-1" padding="lg">
          <CardHeader
            title="Factor Weights"
            subtitle={`Σύνολο: ${totalWeight}%`}
            action={
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={14} />}
                onClick={handleReset}
              >
                Reset
              </Button>
            }
          />

          {totalWeight !== 100 && (
            <div className="mb-4 p-3 bg-[#FEF3C7] border border-[#F59E0B] rounded-lg flex items-center gap-2">
              <AlertCircle size={16} className="text-[#F59E0B]" />
              <span className="text-sm text-[#92400E]">
                Weights must equal 100% (currently {totalWeight}%)
              </span>
            </div>
          )}

          <div className="space-y-6">
            {weightFactors.map((factor) => (
              <Slider
                key={factor.id}
                id={factor.id}
                label={factor.name}
                value={weights[factor.id]}
                onChange={(value) => handleWeightChange(factor.id, value)}
                color={factor.color}
                icon={
                  factor.id === 'profit' ? <Euro size={16} /> :
                  factor.id === 'stock' ? <Package size={16} /> :
                  factor.id === 'strategic' ? <Target size={16} /> :
                  factor.id === 'revenue' ? <TrendingUp size={16} /> :
                  <Users size={16} />
                }
                tooltip={factor.tooltip}
                disabled={approvalStatus === 'approved' || approvalStatus === 'implementing'}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-6 pt-6 border-t border-[var(--nts-border-gray)] space-y-2">
            <Button
              variant="primary"
              className="w-full"
              icon={<Send size={16} />}
              disabled={totalWeight !== 100 || approvalStatus !== 'draft'}
              onClick={() => setApprovalStatus('pending_review')}
            >
              Send for Review
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              icon={<Eye size={16} />}
              disabled={!selectedScenario}
              onClick={() => {
                if (!selectedScenario) return;
                // Show preview comparing current strategy with first alternative
                const otherScenarios = scenarios.filter(s => s.id !== selectedScenario && s.id !== 'custom');
                if (otherScenarios.length > 0) {
                  setPreviewTargetScenario(otherScenarios[0].id);
                  setShowImpactPreview(true);
                } else {
                  // No alternatives, just show current state
                  setPreviewTargetScenario(null);
                  setShowImpactPreview(true);
                }
              }}
            >
              Preview Impact
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              icon={<Download size={16} />}
              disabled={!selectedScenario || products.length === 0}
              onClick={() => setShowFeedFormatModal(true)}
            >
              Generate Product Feed
            </Button>
          </div>
        </Card>

        {/* Live Preview */}
        <Card className="xl:col-span-2" padding="lg">
          <CardHeader
            title="Live Preview"
            subtitle={
              hasImported ? `Top 100 από ${products.length} εισαγόμενα προϊόντα (10 ανά σελίδα)` : 'Top 100 Προτεραιοποιημένα Προϊόντα (10 ανά σελίδα)'
            }
            icon={<Sparkles size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          {selectedScenario === 'custom' && (
            <p className="text-xs text-[#6B7280] mb-3 -mt-2">
              Προσαρμοσμένα weights – σύγκρινε scenarios ή αποθήκευσε preset για γρήγορη εναλλαγή.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                  {previewConfig.columns.map((col) => (
                    <th key={col.id} className={`pb-3 font-medium ${col.id === 'score' ? 'text-right' : ''}`}>
                      {col.tooltip ? (
                        <Tooltip content={col.tooltip}>
                          <span>{col.label}</span>
                        </Tooltip>
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {paginatedPreviewProducts.map((product, index) => (
                    <motion.tr
                      key={product.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-b border-[#E5E5E5] last:border-0"
                    >
                      {previewConfig.columns.map((col) => (
                        <PreviewCell
                          key={col.id}
                          columnId={col.id}
                          product={product}
                          rank={(currentPreviewPage - 1) * PREVIEW_PAGE_SIZE + index + 1}
                        />
                      ))}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {prioritizedProducts.length > PREVIEW_PAGE_SIZE && (
            <div className="mt-4 pt-4 border-t border-[#E5E5E5] flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#4A4A4A]">
                Εμφανίζονται {(currentPreviewPage - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(currentPreviewPage * PREVIEW_PAGE_SIZE, prioritizedProducts.length)} από {prioritizedProducts.length} προϊόντα
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ChevronLeft size={16} />}
                  onClick={() => setCurrentPreviewPage((p) => Math.max(1, p - 1))}
                  disabled={currentPreviewPage <= 1}
                >
                  Προηγούμενα
                </Button>
                <span className="text-sm text-[#4A4A4A] px-2">
                  Σελίδα {currentPreviewPage} από {previewTotalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ChevronRight size={16} />}
                  iconPosition="right"
                  onClick={() => setCurrentPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                  disabled={currentPreviewPage >= previewTotalPages}
                >
                  Επόμενα
                </Button>
              </div>
            </div>
          )}

          {/* Impact Summary */}
          <div className="mt-6 p-4 bg-[#F5F5F5] rounded-lg grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[#4A4A4A]">Affected Categories</p>
              <p className="text-lg font-bold text-[#1A1A1A]">
                {new Set(prioritizedProducts.map((p) => p.category)).size}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#4A4A4A]">Avg Score</p>
              <p className="text-lg font-bold text-[#1A1A1A] font-mono">
                {prioritizedProducts.length > 0
                  ? (
                      prioritizedProducts.reduce((sum, p) => sum + (p.composite_score || 0), 0) /
                      prioritizedProducts.length
                    ).toFixed(1)
                  : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#4A4A4A]">
                {selectedScenario === 'stock_clearance'
                  ? 'With Excess Stock'
                  : selectedScenario === 'brand_launch'
                  ? 'With Priority Tag'
                  : 'High Margin'}
              </p>
              <p className="text-lg font-bold text-[#22C55E]">
                {selectedScenario === 'stock_clearance'
                  ? prioritizedProducts.filter(
                      (p) => ((p.stock_level ?? 0) / (p.stock_capacity || 1)) > 1
                    ).length
                  : selectedScenario === 'brand_launch'
                  ? prioritizedProducts.filter((p) => !!p.priority_tag).length
                  : prioritizedProducts.filter((p) => p.margin_tier === 'high').length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Channel Recommendations */}
      <Card padding="lg">
        <CardHeader
          title="Channel Recommendations"
          subtitle={
            aiEnabled
              ? isAIGenerated
                ? 'AI-generated channel mix βάσει στρατηγικής + segment'
                : aiRecLoading
                ? 'AI δημιουργεί συστάσεις…'
                : 'AI-powered channel mix βάσει επιλεγμένης στρατηγικής'
              : 'Στατικές συστάσεις (rule-based)'
          }
          icon={<Sparkles size={18} className="text-[var(--nts-medium-gray)]" />}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAI}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  aiEnabled ? 'bg-[var(--nts-accent)]/20 text-[var(--nts-accent)]' : 'bg-[#F5F5F5] text-[#4A4A4A]'
                }`}
                title={aiEnabled ? 'AI ενεργό – κλικ για στατικές' : 'AI απενεργοποιημένο – κλικ για AI'}
              >
                {aiEnabled ? 'AI ON' : 'AI OFF'}
              </button>
              {rfmSegments.slice(0, 4).map((segment) => (
                <button
                  key={segment.id}
                  onClick={() => setSelectedSegment(segment.id)}
                  className={`
                    px-3 py-1.5 rounded-full text-xs font-medium transition-all
                    ${selectedSegment === segment.id
                      ? 'text-white'
                      : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
                    }
                  `}
                  style={{
                    backgroundColor: selectedSegment === segment.id ? segment.color : undefined
                  }}
                >
                  {segment.name}
                </button>
              ))}
            </div>
          }
        />

        {aiRecError && (
          <p className="text-xs text-amber-600 mb-2">
            AI απέτυχε – εμφανίζονται στατικές συστάσεις. Ενεργοποίησε Vertex AI στο Firebase Console.
          </p>
        )}
        {aiRecLoading ? (
          <div className="flex items-center gap-3 p-6">
            <Spinner size="md" />
            <span className="text-sm text-[#4A4A4A]">Δημιουργία AI συστάσεων για {rfmSegments.find((s) => s.id === selectedSegment)?.name ?? selectedSegment}…</span>
          </div>
        ) : (
          <ChannelRecommendations
            recommendations={currentRecommendations[selectedSegment] || currentRecommendations.champions}
            segment={rfmSegments.find((s) => s.id === selectedSegment) ?? rfmSegments[0] ?? null}
          />
        )}
      </Card>

      {/* Strategy Impact Preview Modal */}
      <StrategyImpactPreview
        isOpen={showImpactPreview}
        onClose={() => {
          setShowImpactPreview(false);
          setPendingScenarioChange(null);
          setPreviewTargetScenario(null);
        }}
        onConfirm={confirmStrategyChange}
        currentWeights={getCurrentWeights()}
        newWeights={
          pendingScenarioChange 
            ? getWeightsForScenario(pendingScenarioChange) 
            : previewTargetScenario 
              ? getWeightsForScenario(previewTargetScenario)
              : selectedScenario ? getWeightsForScenario(selectedScenario) : defaultWeights
        }
        currentScenarioId={selectedScenario || undefined}
        newScenarioId={pendingScenarioChange || previewTargetScenario || selectedScenario || undefined}
      />

      {/* Compare Scenarios Modal */}
      <CompareScenariosModal
        isOpen={showCompareModal}
        onClose={() => setShowCompareModal(false)}
        products={products}
        getWeightsForScenario={getWeightsForScenario}
      />

      {/* Product Feed Format Modal */}
      <AnimatePresence>
        {showFeedFormatModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowFeedFormatModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1A1A1A]">Generate Product Feed</h2>
                <button
                  onClick={() => setShowFeedFormatModal(false)}
                  className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[#4A4A4A]" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-3">
                <p className="text-sm text-[#4A4A4A] mb-4">
                  Generate feed με <strong>{allPrioritizedProducts.length}</strong> προϊόντα ταξινομημένα βάσει της τρέχουσας strategy
                </p>

                <button
                  onClick={() => generateProductFeed('xlsx')}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#22C55E]/10 rounded-lg group-hover:bg-[#22C55E]/20 transition-colors">
                    <FileSpreadsheet size={24} className="text-[#22C55E]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">Excel (.xlsx)</h3>
                    <p className="text-xs text-[#4A4A4A]">Download as Excel file</p>
                  </div>
                </button>

                <button
                  onClick={() => generateProductFeed('csv')}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#3B82F6]/10 rounded-lg group-hover:bg-[#3B82F6]/20 transition-colors">
                    <FileText size={24} className="text-[#3B82F6]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">CSV (.csv)</h3>
                    <p className="text-xs text-[#4A4A4A]">Download as CSV file</p>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end">
                <Button 
                  variant="ghost" 
                  onClick={() => setShowFeedFormatModal(false)}
                >
                  Ακύρωση
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
