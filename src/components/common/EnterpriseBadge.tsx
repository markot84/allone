import { Lock, Sparkles } from 'lucide-react';

/**
 * The Enterprise marker — the app's one true "highlight" badge, and so the place colors.md §2
 * assigns to gold: "Badges, highlights, μικρές επισημάνσεις".
 *
 * It previously ran on a purple→blue gradient (#7C3AED → #2563EB). Neither is a brand colour;
 * #7C3AED is the RFM "Potential" segment hue, borrowed here for an unrelated meaning. Gold is
 * carried on a navy label, the pairing §3 measures at 7.40:1 — gold is never text, always the
 * surface under navy.
 *
 * The call to action stays ORANGE: gold marks, orange acts, and only orange acts.
 */

interface EnterpriseBadgeProps {
  inline?: boolean;
}

export function EnterpriseBadge({ inline }: EnterpriseBadgeProps) {
  if (inline) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ backgroundColor: 'var(--gold-500)', color: 'var(--navy-500)' }}
      >
        <Lock size={9} /> Enterprise
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: 'var(--gold-100)' }}
      >
        <Sparkles size={24} style={{ color: 'var(--gold-700)' }} />
      </div>
      <h3 className="mb-1 text-lg font-semibold" style={{ color: 'var(--text-heading)' }}>
        Enterprise
      </h3>
      <p className="mb-4 max-w-sm text-sm" style={{ color: 'var(--text-secondary)' }}>
        Αυτή η λειτουργία είναι διαθέσιμη στο allone Enterprise.
        Αναβαθμίστε για πρόσβαση σε Procurement, ERP integrations, και προηγμένους αυτοματισμούς.
      </p>
      <button
        className="rounded-xl px-5 py-2 text-sm font-medium text-white transition-opacity duration-[var(--dur-state)] hover:opacity-90"
        style={{ backgroundColor: 'var(--orange-700)' }}
      >
        Μάθετε περισσότερα
      </button>
    </div>
  );
}
