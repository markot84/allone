import { motion } from 'framer-motion';
import { Check, DollarSign, Package, Rocket, Settings, TrendingUp } from 'lucide-react';
import { scenarios } from '../../data';

interface ScenarioSelectorProps {
  selectedScenario: string;
  onScenarioChange: (scenarioId: string) => void;
}

export function ScenarioSelector({
  selectedScenario,
  onScenarioChange
}: ScenarioSelectorProps) {
  const scenarioIcon = (id: string) => {
    const cls = 'text-[var(--nts-medium-gray)]';
    switch (id) {
      case 'profit_max':
        return <DollarSign size={18} className={cls} />;
      case 'stock_clearance':
        return <Package size={18} className={cls} />;
      case 'brand_launch':
        return <Rocket size={18} className={cls} />;
      case 'revenue_push':
        return <TrendingUp size={18} className={cls} />;
      default:
        return <Settings size={18} className={cls} />;
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-w-full overflow-x-hidden">
      {scenarios.map((scenario, index) => {
        const isSelected = selectedScenario === scenario.id;
        
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
                w-full min-w-0 p-4 rounded-xl border-2 text-left transition-all duration-200
                ${isSelected
                  ? 'border-[#FF6B35] bg-[#FFF0EB] shadow-md'
                  : 'border-[#E5E5E5] bg-white hover:border-[#FF6B35]/50 hover:shadow-sm'
                }
              `}
            >
              <div className="flex items-start justify-between">
                <span className="inline-flex">{scenarioIcon(scenario.id)}</span>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-5 h-5 bg-[#FF6B35] rounded-full flex items-center justify-center"
                  >
                    <Check size={12} className="text-white" />
                  </motion.div>
                )}
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mt-3 text-sm">
                {scenario.name}
              </h3>
              <p className="text-xs text-[#4A4A4A] mt-1">
                {scenario.description}
              </p>
              
              {scenario.weights && (
                <div className="mt-3 pt-3 border-t border-[#E5E5E5]">
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
                              '#FF6B35'
                          }}
                        />
                      ))}
                  </div>
                  <p className="text-[10px] text-[#9CA3AF] mt-1">
                    {Object.entries(scenario.weights)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 2)
                      .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
                      .join(' + ')} focused
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
