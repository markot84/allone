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
      <div
        className={`card-primer ${className.includes('h-full') ? 'h-full' : ''}`}
        style={{
          background: 'var(--nts-bg-pure)',
          border: '1px solid var(--borderColor-default, #d0d7de)',
          borderRadius: 8,
          padding: paddingPx[padding],
          cursor: (hover || onClick) ? 'pointer' : 'default',
          transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
          boxShadow: '0 2px 6px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.08)'
        }}
        onClick={onClick}
        onMouseEnter={(e) => {
          if (!hover && !onClick) return;
          (e.currentTarget as HTMLDivElement).style.background = 'var(--nts-bg-subtle)';
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--borderColor-muted, #d8dee4)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.14), 0 3px 8px rgba(0,0,0,0.10)';
        }}
        onMouseLeave={(e) => {
          if (!hover && !onClick) return;
          (e.currentTarget as HTMLDivElement).style.background = 'var(--nts-bg-pure)';
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--borderColor-default, #d0d7de)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 6px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.08)';
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
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
          <Heading as="h3" variant="small" style={{ margin: 0 }}>
            {title}
          </Heading>
          {subtitle && (
            <Text
              as="p"
              size="small"
              className="line-clamp-2 lg:line-clamp-none lg:truncate"
              style={{ margin: 0, marginTop: 2, color: 'var(--fgColor-muted, #57606a)' }}
            >
              {subtitle}
            </Text>
          )}
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
