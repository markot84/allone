import { motion } from 'framer-motion';

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3'
};

export function ProgressBar({
  value,
  max = 100,
  color = 'var(--nts-accent)',
  showLabel = false,
  size = 'md',
  className = ''
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div className={`bg-[#E5E5E5] rounded-full overflow-hidden ${sizes[size]}`}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
