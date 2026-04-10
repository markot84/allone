import { useState, useMemo, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Calendar, Zap, Tag, Gift, Percent, Sun, Thermometer, BookOpen, Flower2, Heart, HeartHandshake, Pin, type LucideProps } from 'lucide-react';
import { ModalHeader } from '../common';
import { SEASONAL_PERIODS, type SeasonalPeriod, getActiveSeasons } from '../../data/seasonalPeriods';

const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  tag: Tag,
  gift: Gift,
  percent: Percent,
  sun: Sun,
  thermometer: Thermometer,
  'book-open': BookOpen,
  'flower-2': Flower2,
  heart: Heart,
  'heart-handshake': HeartHandshake,
  pin: Pin,
};

function SeasonalIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] ?? Calendar;
  return (
    <div className="w-8 h-8 rounded-lg bg-[#F5F5F5] flex items-center justify-center flex-shrink-0">
      <Icon size={16} className="text-[var(--nts-accent)]" />
    </div>
  );
}
import { scenarios } from '../../data';
import { Button } from '../common';

interface SeasonalPeriodsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (period: SeasonalPeriod) => void;
  customPeriods: SeasonalPeriod[];
  onSaveCustom: (period: SeasonalPeriod) => void;
  onDeleteCustom: (id: string) => void;
}

const BASE_SCENARIOS = scenarios.filter(s => s.id !== 'custom' && s.id !== 'mixed' && s.weights);

const MONTH_NAMES = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαϊ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

function formatDateRange(range: SeasonalPeriod['dateRange']) {
  return `${range.startDay} ${MONTH_NAMES[range.startMonth - 1]} – ${range.endDay} ${MONTH_NAMES[range.endMonth - 1]}`;
}

