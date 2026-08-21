import type { ReactNode } from 'react';
import { SignalEyebrow } from '../signal';

export interface PageHeaderProps {
  /** The page title. A string gets the board's treatment; a node is rendered as the caller built it. */
  title: ReactNode;
  /** Mono kicker above the title — the section's name, where the title is the view's name. */
  eyebrow?: string;
  /** Subtitle / description */
  description?: ReactNode;
  /** Extra line (e.g. stats in green) — separate from description for better wrap on mobile */
  meta?: ReactNode;
  /** Buttons / tools on the right — wrap and stack responsively */
  actions?: ReactNode;
  toolbarAriaLabel?: string;
  className?: string;
}

/**
 * Standard page header (title + actions): stacks on mobile/tablet, single row at lg+.
 *
 * Pages that have moved their tabs and controls into the top bar pass a plain string and no
 * actions, and get the one-line treatment the dashboard's "Σήμερα" row uses. Pages that have not
 * yet keep passing their own `<h2>`, and nothing about them changes — this is the migration path,
 * not a break.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
  toolbarAriaLabel = 'Ενέργειες σελίδας',
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between lg:gap-x-6 lg:gap-y-3 ${className}`.trim()}
    >
      <div className="min-w-0 flex-1 space-y-1 lg:min-w-[240px]">
        {eyebrow && (
          <span style={{ display: 'block', marginBottom: 6 }}>
            <SignalEyebrow>{eyebrow}</SignalEyebrow>
          </span>
        )}
        {typeof title === 'string' ? (
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-heading)',
            }}
          >
            {title}
          </h2>
        ) : (
          title
        )}
        {typeof description === 'string' ? (
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-secondary)', maxWidth: '78ch' }}>
            {description}
          </p>
        ) : (
          description
        )}
        {meta}
      </div>
      {actions != null && (
        <div
          className="flex w-full min-w-0 flex-wrap items-stretch gap-1.5 sm:gap-2 lg:w-auto lg:justify-end"
          role="toolbar"
          aria-label={toolbarAriaLabel}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
