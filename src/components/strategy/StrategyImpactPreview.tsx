import { motion } from 'framer-motion';
import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Package,
  FileText,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Pause,
  Play,
  Check,
  SlidersHorizontal
} from 'lucide-react';
import { Badge, Button } from '../common';
import { useProducts, useCampaigns, useContent } from '../../hooks';
import { calculateCompositeScore } from '../../utils/compositeScore';
import { scenarios } from '../../data/mockScenarios';
import type { Product } from '../../types';

interface StrategyImpactPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentWeights: Record<string, number>;
  newWeights: Record<string, number>;
  currentScenarioId?: string;
  newScenarioId?: string;
}

export function StrategyImpactPreview({ 
  isOpen, 
  onClose, 
  onConfirm,
  currentWeights,
  newWeights,
  currentScenarioId,
  newScenarioId
}: StrategyImpactPreviewProps) {
  if (!isOpen) return null;
  const { products } = useProducts();
  const { campaigns } = useCampaigns();
  const { contentItems } = useContent();

  const from = useMemo(() => {
    const scenario = scenarios.find(s => s.id === currentScenarioId);
    return {
      name: scenario?.name || 'Current Strategy',
      icon: scenario?.icon || ''
    };
  }, [currentScenarioId]);

  const to = useMemo(() => {
    const scenario = scenarios.find(s => s.id === newScenarioId);
    return {
      name: scenario?.name || 'New Strategy',
      icon: scenario?.icon || ''
    };
  }, [newScenarioId]);

  // Check if weights are the same (same strategy selected)
  const isSameStrategy = useMemo(() => {
    const currentKeys = Object.keys(currentWeights).sort();
    const newKeys = Object.keys(newWeights).sort();
    if (currentKeys.length !== newKeys.length) return false;
    return currentKeys.every(key => Math.abs((currentWeights[key] || 0) - (newWeights[key] || 0)) < 0.01);
  }, [currentWeights, newWeights]);

  // Calculate product impacts by comparing composite scores
  const productImpacts = useMemo(() => {
    if (products.length === 0) {
      return {
        will_deprioritize: 0,
        will_prioritize: 0,
        samples: [] as Array<{ name: string; change: string }>
      };
    }

    const productChanges = products.map((product: Product) => {
      const currentScore = calculateCompositeScore(product, currentWeights, undefined, currentScenarioId);
      const newScore = calculateCompositeScore(product, newWeights, undefined, newScenarioId);
      const scoreDiff = newScore - currentScore;
      
      // Use a more sensitive threshold: 1% of score range or absolute 1 point minimum
      // This ensures we catch meaningful changes even when scores are similar
      const threshold = Math.max(1, Math.abs(currentScore) * 0.01);
      
      return {
        product,
        currentScore,
        newScore,
        scoreDiff,
        change: scoreDiff > threshold ? 'prioritize' : scoreDiff < -threshold ? 'deprioritize' : 'neutral'
      };
    });

    // If same strategy, show current prioritization based on scores
    // Use different percentages to ensure different counts
    if (isSameStrategy) {
      const sortedByScore = [...productChanges].sort((a, b) => b.newScore - a.newScore);
      
      const totalProducts = products.length;
      // Use top 20% for prioritized and bottom 10% for deprioritized to ensure different counts
      const top20Percent = Math.max(1, Math.floor(totalProducts * 0.20)); // Top 20%
      const bottom10Percent = Math.max(1, Math.floor(totalProducts * 0.10)); // Bottom 10%
      
      // Ensure no overlap: top from start, bottom from end
      const topProducts = sortedByScore.slice(0, top20Percent);
      const bottomStartIndex = Math.max(top20Percent + 1, totalProducts - bottom10Percent);
      const bottomProducts = sortedByScore.slice(bottomStartIndex);
      
      // Additional safety: filter out any overlap by ID
      const topIds = new Set(topProducts.map(p => p.product.id));
      const bottomProductsFiltered = bottomProducts.filter(p => !topIds.has(p.product.id));
      
      return {
        will_deprioritize: bottomProductsFiltered.length,
        will_prioritize: topProducts.length,
        samples: [
          ...topProducts.slice(0, 5).map(p => ({ name: p.product.name || 'Unknown', change: 'prioritize' })),
          ...bottomProductsFiltered.slice(0, 5).map(p => ({ name: p.product.name || 'Unknown', change: 'deprioritize' }))
        ]
      };
    }

    const willPrioritize = productChanges.filter(p => p.change === 'prioritize');
    const willDeprioritize = productChanges.filter(p => p.change === 'deprioritize');
    
    const samples = [
      ...willPrioritize.slice(0, 5).map(p => ({ name: p.product.name || 'Unknown', change: 'prioritize' })),
      ...willDeprioritize.slice(0, 5).map(p => ({ name: p.product.name || 'Unknown', change: 'deprioritize' }))
    ];

    return {
      will_deprioritize: willDeprioritize.length,
      will_prioritize: willPrioritize.length,
      samples
    };
  }, [products, currentWeights, newWeights, currentScenarioId, newScenarioId, isSameStrategy]);

  // Calculate content alignment impacts
  const contentImpacts = useMemo(() => {
    if (contentItems.length === 0) {
      return {
        aligned: 0,
        needs_review: 0,
        on_hold: 0,
        affected_items: [] as Array<{ title: string; status: string; reason: string }>
      };
    }

    // If same strategy, show current state
    if (isSameStrategy) {
      const aligned = contentItems.filter(item => 
        item.strategy_match === newScenarioId || item.is_aligned === true || !item.strategy_match
      ).length;
      
      const needsReview = contentItems.filter(item => 
        item.status !== 'on_hold' && item.status !== 'completed' && 
        (item.strategy_match !== newScenarioId || item.is_aligned === false)
      ).length;
      
      const onHold = contentItems.filter(item => item.status === 'on_hold').length;

      return {
        aligned,
        needs_review: needsReview,
        on_hold: onHold,
        affected_items: contentItems
          .filter(item => item.status !== 'on_hold' && item.status !== 'completed')
          .slice(0, 5)
          .map(item => ({
            title: item.title || 'Untitled',
            status: item.strategy_match === newScenarioId ? 'aligned' : 'needs_review',
            reason: item.alignment_warning || (item.strategy_match ? 'Strategy mismatch' : 'No strategy assigned')
          }))
      };
    }

    // Content aligned if strategy_match matches new scenario
    const aligned = contentItems.filter(item => 
      item.strategy_match === newScenarioId || item.is_aligned === true
    ).length;
    
    const needsReview = contentItems.filter(item => 
      item.strategy_match !== newScenarioId && item.is_aligned === false && item.status !== 'on_hold'
    ).length;
    
    const onHold = contentItems.filter(item => item.status === 'on_hold').length;

    const affectedItems = contentItems
      .filter(item => item.strategy_match !== newScenarioId && item.is_aligned === false)
      .slice(0, 5)
      .map(item => ({
        title: item.title || 'Untitled',
        status: item.status === 'on_hold' ? 'on_hold' : 'needs_review',
        reason: item.alignment_warning || 'Strategy mismatch'
      }));

    return {
      aligned,
      needs_review: needsReview,
      on_hold: onHold,
      affected_items: affectedItems
    };
  }, [contentItems, newScenarioId, isSameStrategy]);

  // Calculate campaign impacts
  const campaignImpacts = useMemo(() => {
    const activeCampaigns = campaigns.filter((c: any) => c.status === 'active' || !c.status).length;
    // Simple estimation: some campaigns might need adjustment
    const willAdjust = Math.min(activeCampaigns, Math.floor(activeCampaigns * 0.3));
    const willPause = 0; // Conservative estimate

    return {
      active: activeCampaigns,
      will_pause: willPause,
      will_adjust: willAdjust
    };
  }, [campaigns]);

  // Calculate estimated business impact
  const estimatedImpact = useMemo(() => {
    if (products.length === 0) {
      return {
        margin: '0%',
        volume: '0',
        revenue: '€0'
      };
    }

    const prioritizedProducts = productImpacts.will_prioritize;
    const deprioritizedProducts = productImpacts.will_deprioritize;
    
    if (isSameStrategy) {
      // Show current state metrics
      const avgMargin = products.reduce((sum: number, p: Product) => sum + (p.margin_percentage || 0), 0) / products.length;
      const totalRevenue = products.reduce((sum: number, p: Product) => 
        sum + ((p.price || 0) * (p.qty_sold_period || 0)), 0);
      
      return {
        margin: `${Math.round(avgMargin)}%`,
        volume: `${prioritizedProducts}`,
        revenue: `€${Math.round(totalRevenue / 1000)}K`
      };
    }
    
    // Estimate margin improvement from prioritizing high-margin products
    const marginImpact = prioritizedProducts > 0 
      ? Math.round((prioritizedProducts / products.length) * 100 * 0.1) // Conservative 0.1% per prioritized product
      : 0;

    // Estimate volume impact
    const volumeImpact = prioritizedProducts - deprioritizedProducts;

    // Estimate revenue impact (simplified)
    const avgPrice = products.reduce((sum: number, p: Product) => sum + (p.price || 0), 0) / products.length;
    const revenueImpact = volumeImpact * avgPrice * 0.1; // Conservative 10% conversion

    return {
      margin: `${marginImpact > 0 ? '+' : ''}${marginImpact}%`,
      volume: `${volumeImpact > 0 ? '+' : ''}${volumeImpact}`,
      revenue: `€${Math.round(revenueImpact / 1000)}K`
    };
  }, [products, productImpacts, isSameStrategy]);

  const impacts = {
    products: productImpacts,
    content: contentImpacts,
    campaigns: campaignImpacts,
    estimated_impact: estimatedImpact
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-4">
            <AlertTriangle size={24} className="text-[#F59E0B]" />
            <div>
              <h2 className="text-xl font-bold text-[#1A1A1A]">
                {isSameStrategy ? 'Current Strategy Overview' : 'Strategy Change Impact Preview'}
              </h2>
              <p className="text-[#4A4A4A]">
                {isSameStrategy 
                  ? 'Current prioritization and alignment status' 
                  : 'Review the effects before applying this change'}
              </p>
            </div>
          </div>

          {/* From → To */}
          <div className="flex items-center gap-4 mt-6 p-4 bg-[#F5F5F5] rounded-xl">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg border border-[var(--nts-border-gray)] bg-white flex items-center justify-center text-[var(--nts-medium-gray)]">
                <SlidersHorizontal size={16} />
              </div>
              <span className="font-medium text-[#1A1A1A]">{from.name}</span>
            </div>
            <ArrowRight size={24} className="text-[var(--nts-accent)]" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg border border-[var(--nts-border-gray)] bg-white flex items-center justify-center text-[var(--nts-medium-gray)]">
                <SlidersHorizontal size={16} />
              </div>
              <span className="font-medium text-[#1A1A1A]">{to.name}</span>
            </div>
          </div>
        </div>

        {/* Impact Sections */}
        <div className="p-6 space-y-6">
          {/* Products Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <Package size={18} className="text-[var(--nts-medium-gray)]" />
              <h3 className="font-semibold text-[#1A1A1A]">Product Prioritization</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-[#FEE2E2] rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown size={16} className="text-[#EF4444]" />
                  <span className="text-sm font-medium text-[#991B1B]">
                    {isSameStrategy ? 'Currently Deprioritized' : 'Will Deprioritize'}
                  </span>
                </div>
                <p className="text-2xl font-bold text-[#EF4444] mt-1">{impacts.products.will_deprioritize}</p>
                <p className="text-xs text-[#991B1B]">products</p>
              </div>
              <div className="p-3 bg-[#DCFCE7] rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-[#22C55E]" />
                  <span className="text-sm font-medium text-[#166534]">
                    {isSameStrategy ? 'Currently Prioritized' : 'Will Prioritize'}
                  </span>
                </div>
                <p className="text-2xl font-bold text-[#22C55E] mt-1">{impacts.products.will_prioritize}</p>
                <p className="text-xs text-[#166534]">products</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {impacts.products.samples.map((sample, i) => (
                <Badge 
                  key={i} 
                  variant={sample.change === 'prioritize' ? 'success' : 'danger'}
                  size="sm"
                >
                  {sample.change === 'prioritize' ? '↑' : '↓'} {sample.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Content Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={18} className="text-[var(--nts-medium-gray)]" />
              <h3 className="font-semibold text-[#1A1A1A]">Content Alignment</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-[#DCFCE7] rounded-lg">
                <p className="text-xl font-bold text-[#22C55E]">{impacts.content.aligned}</p>
                <p className="text-xs text-[#166534]">Still aligned</p>
              </div>
              <div className="text-center p-3 bg-[#FEF3C7] rounded-lg">
                <p className="text-xl font-bold text-[#F59E0B]">{impacts.content.needs_review}</p>
                <p className="text-xs text-[#92400E]">Needs review</p>
              </div>
              <div className="text-center p-3 bg-[#F5F5F5] rounded-lg">
                <p className="text-xl font-bold text-[#4A4A4A]">{impacts.content.on_hold}</p>
                <p className="text-xs text-[#4A4A4A]">On hold</p>
              </div>
            </div>
            <div className="space-y-2">
              {impacts.content.affected_items.map((item, i) => (
                <div 
                  key={i} 
                  className={`flex items-center justify-between p-2 rounded-lg ${
                    item.status === 'will_activate' ? 'bg-[#DCFCE7]' : 'bg-[#FEF3C7]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.status === 'will_activate' ? (
                      <Play size={14} className="text-[#22C55E]" />
                    ) : (
                      <Pause size={14} className="text-[#F59E0B]" />
                    )}
                    <span className="text-sm text-[#1A1A1A]">{item.title}</span>
                  </div>
                  <span className="text-xs text-[#4A4A4A]">{item.reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Campaigns Impact */}
          <div className="p-4 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <Megaphone size={18} className="text-[var(--nts-accent)]" />
              <h3 className="font-semibold text-[#1A1A1A]">Ενεργά Campaigns</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-[#DBEAFE] rounded-lg">
                <p className="text-xl font-bold text-[#3B82F6]">{impacts.campaigns.active}</p>
                <p className="text-xs text-[#1E40AF]">Τρέχον ενεργά</p>
              </div>
              <div className="text-center p-3 bg-[#FEF3C7] rounded-lg">
                <p className="text-xl font-bold text-[#F59E0B]">{impacts.campaigns.will_pause}</p>
                <p className="text-xs text-[#92400E]">Will pause</p>
              </div>
              <div className="text-center p-3 bg-[var(--nts-light-gray)] rounded-lg">
                <p className="text-xl font-bold text-[var(--nts-accent)]">{impacts.campaigns.will_adjust}</p>
                <p className="text-xs text-[#C2410C]">Will adjust</p>
              </div>
            </div>
          </div>

          {/* Estimated Impact */}
          <div className="p-4 bg-gradient-to-r from-[#F5F5F5] to-white rounded-xl border border-[#E5E5E5]">
            <h3 className="font-semibold text-[#1A1A1A] mb-3">Estimated Business Impact</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-lg font-bold text-[#22C55E]">{impacts.estimated_impact.margin}</p>
                <p className="text-xs text-[#4A4A4A]">Margin</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-[#EF4444]">{impacts.estimated_impact.volume}</p>
                <p className="text-xs text-[#4A4A4A]">Volume</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-[#3B82F6]">{impacts.estimated_impact.revenue}</p>
                <p className="text-xs text-[#4A4A4A]">Net Revenue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-[#E5E5E5] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Ακύρωση
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={onConfirm}>
            Confirm Strategy Change
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