export function SeasonalPeriodsModal({
  isOpen,
  onClose,
  onApply,
  customPeriods,
  onSaveCustom,
  onDeleteCustom,
}: SeasonalPeriodsModalProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStartMonth, setNewStartMonth] = useState(1);
  const [newStartDay, setNewStartDay] = useState(1);
  const [newEndMonth, setNewEndMonth] = useState(1);
  const [newEndDay, setNewEndDay] = useState(31);
  const [newScenarioA, setNewScenarioA] = useState(BASE_SCENARIOS[0]?.id ?? '');
  const [newScenarioB, setNewScenarioB] = useState(BASE_SCENARIOS[1]?.id ?? '');
  const [newPercentA, setNewPercentA] = useState(60);
  const [newDescription, setNewDescription] = useState('');

  const activeIds = useMemo(() => new Set(getActiveSeasons().map(s => s.id)), []);
  const allPeriods = useMemo(() => [...SEASONAL_PERIODS, ...customPeriods], [customPeriods]);

  const resetForm = () => {
    setNewName('');
    setNewStartMonth(1);
    setNewStartDay(1);
    setNewEndMonth(1);
    setNewEndDay(31);
    setNewScenarioA(BASE_SCENARIOS[0]?.id ?? '');
    setNewScenarioB(BASE_SCENARIOS[1]?.id ?? '');
    setNewPercentA(60);
    setNewDescription('');
    setShowNewForm(false);
  };

  const handleSave = () => {
    if (!newName.trim()) return;
    const period: SeasonalPeriod = {
      id: `custom_${Date.now()}`,
      name: newName.trim(),
      icon: 'pin',
      dateRange: { startMonth: newStartMonth, startDay: newStartDay, endMonth: newEndMonth, endDay: newEndDay },
      suggestedMix: { scenarioA: newScenarioA, scenarioB: newScenarioB, percentA: newPercentA },
      description: newDescription.trim() || `Custom περίοδος: ${newName.trim()}`,
      isCustom: true,
    };
    onSaveCustom(period);
    resetForm();
  };

  if (!isOpen) return null;

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
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <ModalHeader
          className="flex-shrink-0"
          toolbarAriaLabel="Κλείσιμο"
          title={
            <div className="flex min-w-0 items-center gap-2">
              <Calendar size={20} className="shrink-0 text-[var(--nts-accent)]" />
              <h2 className="text-lg font-bold text-[#1A1A1A]">Εποχιακές περίοδοι</h2>
            </div>
          }
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[#F5F5F5]">
              <X size={20} className="text-[#4A4A4A]" />
            </button>
          }
        />

        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-3">
            {allPeriods.map(period => {
              const nameA = scenarios.find(s => s.id === period.suggestedMix.scenarioA)?.name ?? '';
              const nameB = scenarios.find(s => s.id === period.suggestedMix.scenarioB)?.name ?? '';
              const isActive = activeIds.has(period.id);

              return (
                <div
                  key={period.id}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    isActive
                      ? 'border-[var(--nts-accent)]/30 bg-[var(--nts-accent)]/5'
                      : 'border-[#E5E5E5]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <SeasonalIcon name={period.icon} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-[#1A1A1A]">{period.name}</h4>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] font-medium">
                            Ενεργή
                          </span>
                        )}
                        {period.isCustom && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F5F5] text-[#9CA3AF] font-medium">
                            Custom
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                        {formatDateRange(period.dateRange)} · {nameA} {period.suggestedMix.percentA}% / {nameB} {100 - period.suggestedMix.percentA}%
                      </p>
                      <p className="text-xs text-[#4A4A4A] mt-1">{period.description}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => onApply(period)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--nts-accent)] text-white hover:opacity-90 transition-opacity"
                      >
                        <Zap size={11} />
                        Εφαρμογή
                      </button>
                      {period.isCustom && (
                        <button
                          onClick={() => onDeleteCustom(period.id)}
                          className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* New custom period form */}
          <div className="mt-4">
            <AnimatePresence>
              {showNewForm ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 border-2 border-dashed border-[var(--nts-accent)]/30 rounded-xl space-y-3">
                    <p className="text-xs font-semibold text-[#4A4A4A]">Νέα εποχιακή περίοδος</p>

                    <input
                      type="text"
                      placeholder="Όνομα (π.χ. Summer Sale)"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E5E5E5] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-[#9CA3AF] block mb-1">Από</label>
                        <div className="flex gap-1">
                          <input type="number" min={1} max={31} value={newStartDay} onChange={e => setNewStartDay(+e.target.value)}
                            className="w-14 px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md text-center" />
                          <select value={newStartMonth} onChange={e => setNewStartMonth(+e.target.value)}
                            className="flex-1 px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md">
                            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] text-[#9CA3AF] block mb-1">Έως</label>
                        <div className="flex gap-1">
                          <input type="number" min={1} max={31} value={newEndDay} onChange={e => setNewEndDay(+e.target.value)}
                            className="w-14 px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md text-center" />
                          <select value={newEndMonth} onChange={e => setNewEndMonth(+e.target.value)}
                            className="flex-1 px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md">
                            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-[#9CA3AF] block mb-1">Στρατηγική Α</label>
                        <select value={newScenarioA} onChange={e => setNewScenarioA(e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md">
                          {BASE_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-[#9CA3AF] block mb-1">Στρατηγική Β</label>
                        <select value={newScenarioB} onChange={e => setNewScenarioB(e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md">
                          {BASE_SCENARIOS.filter(s => s.id !== newScenarioA).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-[#9CA3AF] block mb-1">% Α</label>
                        <input type="number" min={10} max={90} step={5} value={newPercentA}
                          onChange={e => setNewPercentA(+e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-[#E5E5E5] rounded-md text-center" />
                      </div>
                    </div>

                    <textarea
                      placeholder="Περιγραφή (προαιρετικά)"
                      value={newDescription}
                      onChange={e => setNewDescription(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-xs border border-[#E5E5E5] rounded-lg resize-none focus:outline-none focus:border-[var(--nts-accent)]"
                    />

                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={resetForm}>Ακύρωση</Button>
                      <Button variant="primary" size="sm" onClick={handleSave} disabled={!newName.trim()}>
                        Αποθήκευση
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="w-full p-3 border-2 border-dashed border-[#E5E5E5] rounded-xl text-xs font-medium text-[#9CA3AF] hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent)] transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={14} />
                  Προσθήκη custom περιόδου
                </button>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="p-4 border-t border-[#E5E5E5] flex justify-end flex-shrink-0">
          <Button variant="ghost" onClick={onClose}>Κλείσιμο</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
