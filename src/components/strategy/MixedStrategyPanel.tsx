import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Euro, Package, Rocket, Scale, TrendingUp, Check, ArrowUp, ArrowDown, X } from 'lucide-react';
import { scenarios } from '../../data';
import { Button } from '../common';

export interface MixConfig {
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
}

interface MixedStrategyPanelProps {
  onApply: (blendedWeights: Record<string, number>, config: MixConfig) => void;
  onClose?: () => void;
  initialConfig?: MixConfig | null;
}

const BASE_SCENARIOS = scenarios.filter((s) => s.id !== 'mixed' && s.weights);

function scenarioIcon(id: string) {
  const cls = 'text-[var(--nts-medium-gray)]';
  switch (id) {
    case 'profit_max': return <Euro size={16} className={cls} />;
    case 'stock_clearance': return <Package size={16} className={cls} />;
    case 'brand_launch': return <Rocket size={16} className={cls} />;
    case 'revenue_push': return <TrendingUp size={16} className={cls} />;
    case 'sales_base': return <Package size={16} className={cls} />;
    case 'price_benchmark': return <Scale size={16} className={cls} />;
    default: return null;
  }
}

export function computeBlendedWeights(
  scenarioAId: string,
  scenarioBId: string,
  percentA: number
): Record<string, number> {
  const a = scenarios.find(s => s.id === scenarioAId);
  const b = scenarios.find(s => s.id === scenarioBId);
  if (!a?.weights || !b?.weights) return {};

  const pctA = percentA / 100;
  const pctB = 1 - pctA;
  const blended: Record<string, number> = {};
  const keys = Object.keys(a.weights);

  for (const key of keys) {
    blended[key] = Math.round(a.weights[key] * pctA + b.weights[key] * pctB);
  }

  const total = Object.values(blended).reduce((s, v) => s + v, 0);
  if (total !== 100 && keys.length > 0) {
    const largest = keys.reduce((a, b) => blended[a] > blended[b] ? a : b);
    blended[largest] += 100 - total;
  }

  return blended;
}

