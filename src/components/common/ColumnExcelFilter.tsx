import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';

export type ExcelFilterOption = { id: string; label: string };

export interface ColumnExcelFilterProps {
  label: string;
  options: ExcelFilterOption[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  /** excel: null = all checked. additive: null/[] = none checked = no filter (all rows). */
  selectionMode?: 'excel' | 'additive';
  /** Narrow button for table header (no external label). */
  compact?: boolean;
}

export function ColumnExcelFilter({
  label,
  options,
  value,
  onChange,
  selectionMode = 'excel',
  compact = false,
}: ColumnExcelFilterProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [draftValue, setDraftValue] = useState<string[] | null>(value);
  const ref = useRef<HTMLDivElement>(null);
  const allIds = useMemo(() => options.map((o) => o.id), [options]);
  const selected = useMemo(() => {
    if (selectionMode === 'additive') {
      if (value == null || value.length === 0) return new Set<string>();
      const allow = new Set(allIds);
      return new Set(value.filter((id) => allow.has(id)));
    }
    if (value == null) return new Set(allIds);
    if (value.length === 0) return new Set<string>();
    const allow = new Set(allIds);
    return new Set(value.filter((id) => allow.has(id)));
  }, [value, allIds, selectionMode]);
  const draftSelected = useMemo(() => {
    if (selectionMode === 'additive') {
      if (draftValue == null || draftValue.length === 0) return new Set<string>();
      const allow = new Set(allIds);
      return new Set(draftValue.filter((id) => allow.has(id)));
    }
    if (draftValue == null) return new Set(allIds);
    if (draftValue.length === 0) return new Set<string>();
    const allow = new Set(allIds);
    return new Set(draftValue.filter((id) => allow.has(id)));
  }, [draftValue, allIds, selectionMode]);

  useEffect(() => {
    if (!open) {
      setQ('');
      return;
    }
    setDraftValue(value);
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, value]);

  const filteredOpts = useMemo(
    () =>
      options.filter(
        (o) =>
          o.label.toLowerCase().includes(q.toLowerCase()) ||
          o.id.toLowerCase().includes(q.toLowerCase()),
      ),
    [options, q],
  );

  const toggle = (id: string) => {
    if (selectionMode === 'additive') {
      const startSelected =
        draftValue != null && draftValue.length > 0 ? new Set(draftValue.filter((x) => allIds.includes(x))) : new Set<string>();
      const next = new Set(startSelected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0 || next.size === allIds.length) setDraftValue(null);
      else setDraftValue([...next]);
      return;
    }
    const startSelected =
      draftValue == null || draftValue.length === 0
        ? new Set(allIds)
        : new Set(draftValue.filter((x) => allIds.includes(x)));
    const next = new Set(startSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) {
      setDraftValue([]);
      return;
    }
    if (next.size === allIds.length) setDraftValue(null);
    else setDraftValue([...next]);
  };

  const applyDraft = () => {
    if (selectionMode === 'additive') {
      if (draftSelected.size === 0 || draftSelected.size === allIds.length) onChange(null);
      else onChange([...draftSelected]);
      setOpen(false);
      return;
    }
    if (draftSelected.size === allIds.length) onChange(null);
    else if (draftSelected.size === 0) onChange([]);
    else onChange([...draftSelected]);
    setOpen(false);
  };

  const selectedCount = value == null || value.length === 0 ? allIds.length : selected.size;
  const selectedLabels = useMemo(
    () => options.filter((o) => selected.has(o.id)).map((o) => o.label),
    [options, selected],
  );
  const summary =
    selectionMode === 'additive'
      ? value == null || value.length === 0
        ? 'Όλα'
        : selectedLabels.length === 1
          ? selectedLabels[0]
          : selectedLabels.length <= 2
            ? selectedLabels.join(', ')
            : `${selectedLabels.length} επιλογές`
      : value === null
        ? 'Όλα'
        : value.length === 0
          ? 'Καμία'
          : selectedLabels.length === 1
            ? selectedLabels[0]
            : `${selectedCount}/${allIds.length}`;

  const filterActive = value != null && value.length > 0 && value.length < allIds.length;

  if (options.length === 0) {
    if (compact) return <span className="inline-block h-7 w-7 text-center text-xs text-[#D1D5DB]">—</span>;
    return (
      <div className="flex min-w-[140px] flex-col gap-1 opacity-60">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</span>
        <span className="py-2 text-xs text-[#9CA3AF]">—</span>
      </div>
    );
  }

  const dropdown = open ? (
    <div className="absolute left-0 top-full z-[60] mt-1 flex max-h-72 min-w-[260px] w-max max-w-[min(100vw-2rem,320px)] flex-col rounded-lg border border-[#E5E5E5] bg-white shadow-lg">
      <div className="border-b border-[#E5E5E5] p-2">
        <input
          type="search"
          placeholder="Αναζήτηση στη λίστα…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-xs focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30"
        />
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {filteredOpts.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-[#374151] hover:bg-[#F9FAFB]"
          >
            <input
              type="checkbox"
              checked={draftSelected.has(o.id)}
              onChange={() => toggle(o.id)}
              className="rounded border-[#D1D5DB] text-[var(--nts-accent-text)] focus:ring-[var(--nts-accent)]/30"
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#E5E5E5] bg-[#FAFAFA]/90 p-2.5">
        <button
          type="button"
          className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-[#6B7280] hover:bg-white hover:underline"
          onClick={() => {
            setDraftValue(null);
            setQ('');
          }}
        >
          Επαναφορά
        </button>
        <button
          type="button"
          className="whitespace-nowrap rounded-md bg-[var(--nts-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--nts-accent)]/90"
          onClick={applyDraft}
        >
          Εφαρμογή
        </button>
      </div>
    </div>
  ) : null;

  if (compact) {
    return (
      <div ref={ref} className="relative inline-flex">
        <span className="sr-only">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`relative inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 transition-colors ${
            filterActive
              ? 'border-[var(--nts-accent)]/40 bg-orange-50/80 text-[var(--nts-accent-text)]'
              : 'border-transparent text-[#6B7280] hover:border-[#E5E7EB] hover:bg-white'
          }`}
          aria-expanded={open}
          aria-haspopup="listbox"
          title={`${label}: ${summary}`}
        >
          <Filter size={13} aria-hidden />
        </button>
        {dropdown}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex min-w-[160px] flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent bg-[#F5F5F5] px-3 py-2 text-left text-sm transition-all hover:border-[var(--nts-accent)]"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <Filter size={14} className="shrink-0 text-[#9CA3AF]" aria-hidden />
          <span className="text-[#374151]">{summary}</span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-[#9CA3AF]" />
      </button>
      {dropdown}
    </div>
  );
}
