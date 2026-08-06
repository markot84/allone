import { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronUp, TrendingUp, TrendingDown, FlaskConical, AlertTriangle } from 'lucide-react';
import { Card, Badge } from '../common';
import { useBudgetSuggestions } from '../../hooks/useBudgetSuggestions';
import type { Campaign } from '../../types';
import type { BudgetOpportunitySuggestion, BudgetSuggestionKind } from '../../types/budgetSuggestions';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';

const KIND_META: Record<
  BudgetSuggestionKind,
  { label: string; color: string; icon: typeof TrendingUp }
> = {
  scale_up: { label: 'Κλιμάκωση', color: '#059669', icon: TrendingUp },
  scale_test: { label: 'Δοκιμαστική +', color: '#0D9488', icon: FlaskConical },
  hold: { label: 'Σταθερό', color: 'var(--text-muted)', icon: TrendingUp },
  reduce: { label: 'Μείωση', color: '#DC2626', icon: TrendingDown },
  review: { label: 'Έλεγχος', color: '#D97706', icon: AlertTriangle },
};

function SuggestionCard({ s, defaultOpen }: { s: BudgetOpportunitySuggestion; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = KIND_META[s.kind];
  const Icon = meta.icon;
  const delta = s.suggestedBudgetDeltaPercent;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[var(--surface-1)] transition-colors"
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}18` }}
        >
          <Icon size={18} style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <Badge variant="default" className="text-[10px]">
              {s.scope === 'channel' ? 'Κανάλι' : 'Καμπάνια'}
            </Badge>
            <span className="text-[10px] font-medium px-1.5 py-0 rounded" style={{ color: meta.color, background: `${meta.color}12` }}>
              {meta.label}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {s.confidence === 'high' ? 'Υψηλή βεβαιότητα' : s.confidence === 'medium' ? 'Μέτρια' : 'Χαμηλή'}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{s.title}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.channel}{s.campaignName ? ` · ${s.campaignName}` : ''}</p>
        </div>
        {open ? <ChevronUp size={18} className="text-[var(--text-muted)] shrink-0 mt-1" /> : <ChevronDown size={18} className="text-[var(--text-muted)] shrink-0 mt-1" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-[var(--surface-2)] space-y-3">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{s.rationale}</p>
          {delta && (
            <p className="text-xs text-[var(--text-muted)]">
              Ενδεικτική μεταβολή budget: <strong className="text-[var(--text-primary)]">{delta.min}% έως {delta.max}%</strong> (όχι αυτόματη εφαρμογή).
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-[var(--surface-1)] p-2 border border-[var(--surface-2)]">
              <p className="text-[var(--text-muted)] uppercase tracking-wide mb-1">Πρόσφατα</p>
              <p className="text-[var(--text-primary)] font-mono">
                ROAS {formatNumber(s.metrics.recent.roas, 2)}x · spend {formatCurrencyCompact(s.metrics.recent.spend)}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--surface-1)] p-2 border border-[var(--surface-2)]">
              <p className="text-[var(--text-muted)] uppercase tracking-wide mb-1">Προηγούμενη περίοδος</p>
              <p className="text-[var(--text-primary)] font-mono">
                ROAS {formatNumber(s.metrics.baseline.roas, 2)}x · spend {formatCurrencyCompact(s.metrics.baseline.spend)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BudgetOpportunitySection({ campaigns }: { campaigns: Campaign[] }) {
  const { suggestions, meta } = useBudgetSuggestions(campaigns);

  if (meta.campaignsWithDailyMetrics === 0) {
    return (
      <Card padding="lg">
        <div className="flex items-start gap-3">
          <Lightbulb size={22} className="text-[var(--border-strong)] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Προτάσεις budget</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-2xl">
              Για συγκρίσεις 7 vs 7 ημερών χρειάζονται καμπάνιες με <strong>ημερήσια metrics</strong> (σύνδεση Google Ads / Meta και
              εισαγωγή). Χωρίς αυτά, δεν εμφανίζονται αυτόματες προτάσεις κλιμάκωσης ή μείωσης.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card padding="lg">
        <div className="flex items-start gap-3">
          <Lightbulb size={22} className="text-[var(--nts-accent-text)] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Προτάσεις budget</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Ανάλυση {meta.recentDays}+{meta.baselineDays} ημερών — καμία ισχυρή τάση (ROAS/spend) που να ξεπερνά τα όρια κανόνων v1.
              Αλλάξτε thresholds στο engine ή περιμένετε περισσότερες ημέρες δεδομένων.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--nts-accent)]/10 flex items-center justify-center shrink-0">
            <Lightbulb size={20} className="text-[var(--nts-accent-text)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Προτάσεις budget (v1)</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Σύγκριση τελευταίων {meta.recentDays} ημερών με τις {meta.baselineDays} προηγούμενες · {meta.campaignsWithDailyMetrics}{' '}
              καμπάνιες με ημερήσια δεδομένα
              {meta.campaignsSkippedNoDaily > 0 && ` · ${meta.campaignsSkippedNoDaily} χωρίς ημερήσια (παραλείφθηκαν)`}.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {suggestions.map((s, i) => (
          <SuggestionCard key={s.id} s={s} defaultOpen={i === 0} />
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] mt-4 leading-relaxed">
        Οι προτάσεις βασίζονται σε κανόνες επί ιστορικών imports — δεν συνδέονται με αυτόματη αλλαγή budget στις πλατφόρμες. Για narrative με
        AI (προαιρετικά): σύνδεση με Gemini επάνω σε δομημένα σήματα.
      </p>
    </Card>
  );
}
