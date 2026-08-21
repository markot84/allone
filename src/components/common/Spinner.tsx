import type { ReactNode } from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: ReactNode;
}

const sizeClasses = {
  sm: 'w-5 h-5 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-10 h-10 border-[3px]',
};

export function Spinner({ size = 'md', className = '', label }: SpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
      <div
        className={`rounded-full border-[var(--border)] border-t-[var(--orange-500)] animate-spin ${sizeClasses[size]}`}
        role="status"
        aria-label={label ? undefined : 'Loading'}
      />
      {label && (
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
      )}
    </div>
  );
}
