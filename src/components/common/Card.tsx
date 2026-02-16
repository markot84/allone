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
        className="card-primer"
        style={{
          background: 'var(--canvas-default, #ffffff)',
          border: '1px solid var(--borderColor-default, #d0d7de)',
          borderRadius: 8,
          padding: paddingPx[padding],
          cursor: (hover || onClick) ? 'pointer' : 'default',
          transition: 'background-color 120ms ease, border-color 120ms ease'
        }}
        onClick={onClick}
        onMouseEnter={(e) => {
          if (!hover && !onClick) return;
          (e.currentTarget as HTMLDivElement).style.background = 'var(--canvas-subtle, #f6f8fa)';
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--borderColor-muted, #d8dee4)';
        }}
        onMouseLeave={(e) => {
          if (!hover && !onClick) return;
          (e.currentTarget as HTMLDivElement).style.background = 'var(--canvas-default, #ffffff)';
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--borderColor-default, #d0d7de)';
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
}

export function CardHeader({ title, subtitle, icon, action }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span style={{ color: 'var(--fgColor-muted, #57606a)' }}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <Heading as="h3" variant="small" className="truncate" style={{ margin: 0 }}>
            {title}
          </Heading>
          {subtitle && (
            <Text
              as="p"
              size="small"
              className="truncate"
              style={{ margin: 0, marginTop: 2, color: 'var(--fgColor-muted, #57606a)' }}
            >
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
