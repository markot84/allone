import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /**
   * A string renders as the app's one page title — a real `h1` styled by `.page-title`, so the
   * type scale is set in one place rather than retyped per page. Passing a ReactNode still works
   * for the handful of titles that carry an icon or an interpolated brand name, but it opts out of
   * the scale, so prefer the string.
   */
  title: ReactNode;
  /** Subtitle / description */
  description?: ReactNode;
  /** Extra line (e.g. stats in green) — separate from description for better wrap on mobile */
  meta?: ReactNode;
  /** Buttons / tools on the right — wrap and stack responsively */
  actions?: ReactNode;
  toolbarAriaLabel?: string;
  className?: string;
}

/** Standard page header (title + actions): stacks on mobile/tablet, single row at lg+. */
export function PageHeader({
  title,
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
        {typeof title === 'string' ? <h1 className="page-title">{title}</h1> : title}
        {description}
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
