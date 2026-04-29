import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Κύριος τίτλος (π.χ. h2) */
  title: ReactNode;
  /** Υπότιτλος / περιγραφή */
  description?: ReactNode;
  /** Πρόσθετη γραμμή (π.χ. στατιστικά σε πράσινο) — ξεχωριστά από το description για καλύτερο wrap σε mobile */
  meta?: ReactNode;
  /** Κουμπιά / εργαλεία δεξιά — τυλίγονται και στοιβάζονται responsive */
  actions?: ReactNode;
  toolbarAriaLabel?: string;
  className?: string;
}

/**
 * Τυπική κεφαλίδα σελίδας: τίτλος + ενέργειες.
 * Σε mobile/tablet στοιβάζεται (τίτλος πάνω, actions κάτω πλήρους πλάτους)· σε lg+ ίδια γραμμή.
 */
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
      className={`flex flex-col gap-3 min-w-0 lg:flex-row lg:items-start lg:justify-between lg:gap-6 ${className}`.trim()}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {title}
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
