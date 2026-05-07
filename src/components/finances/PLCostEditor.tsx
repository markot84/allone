import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Check, FolderPlus } from 'lucide-react';
import { Card, Button } from '../common';
import type { PLCostCategory, PLCostLine } from '../../types';
import { formatCurrencyCompact } from '../../utils/format';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLine(): PLCostLine {
  return { id: newId(), label: '', amountEUR: 0 };
}

function defaultCategory(name = ''): PLCostCategory {
  return { id: newId(), name, lines: [defaultLine()] };
}

function normCategories(raw: PLCostCategory[] | undefined): PLCostCategory[] {
  if (!raw?.length) return [];
  return raw
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      id: typeof c.id === 'string' && c.id ? c.id : newId(),
      name: typeof c.name === 'string' ? c.name : '',
      lines: (c.lines ?? [])
        .filter((l) => l && typeof l === 'object')
        .map((l) => ({
          id: typeof l.id === 'string' && l.id ? l.id : newId(),
          label: typeof l.label === 'string' ? l.label : '',
          amountEUR: Math.max(0, Number(l.amountEUR) || 0),
        })),
    }));
}

function categoryTotal(cat: PLCostCategory): number {
  return cat.lines.reduce((s, l) => s + (l.amountEUR || 0), 0);
}

export interface PLCostEditorProps {
  initialCategories: PLCostCategory[] | undefined;
  /** Μηνιαίος τζίρος (για % υπολογισμό) */
  monthlyRevenue: number;
  /** Περίοδος σε μήνες (για proration) */
  periodMonths: number;
  onSave: (cats: PLCostCategory[]) => Promise<void>;
  isSaving: boolean;
  disabled?: boolean;
}

