import type { CSSProperties, ReactNode } from 'react';
import { Heading, Text } from '@primer/react';
import { SignalEyebrow } from '../signal';

/**
 * The app's card.
 *
 * This is `SignalCard` wearing the old `Card` API: same props, same call sites, the Signal Board's
 * surface. Restyling here rather than at 59 call sites is the whole point — the board's white
 * panel, navy-100 hairline, 16px radius and single soft shadow arrive everywhere at once.
 *
 * The per-card entrance animation is gone on purpose. A 300ms rise on every card of every page is
 * the "motion spread evenly across every module reads as a template" failure the brief names; the
 * reveal budget belongs to the Strategy Configurator, not to the twelfth card of a table page.
 */

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  onClick?: () => void;
  /** Paints the leading edge. For cards that carry a decision, not for every card on the page. */
  accent?: string;
  /** The heavier shadow, for a card that leads a view. One per screen, at most. */
  elevated?: boolean;
  style?: CSSProperties;
}

const paddingPx: Record<NonNullable<CardProps['padding']>, number> = {
  none: 0,
  sm: 16,
  md: 20,
  lg: 24,
};

const RESTING_SHADOW = '0 3px 6px -2px rgba(16,24,40,0.07)';
const ELEVATED_SHADOW = '0 4px 8px -2px rgba(16,24,40,0.08), 0 12px 24px -4px rgba(16,24,40,0.10)';

export function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
  onClick,
  accent,
  elevated = false,
  style,
}: CardProps) {
  const interactive = hover || !!onClick;

  return (
    <div className={className}>
      <div
        className={`card-primer ${className.includes('h-full') ? 'h-full' : ''}`}
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--navy-100)',
          borderRadius: 16,
          ...(accent ? { borderLeft: `4px solid ${accent}` } : null),
          padding: paddingPx[padding],
          minWidth: 0,
          cursor: interactive ? 'pointer' : 'default',
          transition: `box-shadow var(--dur-state) var(--ease-out), border-color var(--dur-state) var(--ease-out)`,
          boxShadow: elevated ? ELEVATED_SHADOW : RESTING_SHADOW,
          ...style,
        }}
        onClick={onClick}
        onMouseEnter={(e) => {
          if (!interactive) return;
          e.currentTarget.style.boxShadow = ELEVATED_SHADOW;
        }}
        onMouseLeave={(e) => {
          if (!interactive) return;
          e.currentTarget.style.boxShadow = elevated ? ELEVATED_SHADOW : RESTING_SHADOW;
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Mono kicker above the title — `SignalCardHeader`'s eyebrow, optional here so old call sites work. */
  eyebrow?: string;
}

export function CardHeader({ title, subtitle, icon, action, className = '', eyebrow }: CardHeaderProps) {
  return (
    <div
      className={`mb-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4 ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon && (
          <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <span style={{ display: 'block', marginBottom: 6 }}>
              <SignalEyebrow>{eyebrow}</SignalEyebrow>
            </span>
          )}
          {/* Navy is the dominant brand colour and headings are where it carries (colors.md §2).
              Setting it here rather than at each call site is what puts it on every card title. */}
          <Heading
            as="h3"
            variant="small"
            style={{ margin: 0, color: 'var(--text-heading)', letterSpacing: '-0.015em' }}
          >
            {title}
          </Heading>
          {subtitle &&
            (typeof subtitle === 'string' ? (
              <Text
                as="p"
                size="small"
                className="!mt-0.5 !block break-words text-pretty leading-relaxed [overflow-wrap:anywhere]"
                style={{ margin: 0, marginTop: 2, color: 'var(--text-secondary)' }}
              >
                {subtitle}
              </Text>
            ) : (
              <div
                className="mt-0.5 max-w-full space-y-1.5 text-[13px] leading-snug [&_p]:m-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                {subtitle}
              </div>
            ))}
        </div>
      </div>
      {action && (
        <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 lg:w-auto lg:flex-nowrap lg:justify-end lg:items-center">
          {action}
        </div>
      )}
    </div>
  );
}
