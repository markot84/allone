import { Database } from 'lucide-react';

type DataSourcePillProps = {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning';
  title?: string;
};

const toneClasses = {
  neutral: 'border-[var(--border)] bg-white text-[var(--text-secondary)]',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-100 bg-amber-50 text-amber-800',
};

export function DataSourcePill({ label, value, tone = 'neutral', title }: DataSourcePillProps) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm ${toneClasses[tone]}`}
      title={title}
    >
      <Database size={12} className="shrink-0" aria-hidden />
      <span className="shrink-0 text-current/70">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}
