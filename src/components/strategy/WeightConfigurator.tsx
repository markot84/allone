import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Download,
  Sparkles,
  AlertCircle,
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
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, Button, Slider, Badge, Spinner } from '../common';
import { ScenarioSelector } from './ScenarioSelector';
import { ChannelRecommendations } from './ChannelRecommendations';
import { StrategyPackage } from './StrategyPackage';
import { StrategyImpactSummary, StrategyImpactModal } from './StrategyImpactPreview';
import { SeasonalDiscountPanel, type SeasonalDiscountConfig } from './SeasonalDiscountPanel';
import { CustomToolsCard } from './CustomToolsCard';
import { CompareScenariosModal } from './CompareScenariosModal';
import { MixedStrategyPanel, type MixConfig, computeBlendedWeights } from './MixedStrategyPanel';
import { SeasonalBanner } from './SeasonalBanner';
import { SeasonalPeriodsModal } from './SeasonalPeriodsModal';
import { useProducts, useSegments, useBrand } from '../../hooks';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useAuth } from '../../hooks';
import {
  scenarios,
  defaultWeights,
  weightFactors
} from '../../data';
import { useAIChannelRecommendations } from '../../hooks/useAIChannelRecommendations';
import { generateChannelRecommendations } from '../../services/aiChannelRecommendations';
import { generateContentSuggestions } from '../../services/aiContentSuggestions';
import { FirestoreService } from '../../services/firestore';
import { getPreviewConfig, type PreviewColumnId } from '../../data/strategyPreviewConfig';
import { calculateCompositeScore } from '../../utils/compositeScore';
import { getStockAgeDays } from '../../utils/productUtils';
import { rankSegments, type ScoredSegment } from '../../utils/segmentRelevance';
import { safeBrandName } from '../../services/reportExport';
import { useToast } from '../common/Toast';
import { Tooltip } from '../common';
import type { SeasonalPeriod } from '../../data/seasonalPeriods';
import type { Product } from '../../types';


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
        <td className="py-2 pr-1 w-8">
          <span className="w-5 h-5 rounded-full bg-[#F5F5F5] flex items-center justify-center text-[10px] font-medium">
            {rank}
          </span>
        </td>
      );
    case 'product':
      return (
        <td className="py-2 pr-2 max-w-0">
          <p className="text-xs font-medium text-[#1A1A1A] truncate">{product.name}</p>
          <p className="text-[10px] text-[#9CA3AF] truncate">{product.sku}</p>
        </td>
      );
    case 'category':
      return (
        <td className="py-2 pr-2 hidden lg:table-cell">
          <span className="text-xs text-[#4A4A4A] truncate block max-w-[100px]">{product.category}</span>
        </td>
      );
    case 'margin': {
      // Use file/stored margin when available; otherwise compute live from price & cost_price
      const storedMargin = product.margin_percentage ?? 0;
      const costPrice = product.cost_price ?? 0;
      const liveMargin =
        storedMargin > 0
          ? storedMargin
          : product.price > 0 && costPrice > 0
          ? Math.round(((product.price - costPrice) / product.price) * 1000) / 10
          : 0;
      const liveTier: 'high' | 'medium' | 'low' =
        storedMargin > 0
          ? product.margin_tier
          : liveMargin > 25 ? 'high' : liveMargin > 10 ? 'medium' : 'low';
      return (
        <td className="py-2 pr-2 w-16">
          <Badge
            variant={liveTier === 'high' ? 'success' : liveTier === 'medium' ? 'warning' : 'danger'}
            size="sm"
          >
            {liveMargin.toFixed(0)}%
          </Badge>
        </td>
      );
    }
    case 'stock':
      return (
        <td className="py-2 pr-2 w-20 hidden sm:table-cell">
          <div className="flex items-center gap-1.5">
            <div className="w-10 h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden shrink-0">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(ratio * 100, 100)}%`,
                  backgroundColor: ratio > 0.8 ? '#EF4444' : ratio > 0.5 ? '#F59E0B' : '#22C55E',
                }}
              />
            </div>
            <span className="text-[10px] text-[#4A4A4A] font-mono">{product.stock_level ?? 0}</span>
          </div>
        </td>
      );
    case 'stock_age':
      return (
        <td className="py-2 pr-2 w-16 hidden md:table-cell">
          <span className="text-xs text-[#4A4A4A]">{product.stock_age_days ?? 0}d</span>
        </td>
      );
    case 'excess_pct': {
      const excess = Math.max(0, (product.stock_level ?? 0) - cap);
      const pct = cap > 0 ? ((excess / cap) * 100).toFixed(0) : '0';
      return (
        <td className="py-2 pr-2 w-14 hidden md:table-cell">
          <span className="text-xs font-medium text-[#4A4A4A]">{pct}%</span>
        </td>
      );
    }
    case 'priority_tag':
      return (
        <td className="py-2 pr-2 w-20 hidden md:table-cell">
          <Badge variant="default" size="sm">
            {product.priority_tag ?? '-'}
          </Badge>
        </td>
      );
    case 'revenue_potential': {
      const val = (product.price ?? 0) * (product.stock_level ?? 0);
      const fmt = val >= 1000 ? `€${(val / 1000).toFixed(1)}K` : `€${val.toFixed(0)}`;
      return (
        <td className="py-2 pr-2 w-16 hidden sm:table-cell">
          <span className="text-xs font-mono text-[#1A1A1A]">{fmt}</span>
        </td>
      );
    }
    case 'score':
      return (
        <td className={`py-2 w-14 ${alignRight}`}>
          <motion.span
            key={product.composite_score}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="text-sm font-bold text-[var(--nts-accent)] font-mono"
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
  const [strategySaveVersion, setStrategySaveVersion] = useState(0);
  const queryClient = useQueryClient();
  
  // Initialize from active strategy if available, otherwise no default
  const [selectedScenario, setSelectedScenario] = useState<string | null>(() => {
    if (activeStrategy) return activeStrategy.scenarioId;
    return null; // No default scenario - user must select
  });
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    if (activeStrategy) return activeStrategy.weights;
    return defaultWeights; // Empty weights, user must select scenario
  });
  const [duration, setDuration] = useState<number | 'ongoing'>(() => {
    if (activeStrategy?.duration !== undefined) return activeStrategy.duration;
    const s = scenarios.find(sc => sc.id === activeStrategy?.scenarioId);
    return s?.duration ?? 'ongoing';
  });

  const [selectedSegment, setSelectedSegment] = useState('');
  const [mixConfig, setMixConfig] = useState<MixConfig | null>(() => {
    return (activeStrategy as any)?.mixConfig ?? null;
  });

  const currentScenarioWeights = useMemo(() => {
    if (selectedScenario === 'mixed' && mixConfig?.scenarioA && mixConfig?.scenarioB) {
      return computeBlendedWeights(mixConfig.scenarioA, mixConfig.scenarioB, mixConfig.percentA);
    }
    if (!selectedScenario || selectedScenario === 'custom') return weights;
    const sc = scenarios.find(s => s.id === selectedScenario);
    return sc?.weights ?? weights;
  }, [selectedScenario, weights, mixConfig]);

  const rankedSegments = useMemo(
    () => rankSegments(rfmSegments, currentScenarioWeights),
    [rfmSegments, currentScenarioWeights]
  );

  const segmentFitMap = useMemo(() => {
    const map: Record<string, ScoredSegment> = {};
    for (const rs of rankedSegments) map[rs.segment.id] = rs;
    return map;
  }, [rankedSegments]);

  useEffect(() => {
    if (rankedSegments.length > 0 && (!selectedSegment || !rankedSegments.some(rs => rs.segment.id === selectedSegment))) {
      setSelectedSegment(rankedSegments[0].segment.id);
    }
  }, [rankedSegments, selectedSegment]);

  const prevScenarioRef = useRef(selectedScenario);
  useEffect(() => {
    if (selectedScenario !== prevScenarioRef.current) {
      prevScenarioRef.current = selectedScenario;
      if (rankedSegments.length > 0) {
        setSelectedSegment(rankedSegments[0].segment.id);
      }
    }
  }, [selectedScenario, rankedSegments]);

  const [pendingScenarioChange, setPendingScenarioChange] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showFeedFormatModal, setShowFeedFormatModal] = useState(false);
  const [showSeasonalModal, setShowSeasonalModal] = useState(false);
  const [mixPanelOpen, setMixPanelOpen] = useState(() => {
    return !((activeStrategy as any)?.mixConfig && activeStrategy?.scenarioId === 'mixed');
  });
  const [seasonalDiscountConfig, setSeasonalDiscountConfig] = useState<SeasonalDiscountConfig | null>(null);
  const [seasonalPanelOpen, setSeasonalPanelOpen] = useState(false);
  const [customSeasons, setCustomSeasons] = useState<SeasonalPeriod[]>(() => {
    try {
      const raw = localStorage.getItem('perf-plus-custom-seasons');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const PREVIEW_PAGE_SIZE = 10;

  // Refs must be declared before other hooks
  const debounceTimerRef = useRef<number | null>(null);
  
  // Debounced weights for expensive calculations
  const [debouncedWeights, setDebouncedWeights] = useState(weights);

  const getWeightsForScenario = useCallback((scenarioId: string | null) => {
    if (!scenarioId || scenarioId === 'custom') return weights;
    if (scenarioId === 'mixed' || scenarioId === 'seasonal_discount') return weights;
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

  // Apply the scenario change and SAVE it
  // Generate activation + content AI and save directly to Firestore (called after strategy save)
  const triggerAIGeneration = useCallback(async (savedStrategyId: string, scenarioId: string, strategyWeights: Record<string, number>) => {
    const segment = rfmSegments.find(s => s.id === selectedSegment) ?? rfmSegments[0];
    const scenarioObj = scenarios.find(s => s.id === scenarioId) ?? scenarios[0];
    const topCats = [...new Set(products.map(p => p.category).filter(Boolean))].slice(0, 5);
    const segmentNames = rfmSegments.map(s => s.name || s.id).slice(0, 6);
    const scenarioName = scenarioObj?.name || scenarioId;

    const saveField = async (field: string, value: unknown) => {
      const clean = JSON.parse(JSON.stringify(value));
      await FirestoreService.setDocument('active_strategies', savedStrategyId, {
        [field]: clean,
        updatedAt: new Date().toISOString(),
      } as Record<string, unknown>);
    };

    const promises: Promise<void>[] = [];

    if (segment && scenarioObj) {
      promises.push(
        generateChannelRecommendations({
          scenario: scenarioObj, segment,
          fitLevel: segmentFitMap[selectedSegment]?.fit ?? 'good',
          brandContext: currentBrand ? { brandName: currentBrand.name, brandType: currentBrand.type, topCategories: topCats } : undefined,
          segmentFitList: rankedSegments.map(rs => ({ name: rs.segment.name, fit: rs.fit, description: rs.segment.description, count: rs.segment.count, revenueShare: rs.segment.revenue_share })),
          context: 'activation',
        }).then(rec => { if (rec) return saveField('activationRecommendation', rec); })
          .catch(err => console.error('[AI] Activation failed:', err))
      );
    }

    promises.push(
      generateContentSuggestions({
        scenarioId, scenarioName, weights: strategyWeights, brandName: currentBrand?.name, topCategories: topCats, segmentNames,
      }).then(result => { if (result) return saveField('contentSuggestions', result); })
        .catch(err => console.error('[AI] Content failed:', err))
    );

    await Promise.allSettled(promises);
    queryClient.invalidateQueries({ queryKey: ['activeStrategy'] });
  }, [rfmSegments, selectedSegment, products, currentBrand, rankedSegments, segmentFitMap, queryClient]);

  const applyScenarioChange = useCallback((scenarioId: string, overrideDuration?: number | 'ongoing') => {
    setSelectedScenario(scenarioId);

    if (scenarioId === 'mixed' || scenarioId === 'seasonal_discount') {
      setPendingScenarioChange(null);
      setShowDetailModal(false);
      if (scenarioId === 'seasonal_discount') {
        const scenario = scenarios.find((s) => s.id === scenarioId);
        setDuration(overrideDuration ?? scenario?.duration ?? 30);
      }
      return;
    }

    setMixConfig(null);
    const scenario = scenarios.find((s) => s.id === scenarioId);
    const newWeights = scenario?.weights || defaultWeights;
    const saveDuration = overrideDuration ?? scenario?.duration ?? 'ongoing';
    setWeights(newWeights);
    setDuration(saveDuration);
    setPendingScenarioChange(null);
    setShowDetailModal(false);
    
    if (!user) {
      toast.error('Πρέπει να είσαι συνδεδεμένος');
      return;
    }
    
    const scenarioName = scenario?.name || (scenarioId === 'custom' ? 'Custom' : 'Unknown');
    
    saveActiveStrategy({
      scenarioId: scenarioId,
      weights: newWeights,
      duration: saveDuration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
    }).then((saved) => {
      toast.success(`Στρατηγική "${scenarioName}" αποθηκεύτηκε`);
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, scenarioId, newWeights);
    }).catch((error) => {
      console.error('Error saving strategy:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, saveActiveStrategy, toast, triggerAIGeneration]);

  const handleMixedApply = useCallback((blendedWeights: Record<string, number>, config: MixConfig) => {
    setMixConfig(config);
    setWeights(blendedWeights);
    setMixPanelOpen(false);

    if (!user) {
      toast.error('Πρέπει να είσαι συνδεδεμένος');
      return;
    }

    const nameA = scenarios.find(s => s.id === config.scenarioA)?.name ?? config.scenarioA;
    const nameB = scenarios.find(s => s.id === config.scenarioB)?.name ?? config.scenarioB;

    saveActiveStrategy({
      scenarioId: 'mixed',
      weights: blendedWeights,
      duration: duration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
      mixConfig: config,
    } as any).then((saved) => {
      toast.success(`Μικτή στρατηγική "${nameA} ${config.percentA}% / ${nameB} ${config.percentB}%" αποθηκεύτηκε`);
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, 'mixed', blendedWeights);
    }).catch((error) => {
      console.error('Error saving mixed strategy:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, saveActiveStrategy, toast, duration, triggerAIGeneration]);

  const handleSeasonApply = useCallback((period: SeasonalPeriod) => {
    const mix = period.suggestedMix;
    const blended = computeBlendedWeights(mix.scenarioA, mix.scenarioB, mix.percentA);
    const config: MixConfig = {
      scenarioA: mix.scenarioA,
      scenarioB: mix.scenarioB,
      percentA: mix.percentA,
      percentB: 100 - mix.percentA,
    };
    setSelectedScenario('mixed');
    setMixConfig(config);
    setWeights(blended);

    if (!user) return;
    saveActiveStrategy({
      scenarioId: 'mixed',
      weights: blended,
      duration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
      mixConfig: config,
    } as any).then((saved) => {
      toast.success(`Εποχιακή στρατηγική "${period.name}" εφαρμόστηκε`);
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, 'mixed', blended);
    }).catch(() => {});
  }, [user, saveActiveStrategy, toast, duration, triggerAIGeneration]);

  const handleSeasonalDiscountApply = useCallback((config: SeasonalDiscountConfig) => {
    setSeasonalDiscountConfig(config);
    setSeasonalPanelOpen(false);
    toast.success(`Εκπτωτική περίοδος "${config.periodName}" (-${config.discountPercent}%) εφαρμόστηκε`);

    if (!user) return;
    saveActiveStrategy({
      scenarioId: 'seasonal_discount',
      weights,
      duration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
      seasonalDiscount: config,
    } as any).then((saved) => {
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, 'seasonal_discount', weights);
    }).catch(() => {});
  }, [user, saveActiveStrategy, toast, weights, duration, triggerAIGeneration]);


  const handleSaveCustomSeason = useCallback((period: SeasonalPeriod) => {
    setCustomSeasons(prev => {
      const updated = [...prev, period];
      localStorage.setItem('perf-plus-custom-seasons', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleDeleteCustomSeason = useCallback((id: string) => {
    setCustomSeasons(prev => {
      const updated = prev.filter(p => p.id !== id);
      localStorage.setItem('perf-plus-custom-seasons', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Handle scenario change with impact preview — show preview first, apply only on confirm
  const handleScenarioChange = useCallback((scenarioId: string) => {
    if (scenarioId === selectedScenario) {
      if (scenarioId === 'mixed') setMixPanelOpen(p => !p);
      if (scenarioId === 'seasonal_discount') setSeasonalPanelOpen(p => !p);
      return;
    }

    if (scenarioId === 'mixed') {
      setMixPanelOpen(true);
      setSeasonalPanelOpen(false);
      applyScenarioChange('mixed');
      return;
    }

    if (scenarioId === 'seasonal_discount') {
      setSeasonalPanelOpen(true);
      setMixPanelOpen(false);
      applyScenarioChange('seasonal_discount');
      return;
    }
    
    setMixPanelOpen(false);
    setSeasonalPanelOpen(false);
    setPendingScenarioChange(scenarioId);
  }, [selectedScenario, applyScenarioChange]);

  // Confirm strategy change after impact preview
  const confirmStrategyChange = useCallback((selectedDuration: number | 'ongoing') => {
    if (pendingScenarioChange) {
      applyScenarioChange(pendingScenarioChange, selectedDuration);
      setDuration(selectedDuration);
      setPendingScenarioChange(null);
      setShowDetailModal(false);
    }
  }, [pendingScenarioChange, applyScenarioChange]);

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

  // AI channel recommendations — only triggered after strategy save (strategySaveVersion > 0)
  const {
    recommendation: freshAiRec,
    aiOnlyResult,
    isLoading: aiRecLoading,
    error: aiRecError,
    aiEnabled,
    toggleAI,
    isAIGenerated
  } = useAIChannelRecommendations({
    selectedScenarioId: strategySaveVersion > 0 ? selectedScenario : null,
    segments: rfmSegments,
    selectedSegmentId: selectedSegment,
    fitLevel: segmentFitMap[selectedSegment]?.fit ?? 'good',
    mixConfig: selectedScenario === 'mixed' && mixConfig ? mixConfig : undefined,
    brandContext: currentBrand ? {
      brandName: currentBrand.name,
      brandType: currentBrand.type,
      topCategories: [...new Set(products.map(p => p.category).filter(Boolean))].slice(0, 5),
    } : null,
    segmentFitList: rankedSegments.map(rs => ({
      name: rs.segment.name,
      fit: rs.fit,
      description: rs.segment.description,
      count: rs.segment.count,
      revenueShare: rs.segment.revenue_share,
    })),
    useAI: true,
    saveVersion: strategySaveVersion,
  });

  // On load: show saved recommendation. After save: show AI-only result (no static fallback), loading while pending.
  const aiRecommendation = strategySaveVersion > 0
    ? (aiOnlyResult ?? null)
    : (activeStrategy?.channelRecommendation ?? freshAiRec);

  // Save AI-generated strategy recommendation when ready
  useEffect(() => {
    if (!aiOnlyResult || !isAIGenerated || strategySaveVersion === 0 || !activeStrategy?.id || activeStrategy.id.startsWith('default_')) return;
    const strategyId = activeStrategy.id;
    const clean = JSON.parse(JSON.stringify(aiOnlyResult));
    FirestoreService.setDocument('active_strategies', strategyId, {
      channelRecommendation: clean,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>).then(() => {
      queryClient.invalidateQueries({ queryKey: ['activeStrategy'] });
    }).catch(err => console.error('[WeightConfigurator] Save strategy rec failed:', err));
  }, [aiOnlyResult, isAIGenerated, strategySaveVersion, activeStrategy?.id]);

  // After strategy save: generate activation + content AI (directly to Firestore, no mutation closures)

  // Load saved strategy from Firestore on mount/refresh
  useEffect(() => {
    if (!strategyLoading && activeStrategy) {
      setSelectedScenario(activeStrategy.scenarioId);
      setWeights(activeStrategy.weights);
      if (activeStrategy.duration !== undefined) {
        setDuration(activeStrategy.duration);
      }
      const saved = (activeStrategy as any).mixConfig;
      if (activeStrategy.scenarioId === 'mixed' && saved) {
        setMixConfig(saved as MixConfig);
      } else {
        setMixConfig(null);
      }
    }
  }, [activeStrategy?.id, strategyLoading]);

  // NO auto-save default strategy - user must select and save manually


  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Page Header — 2 columns: left = text + package + tabs, right = preview image */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,minmax(280px,400px)] gap-6 lg:gap-8 items-start max-w-full overflow-x-hidden">
        {/* Left column: title, subtitle, strategy package, tabs */}
        <div className="min-w-0 space-y-4 flex flex-col">
          <div>
            <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight">
              Commercial Strategy
            </h2>
            <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
              Καθορισμός εμπορικών προτεραιοτήτων, κατανομή πόρων και συντονισμός εκτέλεσης
            </p>
          </div>

          {/* Strategy Package — share/copy active strategy */}
          {selectedScenario && selectedScenario !== 'custom' && (
            <StrategyPackage
              scenarioId={selectedScenario}
              weights={currentScenarioWeights}
              duration={duration}
              brandName={currentBrand?.name}
              rankedSegments={rankedSegments}
              channelRecommendation={aiRecommendation}
              mixConfig={mixConfig}
            />
          )}

          {/* Scenario Selector (tabs) */}
          <ScenarioSelector
            selectedScenario={selectedScenario}
            onScenarioChange={handleScenarioChange}
            activeDuration={duration}
          />
        </div>

      </div>

      {/* Strategy Expiry Warning */}
      {(() => {
        if (!activeStrategy?.duration || activeStrategy.duration === 'ongoing') return null;
        const dur = typeof activeStrategy.duration === 'string' ? parseInt(activeStrategy.duration, 10) : activeStrategy.duration;
        if (!dur || isNaN(dur)) return null;
        const raw = activeStrategy.updatedAt || activeStrategy.createdAt;
        const startMs = typeof raw === 'string' ? new Date(raw).getTime()
          : typeof (raw as any)?.toMillis === 'function' ? (raw as any).toMillis()
          : typeof (raw as any)?.seconds === 'number' ? (raw as any).seconds * 1000
          : NaN;
        if (isNaN(startMs)) return null;
        const end = new Date(startMs + dur * 86400000);
        const remaining = Math.ceil((end.getTime() - Date.now()) / 86400000);
        if (remaining > 3) return null;
        const expired = remaining <= 0;
        return (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-4 ${expired ? 'border-[#EF4444]/30 bg-[#EF4444]/5' : 'border-[#F59E0B]/30 bg-[#F59E0B]/5'}`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className={expired ? 'text-[#EF4444] mt-0.5' : 'text-[#F59E0B] mt-0.5'} />
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-semibold ${expired ? 'text-[#EF4444]' : 'text-[#F59E0B]'}`}>
                  {expired ? 'Η στρατηγική σας έχει λήξει' : `Η στρατηγική λήγει σε ${remaining} ${remaining === 1 ? 'ημέρα' : 'ημέρες'}`}
                </h4>
                <p className="text-xs text-[#4A4A4A] mt-1 leading-relaxed">
                  {expired
                    ? 'Η διάρκεια της τρέχουσας στρατηγικής έχει ολοκληρωθεί. Επιλέξτε νέα στρατηγική ή ανανεώστε την υπάρχουσα.'
                    : 'Ετοιμαστείτε για αλλαγή — ελέγξτε τα αποτελέσματα και αποφασίστε αν θα ανανεώσετε, προσαρμόσετε ή αλλάξετε στρατηγική.'
                  }
                </p>
              </div>
            </div>
          </motion.div>
        );
      })()}

      {/* Seasonal Banner */}
      <SeasonalBanner
        currentScenarioId={selectedScenario}
        currentMixConfig={mixConfig}
        onApplySeason={handleSeasonApply}
        onManageSeasons={() => setShowSeasonalModal(true)}
      />

      {/* Compare button below scenario cards */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCompareModal(true)}
          className="group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--nts-medium-gray)] hover:text-[var(--nts-accent)] border border-dashed border-[var(--nts-border-gray)] hover:border-[var(--nts-accent)] transition-all duration-200"
        >
          <GitCompare size={13} />
          <span>Σύγκριση στρατηγικών</span>
        </button>
      </div>

      {/* Inline Impact Summary — appears when selecting a new scenario */}
      <AnimatePresence>
        {pendingScenarioChange && (
          <StrategyImpactSummary
            currentWeights={getCurrentWeights()}
            newWeights={getWeightsForScenario(pendingScenarioChange)}
            currentScenarioId={selectedScenario || undefined}
            newScenarioId={pendingScenarioChange}
            onConfirm={confirmStrategyChange}
            onCancel={() => setPendingScenarioChange(null)}
            onDetails={() => setShowDetailModal(true)}
            initialDuration={scenarios.find(s => s.id === pendingScenarioChange)?.duration ?? duration}
          />
        )}
      </AnimatePresence>

      {/* Mixed Strategy Panel */}
      <AnimatePresence>
        {selectedScenario === 'mixed' && mixPanelOpen && (
          <MixedStrategyPanel
            onApply={handleMixedApply}
            onClose={() => setMixPanelOpen(false)}
            initialConfig={mixConfig}
          />
        )}
      </AnimatePresence>

      {/* Seasonal/Discount Panel */}
      <AnimatePresence>
        {selectedScenario === 'seasonal_discount' && seasonalPanelOpen && (
          <SeasonalDiscountPanel
            onApply={handleSeasonalDiscountApply}
            onClose={() => setSeasonalPanelOpen(false)}
            initialConfig={seasonalDiscountConfig}
          />
        )}
      </AnimatePresence>
      {/* Duration is now inside the impact summary popup */}

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
            title="Priority Weights"
            subtitle={`Commercial Strategy · Σύνολο: ${totalWeight}%`}
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
                disabled={false}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-6 pt-6 border-t border-[var(--nts-border-gray)] space-y-2">
            {/* Preview Impact removed — inline summary replaces it */}
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

          <div className="-mx-2">
            <table className="w-full table-fixed">
              <thead>
                <tr className="text-left text-[11px] text-[#4A4A4A] border-b border-[#E5E5E5]">
                  {previewConfig.columns.map((col) => {
                    const hiddenClass =
                      col.id === 'category' ? 'hidden lg:table-cell' :
                      col.id === 'stock' || col.id === 'revenue_potential' ? 'hidden sm:table-cell' :
                      col.id === 'stock_age' || col.id === 'excess_pct' || col.id === 'priority_tag' ? 'hidden md:table-cell' :
                      '';
                    const widthClass =
                      col.id === 'rank' ? 'w-8' :
                      col.id === 'score' ? 'w-14' :
                      col.id === 'margin' ? 'w-16' :
                      col.id === 'stock' ? 'w-20' :
                      col.id === 'stock_age' || col.id === 'revenue_potential' ? 'w-16' :
                      col.id === 'excess_pct' ? 'w-14' :
                      col.id === 'priority_tag' ? 'w-20' :
                      col.id === 'category' ? 'w-24' :
                      '';
                    return (
                      <th key={col.id} className={`pb-2 font-medium ${col.id === 'score' ? 'text-right' : ''} ${hiddenClass} ${widthClass}`}>
                        {col.tooltip ? (
                          <Tooltip content={col.tooltip}>
                            <span>{col.label}</span>
                          </Tooltip>
                        ) : (
                          col.label
                        )}
                      </th>
                    );
                  })}
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
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={toggleAI}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
                style={{
                  background: aiEnabled
                    ? '#1a1a1a'
                    : '#E5E5E5',
                  color: aiEnabled ? '#fff' : '#888',
                  boxShadow: aiEnabled ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
                }}
                title={aiEnabled ? 'AI ενεργό – κλικ για απενεργοποίηση' : 'AI απενεργοποιημένο – κλικ για ενεργοποίηση'}
              >
                <Sparkles size={12} />
                {aiEnabled ? 'AI' : 'AI'}
                <span
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: aiEnabled ? '#4ade80' : '#aaa',
                    boxShadow: aiEnabled ? '0 0 4px #4ade80' : 'none',
                    flexShrink: 0,
                  }}
                />
              </button>
              {rankedSegments.map(({ segment, fit }) => {
                const isSelected = selectedSegment === segment.id;
                const isIdeal = fit === 'ideal';
                const isGood = fit === 'good';
                return (
                  <button
                    key={segment.id}
                    onClick={() => setSelectedSegment(segment.id)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap"
                    style={{
                      backgroundColor: isSelected
                        ? segment.color
                        : isIdeal
                          ? 'rgba(34,197,94,0.08)'
                          : '#F5F5F5',
                      color: isSelected
                        ? '#fff'
                        : isIdeal
                          ? '#4A4A4A'
                          : '#4A4A4A',
                      border: isIdeal && !isSelected
                        ? '1.5px solid rgba(34,197,94,0.5)'
                        : isGood && !isSelected
                          ? '1.5px dashed rgba(34,197,94,0.35)'
                          : '1.5px solid transparent',
                      opacity: fit === 'partial' ? 0.6 : 1,
                    }}
                    title={fit === 'ideal' ? 'Ιδανικό segment για αυτή τη στρατηγική' : fit === 'good' ? 'Καλό ταίριασμα' : 'Μερικό ταίριασμα'}
                  >
                    {isIdeal && !isSelected && <span style={{ marginRight: 4, fontSize: 10, color: '#22C55E' }}>★</span>}
                    {segment.name}
                  </button>
                );
              })}
            </div>
          }
        />

        {aiRecError && (
          <div className="text-xs text-amber-600 mb-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="font-medium">AI απέτυχε – εμφανίζονται στατικές συστάσεις.</p>
            <p className="mt-1 text-amber-500 break-all">{(aiRecError as Error)?.message || String(aiRecError)}</p>
          </div>
        )}
        {aiRecLoading ? (
          <div className="flex items-center gap-3 p-6">
            <Spinner size="md" />
            <span className="text-sm text-[#4A4A4A]">Δημιουργία AI συστάσεων για {rfmSegments.find((s) => s.id === selectedSegment)?.name ?? selectedSegment}…</span>
          </div>
        ) : (
          <ChannelRecommendations
            recommendations={aiRecommendation}
            segment={rfmSegments.find((s) => s.id === selectedSegment) ?? rfmSegments[0] ?? null}
          />
        )}
      </Card>

      {/* Strategy Impact Detail Modal */}
      {pendingScenarioChange && (
        <StrategyImpactModal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          onConfirm={confirmStrategyChange}
          currentWeights={getCurrentWeights()}
          newWeights={getWeightsForScenario(pendingScenarioChange)}
          currentScenarioId={selectedScenario || undefined}
          newScenarioId={pendingScenarioChange}
          currentDuration={duration}
          newDuration={scenarios.find(s => s.id === pendingScenarioChange)?.duration ?? 'ongoing'}
        />
      )}

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
                  <div className="p-3 bg-[#F5F5F5] rounded-lg group-hover:bg-[#E5E5E5] transition-colors">
                    <FileText size={24} className="text-[#4A4A4A]" />
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

      {/* Seasonal Periods Modal */}
      <SeasonalPeriodsModal
        isOpen={showSeasonalModal}
        onClose={() => setShowSeasonalModal(false)}
        onApply={(period) => {
          handleSeasonApply(period);
          setShowSeasonalModal(false);
        }}
        customPeriods={customSeasons}
        onSaveCustom={handleSaveCustomSeason}
        onDeleteCustom={handleDeleteCustomSeason}
      />
    </div>
  );
}
