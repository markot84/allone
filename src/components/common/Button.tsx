import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button as PrimerButton } from '@primer/react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children?: ReactNode;
}

function mapSize(size: ButtonProps['size']): 'small' | 'medium' | 'large' {
  switch (size) {
    case 'sm': return 'small';
    case 'lg': return 'large';
    default: return 'medium';
  }
}

const variantStyles: Record<string, string> = {
  primary: 'bg-[var(--nts-accent)] hover:bg-[var(--nts-accent)]/90 text-white border-[var(--nts-accent)]',
  secondary: 'bg-white hover:bg-gray-50 text-[var(--nts-charcoal)] border-[#E5E5E5]',
  ghost: '',
  danger: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
};

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
  style,
  ...rest
}: ButtonProps) {
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-4 py-2 text-sm';

  if (!children && icon && variant === 'ghost') {
    return (
      <button
        type={type || 'button'}
        disabled={disabled || loading}
        onClick={onClick}
        aria-label={rest['aria-label'] || 'button'}
        className={`inline-flex items-center justify-center p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-50 ${className}`}
        style={style}
      >
        {icon}
      </button>
    );
  }

  if (variant === 'ghost') {
    return (
      <PrimerButton
        variant="invisible"
        size={mapSize(size)}
        disabled={disabled || loading}
        onClick={onClick}
        type={type}
        className={className}
        style={style}
        leadingVisual={icon && iconPosition === 'left' ? () => <>{icon}</> : undefined}
        trailingVisual={icon && iconPosition === 'right' ? () => <>{icon}</> : undefined}
        {...rest}
      >
        {loading ? 'Φόρτωση…' : children}
      </PrimerButton>
    );
  }

  return (
    <button
      type={type || 'button'}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass} ${variantStyles[variant] || variantStyles.secondary} ${className}`}
      style={style}
      {...rest}
    >
      {loading ? 'Φόρτωση…' : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </button>
  );
}
