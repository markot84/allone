import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button as PrimerButton } from '@primer/react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children: ReactNode;
}

function mapVariant(variant: ButtonProps['variant']): React.ComponentProps<typeof PrimerButton>['variant'] {
  switch (variant) {
    case 'primary':
      return 'primary';
    case 'danger':
      return 'danger';
    case 'ghost':
      return 'invisible';
    case 'secondary':
    default:
      return 'default';
  }
}

function mapSize(size: ButtonProps['size']): React.ComponentProps<typeof PrimerButton>['size'] {
  switch (size) {
    case 'sm':
      return 'small';
    case 'lg':
      return 'large';
    case 'md':
    default:
      return 'medium';
  }
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  children,
  className = '',
  disabled,
  onClick,
  type,
  ...rest
}: ButtonProps) {
  return (
    <PrimerButton
      variant={mapVariant(variant)}
      size={mapSize(size)}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      className={className}
      leadingVisual={icon && iconPosition === 'left' ? () => <>{icon}</> : undefined}
      trailingVisual={icon && iconPosition === 'right' ? () => <>{icon}</> : undefined}
      {...rest}
    >
      {loading ? 'Loading…' : children}
    </PrimerButton>
  );
}
