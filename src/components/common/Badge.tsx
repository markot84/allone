import type { ReactNode } from 'react';
import { Label } from '@primer/react';

interface BadgeProps {
  children: ReactNode;
  /**
   * `gold` is the highlight badge of colors.md §2 — an editorial mark, not a status. It is
   * deliberately NOT wired to `warning`: the semantic scale keeps its own amber precisely so a
   * warning is never mistaken for a brand flourish.
   */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'gold';
  size?: 'sm' | 'md';
  className?: string;
}

function mapVariant(variant: BadgeProps['variant']): React.ComponentProps<typeof Label>['variant'] {
  switch (variant) {
    case 'success':
      return 'success';
    case 'warning':
      return 'attention';
    case 'danger':
      return 'danger';
    case 'info':
    case 'orange':
    case 'gold':
      return 'accent';
    case 'default':
    default:
      return 'secondary';
  }
}

export function Badge({ 
  children, 
  variant = 'default', 
  size = 'sm',
  className = '' 
}: BadgeProps) {
  const orangeClass = variant === 'orange' ? '!bg-[var(--nts-accent)] !text-white !border-transparent' : '';
  // Navy on gold measures 7.40:1; gold is never the text.
  const goldClass = variant === 'gold' ? '!bg-[var(--gold-500)] !text-[var(--navy-500)] !border-transparent' : '';
  return (
    <Label
      variant={mapVariant(variant)}
      size={size === 'sm' ? 'small' : 'large'}
      className={`${orangeClass} ${goldClass} ${className}`.trim()}
    >
      {children}
    </Label>
  );
}
