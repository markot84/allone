import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '../common';
import { scenarios } from '../../data';
import { calculateCompositeScore } from '../../data/mockProducts';
import type { Product } from '../../types';

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

  const { topA, topB } = useMemo(() => {
    const scoredA = products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, weightsA, undefined, scenarioA === 'custom' ? undefined : scenarioA),
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
      .slice(0, 10);
    const scoredB = products
      .map((p) => ({
        ...p,
        composite_score: calculateCompositeScore(p, weightsB, undefined, scenarioB === 'custom' ? undefined : scenarioB),
      }))
      .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
      .slice(0, 10);
    return { topA: scoredA, topB: scoredB };
  }, [products, weightsA, weightsB, scenarioA, scenarioB]);

  const nameA = scenarios.find((s) => s.id === scenarioA)?.name ?? scenarioA;
  const nameB = scenarios.find((s) => s.id === scenarioB)?.name ?? scenarioB;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-4 md:inset-8 lg:inset-12 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[#E5E5E5] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#1A1A1A]">Σύγκριση Scenarios</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F5F5F5]">
            <X size={20} />
          </button>
        </div>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-[#1A1A1A] mb-3">{nameA}</h4>
              <div className="border border-[#E5E5E5] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F5F5] text-left text-xs text-[#4A4A4A]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topA.map((p, i) => (
                      <tr key={p.id} className="border-t border-[#E5E5E5]">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2 truncate max-w-[180px]">{p.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{p.composite_score?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-[#1A1A1A] mb-3">{nameB}</h4>
              <div className="border border-[#E5E5E5] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F5F5] text-left text-xs text-[#4A4A4A]">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topB.map((p, i) => (
                      <tr key={p.id} className="border-t border-[#E5E5E5]">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2 truncate max-w-[180px]">{p.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{p.composite_score?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-[#F5F5F5] rounded-lg text-xs text-[#4A4A4A]">
            Κοινά στο Top 10: {topA.filter((a) => topB.some((b) => b.id === a.id)).length} προϊόντα εμφανίζονται και στα δύο scenarios.
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
