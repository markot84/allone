import { useState, useMemo } from 'react';
import { ArrowDown, ArrowUp, Minus, X } from 'lucide-react';
import { Button, Tooltip, ModalHeader } from '../common';
import { scenarios, weightFactors } from '../../data';
import { calculateCompositeScore } from '../../utils/compositeScore';
import type { Product } from '../../types';

/**
 * Sample size for scenario comparison:
 * - n≥30: Rule of thumb for Central Limit Theorem (statistical validity)
 * - Up to 20% of population: Representative when catalog is large
 * - Max 150: Display manageability
 * Refs: CLT (n≥30), sample size determination literature
 */
const MIN_SAMPLE = 30;
const MAX_SAMPLE = 150;
const POPULATION_PCT = 0.2;

function getSampleSize(total: number): number {
  const pctBased = Math.ceil(total * POPULATION_PCT);
  return Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, pctBased));
}

interface CompareScenariosModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  getWeightsForScenario: (scenarioId: string) => Record<string, number>;
}

export function CompareScenariosModal({
  isOpen,
  onClose,
  products,
  getWeightsForScenario,
}: CompareScenariosModalProps) {
  const [scenarioA, setScenarioA] = useState('profit_max');
  const [scenarioB, setScenarioB] = useState('stock_clearance');

  const weightsA = getWeightsForScenario(scenarioA);
  const weightsB = getWeightsForScenario(scenarioB);

  const sampleSize = getSampleSize(products.length);

  const {
    topA,
    topB,
    rankMapA,
    rankMapB,
    revenueA,
    revenueB,
    marginA,
    marginB,
    onlyInA,
    onlyInB,
    overlap,
  } = useMemo(() => {
    const scoredA = products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, weightsA, undefined, scenarioA === 'custom' ? undefined : scenarioA),
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
      .slice(0, sampleSize);
    const scoredB = products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, weightsB, undefined, scenarioB === 'custom' ? undefined : scenarioB),
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
      .slice(0, sampleSize);

    const rankMapA: Record<string, number> = {};
    scoredA.forEach((p, i) => (rankMapA[p.id] = i + 1));
    const rankMapB: Record<string, number> = {};
    scoredB.forEach((p, i) => (rankMapB[p.id] = i + 1));

    const estimateQty = (p: typeof scoredA[0]) =>
      p.qty_sold_period ?? Math.max(1, Math.round((p.stock_level ?? 0) * 0.7));

    const sumRevenue = (items: typeof scoredA) =>
      items.reduce((s, p) => {
        if (p.revenue_period) return s + p.revenue_period;
        return s + p.price * estimateQty(p);
      }, 0);

    const sumMargin = (items: typeof scoredA) =>
      items.reduce((s, p) => {
        const marginPct = p.margin_percentage > 0
          ? p.margin_percentage
          : p.margin_tier === 'high' ? 40 : p.margin_tier === 'medium' ? 25 : 12;
        const cost = p.cost_price ?? p.price * (1 - marginPct / 100);
        return s + (p.price - cost) * estimateQty(p);
      }, 0);

    const idsA = new Set(scoredA.map((p) => p.id));
    const idsB = new Set(scoredB.map((p) => p.id));
    const onlyInA = scoredA.filter((p) => !idsB.has(p.id));
    const onlyInB = scoredB.filter((p) => !idsA.has(p.id));
    const overlap = scoredA.filter((p) => idsB.has(p.id)).length;

    return {
      topA: scoredA,
      topB: scoredB,
      rankMapA,
      rankMapB,
      revenueA: sumRevenue(scoredA),
      revenueB: sumRevenue(scoredB),
      marginA: sumMargin(scoredA),
      marginB: sumMargin(scoredB),
      onlyInA,
      onlyInB,
      overlap,
    };
  }, [products, weightsA, weightsB, scenarioA, scenarioB, sampleSize]);

  const nameA = scenarios.find((s) => s.id === scenarioA)?.name ?? scenarioA;
  const nameB = scenarios.find((s) => s.id === scenarioB)?.name ?? scenarioB;

  const formatEur = (n: number) =>
    n >= 1000 ? `€${(n / 1000).toFixed(1)}k` : `€${Math.round(n)}`;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-4 md:inset-8 lg:inset-12 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        <ModalHeader
          toolbarAriaLabel="Κλείσιμο"
          title={
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-[#1A1A1A]">Σύγκριση Scenarios</h3>
              <Tooltip content="Συγκρίνετε δύο στρατηγικές πριν την εφαρμογή. Top N = τα N προϊόντα με τα υψηλότερα composite scores. Δείτε πώς αλλάζουν οι προτεραιότητες, το revenue/margin και ποια προϊόντα κερδίζουν ή χάνουν θέση." size={14}>
                <span />
              </Tooltip>
            </div>
          }
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[#F5F5F5]">
              <X size={20} />
            </button>
          }
        />
        <div className="flex-1 overflow-auto p-4">
          <div className="flex flex-wrap gap-4 mb-4">
            <div>
              <label className="text-xs text-[#4A4A4A] block mb-1">Scenario A</label>
              <select
                value={scenarioA}
                onChange={(e) => setScenarioA(e.target.value)}
                className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm"
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#4A4A4A] block mb-1">Scenario B</label>
              <select
                value={scenarioB}
                onChange={(e) => setScenarioB(e.target.value)}
                className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm"
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Weights comparison */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-[#F9FAFB] rounded-lg">
              <h5 className="text-xs font-semibold text-[#4A4A4A] mb-2">
                {nameA} — <Tooltip content="Η κατανομή βαρών καθορίζει τι παράγοντες (κέρδος, απόθεμα, στρατηγική κλπ) επηρεάζουν περισσότερο την κατάταξη." size={12}>Weights</Tooltip>
              </h5>
              <div className="space-y-1.5">
                {weightFactors.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="text-xs w-20 truncate">{f.name}</span>
                    <div className="flex-1 h-2 bg-[#E5E5E5] rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${weightsA[f.id] ?? 0}%`,
                          backgroundColor: f.color,
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-6">{weightsA[f.id] ?? 0}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-3 bg-[#F9FAFB] rounded-lg">
              <h5 className="text-xs font-semibold text-[#4A4A4A] mb-2">
                {nameB} — <Tooltip content="Η κατανομή βαρών καθορίζει τι παράγοντες επηρεάζουν περισσότερο την κατάταξη." size={12}>Weights</Tooltip>
              </h5>
              <div className="space-y-1.5">
                {weightFactors.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="text-xs w-20 truncate">{f.name}</span>
                    <div className="flex-1 h-2 bg-[#E5E5E5] rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${weightsB[f.id] ?? 0}%`,
                          backgroundColor: f.color,
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-6">{weightsB[f.id] ?? 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Impact summary */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 border border-[#E5E5E5] rounded-lg">
              <h5 className="text-xs font-semibold text-[#4A4A4A] mb-2">{nameA}</h5>
              <div className="text-sm space-y-1">
                <div>
                  <Tooltip content="Top N προϊόντα με τα υψηλότερα scores. Εκτίμηση βάσει τιμής × ποσότητας (ή 70% αποθέματος αν λείπουν πωλήσεις)." size={12}>
                    <span>Εκτιμ. Revenue: <span className="font-semibold">{formatEur(revenueA)}</span></span>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip content="Top N προϊόντα: (τιμή − κόστος) × εκτιμώμενη ποσότητα. Κόστος από cost_price ή margin tier (high 40%, medium 25%, low 12%). Sell-through 70% αν λείπουν πωλήσεις." size={12}>
                    <span>Εκτιμ. Margin: <span className="font-semibold">{formatEur(marginA)}</span></span>
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="p-3 border border-[#E5E5E5] rounded-lg">
              <h5 className="text-xs font-semibold text-[#4A4A4A] mb-2">{nameB}</h5>
              <div className="text-sm space-y-1">
                <div>
                  <Tooltip content="Top N προϊόντα: εκτίμηση βάσει τιμής × ποσότητας (ή 70% αποθέματος)." size={12}>
                    <span>Εκτιμ. Revenue: <span className="font-semibold">{formatEur(revenueB)}</span></span>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip content="Top N προϊόντα: (τιμή − κόστος) × εκτιμώμενη ποσότητα. Κόστος από cost_price ή margin tier (high 40%, medium 25%, low 12%)." size={12}>
                    <span>Εκτιμ. Margin: <span className="font-semibold">{formatEur(marginB)}</span></span>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>

          {/* Sample size info */}
          <p className="text-xs text-[#6B7280] mb-4">
            <Tooltip content="Top N = τα N προϊόντα με τα υψηλότερα composite scores (τα πιο προτεραιουμένες). Ο υπολογισμός γίνεται για ΟΛΑ τα προϊόντα· εδώ εμφανίζονται μόνο τα top N. n≥30 για στατιστική αξιοπιστία." size={12}>
              <span>Δείγμα: {sampleSize} προϊόντα (min {MIN_SAMPLE}, έως {Math.round(POPULATION_PCT * 100)}% του catalog, max {MAX_SAMPLE})</span>
            </Tooltip>
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-[#1A1A1A] mb-3">
                {nameA}{' '}
                <Tooltip content="Top N = τα N προϊόντα με τα υψηλότερα composite scores για αυτή τη στρατηγική — δηλαδή τα πιο προτεραιουμένες για προώθηση." size={12}>
                  <span>(Top {sampleSize})</span>
                </Tooltip>
              </h4>
              <div className="border border-[#E5E5E5] rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#F5F5F5]">
                    <tr className="text-left text-xs text-[#4A4A4A]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2 text-center w-12">
                        <Tooltip content="Αλλαγή θέσης μεταξύ scenarios: ↑ ανεβαίνει, ↓ κατεβαίνει, — ίδια θέση." size={12}>
                          <span>Δ</span>
                        </Tooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topA.map((p, i) => {
                      const rankB = rankMapB[p.id];
                      const shift = rankB != null ? rankB - (i + 1) : null;
                      return (
                        <tr key={p.id} className="border-t border-[#E5E5E5]">
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2 truncate max-w-[160px]" title={p.name}>{p.name}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.composite_score?.toFixed(1)}</td>
                          <td className="px-3 py-2 text-center">
                            {shift != null ? (
                              shift > 0 ? (
                                <span className="text-amber-600" title={`#${rankB} στο B`}><ArrowDown size={14} /></span>
                              ) : shift < 0 ? (
                                <span className="text-emerald-600" title={`#${rankB} στο B`}><ArrowUp size={14} /></span>
                              ) : (
                                <span className="text-[#9CA3AF]"><Minus size={14} /></span>
                              )
                            ) : (
                              <span className="text-[#9CA3AF] text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-[#1A1A1A] mb-3">
                {nameB}{' '}
                <Tooltip content="Top N = τα N προϊόντα με τα υψηλότερα composite scores για αυτή τη στρατηγική — δηλαδή τα πιο προτεραιουμένες για προώθηση." size={12}>
                  <span>(Top {sampleSize})</span>
                </Tooltip>
              </h4>
              <div className="border border-[#E5E5E5] rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#F5F5F5]">
                    <tr className="text-left text-xs text-[#4A4A4A]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2 text-center w-12">
                        <Tooltip content="Αλλαγή θέσης μεταξύ scenarios: ↑ ανεβαίνει, ↓ κατεβαίνει, — ίδια θέση." size={12}>
                          <span>Δ</span>
                        </Tooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topB.map((p, i) => {
                      const rankA = rankMapA[p.id];
                      const shift = rankA != null ? rankA - (i + 1) : null;
                      return (
                        <tr key={p.id} className="border-t border-[#E5E5E5]">
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2 truncate max-w-[160px]" title={p.name}>{p.name}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.composite_score?.toFixed(1)}</td>
                          <td className="px-3 py-2 text-center">
                            {shift != null ? (
                              shift > 0 ? (
                                <span className="text-emerald-600" title={`#${rankA} στο A`}><ArrowUp size={14} /></span>
                              ) : shift < 0 ? (
                                <span className="text-amber-600" title={`#${rankA} στο A`}><ArrowDown size={14} /></span>
                              ) : (
                                <span className="text-[#9CA3AF]"><Minus size={14} /></span>
                              )
                            ) : (
                              <span className="text-[#9CA3AF] text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-[#F5F5F5] rounded-lg text-xs text-[#4A4A4A]">
              <Tooltip content="Προϊόντα που εμφανίζονται στο Top N και στα δύο σενάρια — σταθερές προτεραιότητες ανεξαρτήτως στρατηγικής." size={12}>
                <span>Κοινά: <span className="font-semibold">{overlap}</span> ({sampleSize > 0 ? Math.round(overlap / sampleSize * 100) : 0}% overlap)</span>
              </Tooltip>
            </div>
            <div className="p-3 bg-[#FEF3C7] rounded-lg text-xs text-[#4A4A4A]">
              <Tooltip content={`Προϊόντα στο Top ${sampleSize} του ${nameA} που δεν εμφανίζονται στο Top ${sampleSize} του ${nameB}.`} size={12}>
                <span>Μοναδικά {nameA}: <span className="font-semibold">{onlyInA.length}</span></span>
              </Tooltip>
            </div>
            <div className="p-3 bg-[#F5F5F5] rounded-lg text-xs text-[#4A4A4A]">
              <Tooltip content={`Προϊόντα στο Top ${sampleSize} του ${nameB} που δεν εμφανίζονται στο Top ${sampleSize} του ${nameA}.`} size={12}>
                <span>Μοναδικά {nameB}: <span className="font-semibold">{onlyInB.length}</span></span>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-[#E5E5E5]">
          <Button variant="secondary" onClick={onClose}>
            Κλείσιμο
          </Button>
        </div>
      </div>
    </>
  );
}
