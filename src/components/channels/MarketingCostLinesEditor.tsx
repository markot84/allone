import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, PiggyBank, Check } from 'lucide-react';
import type { MarketingCostLine } from '../../types';
import { formatCurrencyCompact } from '../../utils/format';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `mcl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLine(): MarketingCostLine {
  return { id: newId(), label: '', kind: 'fixed_monthly', amountEUR: 0 };
}

function normalizeLines(raw: MarketingCostLine[] | undefined): MarketingCostLine[] {
  if (!raw?.length) return [];
  return raw
    .filter((l) => l && typeof l === 'object' && 'kind' in l)
    .map((l) => {
      const id = typeof l.id === 'string' && l.id ? l.id : newId();
      const label = typeof l.label === 'string' ? l.label : '';
      if (l.kind === 'percent_of_budget') {
        return { id, label, kind: 'percent_of_budget' as const, percent: Math.max(0, Number(l.percent) || 0) };
      }
      if (l.kind === 'one_off_month') {
        const now = new Date();
        const month =
          typeof l.month === 'string' && /^\d{4}-\d{2}$/.test(l.month)
            ? l.month
            : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return { id, label, kind: 'one_off_month' as const, amountEUR: Math.max(0, Number(l.amountEUR) || 0), month };
      }
      return {
        id,
        label,
        kind: 'fixed_monthly' as const,
        amountEUR: Math.max(0, Number((l as MarketingCostLine & { amountEUR?: number }).amountEUR) || 0),
      };
    });
}

function serial(rows: MarketingCostLine[]): string {
  return JSON.stringify(normalizeLines(rows));
}

function isSynced(line: MarketingCostLine, baseline: MarketingCostLine[]): boolean {
  const b = baseline.find((x) => x.id === line.id);
  if (!b) return false;
  return JSON.stringify(normalizeLines([line])[0]) === JSON.stringify(normalizeLines([b])[0]);
}

export interface MarketingCostLinesEditorProps {
  initialLines: MarketingCostLine[] | undefined;
  monthlyBudget: number | null;
  onSave: (lines: MarketingCostLine[]) => Promise<void>;
  disabled?: boolean;
  isSaving: boolean;
}

export function MarketingCostLinesEditor({
  initialLines,
  monthlyBudget,
  onSave,
  disabled,
  isSaving,
}: MarketingCostLinesEditorProps) {
  const initialNorm = useMemo(() => normalizeLines(initialLines), [initialLines]);
  const initialSerial = useMemo(() => serial(initialNorm), [initialNorm]);
  const [lines, setLines] = useState<MarketingCostLine[]>(() => normalizeLines(initialLines));
  const [baseline, setBaseline] = useState<MarketingCostLine[]>(() => normalizeLines(initialLines));
  const parentRef = useRef<string | null>(null);

  useEffect(() => {
    const incoming = normalizeLines(initialLines);
    const snap = serial(incoming);
    if (parentRef.current === null) {
      parentRef.current = snap;
      if (incoming.length > 0) { setLines(incoming); setBaseline(incoming); }
      return;
    }
    if (snap !== parentRef.current) {
      parentRef.current = snap;
      setLines(incoming);
      setBaseline(incoming);
    }
  }, [initialLines, initialSerial]);

  const isDirty = useMemo(() => serial(lines) !== serial(baseline), [lines, baseline]);
  const budgetHint = monthlyBudget != null && monthlyBudget > 0;
  const monthlyTotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        if (line.kind === 'fixed_monthly') return sum + (line.amountEUR || 0);
        if (line.kind === 'percent_of_budget' && budgetHint) {
          return sum + ((monthlyBudget || 0) * (line.percent || 0)) / 100;
        }
        return sum;
      }, 0),
    [budgetHint, lines, monthlyBudget]
  );
  const oneOffTotal = useMemo(
    () => lines.reduce((sum, line) => (line.kind === 'one_off_month' ? sum + (line.amountEUR || 0) : sum), 0),
    [lines]
  );
  const hasPercentWithoutBudget = !budgetHint && lines.some((l) => l.kind === 'percent_of_budget');

  const setKind = (id: string, kind: MarketingCostLine['kind']) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id || l.kind === kind) return l;
        const base = { id: l.id, label: l.label };
        if (kind === 'fixed_monthly') return { ...base, kind: 'fixed_monthly', amountEUR: 0 };
        if (kind === 'percent_of_budget') return { ...base, kind: 'percent_of_budget', percent: 0 };
        const now = new Date();
        return { ...base, kind: 'one_off_month', amountEUR: 0, month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` };
      })
    );

  const patchLine = (id: string, patch: Partial<MarketingCostLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? ({ ...l, ...patch } as MarketingCostLine) : l)));

  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const addLine = () => setLines((prev) => [...prev, defaultLine()]);

  const handleSave = async () => {
    const trimmed = lines.map((l) => {
      const label = l.label.trim() || 'Κόστος';
      if (l.kind === 'fixed_monthly') return { ...l, label, amountEUR: Math.max(0, l.amountEUR) };
      if (l.kind === 'percent_of_budget') return { ...l, label, percent: Math.min(100, Math.max(0, l.percent)) };
      return { ...l, label, amountEUR: Math.max(0, l.amountEUR) };
    });
    await onSave(trimmed);
    const norm = normalizeLines(trimmed);
    setLines(norm);
    setBaseline(norm);
    parentRef.current = serial(norm);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/40 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-100 bg-white">
          <PiggyBank size={17} className="text-rose-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#111827]">Επιπλέον κόστη marketing (ROI)</p>
          <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">
            Τα <strong>σταθερά μηνιαία</strong> μετρούν <strong>πλήρες €/μήνα</strong> ανά ημερολογιακό μήνα της περιόδου·
            ποσοστά &amp; εφάπαξ κατανέμονται ανά ημέρα. Δεν αντικαθιστούν το budget καναλιών.
          </p>
        </div>
      </div>

      {/* Lines */}
      <div className="space-y-2 p-4">
        {lines.length === 0 && (
          <p className="text-xs text-[#9CA3AF]">
            Δεν έχουν οριστεί γραμμές. Προσθέστε σταθερά μηνιαία, ποσοστό επί budget ή εφάπαξ.
          </p>
        )}
        {lines.map((line) => {
          const synced = isSynced(line, baseline);
          return (
            <div
              key={line.id}
              className={`relative flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:flex-wrap sm:items-end ${
                synced
                  ? 'border-rose-200 bg-rose-50/40 shadow-[inset_3px_0_0_0_#fb7185]'
                  : 'border-[#E5E7EB] bg-white'
              }`}
            >
              {synced && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Check size={12} strokeWidth={2.5} />
                </span>
              )}
              <label className="min-w-[140px] flex-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Περιγραφή</span>
                <input
                  type="text"
                  value={line.label}
                  onChange={(e) => patchLine(line.id, { label: e.target.value })}
                  disabled={disabled}
                  placeholder="π.χ. Agency retainer"
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                />
              </label>
              <label className="w-full sm:w-40">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Τύπος</span>
                <select
                  value={line.kind}
                  onChange={(e) => setKind(line.id, e.target.value as MarketingCostLine['kind'])}
                  disabled={disabled}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                >
                  <option value="fixed_monthly">Σταθερό / μήνα (€)</option>
                  <option value="percent_of_budget">% του μην. budget</option>
                  <option value="one_off_month">Εφάπαξ (μήνας)</option>
                </select>
              </label>
              {line.kind === 'fixed_monthly' && (
                <label className="w-full sm:w-28">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">€ / μήνα</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.amountEUR === 0 ? '' : String(line.amountEUR)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                      const n = parseFloat(v);
                      patchLine(line.id, { amountEUR: v === '' || isNaN(n) ? 0 : n });
                    }}
                    disabled={disabled}
                    className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 font-mono text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                  />
                </label>
              )}
              {line.kind === 'percent_of_budget' && (
                <label className="w-full sm:w-28">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">%</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.percent === 0 ? '' : String(line.percent)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                      const n = parseFloat(v);
                      patchLine(line.id, { percent: v === '' || isNaN(n) ? 0 : n });
                    }}
                    disabled={disabled}
                    className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 font-mono text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                  />
                </label>
              )}
              {line.kind === 'one_off_month' && (
                <>
                  <label className="w-full sm:w-36">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Μήνας</span>
                    <input
                      type="month"
                      value={line.month}
                      onChange={(e) => patchLine(line.id, { month: e.target.value })}
                      disabled={disabled}
                      className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                    />
                  </label>
                  <label className="w-full sm:w-28">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">€ (σύνολο)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.amountEUR === 0 ? '' : String(line.amountEUR)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                        const n = parseFloat(v);
                        patchLine(line.id, { amountEUR: v === '' || isNaN(n) ? 0 : n });
                      }}
                      disabled={disabled}
                      className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2.5 py-1.5 font-mono text-sm text-[#111827] focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-100 disabled:opacity-50"
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                onClick={() => removeLine(line.id)}
                disabled={disabled}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center self-end rounded-md border border-transparent text-[#9CA3AF] hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                title="Διαγραφή"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}

        {hasPercentWithoutBudget && (
          <p className="rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
            Ορίστε μηνιαίο budget παραπάνω ώστε τα ποσοστά να υπολογίζονται.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 bg-rose-50/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-[#6B7280]">
            Σύνολο:{' '}
            <span className="font-mono font-semibold text-[#111827]">{formatCurrencyCompact(monthlyTotal)}</span>
            <span className="ml-0.5 text-[11px] text-[#9CA3AF]">/μήνα</span>
          </span>
          {oneOffTotal > 0 && (
            <span className="text-xs text-[#6B7280]">
              Εφάπαξ:{' '}
              <span className="font-mono font-semibold text-[#111827]">{formatCurrencyCompact(oneOffTotal)}</span>
            </span>
          )}
          {hasPercentWithoutBudget && (
            <span className="text-[11px] text-amber-700">% budget χωρίς μηνιαίο budget</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addLine}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-[#4B5563] hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
          >
            <Plus size={13} />
            Γραμμή
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={disabled || isSaving || !isDirty}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !isDirty || disabled || isSaving
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
