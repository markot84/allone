import type { ReactNode } from 'react';
import { Heading, Text } from '@primer/react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  onClick?: () => void;
}

const paddingPx: Record<NonNullable<CardProps['padding']>, number> = {
  none: 0,
  sm: 16,
  md: 20,
  lg: 24
};

/**
 * The card. One element, not two.
 *
 * It used to render a `motion.div` wrapper around the card, and `className` went to the WRAPPER —
 * which is why `KPICard`'s `border-l-4 hover:border-l-[var(--nts-accent)]` drew a square orange bar
 * beside a rounded card: it was painting an element that had neither background nor radius. Every
 * other appearance class call sites passed (`overflow-hidden`, `border-…`, `bg-…`) was landing in
 * the same place and doing nothing, or drawing a second border around the real one. Dropping the
 * wrapper puts those classes on the card, and grid placement (`lg:col-span-2`, `h-full`) still
 * works because the card is now the direct grid child.
 *
 * The wrapper also animated: every card in the app faded up on mount, unconditionally, and KPICard
 * added a second `motion.div` on top so each KPI played two at once. CLAUDE.md is explicit that
 * motion spread evenly across every module reads as a template — so entrance motion belongs to the
 * screens that earn it, not to the primitive.
 *
 * Appearance now lives in the `.surface` rule in tokens.css. Padding stays inline because it is the
 * one thing the call site chooses per instance.
 */
export function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
  onClick
}: CardProps) {
  const interactive = hover || onClick;

  return (
    <div
      className={`card-primer surface ${className}`.trim()}
      data-interactive={interactive ? 'true' : undefined}
      style={{
        padding: paddingPx[padding],
        cursor: interactive ? 'pointer' : 'default'
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, action, className = '' }: CardHeaderProps) {
  return (
    <div
      className={`mb-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4 ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon && (
          <span className="shrink-0" style={{ color: 'var(--fgColor-muted, #57606a)' }}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {/* Navy is the dominant brand colour and headings are where it carries (colors.md §2).
              Setting it here rather than at each call site is what puts it on every card title. */}
          <Heading as="h3" variant="small" style={{ margin: 0, color: 'var(--text-heading)' }}>
            {title}
          </Heading>
          {subtitle &&
            (typeof subtitle === 'string' ? (
              <Text
                as="p"
                size="small"
                className="!mt-0.5 !block break-words text-pretty leading-relaxed [overflow-wrap:anywhere]"
                style={{ margin: 0, marginTop: 2, color: 'var(--fgColor-muted, #57606a)' }}
              >
                {subtitle}
              </Text>
            ) : (
              <div
                className="mt-0.5 max-w-full space-y-1.5 text-[13px] leading-snug [&_p]:m-0"
                style={{ color: 'var(--fgColor-muted, #57606a)' }}
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
