import { MoonIcon, SunIcon } from '@primer/octicons-react';
import { useTheme } from '../../hooks/useTheme';

/**
 * Light ↔ cockpit.
 *
 * The icon shows the mode you would switch TO, not the one you are in — a moon while light means
 * "go dark". The label says the same thing in words so the affordance does not rest on that
 * convention alone.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const goingDark = theme === 'light';
  const label = goingDark ? 'Σκούρο θέμα' : 'Ανοιχτό θέμα';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${className}`.trim()}
      style={{
        border: '1px solid var(--chrome-control-border)',
        background: 'var(--chrome-control-bg)',
        color: 'var(--chrome-fg-muted)',
        cursor: 'pointer',
        transition: 'background-color var(--dur-state) var(--ease-out), color var(--dur-state) var(--ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--chrome-control-hover)';
        e.currentTarget.style.color = 'var(--chrome-fg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--chrome-control-bg)';
        e.currentTarget.style.color = 'var(--chrome-fg-muted)';
      }}
    >
      {goingDark ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    </button>
  );
}