export function PLCostEditor({
  initialCategories,
  monthlyRevenue,
  periodMonths,
  onSave,
  isSaving,
  disabled = false,
}: PLCostEditorProps) {
  const [cats, setCats] = useState<PLCostCategory[]>(() => normCategories(initialCategories));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const baselineRef = useRef(JSON.stringify(normCategories(initialCategories)));
  const isDirty = JSON.stringify(normCategories(cats)) !== baselineRef.current;

  useEffect(() => {
    const norm = normCategories(initialCategories);
    setCats(norm);
    baselineRef.current = JSON.stringify(norm);
  }, [JSON.stringify(initialCategories)]);

  const totalMonthly = useMemo(() => cats.reduce((s, c) => s + categoryTotal(c), 0), [cats]);

  function addCategory() {
    const cat = defaultCategory('Νέα κατηγορία');
    setCats((prev) => [...prev, cat]);
    setCollapsed((prev) => ({ ...prev, [cat.id]: false }));
  }

  function deleteCategory(catId: string) {
    setCats((prev) => prev.filter((c) => c.id !== catId));
  }

  function updateCategoryName(catId: string, name: string) {
    setCats((prev) => prev.map((c) => (c.id === catId ? { ...c, name } : c)));
  }

  function addLine(catId: string) {
    setCats((prev) =>
      prev.map((c) => (c.id === catId ? { ...c, lines: [...c.lines, defaultLine()] } : c))
    );
  }

  function deleteLine(catId: string, lineId: string) {
    setCats((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, lines: c.lines.filter((l) => l.id !== lineId) } : c
      )
    );
  }

  function updateLine(catId: string, lineId: string, field: 'label' | 'amountEUR', value: string | number) {
    setCats((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) =>
                l.id === lineId ? { ...l, [field]: field === 'amountEUR' ? Math.max(0, Number(value) || 0) : value } : l
              ),
            }
          : c
      )
    );
  }

  function toggleCollapse(catId: string) {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }

  async function handleSave() {
    const clean = normCategories(cats);
    await onSave(clean);
    baselineRef.current = JSON.stringify(clean);
  }

  return (
    <div className="space-y-4">
      {cats.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
          <p className="text-sm text-[#6B7280]">
            Δεν υπάρχουν κατηγορίες κόστους. Προσθέστε την πρώτη κατηγορία.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {cats.map((cat) => {
            const total = categoryTotal(cat);
            const pct = monthlyRevenue > 0 ? (total / monthlyRevenue) * 100 : 0;
            const isOpen = !collapsed[cat.id];
            return (
              <Card key={cat.id} padding="none" className="overflow-hidden">
                {/* Category header */}
                <div className="flex items-center gap-2 bg-slate-50/80 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(cat.id)}
                    className="flex shrink-0 items-center text-slate-500 hover:text-slate-700"
                    aria-label={isOpen ? 'Σύμπτυξη' : 'Ανάπτυξη'}
                  >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <input
                    type="text"
                    value={cat.name}
                    onChange={(e) => updateCategoryName(cat.id, e.target.value)}
                    placeholder="Όνομα κατηγορίας"
                    disabled={disabled}
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#111827] outline-none placeholder:text-slate-400 focus:ring-0 disabled:opacity-60"
                  />
                  <div className="ml-auto flex shrink-0 items-center gap-3">
                    <span className="text-sm font-mono font-semibold text-[#374151]">
                      {formatCurrencyCompact(total)}
                      <span className="ml-1 text-xs font-normal text-[#9CA3AF]">/μήνα</span>
                    </span>
                    {pct > 0 && (
                      <span className="hidden text-xs text-[#9CA3AF] sm:inline">
                        {pct.toFixed(1)}% τζίρου
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteCategory(cat.id)}
                      disabled={disabled}
                      className="text-slate-400 hover:text-red-500 disabled:opacity-40"
                      aria-label="Διαγραφή κατηγορίας"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Lines */}
                {isOpen && (
                  <div className="divide-y divide-slate-100 px-4">
                    {cat.lines.map((line) => (
                      <div key={line.id} className="flex items-center gap-2 py-2">
                        <input
                          type="text"
                          value={line.label}
                          onChange={(e) => updateLine(cat.id, line.id, 'label', e.target.value)}
                          placeholder="Περιγραφή κόστους"
                          disabled={disabled}
                          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-[#111827] outline-none focus:border-[var(--nts-accent)] focus:ring-1 focus:ring-[var(--nts-accent)]/30 disabled:opacity-60"
                        />
                        <div className="relative flex shrink-0 items-center">
                          <span className="pointer-events-none absolute left-2.5 text-xs text-slate-400">€</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={line.amountEUR || ''}
                            onChange={(e) => updateLine(cat.id, line.id, 'amountEUR', e.target.value)}
                            placeholder="0"
                            disabled={disabled}
                            className="w-24 rounded-md border border-slate-200 bg-white py-1.5 pl-6 pr-2 text-right text-sm font-mono text-[#111827] outline-none focus:border-[var(--nts-accent)] focus:ring-1 focus:ring-[var(--nts-accent)]/30 disabled:opacity-60"
                          />
                        </div>
                        <span className="hidden text-xs text-slate-400 sm:inline">/μήνα</span>
                        <button
                          type="button"
                          onClick={() => deleteLine(cat.id, line.id)}
                          disabled={disabled || cat.lines.length <= 1}
                          className="text-slate-300 hover:text-red-400 disabled:opacity-30"
                          aria-label="Διαγραφή γραμμής"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="py-2">
                      <button
                        type="button"
                        onClick={() => addLine(cat.id)}
                        disabled={disabled}
                        className="flex items-center gap-1.5 text-xs text-[var(--nts-accent)] hover:underline disabled:opacity-40"
                      >
                        <Plus size={13} />
                        Προσθήκη γραμμής
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Totals + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span className="text-sm text-[#6B7280]">
            Σύνολο κόστους:{' '}
            <span className="font-semibold font-mono text-[#111827]">{formatCurrencyCompact(totalMonthly)}</span>
            <span className="text-xs text-[#9CA3AF]"> /μήνα</span>
          </span>
          {periodMonths > 0 && periodMonths !== 1 && (
            <span className="text-sm text-[#6B7280]">
              Περίοδος ({periodMonths.toFixed(1)}μ.):{' '}
              <span className="font-semibold font-mono text-[#111827]">
                {formatCurrencyCompact(totalMonthly * periodMonths)}
              </span>
            </span>
          )}
          {monthlyRevenue > 0 && totalMonthly > 0 && (
            <span className="text-sm text-[#6B7280]">
              % τζίρου:{' '}
              <span className="font-semibold text-[#111827]">
                {((totalMonthly / monthlyRevenue) * 100).toFixed(1)}%
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addCategory}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent)] disabled:opacity-40"
          >
            <FolderPlus size={14} />
            Κατηγορία
          </button>
          <Button
            variant="primary"
            size="sm"
            icon={isSaving ? undefined : <Check size={14} />}
            onClick={handleSave}
            disabled={!isDirty || isSaving || disabled}
          >
            {isSaving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </Button>
        </div>
      </div>
    </div>
  );
}
