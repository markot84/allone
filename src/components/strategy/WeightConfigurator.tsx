import { useState, useCallback, useMemo, useEffect, useRef, startTransition } from 'react';
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
  X,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, Button, Slider, Badge, PageHeader, ModalHeader, DataSourcePill } from '../common';
import { ScenarioSelector } from './ScenarioSelector';
import { TriageCard } from './TriageCard';
import { ProcurementStrategyBridge } from './ProcurementStrategyBridge';
import { StrategyPackage } from './StrategyPackage';
import { StrategyImpactModal } from './StrategyImpactPreview';
import { SalesBaseSetupModal } from './SalesBaseSetupModal';
import { PriceBenchmarkSetupModal } from './PriceBenchmarkSetupModal';
import { SeasonalDiscountPanel, type SeasonalDiscountConfig } from './SeasonalDiscountPanel';
import { CustomToolsCard } from './CustomToolsCard';
import { MixedStrategyPanel, type MixConfig, computeBlendedWeights } from './MixedStrategyPanel';
import { SeasonalBanner } from './SeasonalBanner';
import { SeasonalPeriodsModal } from './SeasonalPeriodsModal';
import { useProductSource } from '../../hooks/useProductSource';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { useProductSignals } from '../../hooks/useProductSignals';
import { buildTriagePromptContext, buildProvenancePromptContext } from '../../utils/aiPromptContext';
import { useSegments } from '../../hooks/useSegments';
import { useBrand } from '../../hooks/useBrand';
import { useActiveStrategy, type SeasonalProposal, type TriageOrigin } from '../../hooks/useActiveStrategy';
import { useAuth } from '../../hooks/useAuth';
import {
  scenarios,
  defaultWeights,
  weightFactors
} from '../../data';
import { generateChannelRecommendations } from '../../services/aiChannelRecommendations';
import { generateContentSuggestions } from '../../services/aiContentSuggestions';
import { FirestoreService } from '../../services/firestore';
import { BriefingDrawer } from '../coordination/BriefingDrawer';
import { getPreviewConfig, type PreviewColumnId } from '../../data/strategyPreviewConfig';
import { calculateCompositeScore, type CompositeScoreContext } from '../../utils/compositeScore';
import {
  filterProductsBySalesBaseScope,
  productParticipatesInSalesBase,
  salesMomentumLabel,
} from '../../utils/salesBaseScore';
import {
  buildBenchmarkLookup,
  filterProductsByPriceBenchmarkScope,
  findBenchmarkForProductInLookup,
  productInPriceBenchmarkScopeWithLookup,
} from '../../utils/priceBenchmarkStrategy';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useRefreshAggregates } from '../../hooks/useAggregates';
import { useProcurement } from '../../hooks/useProcurement';
import { getEffectiveStockLevel, getStockAgeDays } from '../../utils/productUtils';
import { rankSegments, type ScoredSegment } from '../../utils/segmentRelevance';
import { safeBrandName } from '../../services/reportExport';
import { exportStrategyPlan } from '../../services/segmentActionPack';
import { useToast } from '../common/Toast';
import { Tooltip } from '../common';
import type { SeasonalPeriod } from '../../data/seasonalPeriods';
import type { Product, PriceBenchmarkStrategyScope, SalesBaseScope } from '../../types';


const STRATEGY_PRODUCT_LIMIT = 5000;

