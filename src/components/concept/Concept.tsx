import { motion } from 'framer-motion';
import {
  Target,
  Package,
  Flag,
  TrendingUp,
  Users,
  Database,
  SlidersHorizontal,
  CheckCircle2,
  Megaphone,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { Card, CardHeader, Button } from '../common';
import { weightFactors, scenarios } from '../../data/mockScenarios';

const factorIcons: Record<string, React.ReactNode> = {
  profit: <Target size={20} />,
  stock: <Package size={20} />,
  strategic: <Flag size={20} />,
  revenue: <TrendingUp size={20} />,
  fit: <Users size={20} />
};

const workflowSteps = [
  { id: '1', label: 'Data', desc: 'Products, margins, stock, RFM segments', icon: <Database size={18} /> },
  { id: '2', label: 'Scenario', desc: 'Choose goal (Profit, Stock, Brand, Revenue)', icon: <Sparkles size={18} /> },
  { id: '3', label: 'Weights', desc: 'Configure factor weights → composite score', icon: <SlidersHorizontal size={18} /> },
  { id: '4', label: 'Approval', desc: 'Draft → Review → Approved', icon: <CheckCircle2 size={18} /> },
  { id: '5', label: 'Channels', desc: 'Activate per segment & strategy', icon: <Megaphone size={18} /> }
];

interface ConceptProps {
  onNavigateToStrategy?: () => void;
}

export function Concept({ onNavigateToStrategy }: ConceptProps) {
  return (
    <div className="space-y-8 pb-8">
      {/* Hero */}
      <div className="text-center py-8 px-4">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[var(--nts-charcoal)]"
        >
          How Performance+ works
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-2 text-[var(--nts-medium-gray)] max-w-xl mx-auto"
        >
          Product prioritization για marketing campaigns βασισμένο σε 5 παράγοντες και composite score.
          Επίλεξε scenario, ρύθμισε τα weights, πάρε approval και ενεργοποίησε τα channels.
        </motion.p>
      </div>

      {/* Workflow */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-4">Workflow</h2>
        <div className="flex flex-wrap items-stretch gap-3">
          {workflowSteps.map((step, i) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 * i }}
              className="flex items-center gap-3 min-w-0 flex-1 basis-[140px]"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] flex items-center justify-center text-[var(--nts-charcoal)]">
                {step.icon}
              </div>
              <div className="min-w-0">
                <span className="font-medium text-[var(--nts-charcoal)] text-sm">{step.label}</span>
                <p className="text-xs text-[var(--nts-medium-gray)] truncate" title={step.desc}>
                  {step.desc}
                </p>
              </div>
              {i < workflowSteps.length - 1 && (
                <ArrowRight size={14} className="flex-shrink-0 text-[var(--nts-border-gray)] hidden sm:block" />
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* 5 Factors */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-4">Οι 5 παράγοντες (Weight Factors)</h2>
        <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
          Το composite score κάθε προϊόντος = σταθμισμένο άθροισμα των scores ανά παράγοντα. Όσο υψηλότερο το weight,
          τόσο περισσότερο επηρεάζει την προτεραιοποίηση.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {weightFactors.map((f, i) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
            >
              <Card padding="md" className="h-full">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                    style={{ backgroundColor: f.color }}
                  >
                    {factorIcons[f.id] ?? <Target size={20} />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[var(--nts-charcoal)] text-sm">{f.name}</h3>
                    <p className="text-xs text-[var(--nts-medium-gray)] mt-0.5">{f.tooltip}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Scenarios */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-4">Predefined scenarios</h2>
        <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
          Κάθε scenario ορίζει διαφορετική κατανομή weights ανάλογα με τον στόχο (κέρδος, εκκαθάριση, launch, τζίρος).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {scenarios.filter(s => s.weights).map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
            >
              <Card padding="sm" className="h-full">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h3 className="font-medium text-[var(--nts-charcoal)] text-sm">{s.name}</h3>
                    <p className="text-xs text-[var(--nts-medium-gray)] mt-0.5">{s.description}</p>
                  </div>
                  {s.weights && (
                    <div className="flex gap-1 flex-shrink-0">
                      {Object.entries(s.weights)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([key, value]) => (
                          <div
                            key={key}
                            className="h-1.5 w-4 rounded-full bg-[var(--nts-border-gray)]"
                            style={{
                              opacity: 0.4 + (value / 100) * 0.6
                            }}
                            title={`${key}: ${value}%`}
                          />
                        ))}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section>
        <Card padding="lg" className="bg-[var(--nts-light-gray)] border-[var(--nts-border-gray)]">
          <CardHeader
            title="Έτοιμος να ρυθμίσεις τη στρατηγική;"
            subtitle="Strategy Weights → διάλεξε scenario ή custom weights → preview impact → submit για approval."
            icon={<SlidersHorizontal size={20} className="text-[#FF6B35]" />}
          />
          <Button
            variant="primary"
            onClick={onNavigateToStrategy}
          >
            Άνοιγμα Strategy Weights
          </Button>
        </Card>
      </section>
    </div>
  );
}
