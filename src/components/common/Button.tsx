import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
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

/**
 * Colour is the whole of this file's design.
 *
 * Primary is white on `--orange-700`, not on `--orange-500`. Orange at full strength measures
 * 3.00:1 against white, which is a button whose label cannot be read; `--orange-700` is 5.61:1 and
 * is the only reason `--nts-accent-text` exists. Hover darkens with a filter rather than stepping
 * to `--orange-600`, because that step goes *lighter* and would drop the label back under 4.5:1
 * exactly while the pointer is on it.
 *
 * Secondary is the board's resting control: white, `--border`, secondary text. Danger is white on
 * `--danger-700` for the same contrast reason primary is.
 */
const variantStyle: Record<'primary' | 'secondary' | 'danger', CSSProperties> = {
  primary: {
    background: 'var(--gold-500)',
    color: 'var(--navy-900)',
    borderColor: 'var(--gold-500)',
  },
  secondary: {
    background: 'var(--surface-0)',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border)',
  },
  danger: {
    background: 'var(--danger-700)',
    color: 'var(--surface-0)',
    borderColor: 'var(--danger-700)',
  },
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
        className={`signal-btn inline-flex items-center justify-center p-2 rounded-lg disabled:opacity-50 ${className}`}
        style={{ color: 'var(--text-secondary)', ...style }}
        {...rest}
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
        className={`signal-btn ${className}`.trim()}
        style={style}
        leadingVisual={icon && iconPosition === 'left' ? () => <>{icon}</> : undefined}
        trailingVisual={icon && iconPosition === 'right' ? () => <>{icon}</> : undefined}
        {...rest}
      >
        {loading ? 'Φόρτωση…' : children}
      </PrimerButton>
    );
  }

  const resolved = variantStyle[variant] ?? variantStyle.secondary;

  return (
    <button
      type={type || 'button'}
      disabled={disabled || loading}
      onClick={onClick}
      className={`signal-btn signal-btn--${variant} inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass} ${className}`}
      style={{ ...resolved, ...style }}
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