export function MixedStrategyPanel({ onApply, onClose, initialConfig }: MixedStrategyPanelProps) {
  const [scenarioA, setScenarioA] = useState<string | null>(initialConfig?.scenarioA ?? null);
  const [scenarioB, setScenarioB] = useState<string | null>(initialConfig?.scenarioB ?? null);
  const [percentA, setPercentA] = useState(initialConfig?.percentA ?? 70);

  useEffect(() => {
    if (initialConfig) {
      setScenarioA(initialConfig.scenarioA);
      setScenarioB(initialConfig.scenarioB);
      setPercentA(initialConfig.percentA);
    }
  }, [initialConfig?.scenarioA, initialConfig?.scenarioB, initialConfig?.percentA]);

  const percentB = 100 - percentA;

  const blendedWeights = useMemo(() => {
    if (!scenarioA || !scenarioB) return null;
    return computeBlendedWeights(scenarioA, scenarioB, percentA);
  }, [scenarioA, scenarioB, percentA]);

  const handleApply = useCallback(() => {
    if (!scenarioA || !scenarioB || !blendedWeights) return;
    onApply(blendedWeights, { scenarioA, scenarioB, percentA, percentB });
  }, [scenarioA, scenarioB, percentA, percentB, blendedWeights, onApply]);

  const handleSelectA = useCallback((id: string) => {
    setScenarioA(id);
    if (scenarioB === id) setScenarioB(null);
  }, [scenarioB]);

  const handleSelectB = useCallback((id: string) => {
    setScenarioB(id);
    if (scenarioA === id) setScenarioA(null);
  }, [scenarioA]);

  const weightKeys = ['profit', 'stock', 'strategic', 'revenue', 'fit'];
  const weightColors: Record<string, string> = {
    profit: '#22C55E', stock: '#3B82F6', strategic: '#8B5CF6',
    revenue: '#F59E0B', fit: '#F97316',
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="p-5 bg-white rounded-xl border-2 border-[#E5E5E5] relative"
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>

        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[#9CA3AF] hover:text-[var(--text-secondary)] transition-colors"
            title="Κλείσιμο"
          >
            <X size={18} />
          </button>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
          {/* Strategy A */}
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
              Στρατηγική Α
            </p>
            <div className="space-y-2">
              {BASE_SCENARIOS.map(s => {
                const selected = scenarioA === s.id;
                const disabled = scenarioB === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => !disabled && handleSelectA(s.id)}
                    disabled={disabled}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${
                      selected
                        ? 'border-[var(--nts-accent)] bg-[var(--nts-light-gray)]'
                        : disabled
                          ? 'border-[#E5E5E5] bg-[#FAFAFA] opacity-40 cursor-not-allowed'
                          : 'border-[#E5E5E5] bg-white hover:border-[var(--nts-accent)]/50'
                    }`}
                  >
                    {scenarioIcon(s.id)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{s.name}</p>
                      <p className="text-[11px] text-[#9CA3AF] truncate">{s.description}</p>
                    </div>
                    {selected && (
                      <div className="w-5 h-5 bg-[var(--nts-accent)] rounded-full flex items-center justify-center flex-shrink-0">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Percentage Slider */}
          <div className="flex flex-col items-center justify-center py-4 md:py-0 md:px-4 md:self-center">
            <div className="text-center mb-3">
              <p className="text-2xl font-bold text-[#1A1A1A] font-mono">
                {percentA}<span className="text-[#9CA3AF] mx-1">/</span>{percentB}
              </p>
              <p className="text-[10px] text-[#9CA3AF] mt-0.5">%</p>
            </div>

            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={percentA}
              onChange={e => setPercentA(Number(e.target.value))}
              className="w-32 md:w-24 accent-[var(--nts-accent)]"
            />

            <div className="flex justify-between w-32 md:w-24 mt-1">
              <span className="text-[10px] text-[#9CA3AF]">10%</span>
              <span className="text-[10px] text-[#9CA3AF]">90%</span>
            </div>
          </div>

          {/* Strategy B */}
          <div>
            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
              Στρατηγική Β
            </p>
            <div className="space-y-2">
              {BASE_SCENARIOS.map(s => {
                const selected = scenarioB === s.id;
                const disabled = scenarioA === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => !disabled && handleSelectB(s.id)}
                    disabled={disabled}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3 ${
                      selected
                        ? 'border-[var(--nts-accent)] bg-[var(--nts-light-gray)]'
                        : disabled
                          ? 'border-[#E5E5E5] bg-[#FAFAFA] opacity-40 cursor-not-allowed'
                          : 'border-[#E5E5E5] bg-white hover:border-[var(--nts-accent)]/50'
                    }`}
                  >
                    {scenarioIcon(s.id)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{s.name}</p>
                      <p className="text-[11px] text-[#9CA3AF] truncate">{s.description}</p>
                    </div>
                    {selected && (
                      <div className="w-5 h-5 bg-[var(--nts-accent)] rounded-full flex items-center justify-center flex-shrink-0">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Blended weights preview */}
        <AnimatePresence>
          {blendedWeights && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mt-4 pt-4 border-t border-[#E5E5E5]"
            >
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                Συνδυασμένα βάρη
              </p>
              <div className="flex gap-1 mb-1 h-2 rounded-full overflow-hidden">
                {weightKeys.map(key => (
                  <div
                    key={key}
                    style={{
                      width: `${blendedWeights[key]}%`,
                      backgroundColor: weightColors[key],
                      transition: 'width 0.3s ease',
                    }}
                  />
                ))}
              </div>
              <div className="flex gap-3 flex-wrap mt-1">
                {weightKeys.map(key => (
                  <span key={key} className="text-[10px] text-[#9CA3AF]">
                    <span style={{ color: weightColors[key] }}>●</span>{' '}
                    {key.charAt(0).toUpperCase() + key.slice(1)} {blendedWeights[key]}%
                  </span>
                ))}
              </div>

              {scenarioA && (() => {
                const baseWeights = scenarios.find(s => s.id === scenarioA)?.weights;
                if (!baseWeights) return null;
                const diffs = weightKeys
                  .map(key => ({ key, from: baseWeights[key], to: blendedWeights[key], diff: blendedWeights[key] - baseWeights[key] }))
                  .filter(d => d.diff !== 0)
                  .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
                  .slice(0, 3);
                if (diffs.length === 0) return null;
                return (
                  <div className="flex gap-3 flex-wrap mt-2">
                    {diffs.map(d => (
                      <span key={d.key} className="inline-flex items-center gap-1 text-[10px]">
                        <span style={{ color: weightColors[d.key] }}>●</span>
                        <span className="text-[#9CA3AF]">{d.key.charAt(0).toUpperCase() + d.key.slice(1)}</span>
                        <span className="text-[#9CA3AF]">{d.from}%</span>
                        <span className="text-[#9CA3AF]">→</span>
                        <span className={d.diff > 0 ? 'text-[#22C55E]' : 'text-[#9CA3AF]'}>
                          {d.to}%
                        </span>
                        {d.diff > 0
                          ? <ArrowUp size={9} className="text-[#22C55E]" />
                          : <ArrowDown size={9} className="text-[#9CA3AF]" />
                        }
                      </span>
                    ))}
                  </div>
                );
              })()}

              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  onClick={handleApply}
                >
                  Εφαρμογή
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!scenarioA && !scenarioB && (
          <p className="text-xs text-[#9CA3AF] mt-3 text-center">
            Επιλέξτε 2 στρατηγικές και ρυθμίστε τα ποσοστά
          </p>
        )}
      </div>
    </motion.div>
  );
}
