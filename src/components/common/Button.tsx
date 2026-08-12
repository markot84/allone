import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children?: ReactNode;
}

/**
 * One button, four variants.
 *
 * This file used to render three different elements: a native `button` for primary/secondary/danger,
 * a Primer `Button variant="invisible"` for ghost, and a third bare `button` for the icon-only ghost.
 * A ghost and a primary sitting next to each other therefore agreed on nothing — not height, not
 * radius, not focus ring — which is visible in every toolbar in the app. They are one element now.
 *
 * The colours moved to `--btn-*` in tokens.css. The primary was white on `#FE630C` (3.00:1); it is
 * white on `--orange-700` (5.60:1), which is what colors.md §3 and CLAUDE.md both specify. `danger`
 * was Tailwind's `bg-red-600` and `secondary` a hardcoded `#E5E5E5` border — both off-palette.
 *
 * `min-height` rather than padding alone is what actually makes a row of mixed variants line up:
 * padding plus a differing line-height does not.
 */

const sizeStyle: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
  sm: { minHeight: 28, padding: '0 var(--space-3)', fontSize: 'var(--type-micro)', gap: 'var(--space-1)' },
  md: { minHeight: 36, padding: '0 var(--space-4)', fontSize: 'var(--type-small)', gap: 'var(--space-2)' },
  lg: { minHeight: 44, padding: '0 var(--space-5)', fontSize: 'var(--type-body)', gap: 'var(--space-2)' }
};

const variantStyle: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
  primary: {
    background: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-fg)',
    borderColor: 'var(--btn-primary-bg)'
  },
  secondary: {
    background: 'var(--btn-secondary-bg)',
    color: 'var(--btn-secondary-fg)',
    borderColor: 'var(--btn-secondary-border)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--btn-ghost-fg)',
    borderColor: 'transparent'
  },
  danger: {
    background: 'var(--btn-danger-bg)',
    color: 'var(--btn-danger-fg)',
    borderColor: 'var(--btn-danger-bg)'
  }
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
  const iconOnly = !children && !!icon;

  return (
    <button
      type={type || 'button'}
      disabled={disabled || loading}
      onClick={onClick}
      data-variant={variant}
      className={`btn ${className}`.trim()}
      style={{
        ...sizeStyle[size],
        ...variantStyle[variant],
        // A square target for an icon with no label, so it does not render as a wide thin pill.
        ...(iconOnly ? { padding: 0, width: sizeStyle[size].minHeight, aspectRatio: '1 / 1' } : null),
        ...style
      }}
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
