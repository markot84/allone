import { Lightbulb, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { useCommercialInfo } from '../../hooks/useCommercialInfo';

/**
 * Banner που συνδέει τις «Εμπορικές Πληροφορίες» με σελίδες απόφασης (Strategy, Channels).
 * Επιφανειακά εμφανίζει τα ενεργά σήματα ώστε ο χρήστης να τα λάβει υπόψη στις πολιτικές.
 */
export function CommercialInfoBanner({
  onOpen,
  context = 'policy',
}: {
  onOpen?: () => void;
  context?: 'policy' | 'channel';
}) {
  const { items } = useCommercialInfo();
  const active = items.filter((i) => i.status === 'active');
  if (active.length === 0) return null;

  const top = active.slice(0, 3);
  const ctaLabel =
    context === 'channel'
      ? 'Πώς επηρεάζουν την ενεργοποίηση καναλιών;'
      : 'Πώς επηρεάζουν τις εμπορικές πολιτικές;';

  return (
    <div className="rounded-xl border border-[var(--nts-accent)]/30 bg-[var(--nts-accent)]/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-[var(--nts-accent)]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--nts-charcoal)]">
              {active.length} ενεργές εμπορικές πληροφορίες
            </p>
            <ul className="mt-1 space-y-0.5">
              {top.map((i) => (
                <li key={i.id} className="flex items-center gap-1.5 text-xs text-[var(--nts-medium-gray)]">
                  {i.direction === 'up' ? (
                    <TrendingUp size={12} className="shrink-0 text-emerald-600" />
                  ) : i.direction === 'down' ? (
                    <TrendingDown size={12} className="shrink-0 text-red-500" />
                  ) : null}
                  <span className="truncate">{i.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {onOpen && (
          <button
            onClick={onOpen}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--nts-accent)] hover:underline"
          >
            {ctaLabel}
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
