import { MONO } from '../signal';

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HEIGHT: Record<NonNullable<ProgressBarProps['size']>, number> = { sm: 4, md: 8, lg: 12 };

/**
 * A share of a total, as one bar.
 *
 * The fill grows through a CSS transition on the board's reorder duration rather than through a
 * framer-motion `animate`, so a progress bar inside a list of forty rows costs forty transitions
 * instead of forty animation loops — and it obeys `prefers-reduced-motion`, which `tokens.css`
 * already handles globally.
 */
export function ProgressBar({
  value,
  max = 100,
  color = 'var(--orange-500)',
  showLabel = false,
  size = 'md',
  className = '',
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const height = HEIGHT[size];

  return (
    <div className={className}>
      {showLabel && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: MONO,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 4,
          }}
        >
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div
        style={{ height, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-2)' }}
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            borderRadius: 999,
            background: color,
            transition: 'width var(--dur-reorder) var(--ease-out)',
          }}
        />
      </div>
    </div>
  );
}
