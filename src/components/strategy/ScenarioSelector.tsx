import { motion } from 'framer-motion';
import { Check, Clock, Euro, Infinity, Layers, Package, Percent, Rocket, Scale, Settings, ShoppingBag, TrendingUp } from 'lucide-react';
import { scenarios } from '../../data';

interface ScenarioSelectorProps {
  selectedScenario: string | null;
  onScenarioChange: (scenarioId: string) => void;
  activeDuration?: number | 'ongoing';
  /** Suggested action from ERP (Product Intelligence) per scenario id */
  erpHints?: Record<string, string>;
}

export function ScenarioSelector({
  selectedScenario,
  onScenarioChange,
  activeDuration,
  erpHints,
}: ScenarioSelectorProps) {
  const scenarioIcon = (id: string) => {
    const cls = 'text-[var(--nts-medium-gray)]';
    switch (id) {
      case 'profit_max':
        return <Euro size={18} className={cls} />;
      case 'stock_clearance':
        return <Package size={18} className={cls} />;
      case 'brand_launch':
        return <Rocket size={18} className={cls} />;
      case 'revenue_push':
        return <TrendingUp size={18} className={cls} />;
      case 'sales_base':
        return <ShoppingBag size={18} className={cls} />;
      case 'price_benchmark':
        return <Scale size={18} className={cls} />;
      case 'mixed':
        return <Layers size={18} className={cls} />;
      case 'seasonal_discount':
        return <Percent size={18} className={cls} />;
      default:
        return <Settings size={18} className={cls} />;
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 max-w-full overflow-x-hidden">
      {scenarios.map((scenario, index) => {
        const isSelected = selectedScenario !== null && selectedScenario === scenario.id;
        
        return (
          <motion.div
            key={scenario.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <button
              onClick={() => onScenarioChange(scenario.id)}
              className={`
                w-full h-full min-w-0 min-h-[220px] p-4 rounded-xl border-2 text-left transition-all duration-200 flex flex-col
                ${isSelected
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-light-gray)]'
                  : 'border-[var(--border)] bg-white hover:border-[var(--nts-accent)]/50'
                }
              `}
              style={{
                boxShadow: isSelected
                  ? '0 6px 20px rgba(0,0,0,0.14), 0 3px 8px rgba(0,0,0,0.10)'
                  : '0 2px 6px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.08)'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.14), 0 3px 8px rgba(0,0,0,0.10)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.08)';
              }}
            >
              <div className="flex items-start justify-between">
                <span className="inline-flex">{scenarioIcon(scenario.id)}</span>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-5 h-5 bg-[var(--nts-accent)] rounded-full flex items-center justify-center"
                  >
                    <Check size={12} className="text-white" />
                  </motion.div>
                )}
              </div>
              <h3 className="font-semibold text-[var(--text-primary)] mt-3 text-sm">
                {scenario.name}
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {scenario.description}
              </p>
              {erpHints?.[scenario.id] && (
                <p className="text-[10px] font-semibold text-[#92400E] mt-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-100/80 leading-snug">
                  {erpHints[scenario.id]}
                </p>
              )}
              {(() => {
                const dur = isSelected && activeDuration !== undefined ? activeDuration : scenario.duration;
                if (dur === undefined) return null;
                return (
                  <div className="flex items-center gap-1 mt-2">
                    {dur === 'ongoing'
                      ? <Infinity size={12} className="text-[var(--text-muted)]" />
                      : <Clock size={12} className="text-[var(--text-muted)]" />
                    }
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {dur === 'ongoing' ? 'Συνεχής' : `${dur} ημέρες`}
                    </span>
                  </div>
                );
              })()}
              
              {scenario.weights && (
                <div className="mt-auto pt-3 border-t border-[var(--border)]">
                  <div className="flex gap-1">
                    {Object.entries(scenario.weights)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([key, value]) => (
                        <div
                          key={key}
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${value}%`,
                            backgroundColor: 
                              key === 'profit' ? '#22C55E' :
                              key === 'stock' ? '#3B82F6' :
                              key === 'strategic' ? '#8B5CF6' :
                              key === 'revenue' ? '#F59E0B' :
                              'var(--nts-accent)'
                          }}
                        />
                      ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    {scenario.cardHint ??
                      `${Object.entries(scenario.weights)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
                        .join(' + ')} focused`}
                  </p>
                </div>
              )}
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
