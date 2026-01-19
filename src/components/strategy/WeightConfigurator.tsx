import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Send,
  Download,
  Sparkles,
  AlertCircle,
  Eye,
  DollarSign,
  Package,
  Target,
  TrendingUp,
  Users
} from 'lucide-react';
import { Card, CardHeader, Button, Slider, Badge } from '../common';
import { ScenarioSelector } from './ScenarioSelector';
import { ChannelRecommendations } from './ChannelRecommendations';
import { ApprovalWorkflow } from './ApprovalWorkflow';
import { StrategyImpactPreview } from './StrategyImpactPreview';
import {
  scenarios,
  defaultWeights,
  weightFactors,
  channelRecommendations
} from '../../data';
import { products, calculateCompositeScore } from '../../data/mockProducts';
import { rfmSegments } from '../../data';

type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'implementing';

export function WeightConfigurator() {
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0].id);
  const [weights, setWeights] = useState<Record<string, number>>(
    scenarios[0].weights || defaultWeights
  );
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('draft');
  const [selectedSegment, setSelectedSegment] = useState('champions');
  const [showImpactPreview, setShowImpactPreview] = useState(false);
  const [pendingScenarioChange, setPendingScenarioChange] = useState<string | null>(null);

  // Handle scenario change with impact preview
  const handleScenarioChange = useCallback((scenarioId: string) => {
    // If changing from an approved/implementing scenario, show impact preview
    if (approvalStatus === 'approved' || approvalStatus === 'implementing') {
      setPendingScenarioChange(scenarioId);
      setShowImpactPreview(true);
    } else {
      applyScenarioChange(scenarioId);
    }
  }, [approvalStatus]);

  // Apply the scenario change
  const applyScenarioChange = useCallback((scenarioId: string) => {
    setSelectedScenario(scenarioId);
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (scenario?.weights) {
      setWeights(scenario.weights);
    }
    setApprovalStatus('draft');
    setShowImpactPreview(false);
    setPendingScenarioChange(null);
  }, []);

  // Confirm strategy change after impact preview
  const confirmStrategyChange = useCallback(() => {
    if (pendingScenarioChange) {
      applyScenarioChange(pendingScenarioChange);
    }
  }, [pendingScenarioChange, applyScenarioChange]);

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
    },
    [weights]
  );

  // Reset to default
  const handleReset = useCallback(() => {
    setWeights(defaultWeights);
    setSelectedScenario('custom');
    setApprovalStatus('draft');
  }, []);

  // Calculate prioritized products
  const prioritizedProducts = useMemo(() => {
    return products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, weights)
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
      .slice(0, 10);
  }, [weights]);

  // Get channel recommendations for current scenario
  const currentRecommendations = useMemo(() => {
    const scenarioKey = selectedScenario === 'custom' ? 'profit_max' : selectedScenario;
    return channelRecommendations[scenarioKey] || channelRecommendations.profit_max;
  }, [selectedScenario]);

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between max-w-full overflow-x-hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight">
            Strategy Weights Configurator
          </h2>
          <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
            Customize product prioritization factors for your marketing campaigns
          </p>
        </div>
        <ApprovalWorkflow
          status={approvalStatus}
          onStatusChange={setApprovalStatus}
        />
      </div>

      {/* Scenario Selector */}
      <ScenarioSelector
        selectedScenario={selectedScenario}
        onScenarioChange={handleScenarioChange}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-full overflow-x-hidden">
        {/* Weight Sliders */}
        <Card className="xl:col-span-1" padding="lg">
          <CardHeader
            title="Factor Weights"
            subtitle={`Total: ${totalWeight}%`}
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
                  factor.id === 'profit' ? <DollarSign size={16} /> :
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
              onClick={() => setShowImpactPreview(true)}
            >
              Preview Impact
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              icon={<Download size={16} />}
              disabled={approvalStatus !== 'approved'}
            >
              Generate Product Feed
            </Button>
          </div>
        </Card>

        {/* Live Preview */}
        <Card className="xl:col-span-2" padding="lg">
          <CardHeader
            title="Live Preview"
            subtitle="Top 10 Prioritized Products"
            icon={<Sparkles size={18} className="text-[var(--nts-medium-gray)]" />}
          />

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <th className="pb-3 font-medium">Rank</th>
                  <th className="pb-3 font-medium">Product</th>
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium">Margin</th>
                  <th className="pb-3 font-medium">Stock</th>
                  <th className="pb-3 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {prioritizedProducts.map((product, index) => (
                    <motion.tr
                      key={product.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ delay: index * 0.03 }}
                      className="border-b border-[#E5E5E5] last:border-0"
                    >
                      <td className="py-3">
                        <span className="w-6 h-6 rounded-full bg-[#F5F5F5] flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-3">
                        <div>
                          <p className="text-sm font-medium text-[#1A1A1A] truncate max-w-[200px]">
                            {product.name}
                          </p>
                          <p className="text-xs text-[#9CA3AF]">{product.sku}</p>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className="text-sm text-[#4A4A4A]">
                          {product.category}
                        </span>
                      </td>
                      <td className="py-3">
                        <Badge
                          variant={
                            product.margin_tier === 'high'
                              ? 'success'
                              : product.margin_tier === 'medium'
                              ? 'warning'
                              : 'danger'
                          }
                        >
                          {product.margin_percentage.toFixed(1)}%
                        </Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(product.stock_level / product.stock_capacity) * 100}%`,
                                backgroundColor:
                                  product.stock_level / product.stock_capacity > 0.8
                                    ? '#EF4444'
                                    : product.stock_level / product.stock_capacity > 0.5
                                    ? '#F59E0B'
                                    : '#22C55E'
                              }}
                            />
                          </div>
                          <span className="text-xs text-[#4A4A4A] font-mono">
                            {product.stock_level}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <motion.span
                          key={product.composite_score}
                          initial={{ scale: 1.2 }}
                          animate={{ scale: 1 }}
                          className="text-lg font-bold text-[#FF6B35] font-mono"
                        >
                          {product.composite_score?.toFixed(1)}
                        </motion.span>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

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
                {(
                  prioritizedProducts.reduce((sum, p) => sum + (p.composite_score || 0), 0) /
                  prioritizedProducts.length
                ).toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#4A4A4A]">High Margin Products</p>
              <p className="text-lg font-bold text-[#22C55E]">
                {prioritizedProducts.filter((p) => p.margin_tier === 'high').length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Channel Recommendations */}
      <Card padding="lg">
        <CardHeader
          title="Channel Recommendations"
          subtitle="AI-powered channel mix based on selected strategy"
          icon={<Sparkles size={18} className="text-[var(--nts-medium-gray)]" />}
          action={
            <div className="flex items-center gap-2">
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

        <ChannelRecommendations
          recommendations={currentRecommendations[selectedSegment] || currentRecommendations.champions}
          segment={rfmSegments.find((s) => s.id === selectedSegment) || rfmSegments[0]}
        />
      </Card>

      {/* Strategy Impact Preview Modal */}
      <StrategyImpactPreview
        isOpen={showImpactPreview}
        onClose={() => {
          setShowImpactPreview(false);
          setPendingScenarioChange(null);
        }}
        onConfirm={confirmStrategyChange}
      />
    </div>
  );
}
