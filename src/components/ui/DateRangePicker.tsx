import { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};
const firstOfMonth = (y: number, m: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-01`;
const lastOfMonth = (y: number, m: number) =>
  new Date(y, m + 1, 0).toISOString().slice(0, 10);

const PRESETS = [
  { label: 'Σήμερα', from: () => todayStr(), to: () => todayStr() },
  { label: 'Χθες', from: () => daysAgo(1), to: () => daysAgo(1) },
  { label: 'Τελ. 7 ημέρες', from: () => daysAgo(6), to: () => todayStr() },
  { label: 'Τελ. 14 ημέρες', from: () => daysAgo(13), to: () => todayStr() },
  { label: 'Τελ. 30 ημέρες', from: () => daysAgo(29), to: () => todayStr() },
  { label: 'Τελ. 90 ημέρες', from: () => daysAgo(89), to: () => todayStr() },
  {
    label: 'Τρέχων μήνας',
    from: () => { const n = new Date(); return firstOfMonth(n.getFullYear(), n.getMonth()); },
    to: () => todayStr(),
  },
  {
    label: 'Προηγ. μήνας',
    from: () => { const n = new Date(); const pm = n.getMonth() === 0 ? 11 : n.getMonth() - 1; const y = n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear(); return firstOfMonth(y, pm); },
    to: () => { const n = new Date(); const pm = n.getMonth() === 0 ? 11 : n.getMonth() - 1; const y = n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear(); return lastOfMonth(y, pm); },
  },
  {
    label: 'Τρέχων έτος',
    from: () => `${new Date().getFullYear()}-01-01`,
    to: () => todayStr(),
  },
  {
    label: 'Προηγούμενο έτος',
    from: () => `${new Date().getFullYear() - 1}-01-01`,
    to: () => `${new Date().getFullYear() - 1}-12-31`,
  },
  { label: 'Τελ. 3 χρόνια', from: () => daysAgo(365 * 3), to: () => todayStr() },
];

const MONTH_NAMES = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
];
const MONTH_SHORT = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const DAY_NAMES = ['Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα', 'Κυ'];

function makeDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDays(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1).getDay(); // 0=Sun
  const total = new Date(year, month + 1, 0).getDate();
  const offset = (first + 6) % 7; // Mon-start
  const days: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= total; d++) days.push(d);
  return days;
}

function formatDisplay(s: string): string {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${parseInt(d)} ${MONTH_SHORT[parseInt(m) - 1]} ${y}`;
}

// ── Sub-component: single month calendar ───────────────────────────────────
interface MonthCalendarProps {
  year: number;
  month: number;
  pendingFrom: string;
  pendingTo: string;
  hoverDate: string;
  onDayClick: (d: string) => void;
  onDayHover: (d: string) => void;
  onPrev: () => void;
  onNext: () => void;
  showPrev: boolean;
  showNext: boolean;
}

