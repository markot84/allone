import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ReceiptText, FolderPlus } from 'lucide-react';
import type { PLCostCategory, PLCostLine } from '../../types';
import { formatCurrencyCompact } from '../../utils/format';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLine(): PLCostLine {
  return { id: newId(), label: '', amountEUR: 0 };
}

function defaultCategory(name = 'Νέα κατηγορία'): PLCostCategory {
  return { id: newId(), name, lines: [defaultLine()] };
}

function norm(raw: PLCostCategory[] | undefined): PLCostCategory[] {
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

function catTotal(cat: PLCostCategory): number {
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
  const [cats, setCats] = useState<PLCostCategory[]>(() => norm(initialCategories));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const baselineRef = useRef(JSON.stringify(norm(initialCategories)));
  const isDirty = JSON.stringify(norm(cats)) !== baselineRef.current;

  useEffect(() => {
    const n = norm(initialCategories);
    setCats(n);
    baselineRef.current = JSON.stringify(n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialCategories)]);

  const totalMonthly = useMemo(() => cats.reduce((s, c) => s + catTotal(c), 0), [cats]);

  const addCategory = () => {
    const cat = defaultCategory();
    setCats((p) => [...p, cat]);
    setCollapsed((p) => ({ ...p, [cat.id]: false }));
  };

  const deleteCategory = (id: string) => setCats((p) => p.filter((c) => c.id !== id));

  const renameCat = (id: string, name: string) =>
    setCats((p) => p.map((c) => (c.id === id ? { ...c, name } : c)));

  const addLine = (catId: string) =>
    setCats((p) =>
      p.map((c) => (c.id === catId ? { ...c, lines: [...c.lines, defaultLine()] } : c))
    );

  const deleteLine = (catId: string, lineId: string) =>
    setCats((p) =>
      p.map((c) =>
        c.id === catId ? { ...c, lines: c.lines.filter((l) => l.id !== lineId) } : c
      )
    );

  const updateLine = (
    catId: string,
    lineId: string,
    field: 'label' | 'amountEUR',
    value: string | number
  ) =>
    setCats((p) =>
      p.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) =>
                l.id === lineId
                  ? { ...l, [field]: field === 'amountEUR' ? Math.max(0, Number(value) || 0) : value }
                  : l
              ),
            }
          : c
      )
    );

  const toggle = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const handleSave = async () => {
    const clean = norm(cats);
    await onSave(clean);
    baselineRef.current = JSON.stringify(clean);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-[#E5E7EB] bg-slate-50/60 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white">
          <ReceiptText size={17} className="text-[var(--nts-accent)]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#111827]">Κόστη Επιχείρησης (P&L)</p>
          <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">
            Κατηγορίες κόστους με μηνιαία ποσά · subtotal ανά κατηγορία · % τζίρου περιόδου
          </p>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-0 divide-y divide-[#E5E7EB] p-4 pb-3">
        {cats.length === 0 ? (
          <p className="py-2 text-xs text-[#9CA3AF]">
            Δεν υπάρχουν κατηγορίες. Προσθέστε την πρώτη κατηγορία κόστους.
          </p>
        ) : (
          <div className="space-y-2">
            {cats.map((cat) => {
              const total = catTotal(cat);
              const pct = monthlyRevenue > 0 ? (total / monthlyRevenue) * 100 : 0;
              const isOpen = !collapsed[cat.id];
              return (
                <div key={cat.id} className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                  {/* Category row */}
                  <div className="flex items-center gap-2 bg-slate-50/70 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(cat.id)}
                      className="flex shrink-0 items-center text-slate-400 hover:text-slate-600"
                    >
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) => renameCat(cat.id, e.target.value)}
                      placeholder="Όνομα κατηγορίας"
                      disabled={disabled}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#111827] outline-none placeholder:text-slate-300 disabled:opacity-60"
                    />
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-[#374151]">
                        {formatCurrencyCompact(total)}
                        <span className="ml-0.5 text-[11px] font-normal text-[#9CA3AF]">/μήνα</span>
                      </span>
                      {pct > 0 && (
                        <span className="hidden text-[11px] text-[#9CA3AF] sm:inline">
                          {pct.toFixed(1)}%
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteCategory(cat.id)}
                        disabled={disabled}
                        className="text-slate-300 hover:text-red-500 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Lines */}
                  {isOpen && (
                    <div className="divide-y divide-slate-100 px-3">
                      {cat.lines.map((line) => (
                        <div key={line.id} className="flex items-center gap-2 py-2">
                          <input
                            type="text"
                            value={line.label}
                            onChange={(e) => updateLine(cat.id, line.id, 'label', e.target.value)}
                            placeholder="Περιγραφή κόστους"
                            disabled={disabled}
                            className="min-w-0 flex-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm text-[#111827] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/20 disabled:opacity-60"
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
                              className="w-24 rounded-md border border-[#E5E7EB] py-1.5 pl-6 pr-2 text-right font-mono text-sm text-[#111827] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/20 disabled:opacity-60"
                            />
                          </div>
                          <span className="hidden text-[11px] text-slate-400 sm:inline">/μήνα</span>
                          <button
                            type="button"
                            onClick={() => deleteLine(cat.id, line.id)}
                            disabled={disabled || cat.lines.length <= 1}
                            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border border-transparent text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="py-2">
                        <button
                          type="button"
                          onClick={() => addLine(cat.id)}
                          disabled={disabled}
                          className="flex items-center gap-1 text-xs text-[var(--nts-accent)] hover:underline disabled:opacity-40"
                        >
                          <Plus size={12} />
                          Προσθήκη γραμμής
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] bg-slate-50/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-[#6B7280]">
            Σύνολο:{' '}
            <span className="font-mono font-semibold text-[#111827]">{formatCurrencyCompact(totalMonthly)}</span>
            <span className="ml-0.5 text-[11px] text-[#9CA3AF]">/μήνα</span>
          </span>
          {periodMonths > 0 && periodMonths !== 1 && (
            <span className="text-xs text-[#6B7280]">
              Περίοδος:{' '}
              <span className="font-mono font-semibold text-[#111827]">
                {formatCurrencyCompact(totalMonthly * periodMonths)}
              </span>
            </span>
          )}
          {monthlyRevenue > 0 && totalMonthly > 0 && (
            <span className="text-xs text-[#6B7280]">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#4B5563] hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent)] disabled:opacity-40"
          >
            <FolderPlus size={13} />
            Κατηγορία
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving || disabled}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !isDirty || isSaving || disabled
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'bg-[#111827] text-white shadow-sm hover:bg-[#1f2937]'
            }`}
          >
            {isSaving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
          {!isDirty && !disabled && !isSaving && (
            <span className="text-[11px] text-[#9CA3AF]">Καμία αλλαγή</span>
          )}
        </div>
      </div>
    </div>
  );
}
