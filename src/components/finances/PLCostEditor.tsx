import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ReceiptText, Check } from 'lucide-react';
import type { PLCostCategory, PLCostLine } from '../../types';
import { formatCurrencyCompact } from '../../utils/format';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLine(): PLCostLine {
  return { id: newId(), label: '', amountEUR: 0 };
}

function defaultCategory(name = 'Κόστη επιχείρησης'): PLCostCategory {
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
  /** Monthly revenue (for % calculation) */
  monthlyRevenue: number;
  /** Period in months (for proration) */
  periodMonths: number;
  onSave: (cats: PLCostCategory[]) => Promise<void>;
  isSaving: boolean;
  disabled?: boolean;
}

function isCatSynced(cat: PLCostCategory, baseline: PLCostCategory[]): boolean {
  const b = baseline.find((c) => c.id === cat.id);
  if (!b) return false;
  return JSON.stringify(norm([cat])[0]) === JSON.stringify(norm([b])[0]);
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
  const [baseline, setBaseline] = useState<PLCostCategory[]>(() => norm(initialCategories));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const baselineRef = useRef(JSON.stringify(norm(initialCategories)));
  const isDirty = JSON.stringify(norm(cats)) !== baselineRef.current;

  useEffect(() => {
    const n = norm(initialCategories);
    setCats(n);
    setBaseline(n);
    baselineRef.current = JSON.stringify(n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialCategories)]);

  const totalMonthly = useMemo(() => cats.reduce((s, c) => s + catTotal(c), 0), [cats]);

  const addPrimaryLine = () => {
    setCats((prev) => {
      if (prev.length === 0) return [defaultCategory()];
      const [first, ...rest] = prev;
      return [{ ...first, lines: [...first.lines, defaultLine()] }, ...rest];
    });
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
    setBaseline(clean);
    baselineRef.current = JSON.stringify(clean);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/40 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-100 bg-white">
          <ReceiptText size={17} className="text-rose-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Κόστη Επιχείρησης (P&L)</p>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
            Κατηγορίες κόστους με μηνιαία ποσά · subtotal ανά κατηγορία · % τζίρου περιόδου
          </p>
        </div>
      </div>

      {/* Categories */}
      <div className="p-4 pb-3">
        {cats.length === 0 ? (
          <p className="py-2 text-xs text-[var(--text-muted)]">
            Δεν υπάρχουν γραμμές κόστους. Προσθέστε την πρώτη γραμμή.
          </p>
        ) : (
          <div className="space-y-2">
            {cats.map((cat) => {
              const total = catTotal(cat);
              const pct = monthlyRevenue > 0 ? (total / monthlyRevenue) * 100 : 0;
              const isOpen = !collapsed[cat.id];
              const synced = isCatSynced(cat, baseline);
              const singleCategoryMode = cats.length === 1;
              return (
                <div
                  key={cat.id}
                  className={
                    singleCategoryMode
                      ? 'space-y-2'
                      : `overflow-hidden rounded-lg border ${
                          synced ? 'border-rose-200 shadow-[inset_3px_0_0_0_#fb7185]' : 'border-[var(--border)]'
                        } bg-white`
                  }
                >
                  {/* Category row */}
                  {!singleCategoryMode && (
                  <div className={`flex items-center gap-2 px-3 py-2.5 ${synced ? 'bg-rose-50/40' : 'bg-slate-50/70'}`}>
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
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none placeholder:text-slate-300 disabled:opacity-60"
                    />
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-[var(--text-secondary)]">
                        {formatCurrencyCompact(total)}
                        <span className="ml-0.5 text-[11px] font-normal text-[var(--text-muted)]">/μήνα</span>
                      </span>
                      {pct > 0 && (
                        <span className="hidden text-[11px] text-[var(--text-muted)] sm:inline">
                          {pct.toFixed(1)}%
                        </span>
                      )}
                      {synced && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                          <Check size={12} strokeWidth={2.5} />
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
                  )}

                  {/* Lines */}
                  {(isOpen || singleCategoryMode) && (
                    <div className={singleCategoryMode ? 'space-y-2' : 'divide-y divide-slate-100 px-3'}>
                      {cat.lines.map((line) => (
                        <div
                          key={line.id}
                          className={
                            singleCategoryMode
                              ? `relative flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-end ${
                                  synced
                                    ? 'border-rose-200 bg-rose-50/40 shadow-[inset_3px_0_0_0_#fb7185]'
                                    : 'border-[var(--border)] bg-white'
                                }`
                              : 'flex items-center gap-2 py-2'
                          }
                        >
                          {singleCategoryMode && synced && (
                            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                              <Check size={12} strokeWidth={2.5} />
                            </span>
                          )}
                          <label className={singleCategoryMode ? 'min-w-[140px] flex-1' : 'min-w-0 flex-1'}>
                            {singleCategoryMode && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                                Περιγραφή
                              </span>
                            )}
                          <input
                            type="text"
                            value={line.label}
                            onChange={(e) => updateLine(cat.id, line.id, 'label', e.target.value)}
                            placeholder="Περιγραφή κόστους"
                            disabled={disabled}
                            className={`rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-60 ${
                              singleCategoryMode ? 'mt-1 w-full' : 'min-w-0 w-full'
                            }`}
                          />
                          </label>
                          <label className={singleCategoryMode ? 'w-full sm:w-28' : 'relative flex shrink-0 items-center'}>
                            {singleCategoryMode && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">€ / μήνα</span>
                            )}
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
                              className={`rounded-md border border-[var(--border)] py-1.5 pl-6 pr-2 text-right font-mono text-sm text-[var(--text-primary)] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-60 ${
                                singleCategoryMode ? 'mt-1 w-full' : 'w-24'
                              }`}
                            />
                          </div>
                          </label>
                          {!singleCategoryMode && <span className="hidden text-[11px] text-slate-400 sm:inline">/μήνα</span>}
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
                      {!singleCategoryMode && <div className="py-2">
                        <button
                          type="button"
                          onClick={() => addLine(cat.id)}
                          disabled={disabled}
                          className="flex items-center gap-1 text-xs text-rose-600 hover:underline disabled:opacity-40"
                        >
                          <Plus size={12} />
                          Προσθήκη γραμμής
                        </button>
                      </div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 bg-rose-50/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-[var(--text-muted)]">
            Σύνολο:{' '}
            <span className="font-mono font-semibold text-[var(--text-primary)]">{formatCurrencyCompact(totalMonthly)}</span>
            <span className="ml-0.5 text-[11px] text-[var(--text-muted)]">/μήνα</span>
          </span>
          {periodMonths > 0 && periodMonths !== 1 && (
            <span className="text-xs text-[var(--text-muted)]">
              Περίοδος:{' '}
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {formatCurrencyCompact(totalMonthly * periodMonths)}
              </span>
            </span>
          )}
          {monthlyRevenue > 0 && totalMonthly > 0 && (
            <span className="text-xs text-[var(--text-muted)]">
              % τζίρου:{' '}
              <span className="font-semibold text-[var(--text-primary)]">
                {((totalMonthly / monthlyRevenue) * 100).toFixed(1)}%
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addPrimaryLine}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
          >
            <Plus size={13} />
            Γραμμή
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving || disabled}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !isDirty || isSaving || disabled
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'bg-[var(--text-primary)] text-white shadow-sm hover:bg-[#1f2937]'
            }`}
          >
            {isSaving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
          {!isDirty && !disabled && !isSaving && (
            <span className="text-[11px] text-[var(--text-muted)]">Καμία αλλαγή</span>
          )}
        </div>
      </div>
    </div>
  );
}