function MonthCalendar({ year, month, pendingFrom, pendingTo, hoverDate, onDayClick, onDayHover, onPrev, onNext, showPrev, showNext }: MonthCalendarProps) {
  const days = getDays(year, month);
  const today = todayStr();

  const lo = pendingFrom && (pendingTo || hoverDate)
    ? (pendingFrom <= (pendingTo || hoverDate) ? pendingFrom : (pendingTo || hoverDate))
    : pendingFrom;
  const hi = pendingFrom && (pendingTo || hoverDate)
    ? (pendingFrom <= (pendingTo || hoverDate) ? (pendingTo || hoverDate) : pendingFrom)
    : '';

  return (
    <div className="p-4 flex-1 min-w-[220px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 h-8">
        <button
          onClick={onPrev}
          className={`w-7 h-7 flex items-center justify-center rounded hover:bg-[#F3F4F6] transition-colors ${!showPrev ? 'invisible' : ''}`}
        >
          <ChevronLeft size={15} className="text-[#6B7280]" />
        </button>
        <span className="text-sm font-semibold text-[#111827]">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={onNext}
          className={`w-7 h-7 flex items-center justify-center rounded hover:bg-[#F3F4F6] transition-colors ${!showNext ? 'invisible' : ''}`}
        >
          <ChevronRight size={15} className="text-[#6B7280]" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-[#9CA3AF] py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="h-8" />;
          const ds = makeDate(year, month, day);
          const isStart = ds === lo;
          const isEnd = ds === hi && hi !== lo;
          const inRange = lo && hi && ds > lo && ds < hi;
          const isFuture = ds > today;
          const isToday = ds === today;

          return (
            <div key={ds} className="relative h-8 flex items-center justify-center">
              {/* Range fill */}
              {inRange && (
                <div className="absolute inset-0 bg-[var(--nts-accent)]/10" />
              )}
              {isStart && hi && hi !== lo && (
                <div className="absolute top-0 bottom-0 left-1/2 right-0 bg-[var(--nts-accent)]/10" />
              )}
              {isEnd && (
                <div className="absolute top-0 bottom-0 left-0 right-1/2 bg-[var(--nts-accent)]/10" />
              )}
              <button
                onClick={() => !isFuture && onDayClick(ds)}
                onMouseEnter={() => !isFuture && onDayHover(ds)}
                onMouseLeave={() => onDayHover('')}
                disabled={isFuture}
                className={`
                  relative z-10 w-8 h-8 rounded-full text-[13px] transition-all flex items-center justify-center
                  ${isFuture ? 'text-[#D1D5DB] cursor-not-allowed' : 'cursor-pointer'}
                  ${isStart || isEnd
                    ? 'bg-[var(--nts-accent)] text-white font-semibold shadow-sm'
                    : isFuture
                    ? ''
                    : 'text-[#374151] hover:bg-[var(--nts-accent)] hover:text-white hover:opacity-80'}
                  ${isToday && !isStart && !isEnd ? 'font-bold underline underline-offset-2' : ''}
                `}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onClear?: () => void;
}

export function DateRangePicker({ from, to, onChange, onClear }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const [hoverDate, setHoverDate] = useState('');
  const [pickingSecond, setPickingSecond] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [rightYear, setRightYear] = useState(now.getFullYear());
  const [rightMonth, setRightMonth] = useState(now.getMonth());

  const leftYear = rightMonth === 0 ? rightYear - 1 : rightYear;
  const leftMonth = rightMonth === 0 ? 11 : rightMonth - 1;

  // Sync pending state with props when closed
  useEffect(() => {
    if (!open) { setPendingFrom(from); setPendingTo(to); }
  }, [from, to, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const navigatePrev = () => {
    if (rightMonth === 0) { setRightYear(y => y - 1); setRightMonth(11); }
    else setRightMonth(m => m - 1);
  };
  const navigateNext = () => {
    if (rightMonth === 11) { setRightYear(y => y + 1); setRightMonth(0); }
    else setRightMonth(m => m + 1);
  };

  const handleDayClick = (ds: string) => {
    if (!pickingSecond) {
      // First click: set start, clear end
      setPendingFrom(ds);
      setPendingTo('');
      setPickingSecond(true);
    } else {
      // Second click: set end, normalise order
      const [f, t] = ds >= pendingFrom ? [pendingFrom, ds] : [ds, pendingFrom];
      setPendingFrom(f);
      setPendingTo(t);
      setPickingSecond(false);
    }
  };

  const applyPreset = (f: string, t: string) => {
    onChange(f, t);
    setOpen(false);
    setPickingSecond(false);
  };

  const apply = () => {
    if (pendingFrom && pendingTo) {
      onChange(pendingFrom, pendingTo);
      setOpen(false);
      setPickingSecond(false);
    }
  };

  const isPresetActive = (p: typeof PRESETS[0]) =>
    p.from() === from && p.to() === to;

  const triggerLabel = from && to
    ? `${formatDisplay(from)} – ${formatDisplay(to)}`
    : 'Επιλογή περιόδου';

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* ── Trigger ── */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all bg-white
            ${open ? 'border-[var(--nts-accent)] shadow-md' : 'border-[#E5E7EB] hover:border-[var(--nts-accent)]/60'}
          `}
        >
          <Calendar size={15} className="text-[var(--nts-accent)] shrink-0" />
          <span className="text-[#374151]">{triggerLabel}</span>
          <ChevronDown size={13} className={`text-[#9CA3AF] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
        {(from || to) && onClear && (
          <button
            onClick={onClear}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#F3F4F6] text-[#9CA3AF] hover:text-[#374151] transition-colors"
            title="Καθαρισμός"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {open && (
        <div
          className="absolute top-full mt-2 left-0 z-50 bg-white rounded-xl shadow-2xl border border-[#E5E7EB] flex overflow-hidden"
          style={{ minWidth: 660 }}
        >
          {/* Presets sidebar */}
          <div className="w-44 border-r border-[#F3F4F6] py-3 flex flex-col shrink-0">
            <div className="px-3 pb-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Γρήγορη επιλογή
            </div>
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.from(), p.to())}
                className={`text-left px-3 py-1.5 text-sm transition-colors
                  ${isPresetActive(p)
                    ? 'bg-[var(--nts-accent)] text-white font-medium'
                    : 'text-[#374151] hover:bg-[#F9FAFB]'}
                `}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar area */}
          <div className="flex flex-col flex-1">
            <div className="flex divide-x divide-[#F3F4F6]">
              <MonthCalendar
                year={leftYear}
                month={leftMonth}
                pendingFrom={pendingFrom}
                pendingTo={pendingTo}
                hoverDate={pickingSecond ? hoverDate : ''}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
                onPrev={navigatePrev}
                onNext={navigateNext}
                showPrev
                showNext={false}
              />
              <MonthCalendar
                year={rightYear}
                month={rightMonth}
                pendingFrom={pendingFrom}
                pendingTo={pendingTo}
                hoverDate={pickingSecond ? hoverDate : ''}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
                onPrev={navigatePrev}
                onNext={navigateNext}
                showPrev={false}
                showNext
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#F3F4F6] bg-[#FAFAFA]">
              <div className="flex items-center gap-2 text-sm">
                <span className={`px-3 py-1.5 rounded-md border text-sm ${
                  pendingFrom
                    ? 'border-[var(--nts-accent)]/50 bg-white text-[#111827] font-medium'
                    : 'border-dashed border-[#D1D5DB] text-[#9CA3AF]'
                }`}>
                  {pendingFrom ? formatDisplay(pendingFrom) : 'Ημ. έναρξης'}
                </span>
                <span className="text-[#D1D5DB] font-light text-base">→</span>
                <span className={`px-3 py-1.5 rounded-md border text-sm ${
                  pendingTo
                    ? 'border-[var(--nts-accent)]/50 bg-white text-[#111827] font-medium'
                    : 'border-dashed border-[#D1D5DB] text-[#9CA3AF]'
                }`}>
                  {pendingTo ? formatDisplay(pendingTo) : 'Ημ. λήξης'}
                </span>
                {pickingSecond && (
                  <span className="text-xs text-[#9CA3AF] italic ml-1">Επιλέξτε ημέρα λήξης</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="px-4 py-1.5 text-sm rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                >
                  Ακύρωση
                </button>
                <button
                  onClick={apply}
                  disabled={!pendingFrom || !pendingTo}
                  className="px-4 py-1.5 text-sm rounded-lg bg-[var(--nts-accent)] text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Εφαρμογή
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