const PreviewCell = memo(function PreviewCell({
  columnId,
  product,
  rank,
}: {
  columnId: PreviewColumnId;
  product: Product & { composite_score?: number };
  rank: number;
}) {
  const effectiveStock = getEffectiveStockLevel(product);
  const stockCapacity = Math.max(product.stock_capacity || 0, 1);
  const ratio = effectiveStock / Math.max(stockCapacity, effectiveStock, 1);
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
            <span className="text-[10px] text-[#4A4A4A] font-mono">{effectiveStock}</span>
          </div>
        </td>
      );
    case 'stock_age': {
      const d = getStockAgeDays(product);
      return (
        <td className="py-2 pr-2 w-16 hidden md:table-cell">
          <span className="text-xs text-[#4A4A4A]">{d < 0 ? '—' : `${d}d`}</span>
        </td>
      );
    }
    case 'excess_pct': {
      const excess = Math.max(0, effectiveStock - stockCapacity);
      const pct = stockCapacity > 0 ? ((excess / stockCapacity) * 100).toFixed(0) : '0';
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
      const val = (product.price ?? 0) * effectiveStock;
      const fmt = val >= 1000 ? `€${(val / 1000).toFixed(1)}K` : `€${val.toFixed(0)}`;
      return (
        <td className="py-2 pr-2 w-16 hidden sm:table-cell">
          <span className="text-xs font-mono text-[#1A1A1A]">{fmt}</span>
        </td>
      );
    }
    case 'sales_signal': {
      const label = salesMomentumLabel(product);
      const tone =
        label === 'Υψηλή' || label === 'Αυξημένη'
          ? 'text-amber-700 bg-amber-50'
          : label === 'Μέτρια'
            ? 'text-[#4A4A4A] bg-[#F3F4F6]'
            : 'text-emerald-800 bg-emerald-50';
      return (
        <td className="py-2 pr-2 w-20 hidden sm:table-cell">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tone}`}>{label}</span>
        </td>
      );
    }
    case 'benchmark_signal': {
      type PBench = Product & {
        __priceBenchmark?: { priceDiff: number; benchmarkPrice: number; yourPrice: number };
      };
      const bm = (product as PBench).__priceBenchmark;
      if (!bm || bm.benchmarkPrice <= 0) {
        return (
          <td className="py-2 pr-2 w-20 hidden sm:table-cell">
            <span className="text-[10px] text-[#9CA3AF]">—</span>
          </td>
        );
      }
      const tone =
        bm.priceDiff < -2
          ? 'text-emerald-800 bg-emerald-50'
          : bm.priceDiff > 2
            ? 'text-rose-800 bg-rose-50'
            : 'text-[#4A4A4A] bg-[#F3F4F6]';
      return (
        <td className="py-2 pr-2 w-24 hidden sm:table-cell">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tone}`}>
            {bm.priceDiff > 0 ? '+' : ''}
            {bm.priceDiff}%
          </span>
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

function getScenarioPendingLabel(scenarioId: string | null): string {
  return scenarioId === 'price_benchmark'
    ? 'Επιλεγμένη λειτουργία προς ενεργοποίηση'
    : 'Επιλεγμένη πολιτική προς ενεργοποίηση';
}

function getScenarioPendingHelpText(scenarioId: string | null): string {
  return scenarioId === 'price_benchmark'
    ? 'Έλεγξε πρώτα preview και φίλτρα. Το popup διάρκειας ανοίγει μόνο όταν πατήσεις συνέχεια.'
    : 'Έλεγξε πρώτα preview και ρυθμίσεις. Το popup διάρκειας ανοίγει μόνο όταν πατήσεις ενεργοποίηση.';
}

function getScenarioPendingActionText(scenarioId: string | null): string {
  return scenarioId === 'price_benchmark'
    ? 'Συνέχεια σε διάρκεια λειτουργίας'
    : 'Επιλογή διάρκειας & ενεργοποίηση';
}

export function WeightConfigurator() {
  const { currentBrand } = useBrand();
  const {
    products: sourceProducts,
    hasImported: sourceHasImported,
    usingProcurement,
    sourceLabel: sourceProductDataSourceLabel,
    sourceKind: sourceProductSourceKind,
  } = useProductSource({ maxProducts: STRATEGY_PRODUCT_LIMIT });
  const serverProductIntelligence = useProductIntelligenceAggregate('all', 1);
  const serverProducts = !usingProcurement ? (serverProductIntelligence.page?.products ?? []) : [];
  const products = serverProducts.length > 0 ? serverProducts : sourceProducts;
  const hasImported = sourceHasImported || !!serverProductIntelligence.aggregate;
  const productDataSourceLabel = serverProducts.length > 0
    ? serverProductIntelligence.aggregate?.sourceLabel ?? sourceProductDataSourceLabel
    : sourceProductDataSourceLabel;
  const productSourceKind = serverProducts.length > 0 ? 'erp' : sourceProductSourceKind;
  const productSourceCount = serverProductIntelligence.aggregate?.totalCount ?? products.length;

  const scenarioErpHints = useMemo(() => {
    if (!usingProcurement || products.length === 0) return undefined;
    const deadN = products.filter((p) => p.priority_tag === 'dead').length;
    const excessN = products.filter((p) => p.priority_tag === 'excess').length;
    const h: Record<string, string> = {};
    if (deadN > 0 || excessN > 0) {
      const scName = scenarios.find((s) => s.id === 'stock_clearance')?.name ?? 'Stock Clearance';
      const parts: string[] = [];
      if (deadN > 0) parts.push(`${deadN.toLocaleString('el-GR')} Dead Stock`);
      if (excessN > 0) parts.push(`${excessN.toLocaleString('el-GR')} Excess Stock`);
      h.stock_clearance = `${parts.join(' · ')} (ERP) — επιλέξτε «${scName}» (ίδιο preset για dead & excess)`;
    }
    return Object.keys(h).length ? h : undefined;
  }, [usingProcurement, products]);
  const {
    skuStats,
    skuMovement,
    stockMovementBaselineDate,
    connectedPlatforms,
  } = useEcommerceSummary();
  const { data: procurementData } = useProcurement();
  const { refresh: refreshAggregates } = useRefreshAggregates();
  const { segments: rfmSegments, dataCoverage, sourceLabel: segmentDataSourceLabel } = useSegments();
  const { user } = useAuth();
  const { activeStrategy, saveActiveStrategy, isLoading: strategyLoading } = useActiveStrategy();
  const { benchmarks } = usePriceBenchmarks();
  const toast = useToast();

  // Source provenance — δίνεται στα Gemini prompts ώστε να calibrate το AI
  // confidence (π.χ. αν λείπει connector, δεν υπόσχεται real-time ROAS).
  const { coverage: signalCoverage, signalsBySku } = useProductSignals(products);

  const benchmarkLookupMap = useMemo(() => buildBenchmarkLookup(benchmarks), [benchmarks]);
  const normalizedSkuStats = useMemo(() => {
    if (!skuStats) return null;
    const entries = Object.entries(skuStats).map(([sku, stats]) => [sku.trim().toLowerCase(), stats] as const);
    return Object.fromEntries(entries);
  }, [skuStats]);

  const normalizedSkuMovement = useMemo(() => {
    if (!skuMovement) return null;
    const entries = Object.entries(skuMovement).map(([sku, m]) => [sku.trim().toLowerCase(), m] as const);
    return Object.fromEntries(entries);
  }, [skuMovement]);

  // sku → { procurement_category, procurement_status } από procurement_inventory.
  // Δίνει δεύτερη πηγή κατηγοριοποίησης (lifecycle status π.χ. «Επί παραγγελία», «Προς κατάργηση»),
  // χωριστή από την εμπορική κατηγορία προϊόντος.
  const procurementBySku = useMemo(() => {
    const out = new Map<string, { category: string; status: string }>();
    const inventory = (procurementData?.inventory ?? []) as Array<Record<string, unknown>>;
    for (const row of inventory) {
      const sku = String(row.ΚΩΔΙΚΟΣ ?? '').trim().toLowerCase();
      if (!sku) continue;
      const category = String(row.ΚΑΤΗΓΟΡΙΑ ?? '').trim();
      // Status priority: explicit STATUS_ΚΩΔΙΚΟΥ → ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ → ΟΜΑΔΑ_ΡΟΗΣ
      const status =
        String(row.STATUS_ΚΩΔΙΚΟΥ ?? '').trim() ||
        String(row.ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ ?? '').trim() ||
        String(row.ΟΜΑΔΑ_ΡΟΗΣ ?? '').trim();
      out.set(sku, { category, status });
    }
    return out;
  }, [procurementData]);

  const hasProcurementCategories = procurementBySku.size > 0;

  // Source-of-truth προτεραιότητα για τα φίλτρα Sales Optimization:
  //   1) Connector orders (skuStats.sold*) — αυθεντικά δεδομένα παραγγελιών.
  //   2) Stock movement (skuMovement.dec*) — καθολικός μηχανισμός που λειτουργεί για κάθε brand
  //      και αποτυπώνει net κινητικότητα (πωλήσεις μείον επιστροφές/ακυρώσεις).
  //   3) Import lifetime/period — fallback όταν δεν υπάρχει τίποτα από τα παραπάνω.
  //
  // Σημείωση: το stock movement δεν δίνει `last_sale_at` (δεν γνωρίζουμε ημερομηνία ακριβούς πώλησης
  // από snapshots), αλλά καλύπτει 7/30/90d windows. Αν δεν είχαμε καμία μείωση σε όλα τα windows,
  // το προϊόν θεωρείται "πάγωμα αποθέματος" → 0 πωλήσεις στο αντίστοιχο window.
  const hasConnector = (connectedPlatforms?.length ?? 0) > 0;
  const skuStatsHasWindows = useMemo(() => {
    if (!normalizedSkuStats) return false;
    for (const stats of Object.values(normalizedSkuStats)) {
      if (stats.sold7d != null || stats.sold30d != null || stats.sold90d != null) return true;
    }
    return false;
  }, [normalizedSkuStats]);

  const hasMovementData = useMemo(() => {
    if (!normalizedSkuMovement) return { d7: false, d30: false, d90: false, any: false };
    let d7 = false, d30 = false, d90 = false;
    for (const m of Object.values(normalizedSkuMovement)) {
      if (m.dec7d != null) d7 = true;
      if (m.dec30d != null) d30 = true;
      if (m.dec90d != null) d90 = true;
      if (d7 && d30 && d90) break;
    }
    return { d7, d30, d90, any: d7 || d30 || d90 };
  }, [normalizedSkuMovement]);

  const salesBaseProducts = useMemo(() => {
    const enrichSales = (p: Product): Product => {
      const key = (p.sku || '').trim().toLowerCase();
      const stats = key ? normalizedSkuStats?.[key] : undefined;
      const move = key ? normalizedSkuMovement?.[key] : undefined;

      // Αν υπάρχουν αυθεντικά connector orders → κυρίαρχη πηγή.
      if (hasConnector && skuStatsHasWindows) {
        const sold7 = stats?.sold7d != null ? Math.max(0, Math.round(stats.sold7d)) : 0;
        const sold30 = stats?.sold30d != null ? Math.max(0, Math.round(stats.sold30d)) : 0;
        const sold90 = stats?.sold90d != null ? Math.max(0, Math.round(stats.sold90d)) : 0;
        return {
          ...p,
          qty_sold_last_7d: sold7,
          qty_sold_last_30d: sold30,
          qty_sold_last_90d: sold90,
          ...(p.stock_level == null && stats?.stock != null
            ? { stock_level: Math.max(0, Math.round(stats.stock)) }
            : {}),
          ...(stats?.lastSaleAt ? { last_sale_at: stats.lastSaleAt } : {}),
        } as Product;
      }

      // Αλλιώς: stock movement (universal) ως κυρίαρχη πηγή για windowed sales.
      if (hasMovementData.any && move) {
        const out: Product = { ...p };
        if (hasMovementData.d7 && move.dec7d != null) {
          out.qty_sold_last_7d = Math.max(0, Math.round(move.dec7d));
        }
        if (hasMovementData.d30 && move.dec30d != null) {
          out.qty_sold_last_30d = Math.max(0, Math.round(move.dec30d));
        }
        if (hasMovementData.d90 && move.dec90d != null) {
          out.qty_sold_last_90d = Math.max(0, Math.round(move.dec90d));
        }
        // Στο connector skuStats μπορεί να έχουμε stock & lastSaleAt — γράψ' τα αν λείπουν.
        if (out.stock_level == null && stats?.stock != null) {
          out.stock_level = Math.max(0, Math.round(stats.stock));
        }
        if (!out.last_sale_at && stats?.lastSaleAt) {
          out.last_sale_at = stats.lastSaleAt;
        }
        return out;
      }

      // Τέλος: συμπλήρωσε από connector skuStats (αν υπάρχει) χωρίς override.
      if (!stats) return p;
      const sold90Fallback = stats.sold90d ?? stats.sold;
      return {
        ...p,
        ...(p.qty_sold_last_7d == null && stats.sold7d != null
          ? { qty_sold_last_7d: Math.max(0, Math.round(stats.sold7d)) }
          : {}),
        ...(p.qty_sold_last_30d == null && stats.sold30d != null
          ? { qty_sold_last_30d: Math.max(0, Math.round(stats.sold30d)) }
          : {}),
        ...(p.qty_sold_last_90d == null && sold90Fallback != null
          ? { qty_sold_last_90d: Math.max(0, Math.round(sold90Fallback)) }
          : {}),
        ...(p.stock_level == null
          ? { stock_level: Math.max(0, Math.round(stats.stock || 0)) }
          : {}),
        ...(p.last_sale_at == null && stats.lastSaleAt
          ? { last_sale_at: stats.lastSaleAt }
          : {}),
      } as Product;
    };

    // Wrap: εφαρμογή sales enrichment + procurement enrichment σε όλα τα products.
    return products.map((p) => {
      const enriched = enrichSales(p);
      const key = (p.sku || '').trim().toLowerCase();
      const proc = key ? procurementBySku.get(key) : undefined;
      if (!proc) return enriched;
      return {
        ...enriched,
        ...(proc.category && !enriched.procurement_category
          ? { procurement_category: proc.category }
          : {}),
        ...(proc.status && !enriched.procurement_status
          ? { procurement_status: proc.status }
          : {}),
      };
    });
  }, [
    normalizedSkuStats,
    normalizedSkuMovement,
    products,
    hasConnector,
    skuStatsHasWindows,
    hasMovementData,
    procurementBySku,
  ]);

  const salesBaseProductById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of salesBaseProducts) map.set(p.id, p);
    return map;
  }, [salesBaseProducts]);

  const benchmarkLookup = useCallback(
    (p: Product) => findBenchmarkForProductInLookup(p, benchmarkLookupMap),
    [benchmarkLookupMap],
  );

  const benchmarkScoreContext = useMemo<CompositeScoreContext>(
    () => ({ benchmarkLookup }),
    [benchmarkLookup],
  );

  const [briefingName, setBriefingName] = useState<string | null>(null);
  const [showBriefingDrawer, setShowBriefingDrawer] = useState(false);

  const createStrategyDecision = useCallback(async (strategyName: string) => {
    setBriefingName(strategyName);
  }, []);

  // strategySaveVersion bump triggers downstream effects (κρατείται για future use).
  const [, setStrategySaveVersion] = useState(0);
  const queryClient = useQueryClient();
  
  // Initialize from active strategy if available, otherwise no default
  const [selectedScenario, setSelectedScenario] = useState<string | null>(() => {
    if (!activeStrategy) return null;
    const sid = activeStrategy.scenarioId;
    return sid === 'custom' ? 'profit_max' : sid;
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
    return weights;
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
  const [salesBaseSetupOpen, setSalesBaseSetupOpen] = useState(false);
  const [pendingSalesBaseScope, setPendingSalesBaseScope] = useState<SalesBaseScope | null>(null);
  const [priceBenchmarkSetupOpen, setPriceBenchmarkSetupOpen] = useState(false);
  const [pendingPriceBenchmarkScope, setPendingPriceBenchmarkScope] =
    useState<PriceBenchmarkStrategyScope | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showFeedFormatModal, setShowFeedFormatModal] = useState(false);
  const [showSeasonalModal, setShowSeasonalModal] = useState(false);
  const scenarioSelectorRef = useRef<HTMLDivElement | null>(null);
  const [mixPanelOpen, setMixPanelOpen] = useState(() => {
    return !((activeStrategy as any)?.mixConfig && activeStrategy?.scenarioId === 'mixed');
  });
  const [seasonalDiscountConfig, setSeasonalDiscountConfig] = useState<SeasonalDiscountConfig | null>(null);
  const [seasonalPanelOpen, setSeasonalPanelOpen] = useState(false);
  // Triage origin: ποιο decision bucket γέννησε την επιλογή πολιτικής & SKU scope.
  // Persists στο active_strategies — επιτρέπει downstream consumers (Channel
  // Activation, AI prompts, exports) να γνωρίζουν την αιτία της στρατηγικής.
  const [triageOrigin, setTriageOrigin] = useState<TriageOrigin | null>(null);
  const scrollToScenarioSelector = useCallback(() => {
    window.requestAnimationFrame(() => {
      scenarioSelectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const clearPendingScenario = useCallback(() => {
    setPendingScenarioChange(null);
    setPendingSalesBaseScope(null);
    setPendingPriceBenchmarkScope(null);
    setShowDetailModal(false);
  }, []);
  const triageScopedProductIds = useMemo(() => {
    if (!triageOrigin) return null;
    if (triageOrigin.productIds && triageOrigin.productIds.length > 0) {
      return new Set(triageOrigin.productIds);
    }
    if (triageOrigin.skus && triageOrigin.skus.length > 0) {
      const skuSet = new Set(triageOrigin.skus.map((sku) => sku.trim().toLowerCase()).filter(Boolean));
      const matchedIds = products
        .filter((product) => skuSet.has((product.sku || '').trim().toLowerCase()))
        .map((product) => product.id);
      return matchedIds.length > 0 ? new Set(matchedIds) : null;
    }
    return null;
  }, [triageOrigin, products]);
  const filterProductsByTriageScope = useCallback(
    (source: Product[]): Product[] => {
      if (!triageScopedProductIds || triageScopedProductIds.size === 0) return source;
      const filtered = source.filter((product) => triageScopedProductIds.has(product.id));
      return filtered.length > 0 ? filtered : source;
    },
    [triageScopedProductIds]
  );
  const buildImpactProductFilter = useCallback(
    (baseFilter?: (p: Product) => boolean) =>
      (product: Product) => {
        const inTriageScope = !triageScopedProductIds || triageScopedProductIds.has(product.id);
        return inTriageScope && (baseFilter ? baseFilter(product) : true);
      },
    [triageScopedProductIds]
  );
  const triageScopeCount = triageScopedProductIds?.size ?? 0;

  // Memoized AI prompt contexts — αναγεννώνται μόνο όταν αλλάζει το triage ή
  // η κάλυψη πηγών (όχι σε κάθε render).
  const triagePromptCtx = useMemo(
    () => buildTriagePromptContext(triageOrigin),
    [triageOrigin]
  );
  const provenancePromptCtx = useMemo(
    () => buildProvenancePromptContext(signalCoverage, productSourceCount),
    [signalCoverage, productSourceCount]
  );
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
  const [hasManualWeightChanges, setHasManualWeightChanges] = useState(false);

  const getWeightsForScenario = useCallback((scenarioId: string | null) => {
    if (!scenarioId) return weights;
    if (scenarioId === 'mixed' || scenarioId === 'seasonal_discount') return weights;
    const scenario = scenarios.find((s) => s.id === scenarioId);
    return scenario?.weights ?? defaultWeights;
  }, [weights]);

  // Calculate total weight early to avoid reference errors
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  // Get current weights for comparison
  const getCurrentWeights = useCallback(() => weights, [weights]);

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
          triage: triagePromptCtx,
          provenance: provenancePromptCtx,
          audience: dataCoverage,
        }).then(async rec => {
          if (!rec) return;
          // Mirror στα 2 πεδία ώστε Channel page (activation) και RFM exports (channel) να μη διαφωνούν.
          const clean = JSON.parse(JSON.stringify(rec));
          await FirestoreService.setDocument('active_strategies', savedStrategyId, {
            activationRecommendation: clean,
            channelRecommendation: clean,
            updatedAt: new Date().toISOString(),
          } as Record<string, unknown>);
        })
          .catch(err => console.error('[AI] Activation failed:', err))
      );
    }

    promises.push(
      generateContentSuggestions({
        scenarioId, scenarioName, weights: strategyWeights, brandName: currentBrand?.name, topCategories: topCats, segmentNames,
        triage: triagePromptCtx,
        provenance: provenancePromptCtx,
        audience: dataCoverage,
      }).then(result => { if (result) return saveField('contentSuggestions', result); })
        .catch(err => console.error('[AI] Content failed:', err))
    );

    await Promise.allSettled(promises);
    queryClient.invalidateQueries({ queryKey: ['activeStrategy'] });
  }, [rfmSegments, selectedSegment, products, currentBrand, rankedSegments, segmentFitMap, queryClient, triagePromptCtx, provenancePromptCtx, dataCoverage]);

  const applyScenarioChange = useCallback((
    scenarioId: string,
    overrideDuration?: number | 'ongoing',
    saveOptions?: { salesBaseScope?: SalesBaseScope; priceBenchmarkScope?: PriceBenchmarkStrategyScope },
  ) => {
    setSelectedScenario(scenarioId);
    setHasManualWeightChanges(false);

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
    
    const scenarioName = scenario?.name || 'Unknown';

    const defaultSalesScope: SalesBaseScope = {
      preset: 'all',
      brandFilter: '',
      categoryFilter: '',
      search: '',
      selectedProductIds: null,
    };

    const defaultPriceBenchmarkScope: PriceBenchmarkStrategyScope = {
      preset: 'below_market',
      brandFilter: '',
      categoryFilter: '',
      search: '',
      selectedProductIds: null,
    };

    saveActiveStrategy({
      scenarioId: scenarioId,
      weights: newWeights,
      duration: saveDuration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
      ...(scenarioId === 'sales_base'
        ? { salesBaseScope: saveOptions?.salesBaseScope ?? defaultSalesScope }
        : {}),
      ...(scenarioId === 'price_benchmark'
        ? { priceBenchmarkScope: saveOptions?.priceBenchmarkScope ?? defaultPriceBenchmarkScope }
        : {}),
      ...(triageOrigin ? { triageOrigin } : {}),
    }).then((saved) => {
      toast.success(`Στρατηγική "${scenarioName}" αποθηκεύτηκε`);
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, scenarioId, newWeights);
      createStrategyDecision(scenarioName);
    }).catch((error) => {
      console.error('Error saving strategy:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, saveActiveStrategy, toast, triggerAIGeneration, createStrategyDecision]);

  const handleMixedApply = useCallback((blendedWeights: Record<string, number>, config: MixConfig) => {
    setMixConfig(config);
    setWeights(blendedWeights);
    setHasManualWeightChanges(false);
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
      ...(triageOrigin ? { triageOrigin } : {}),
    } as any).then((saved) => {
      const mixName = `${nameA} ${config.percentA}% / ${nameB} ${config.percentB}%`;
      toast.success(`Μικτή στρατηγική "${mixName}" αποθηκεύτηκε`);
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, 'mixed', blendedWeights);
      createStrategyDecision(`Μικτή: ${mixName}`);
    }).catch((error) => {
      console.error('Error saving mixed strategy:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, saveActiveStrategy, toast, duration, triggerAIGeneration, createStrategyDecision]);

  const handleSeasonApply = useCallback((period: SeasonalPeriod) => {
    if (!user) {
      toast.error('Πρέπει να είσαι συνδεδεμένος');
      return;
    }
    if (!currentBrand?.id) {
      toast.error('Δεν βρέθηκε επιλεγμένο brand');
      return;
    }

    const mix = period.suggestedMix;
    const proposal: SeasonalProposal = {
      periodId: period.id,
      periodName: period.name,
      scenarioA: mix.scenarioA,
      scenarioB: mix.scenarioB,
      percentA: mix.percentA,
      percentB: 100 - mix.percentA,
      description: period.description,
      activatedAt: new Date().toISOString(),
    };

    const currentScenarioId = selectedScenario || activeStrategy?.scenarioId || 'profit_max';
    const currentWeights = currentScenarioId === 'mixed' && mixConfig
      ? computeBlendedWeights(mixConfig.scenarioA, mixConfig.scenarioB, mixConfig.percentA)
      : weights;
    const currentDuration = activeStrategy?.duration ?? duration;

    const now = new Date().toISOString();
    const strategyId =
      activeStrategy && !activeStrategy.id.startsWith('default_')
        ? activeStrategy.id
        : `strategy_${currentBrand.id}`;
    const payload: Record<string, unknown> =
      activeStrategy && !activeStrategy.id.startsWith('default_')
        ? {
            ...JSON.parse(JSON.stringify(activeStrategy)),
            seasonalProposal: proposal,
            updatedAt: now,
          }
        : {
            id: strategyId,
            brandId: currentBrand.id,
            scenarioId: currentScenarioId,
            weights: currentWeights,
            duration: currentDuration,
            approvalStatus: 'implementing',
            approvedBy: user.email || user.displayName || 'User',
            approvedAt: now,
            implementedAt: now,
            createdAt: now,
            updatedAt: now,
            ...(activeStrategy?.scenarioId === 'mixed' && mixConfig ? { mixConfig } : {}),
            ...(triageOrigin ? { triageOrigin } : {}),
            seasonalProposal: proposal,
          };

    FirestoreService.setDocument('active_strategies', strategyId, payload).then(() => {
      queryClient.invalidateQueries({ queryKey: ['activeStrategy', currentBrand.id] }).catch(() => {});
      toast.success(`Η εποχιακή πρόταση "${period.name}" ενεργοποιήθηκε παράλληλα με την κύρια πολιτική`);
      setShowSeasonalModal(false);
      createStrategyDecision(`Εποχική πρόταση: ${period.name}`);
    }).catch((error) => {
      console.error('Error saving seasonal proposal:', error);
      toast.error(`Σφάλμα: ${error?.message || error}`);
    });
  }, [user, toast, currentBrand?.id, selectedScenario, activeStrategy, mixConfig, weights, duration, triageOrigin, createStrategyDecision, queryClient]);

  const handleSeasonalDiscountApply = useCallback((config: SeasonalDiscountConfig) => {
    setSeasonalDiscountConfig(config);
    setSeasonalPanelOpen(false);
    setHasManualWeightChanges(false);
    toast.success(`Εκπτωτική περίοδος "${config.periodName}" (-${config.discountPercent}%) εφαρμόστηκε`);

    if (!user) return;
    saveActiveStrategy({
      scenarioId: 'seasonal_discount',
      weights,
      duration,
      approvalStatus: 'implementing',
      approvedBy: user.email || user.displayName || 'User',
      seasonalDiscount: config,
      ...(triageOrigin ? { triageOrigin } : {}),
    }).then((saved) => {
      setStrategySaveVersion(v => v + 1);
      if (saved?.id) triggerAIGeneration(saved.id, 'seasonal_discount', weights);
      createStrategyDecision(`Εκπτωτική: ${config.periodName} (-${config.discountPercent}%)`);
    }).catch(() => {});
  }, [user, saveActiveStrategy, toast, weights, duration, triggerAIGeneration, createStrategyDecision]);


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

    if (scenarioId === 'sales_base') {
      setMixPanelOpen(false);
      setSeasonalPanelOpen(false);
      setSalesBaseSetupOpen(true);
      return;
    }

    if (scenarioId === 'price_benchmark') {
      setMixPanelOpen(false);
      setSeasonalPanelOpen(false);
      setPriceBenchmarkSetupOpen(true);
      return;
    }
    
    setMixPanelOpen(false);
    setSeasonalPanelOpen(false);
    startTransition(() => {
      setPendingScenarioChange(scenarioId);
    });
  }, [selectedScenario, applyScenarioChange]);

  // Confirm strategy change after impact preview
  const confirmStrategyChange = useCallback((selectedDuration: number | 'ongoing') => {
    if (!pendingScenarioChange) return;
    const saveOpts: {
      salesBaseScope?: SalesBaseScope;
      priceBenchmarkScope?: PriceBenchmarkStrategyScope;
    } = {};
    if (pendingScenarioChange === 'sales_base') {
      saveOpts.salesBaseScope =
        pendingSalesBaseScope ?? {
          preset: 'all',
          brandFilter: '',
          categoryFilter: '',
          search: '',
          selectedProductIds: null,
        };
    }
    if (pendingScenarioChange === 'price_benchmark') {
      saveOpts.priceBenchmarkScope =
        pendingPriceBenchmarkScope ?? {
          preset: 'below_market',
          brandFilter: '',
          categoryFilter: '',
          search: '',
          selectedProductIds: null,
        };
    }
    applyScenarioChange(pendingScenarioChange, selectedDuration, saveOpts);
    clearPendingScenario();
  }, [pendingScenarioChange, pendingSalesBaseScope, pendingPriceBenchmarkScope, applyScenarioChange, clearPendingScenario]);

  const previewUiScenarioId =
    pendingScenarioChange === 'sales_base'
      ? 'sales_base'
      : pendingScenarioChange === 'price_benchmark'
        ? 'price_benchmark'
        : selectedScenario || 'profit_max';
  const previewUiWeights =
    pendingScenarioChange === 'sales_base'
      ? getWeightsForScenario('sales_base')
      : pendingScenarioChange === 'price_benchmark'
        ? getWeightsForScenario('price_benchmark')
        : weights;

  const previewConfig = getPreviewConfig(previewUiScenarioId, previewUiWeights);

  const salesBaseScopeForPreview = useMemo(() => {
    if (pendingScenarioChange === 'sales_base' && pendingSalesBaseScope) return pendingSalesBaseScope;
    if (selectedScenario === 'sales_base') return (activeStrategy as { salesBaseScope?: SalesBaseScope })?.salesBaseScope;
    return undefined;
  }, [pendingScenarioChange, pendingSalesBaseScope, selectedScenario, activeStrategy]);

  const priceBenchmarkScopeForPreview = useMemo(() => {
    if (pendingScenarioChange === 'price_benchmark' && pendingPriceBenchmarkScope) {
      return pendingPriceBenchmarkScope;
    }
    if (selectedScenario === 'price_benchmark') {
      return (activeStrategy as { priceBenchmarkScope?: PriceBenchmarkStrategyScope })?.priceBenchmarkScope;
    }
    return undefined;
  }, [pendingScenarioChange, pendingPriceBenchmarkScope, selectedScenario, activeStrategy]);

  // Weights auto-sync from scenario selection; slider edits stay on the selected preset until save.

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
      setHasManualWeightChanges(true);

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
    const pm = scenarios.find((s) => s.id === 'profit_max');
    setWeights(pm?.weights ? { ...pm.weights } : defaultWeights);
    setSelectedScenario('profit_max');
    setHasManualWeightChanges(false);
  }, []);

  // Calculate prioritized products (strategy-specific score logic)
  // Use debounced weights for expensive calculations, limit to top 100 for preview
  const prioritizedProducts = useMemo(() => {
    const previewingSalesPending = pendingScenarioChange === 'sales_base';
    const previewingPriceBenchPending = pendingScenarioChange === 'price_benchmark';
    if (!selectedScenario && !previewingSalesPending && !previewingPriceBenchPending) return [];

    const strategyId: string | undefined = previewingSalesPending
      ? 'sales_base'
      : previewingPriceBenchPending
        ? 'price_benchmark'
        : (selectedScenario ?? undefined);

    const weightsForScore = previewingSalesPending
      ? getWeightsForScenario('sales_base')
      : previewingPriceBenchPending
        ? getWeightsForScenario('price_benchmark')
        : debouncedWeights;

    let source = products;
    if (strategyId === 'sales_base') {
      source = filterProductsBySalesBaseScope(salesBaseProducts, salesBaseScopeForPreview);
    }
    if (strategyId === 'price_benchmark') {
      source = filterProductsByPriceBenchmarkScope(products, priceBenchmarkScopeForPreview, benchmarks);
    }
    source = filterProductsByTriageScope(source);

    const scoreCtx: CompositeScoreContext | undefined =
      strategyId === 'price_benchmark' ? benchmarkScoreContext : undefined;

    const scored = source
      .map((p) => {
        const bm = strategyId === 'price_benchmark' ? benchmarkLookup(p) : undefined;
        return {
          ...p,
          ...(bm ? { __priceBenchmark: bm } : {}),
          composite_score: calculateCompositeScore(
            p,
            weightsForScore,
            undefined,
            strategyId,
            undefined,
            scoreCtx,
          ),
        };
      })
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));

    return scored.slice(0, 100);
  }, [
    products,
    salesBaseProducts,
    debouncedWeights,
    selectedScenario,
    pendingScenarioChange,
    salesBaseScopeForPreview,
    priceBenchmarkScopeForPreview,
    benchmarks,
    filterProductsByTriageScope,
    benchmarkLookup,
    benchmarkScoreContext,
    getWeightsForScenario,
  ]);

  const previewTotalPages = Math.max(1, Math.ceil(prioritizedProducts.length / PREVIEW_PAGE_SIZE));
  const paginatedPreviewProducts = prioritizedProducts.slice(
    (currentPreviewPage - 1) * PREVIEW_PAGE_SIZE,
    currentPreviewPage * PREVIEW_PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPreviewPage(1);
  }, [
    selectedScenario,
    debouncedWeights,
    pendingScenarioChange,
    salesBaseScopeForPreview,
    priceBenchmarkScopeForPreview,
    triageScopeCount,
  ]);

  // Full list for export (only calculated when needed)
  const allPrioritizedProducts = useMemo(() => {
    const previewingSalesPending = pendingScenarioChange === 'sales_base';
    const previewingPriceBenchPending = pendingScenarioChange === 'price_benchmark';
    if (!selectedScenario && !previewingSalesPending && !previewingPriceBenchPending) return [];

    const strategyId: string | undefined = previewingSalesPending
      ? 'sales_base'
      : previewingPriceBenchPending
        ? 'price_benchmark'
        : (selectedScenario ?? undefined);

    const weightsForScore = previewingSalesPending
      ? getWeightsForScenario('sales_base')
      : previewingPriceBenchPending
        ? getWeightsForScenario('price_benchmark')
        : debouncedWeights;

    let source = products;
    if (strategyId === 'sales_base') {
      source = filterProductsBySalesBaseScope(salesBaseProducts, salesBaseScopeForPreview);
    }
    if (strategyId === 'price_benchmark') {
      source = filterProductsByPriceBenchmarkScope(products, priceBenchmarkScopeForPreview, benchmarks);
    }
    source = filterProductsByTriageScope(source);

    const scoreCtx: CompositeScoreContext | undefined =
      strategyId === 'price_benchmark' ? benchmarkScoreContext : undefined;

    return source
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(
          p,
          weightsForScore,
          undefined,
          strategyId,
          undefined,
          scoreCtx,
        ),
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));
  }, [
    products,
    salesBaseProducts,
    debouncedWeights,
    selectedScenario,
    pendingScenarioChange,
    salesBaseScopeForPreview,
    priceBenchmarkScopeForPreview,
    benchmarks,
    filterProductsByTriageScope,
    benchmarkScoreContext,
    getWeightsForScenario,
  ]);

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

  const [isExportingStrategy, setIsExportingStrategy] = useState(false);
  const handleExportStrategy = async () => {
    if (!selectedScenario) return;
    setIsExportingStrategy(true);
    try {
      const scenarioName = scenarios.find(s => s.id === selectedScenario)?.name || selectedScenario;
      await exportStrategyPlan({
        brandName: currentBrand?.name,
        scenarioName,
        duration: duration === 'ongoing' ? 'Ongoing' : duration ? `${duration} ημέρες` : undefined,
        monthlyBudget: activeStrategy?.monthlyBudget ?? null,
        segments: rfmSegments,
        channelRecommendation: activeStrategy?.channelRecommendation ?? null,
      });
      toast.success('Strategy Plan exported!');
    } catch { toast.error('Export failed'); }
    setIsExportingStrategy(false);
  };

  // Channel recommendation πλέον προβάλλεται/παράγεται από το Channel Activation
  // (single source of truth). Εδώ διαβάζουμε ΜΟΝΟ το αποθηκευμένο rec για να
  // τροφοδοτήσουμε το StrategyPackage preview.
  const aiRecommendation = activeStrategy?.channelRecommendation ?? null;

  // After strategy save: generate activation + content AI (directly to Firestore, no mutation closures)

  // Load saved strategy from Firestore on mount/refresh
  useEffect(() => {
    if (!strategyLoading && activeStrategy) {
      const sid = activeStrategy.scenarioId === 'custom' ? 'profit_max' : activeStrategy.scenarioId;
      setSelectedScenario(sid);
      setWeights(activeStrategy.weights);
      setHasManualWeightChanges(false);
      if (activeStrategy.duration !== undefined) {
        setDuration(activeStrategy.duration);
      }
      const saved = (activeStrategy as any).mixConfig;
      if (activeStrategy.scenarioId === 'mixed' && saved) {
        setMixConfig(saved as MixConfig);
      } else {
        setMixConfig(null);
      }
      // Rehydrate seasonal discount config — αλλιώς reload χάνει την επιλογή του χρήστη.
      const savedSeasonal = (activeStrategy as any).seasonalDiscount as SeasonalDiscountConfig | undefined;
      if (activeStrategy.scenarioId === 'seasonal_discount' && savedSeasonal) {
        setSeasonalDiscountConfig(savedSeasonal);
      } else {
        setSeasonalDiscountConfig(null);
      }
      // Rehydrate triage origin annotation (Decision Buckets → policy provenance).
      const savedTriage = (activeStrategy as any).triageOrigin as TriageOrigin | undefined;
      if (savedTriage) {
        setTriageOrigin({
          ...savedTriage,
          skus: Array.isArray(savedTriage.skus) ? savedTriage.skus : [],
          productIds: Array.isArray(savedTriage.productIds) ? savedTriage.productIds : undefined,
        });
      } else {
        setTriageOrigin(null);
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
          <PageHeader
            title={
              <h2 className="text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">
                Commercial Strategy
              </h2>
            }
            description={
              <p className="text-[14px] text-[var(--nts-medium-gray)]">
                Καθορισμός εμπορικών προτεραιοτήτων, κατανομή πόρων και συντονισμός εκτέλεσης
              </p>
            }
            meta={
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <DataSourcePill
                  label="Products"
                  value={productDataSourceLabel}
                  tone={productSourceKind === 'erp' ? 'warning' : hasImported ? 'success' : 'neutral'}
                />
                <DataSourcePill
                  label="Segments"
                  value={segmentDataSourceLabel}
                  tone={dataCoverage.activeSource === 'import' ? 'warning' : dataCoverage.activeSource === 'ecommerce' ? 'success' : 'neutral'}
                />
              </div>
            }
          />

          {/* Strategy Package — share/copy active strategy */}
          {selectedScenario && (
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

          <SeasonalBanner
            activeProposalId={(activeStrategy as { seasonalProposal?: SeasonalProposal | undefined } | null)?.seasonalProposal?.periodId ?? null}
            onApplySeason={handleSeasonApply}
            onManageSeasons={() => setShowSeasonalModal(true)}
          />

          <ProcurementStrategyBridge
            products={products}
            signalsBySku={signalsBySku}
            enabled={usingProcurement}
            onDeadToStockClearance={({ productIds, skus, tiedCapital, count }) => {
              setTriageOrigin({
                bucket: 'erp_dead_stock',
                label: `Dead stock (ERP) — ${count.toLocaleString('el-GR')} SKU`,
                skus,
                productIds,
                tiedCapital,
                selectedAt: new Date().toISOString(),
              });
              handleScenarioChange('stock_clearance');
              scrollToScenarioSelector();
            }}
            onExcessToStockClearance={({ productIds, skus, tiedCapital, count }) => {
              setTriageOrigin({
                bucket: 'erp_excess_stock',
                label: `Excess Stock (ERP) — ${count.toLocaleString('el-GR')} SKU`,
                skus,
                productIds,
                tiedCapital,
                selectedAt: new Date().toISOString(),
              });
              handleScenarioChange('stock_clearance');
              scrollToScenarioSelector();
            }}
            onOpenProductIntelligence={() => {
              window.location.hash = '#products';
            }}
          />

          {/* Διάγνωση προτεραιοτήτων (Decision Buckets) πάνω από τις πολιτικές */}
          <TriageCard
            onSelectPolicy={(policy, bucket, payload) => {
              setTriageOrigin({
                bucket,
                label: payload.label,
                skus: payload.skus,
                productIds: payload.productIds,
                tiedCapital: payload.tiedCapital,
                selectedAt: new Date().toISOString(),
              });
              if (policy === 'price_benchmark') {
                setMixPanelOpen(false);
                setSeasonalPanelOpen(false);
                startTransition(() => {
                  setPendingPriceBenchmarkScope({
                    preset: 'all_benchmarked',
                    brandFilter: '',
                    categoryFilter: '',
                    search: '',
                    selectedProductIds: payload.productIds.length > 0 ? payload.productIds : null,
                  });
                  setPendingScenarioChange('price_benchmark');
                });
                scrollToScenarioSelector();
                return;
              }

              if (policy === 'seasonal_discount') {
                setSeasonalDiscountConfig({
                  periodName: '',
                  discountPercent: 20,
                  scope: 'products',
                  selectedCategories: [],
                  selectedProductIds: payload.productIds,
                });
              }

              handleScenarioChange(policy);
              scrollToScenarioSelector();
            }}
          />

          {/* Scenario Selector (tabs) */}
          <div ref={scenarioSelectorRef} className="space-y-3">
            <ScenarioSelector
              selectedScenario={pendingScenarioChange ?? selectedScenario}
              onScenarioChange={handleScenarioChange}
              activeDuration={duration}
              erpHints={scenarioErpHints}
            />
            {pendingScenarioChange && (
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--nts-accent)]/20 bg-[var(--nts-light-gray)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-accent)]">
                    {getScenarioPendingLabel(pendingScenarioChange)}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--nts-charcoal)]">
                    {scenarios.find((s) => s.id === pendingScenarioChange)?.name ?? pendingScenarioChange}
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--nts-medium-gray)]">
                    {getScenarioPendingHelpText(pendingScenarioChange)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearPendingScenario}
                  >
                    Κλείσιμο προεπιλογής
                  </Button>
                  <Button
                    size="sm"
                    icon={<ChevronRight size={14} />}
                    iconPosition="right"
                    onClick={() => setShowDetailModal(true)}
                  >
                    {getScenarioPendingActionText(pendingScenarioChange)}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Briefing Banner — shown after strategy save */}
          {briefingName && !showBriefingDrawer && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#111827] rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[var(--nts-accent)] shrink-0 animate-pulse" />
                <span className="text-sm text-white truncate">
                  Στρατηγική <strong>"{briefingName}"</strong> ενεργοποιήθηκε
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setBriefingName(null)}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  Παράλειψη
                </button>
                <button
                  onClick={() => setShowBriefingDrawer(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--nts-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                  Αποστολή Briefing →
                </button>
              </div>
            </div>
          )}
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
            {selectedScenario && (
              <CustomToolsCard
                weights={weights}
                onWeightsChange={(next) => {
                  if (debounceTimerRef.current) {
                    window.clearTimeout(debounceTimerRef.current);
                  }
                  setWeights(next);
                  setDebouncedWeights(next);
                  setHasManualWeightChanges(false);
                }}
                canSavePreset={hasManualWeightChanges}
                onPresetSaved={() => setHasManualWeightChanges(false)}
              />
            )}
            <Button
              variant="secondary"
              className="w-full"
              icon={<Download size={16} />}
              disabled={!selectedScenario || products.length === 0}
              onClick={() => setShowFeedFormatModal(true)}
            >
              Εξαγωγή product feed
            </Button>
            {rfmSegments.length > 0 && (
              <Button
                variant="secondary"
                className="w-full"
                icon={<FileSpreadsheet size={16} />}
                disabled={!selectedScenario || isExportingStrategy}
                onClick={handleExportStrategy}
              >
                {isExportingStrategy ? 'Εξαγωγή…' : 'Εξαγωγή πλάνου στρατηγικής'}
              </Button>
            )}
          </div>
        </Card>

        {/* Live Preview */}
        <Card className="xl:col-span-2" padding="lg">
          <CardHeader
            title="Live Preview"
            subtitle={
              triageScopeCount > 0
                ? `Εστίαση από διάγνωση: ${triageScopeCount} προϊόντα · προβολή top 100 (10 ανά σελίδα)`
                : hasImported
                  ? `Top 100 από ${productSourceCount.toLocaleString('el-GR')} προϊόντα (10 ανά σελίδα)`
                  : 'Top 100 προτεραιοποιημένα προϊόντα (10 ανά σελίδα)'
            }
            icon={<Sparkles size={18} className="text-[var(--nts-medium-gray)]" />}
          />
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
          <div className="mt-6 grid grid-cols-1 gap-4 rounded-lg bg-[#F5F5F5] p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[#4A4A4A]">Επηρεαζόμενες κατηγορίες</p>
              <p className="text-lg font-bold text-[#1A1A1A]">
                {new Set(prioritizedProducts.map((p) => p.category)).size}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#4A4A4A]">Μέση βαθμολογία</p>
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
                  ? 'Με πλεονάζον απόθεμα'
                  : selectedScenario === 'brand_launch'
                  ? 'Με στρατηγική επισήμανση'
                  : 'Με υψηλό περιθώριο'}
              </p>
              <p className="text-lg font-bold text-[#22C55E]">
                {selectedScenario === 'stock_clearance'
                  ? prioritizedProducts.filter(
                      (p) => getEffectiveStockLevel(p) / Math.max(p.stock_capacity || 0, 1) > 1
                    ).length
                  : selectedScenario === 'brand_launch'
                  ? prioritizedProducts.filter((p) => !!p.priority_tag).length
                  : prioritizedProducts.filter((p) => p.margin_tier === 'high').length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Συστάσεις καναλιών (segments + budget allocation + κανάλια + briefs) έχουν
          μεταφερθεί στο Channel Activation. Εδώ ο ιδιοκτήτης ορίζει ΜΟΝΟ την εμπορική
          πολιτική· οι λεπτομέρειες υλοποίησης ζουν δίπλα στους πίνακες ενεργοποίησης. */}

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
          impactProductFilter={buildImpactProductFilter(
            pendingScenarioChange === 'sales_base' && pendingSalesBaseScope
              ? (p) => productParticipatesInSalesBase(salesBaseProductById.get(p.id) ?? p, pendingSalesBaseScope)
              : pendingScenarioChange === 'price_benchmark' && pendingPriceBenchmarkScope
                ? (p) =>
                    productInPriceBenchmarkScopeWithLookup(
                      p,
                      pendingPriceBenchmarkScope,
                      benchmarkLookupMap,
                    )
                : undefined
          )}
          scoreContext={
            pendingScenarioChange === 'price_benchmark' ? benchmarkScoreContext : undefined
          }
        />
      )}

      <SalesBaseSetupModal
        isOpen={salesBaseSetupOpen}
        onClose={() => setSalesBaseSetupOpen(false)}
        products={salesBaseProducts}
        initialScope={
          activeStrategy?.scenarioId === 'sales_base'
            ? (activeStrategy as { salesBaseScope?: SalesBaseScope }).salesBaseScope
            : undefined
        }
        onContinue={(scope) => {
          startTransition(() => {
            setPendingSalesBaseScope(scope);
            setSalesBaseSetupOpen(false);
            setPendingScenarioChange('sales_base');
          });
        }}
        hasConnector={hasConnector}
        hasFreshWindowedStats={skuStatsHasWindows}
        stockMovementBaselineDate={stockMovementBaselineDate}
        hasMovementWindows={hasMovementData}
        hasProcurementCategories={hasProcurementCategories}
        onRefreshStats={async () => {
          const r = await refreshAggregates();
          if (r.ok) {
            toast.success('Τα stats ενημερώθηκαν. Ανανεώστε τη σελίδα για να δείτε τα νέα αποτελέσματα.');
          } else {
            toast.error(`Αποτυχία: ${r.error ?? 'άγνωστο σφάλμα'}`);
          }
        }}
      />

      <PriceBenchmarkSetupModal
        isOpen={priceBenchmarkSetupOpen}
        onClose={() => setPriceBenchmarkSetupOpen(false)}
        products={products}
        benchmarks={benchmarks}
        initialScope={
          activeStrategy?.scenarioId === 'price_benchmark'
            ? (activeStrategy as { priceBenchmarkScope?: PriceBenchmarkStrategyScope }).priceBenchmarkScope
            : undefined
        }
        onContinue={(scope) => {
          startTransition(() => {
            setPendingPriceBenchmarkScope(scope);
            setPriceBenchmarkSetupOpen(false);
            setPendingScenarioChange('price_benchmark');
          });
        }}
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
              <ModalHeader
                toolbarAriaLabel="Κλείσιμο"
                title={<h2 className="text-xl font-bold text-[#1A1A1A]">Εξαγωγή product feed</h2>}
                actions={
                  <button
                    type="button"
                    onClick={() => setShowFeedFormatModal(false)}
                    className="rounded-lg p-2 transition-colors hover:bg-[#F5F5F5]"
                  >
                    <X size={20} className="text-[#4A4A4A]" />
                  </button>
                }
              />

              {/* Content */}
              <div className="p-6 space-y-3">
                <p className="text-sm text-[#4A4A4A] mb-4">
                  Εξαγωγή feed με <strong>{allPrioritizedProducts.length}</strong> προϊόντα, ταξινομημένα βάσει της τρέχουσας στρατηγικής.
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
                    <p className="text-xs text-[#4A4A4A]">Λήψη ως αρχείο Excel</p>
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
                    <p className="text-xs text-[#4A4A4A]">Λήψη ως αρχείο CSV</p>
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

      {/* Briefing Drawer */}
      {showBriefingDrawer && briefingName && (
        <BriefingDrawer
          strategyName={briefingName}
          onClose={() => setShowBriefingDrawer(false)}
          onSent={() => {
            setShowBriefingDrawer(false);
            setBriefingName(null);
          }}
        />
      )}
    </div>
  );
}
