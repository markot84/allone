/**
 * TriageCard — Decision Buckets snapshot πάνω από τον scenario selector.
 *
 * Δείχνει τα 8 merchant-centric buckets με counts + tied capital, και
 * προτείνει συγκεκριμένη commercial policy για κάθε bucket. Click → επιλέγει
 * αυτόματα το recommended scenario.
 *
 * Pure UI — όλη η classification logic ζει στο `useDecisionBuckets`.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, Zap, Snowflake, XCircle, Package, Sparkles, ChevronRight } from 'lucide-react';
import { useDecisionBuckets } from '../../hooks/useDecisionBuckets';
import type { BucketId, RecommendedPolicy } from '../../utils/decisionBuckets';

const ICONS: Record<BucketId, React.ComponentType<{ size?: number; className?: string }>> = {
  dead_capital: XCircle,
  stockout_risk: AlertTriangle,
  hot_seller: TrendingUp,
  margin_bleeder: Zap,
  slow_mover: Snowflake,
  discontinue: Package,
  replenish_now: Package,
  new_or_unknown: Sparkles,
};

const COLOR_CLASSES: Record<string, { bg: string; text: string; border: string; ring: string }> = {
  rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', ring: 'ring-rose-300' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'ring-amber-300' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', ring: 'ring-emerald-300' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', ring: 'ring-sky-300' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', ring: 'ring-violet-300' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', ring: 'ring-slate-300' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', ring: 'ring-orange-300' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', ring: 'ring-indigo-300' },
};

function fmtEur(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k€`;
  return `${Math.round(n)}€`;
}

interface TriageCardProps {
  /** Καλείται όταν ο χρήστης επιλέγει "Open in policy" — ο parent αλλάζει scenario. */
  onSelectPolicy?: (policy: NonNullable<RecommendedPolicy>, fromBucket: BucketId) => void;
}

export function TriageCard({ onSelectPolicy }: TriageCardProps) {
  const { counts, tiedByBucket, totalProducts, isLoading, defs, bucketOrder, totalTiedCapital, topByBucket } = useDecisionBuckets();
  const [expanded, setExpanded] = useState<BucketId | null>(null);

  const visible = useMemo(
    () => bucketOrder.filter((b) => counts[b] > 0),
    [bucketOrder, counts]
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-100 rounded mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (totalProducts === 0) return null;

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-4">
        <div className="text-sm text-gray-500">
          Triage: δεν εντοπίστηκαν SKUs με κρίσιμα σήματα — χρειάζονται περισσότερα δεδομένα (orders, procurement ή stock movement).
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Triage — τι χρειάζεται απόφαση τώρα</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {totalProducts.toLocaleString('el-GR')} SKUs αναλύθηκαν · συνολικά δεσμευμένα {fmtEur(totalTiedCapital)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {visible.map((b) => {
          const def = defs[b];
          const Icon = ICONS[b];
          const colors = COLOR_CLASSES[def.color] ?? COLOR_CLASSES.slate;
          const count = counts[b];
          const tied = tiedByBucket[b];
          const isOpen = expanded === b;
          return (
            <button
              key={b}
              onClick={() => setExpanded(isOpen ? null : b)}
              className={`text-left rounded-lg border p-2.5 transition-all ${colors.bg} ${colors.border} hover:shadow-sm ${
                isOpen ? `ring-2 ${colors.ring}` : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={14} className={colors.text} />
                  <span className={`text-[11px] font-semibold ${colors.text} truncate`}>{def.shortLabel}</span>
                </div>
                <span className={`text-base font-bold ${colors.text} leading-none`}>{count}</span>
              </div>
              <div className="text-[10px] text-gray-600 mt-1 line-clamp-2">{def.label}</div>
              {tied > 0 && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {fmtEur(tied)} κεφάλαια
                </div>
              )}
            </button>
          );
        })}
      </div>

      {expanded && (
        <div className="rounded-lg border border-[var(--nts-border-gray)] bg-gray-50 p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900">{defs[expanded].label}</div>
              <div className="text-[11px] text-gray-600 mt-0.5">{defs[expanded].description}</div>
            </div>
            {defs[expanded].recommendedPolicy && onSelectPolicy && (
              <button
                onClick={() => onSelectPolicy(defs[expanded].recommendedPolicy as NonNullable<RecommendedPolicy>, expanded)}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--nts-accent)] text-white text-[11px] font-semibold hover:opacity-90"
              >
                {defs[expanded].cta}
                <ChevronRight size={12} />
              </button>
            )}
          </div>

          {topByBucket[expanded].length > 0 && (
            <div className="text-[11px] text-gray-700">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Top {Math.min(5, topByBucket[expanded].length)} SKUs (severity)
              </div>
              <ul className="space-y-1">
                {topByBucket[expanded].slice(0, 5).map((a) => (
                  <li key={a.productId} className="flex items-baseline justify-between gap-2 truncate">
                    <span className="truncate">
                      <span className="font-medium">{a.sku}</span>
                      <span className="text-gray-500 ml-1.5">— {a.productName}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">{fmtEur(a.tiedCapital)}</span>
                  </li>
                ))}
              </ul>
              {topByBucket[expanded][0]?.reasons[expanded] && (
                <div className="mt-1.5 text-[10px] text-gray-500 italic">
                  «{topByBucket[expanded][0].reasons[expanded]}»
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
