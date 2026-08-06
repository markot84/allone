import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
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

export function Card({ 
  children, 
  className = '', 
  padding = 'md', 
  hover = false,
  onClick 
}: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={className}
    >
      {/*
        The surface treatment — border, elevation, lit top edge, hover — lives in the `.surface`
        rule in tokens.css, not here. It used to be inline styles put back by a mouseleave handler,
        which meant hover existed for the mouse and for nothing else; as CSS it covers
        :focus-visible too. It is also what lets the dark theme trade the drop shadow for a lit top
        edge — the only depth cue that survives on a near-black canvas — without this component
        needing to know there are two themes.
      */}
      <div
        className={`card-primer surface ${className.includes('h-full') ? 'h-full' : ''}`}
        data-interactive={hover || onClick ? 'true' : undefined}
        style={{
          padding: paddingPx[padding],
          cursor: hover || onClick ? 'pointer' : 'default',
        }}
        onClick={onClick}
      >
        {children}
      </div>
    </motion.div>
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
          <span className="shrink-0" style={{ color: 'var(--fgColor-muted, var(--text-muted))' }}>
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
                style={{ margin: 0, marginTop: 2, color: 'var(--fgColor-muted, var(--text-muted))' }}
              >
                {subtitle}
              </Text>
            ) : (
              <div
                className="mt-0.5 max-w-full space-y-1.5 text-[13px] leading-snug [&_p]:m-0"
                style={{ color: 'var(--fgColor-muted, var(--text-muted))' }}
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
