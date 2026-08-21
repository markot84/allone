import type { CSSProperties, ReactNode } from 'react';
import { MONO } from '../signal';

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

/**
 * The status chip, one vocabulary with `SignalChip`.
 *
 * Primer's `Label` used to carry this, which meant badges were the one place in the app still
 * showing another design system's greys. Every pair below is a token background with a token text
 * colour chosen to clear 4.5:1 on it — gold and orange included, which is why neither of them is
 * ever the text: navy sits on gold (7.40:1) and `--orange-700` sits on `--orange-100`.
 */
const VARIANT: Record<NonNullable<BadgeProps['variant']>, { background: string; color: string }> = {
  default: { background: 'var(--surface-2)', color: 'var(--text-secondary)' },
  success: { background: 'var(--success-light)', color: 'var(--success-700)' },
  warning: { background: 'var(--warning-light)', color: 'var(--orange-700)' },
  danger: { background: 'var(--danger-light)', color: 'var(--danger-600)' },
  info: { background: 'var(--sky-badge-bg)', color: 'var(--sky-700)' },
  orange: { background: 'var(--orange-100)', color: 'var(--orange-700)' },
  gold: { background: 'var(--gold-500)', color: 'var(--navy-500)' },
};

export function Badge({ children, variant = 'default', size = 'sm', className = '' }: BadgeProps) {
  const tone = VARIANT[variant] ?? VARIANT.default;
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: MONO,
    fontSize: size === 'sm' ? 10 : 11,
    fontWeight: 700,
    letterSpacing: '0.1em',
    // Greek drops its accents in all-caps, and the document declares lang="el", so the browser
    // applies that rule for us — the same treatment every other chip on the board gets.
    textTransform: 'uppercase',
    padding: size === 'sm' ? '4px 9px' : '5px 11px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
    ...tone,
  };

  return (
    <span className={className} style={style}>
      {children}
    </span>
  );
}
