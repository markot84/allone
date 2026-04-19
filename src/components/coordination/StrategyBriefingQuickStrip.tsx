import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '../common';
import { BriefingDrawer } from './BriefingDrawer';

interface StrategyBriefingQuickStripProps {
  /** Όνομα ενεργού σεναρίου ή fallback (π.χ. «Εμπορική πολιτική») για κείμενα στο drawer */
  strategyDisplayName: string;
  /** Αν false, δεν υπάρχει ενεργή στρατηγική — εμφανίζεται βοηθητικό κείμενο και άλλος προεπιλεγμένος τίτλος */
  hasActiveStrategy?: boolean;
  /** Κλήση μετά επιτυχή αποστολή (π.χ. toast από parent) */
  onSent?: () => void;
}

/**
 * Γρήγορη ενέργεια από Dashboard: ίδιο briefing flow με τη σελίδα Στρατηγικής (BriefingDrawer).
 */
export function StrategyBriefingQuickStrip({
  strategyDisplayName,
  hasActiveStrategy = true,
  onSent,
}: StrategyBriefingQuickStripProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-gradient-to-r from-[var(--nts-accent)]/[0.06] to-transparent px-4 py-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-[var(--nts-accent)]/15 text-[var(--nts-accent)] shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--nts-charcoal)]">
              {hasActiveStrategy ? 'Ειδοποίηση τμημάτων για τη στρατηγική' : 'Ειδοποίηση τμημάτων'}
            </p>
            <p className="text-xs text-[var(--nts-medium-gray)] mt-0.5">
              {hasActiveStrategy
                ? 'Χρησιμοποιεί την ίδια ροή με την Εμπορική Στρατηγική, με briefing, templates και επιλογή παραληπτών.'
                : 'Δεν υπάρχει ενεργό σενάριο στο Dashboard. Μπορείτε να στείλετε γενικό briefing και να προσαρμόσετε τον τίτλο στο επόμενο βήμα.'}
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          icon={<Send size={15} />}
          className="shrink-0 w-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          Αποστολή briefing
        </Button>
      </div>

      {open && (
        <BriefingDrawer
          strategyName={strategyDisplayName}
          initialTitle={hasActiveStrategy ? undefined : 'Briefing προς τμήματα'}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onSent?.();
          }}
        />
      )}
    </>
  );
}
