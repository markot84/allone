import type { ReactNode } from 'react';
import { Label } from '@primer/react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'orange';
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
  return (
    <Label
      variant={mapVariant(variant)}
      size={size === 'sm' ? 'small' : 'large'}
      className={className}
    >
      {children}
    </Label>
  );
}
