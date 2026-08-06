import type { ReactNode } from 'react';

export interface ModalHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Extra classes on the outer bar (default: border-b + responsive padding) */
  className?: string;
  toolbarAriaLabel?: string;
}

/** Modal/drawer header: same responsive pattern as PageHeader (stacked when narrow, single row at lg). */
export function ModalHeader({
  title,
  description,
  actions,
  className = '',
  toolbarAriaLabel = 'Ενέργειες',
}: ModalHeaderProps) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 border-b border-[var(--border)] p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-between lg:gap-4 ${className}`.trim()}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {title}
        {description}
      </div>
      {actions != null && (
        <div
          className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:gap-2 lg:w-auto lg:flex-nowrap lg:justify-end lg:items-center"
          role="toolbar"
          aria-label={toolbarAriaLabel}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
