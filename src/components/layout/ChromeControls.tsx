import type { ReactNode } from 'react';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS, type GlobalPeriod } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { ChromeActions, ChromeTabs } from './AppChrome';
import { MONO } from '../signal';

/**
 * The controls every page hands to the top bar.
 *
 * The bar is one navy strip that mixes app chrome with what only the current page knows: its tab
 * row and its period. Before this file each page drew its own tab row inside the canvas and its own
 * period pills in a grey `bg-gray-100` group — five implementations of two controls, none of which
 * matched the board. They are one implementation here, and a page adopts the chrome by rendering
 * two components rather than by restyling anything.
 */

export interface ChromeTab {
  id: string;
  label: string;
}

/**
 * The tab row, left of the actions and under the section title.
 *
 * The current tab is marked with the same gold underline the rail uses down its leading edge —
 * one marker colour for "you are here", wherever the chrome says it.
 */
export function ChromeTabRow({
  tabs,
  current,
  onSelect,
}: {
  tabs: ChromeTab[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ChromeTabs>
      {tabs.map((tab) => {
        const isCurrent = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => !isCurrent && onSelect(tab.id)}
            className="chrome-tab"
            aria-current={isCurrent ? 'page' : undefined}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: isCurrent ? 'default' : 'pointer',
              padding: '15px 0',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: isCurrent ? 700 : 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: isCurrent ? 'var(--chrome-fg)' : 'var(--chrome-fg-muted)',
              boxShadow: isCurrent ? 'inset 0 -3px 0 var(--chrome-active-marker)' : undefined,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </ChromeTabs>
  );
}

/** Long labels belong in a menu, not in a bar that also carries a title and three controls. */
const PERIOD_SHORT: Record<GlobalPeriod, string> = {
  current_month: 'Μήνας',
  last_30: '30ημ.',
  current_year: 'Έτος',
  custom: 'Custom',
};

/**
 * The period switch, reading and writing the per-brand global date directly.
 *
 * No props for the period: every page that shows one is already looking at `useGlobalDate`, so a
 * page passing its own value down was a second copy of state that could disagree with the context.
 * `onChange` exists only for the pages that keep a local override to clear alongside it.
 */
export function ChromePeriodSwitch({
  onChange,
  showDatePicker = true,
}: {
  onChange?: () => void;
  showDatePicker?: boolean;
}) {
  const { period, setPeriod, customFrom, customTo, setCustomRange, fromDate, toDate } = useGlobalDate();

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          background: 'var(--chrome-control-bg)',
          border: '1px solid var(--chrome-control-border)',
          borderRadius: 8,
          padding: 3,
        }}
      >
        {GLOBAL_PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setPeriod(opt.key);
                onChange?.();
              }}
              className="chrome-period"
              aria-pressed={active}
              title={opt.label}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '7px 13px',
                borderRadius: 6,
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                background: active ? 'var(--chrome-active-bg)' : 'transparent',
                color: active ? 'var(--chrome-active-fg)' : 'var(--chrome-fg-muted)',
              }}
            >
              {PERIOD_SHORT[opt.key] ?? opt.label}
            </button>
          );
        })}
      </div>
      {showDatePicker && period === 'custom' && (
        <DateRangePicker
          from={customFrom || fromDate}
          to={customTo || toDate}
          onChange={(f, t) => {
            setCustomRange(f, t);
            onChange?.();
          }}
          onClear={() => {
            setPeriod('current_month');
            onChange?.();
          }}
        />
      )}
    </>
  );
}

/** Sugar for the common case: a page whose only top-bar contribution is its period. */
export function ChromePeriodActions({ children, onChange }: { children?: ReactNode; onChange?: () => void }) {
  return (
    <ChromeActions>
      <ChromePeriodSwitch onChange={onChange} />
      {children}
    </ChromeActions>
  );
}

/**
 * The canvas a full-bleed page draws on: the board's gutters and its 16px rhythm.
 *
 * Pages call `useFullBleedCanvas()` and wrap their content in this, so "what a page looks like
 * before anything is on it" is one decision rather than four.
 */
export function PageCanvas({ children }: { children: ReactNode }) {
  return <div className="page-canvas">{children}</div>;
}
