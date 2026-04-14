import { useState } from 'react';
import { Plus, Trash2, PiggyBank } from 'lucide-react';
import type { MarketingCostLine } from '../../types';

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `mcl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLine(): MarketingCostLine {
  return {
    id: newId(),
    label: '',
    kind: 'fixed_monthly',
    amountEUR: 0,
  };
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
        const month = typeof l.month === 'string' && /^\d{4}-\d{2}$/.test(l.month) ? l.month : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        return { id, label, kind: 'one_off_month' as const, amountEUR: Math.max(0, Number(l.amountEUR) || 0), month };
      }
      return { id, label, kind: 'fixed_monthly' as const, amountEUR: Math.max(0, Number((l as MarketingCostLine & { amountEUR?: number }).amountEUR) || 0) };
    });
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
  const [lines, setLines] = useState<MarketingCostLine[]>(() => normalizeLines(initialLines));

  const budgetHint = monthlyBudget != null && monthlyBudget > 0;

  const setLineKind = (id: string, kind: MarketingCostLine['kind']) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        if (kind === line.kind) return line;
        const base = { id: line.id, label: line.label };
        if (kind === 'fixed_monthly') return { ...base, kind: 'fixed_monthly', amountEUR: 0 };
        if (kind === 'percent_of_budget') return { ...base, kind: 'percent_of_budget', percent: 0 };
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return { ...base, kind: 'one_off_month', amountEUR: 0, month };
      })
    );
  };

  const updateLine = (id: string, patch: Partial<MarketingCostLine>) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        return { ...line, ...patch } as MarketingCostLine;
      })
    );
  };

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
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-[#E5E7EB]">
          <PiggyBank size={18} className="text-[var(--nts-accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#111827]">Επιπλέον κόστη marketing (ROI)</h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5 leading-snug">
            Agency, εργαλεία, εφάπαξ έξοδα κ.λπ. — στη σελίδα ROI εμφανίζεται{' '}
            <strong>αναλογία ανά ημέρα</strong> στο <strong>καθολικό διάστημα</strong> (Dashboard/ROI), όχι απαραίτητα ολόκληρο το μηνιαίο ποσό. Δεν αντικαθιστούν το μηνιαίο budget καναλιών.
          </p>
        </div>
      </div>

      {lines.length === 0 && (
        <p className="text-xs text-[#9CA3AF] mb-3">Δεν έχουν οριστεί γραμμές. Προσθέστε σταθερά μηνιαία, ποσοστό επί του budget ή εφάπαξ ανά μήνα.</p>
      )}

      <div className="space-y-3">
        {lines.map((line) => (
          <div
            key={line.id}
            className="flex flex-col gap-2 rounded-lg border border-[#E5E7EB] bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <label className="flex-1 min-w-[140px]">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Περιγραφή</span>
              <input
                type="text"
                value={line.label}
                onChange={(e) => updateLine(line.id, { label: e.target.value })}
                disabled={disabled}
                placeholder="π.χ. Agency retainer"
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="w-full sm:w-40">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Τύπος</span>
              <select
                value={line.kind}
                onChange={(e) => setLineKind(line.id, e.target.value as MarketingCostLine['kind'])}
                disabled={disabled}
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
              >
                <option value="fixed_monthly">Σταθερό / μήνα (€)</option>
                <option value="percent_of_budget">% του μην. budget</option>
                <option value="one_off_month">Εφάπαξ (μήνας)</option>
              </select>
            </label>
            {line.kind === 'fixed_monthly' && (
              <label className="w-full sm:w-28">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">€ / μήνα</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.amountEUR === 0 ? '' : String(line.amountEUR)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                    const n = parseFloat(v);
                    updateLine(line.id, { amountEUR: v === '' || isNaN(n) ? 0 : n });
                  }}
                  disabled={disabled}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 font-mono text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
                />
              </label>
            )}
            {line.kind === 'percent_of_budget' && (
              <label className="w-full sm:w-28">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">%</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.percent === 0 ? '' : String(line.percent)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                    const n = parseFloat(v);
                    updateLine(line.id, { percent: v === '' || isNaN(n) ? 0 : n });
                  }}
                  disabled={disabled}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 font-mono text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
                />
              </label>
            )}
            {line.kind === 'one_off_month' && (
              <>
                <label className="w-full sm:w-36">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">Μήνας</span>
                  <input
                    type="month"
                    value={line.month}
                    onChange={(e) => updateLine(line.id, { month: e.target.value })}
                    disabled={disabled}
                    className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
                  />
                </label>
                <label className="w-full sm:w-28">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[#9CA3AF]">€ (σύνολο)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.amountEUR === 0 ? '' : String(line.amountEUR)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                      const n = parseFloat(v);
                      updateLine(line.id, { amountEUR: v === '' || isNaN(n) ? 0 : n });
                    }}
                    disabled={disabled}
                    className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 font-mono text-sm focus:border-[var(--nts-accent)] focus:outline-none disabled:opacity-50"
                  />
                </label>
              </>
            )}
            <button
              type="button"
              onClick={() => removeLine(line.id)}
              disabled={disabled}
              className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-md border border-transparent text-[#9CA3AF] hover:bg-[#FEF2F2] hover:text-[#EF4444] disabled:opacity-40"
              title="Διαγραφή"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {!budgetHint && lines.some((l) => l.kind === 'percent_of_budget') && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mt-3">
          Ορίστε μηνιαίο budget παραπάνω ώστε τα ποσοστά να υπολογίζονται.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={addLine}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#D1D5DB] px-3 py-1.5 text-xs font-medium text-[#4B5563] hover:border-[var(--nts-accent)] hover:text-[#111827] disabled:opacity-40"
        >
          <Plus size={14} />
          Γραμμή
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={disabled || isSaving}
          className="inline-flex items-center rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f2937] disabled:opacity-50"
        >
          {isSaving ? 'Αποθήκευση...' : 'Αποθήκευση'}
        </button>
      </div>
    </div>
  );
}
