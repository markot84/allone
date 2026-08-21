import { Database } from 'lucide-react';
import { MONO } from '../signal';

type DataSourcePillProps = {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning';
  title?: string;
};

/** Tone pairs, each measured on its own background rather than borrowed from Tailwind's ramps. */
const toneStyle = {
  neutral: { borderColor: 'var(--border)', background: 'var(--surface-0)', color: 'var(--text-secondary)' },
  success: { borderColor: 'var(--success-light)', background: 'var(--success-light)', color: 'var(--success-700)' },
  warning: { borderColor: 'var(--warning-light)', background: 'var(--warning-light)', color: 'var(--orange-700)' },
} as const;

export function DataSourcePill({ label, value, tone = 'neutral', title }: DataSourcePillProps) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none"
      style={{ fontFamily: MONO, letterSpacing: '0.04em', ...toneStyle[tone] }}
      title={title}
    >
      <Database size={12} className="shrink-0" aria-hidden />
      <span className="shrink-0 text-current/70">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}
