import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '../common';
import { BriefingDrawer } from './BriefingDrawer';

interface StrategyBriefingQuickStripProps {
  /** Active scenario name or fallback, used for drawer text. */
  strategyDisplayName: string;
  /** If false, no active strategy — shows helper text and a different default title. */
  hasActiveStrategy?: boolean;
  /** Called after a successful send (e.g. toast from parent). */
  onSent?: () => void;
}

/** Quick action from the Dashboard: same briefing flow as the Strategy page (BriefingDrawer). */
export function StrategyBriefingQuickStrip({
  strategyDisplayName,
  hasActiveStrategy = true,
  onSent,
}: StrategyBriefingQuickStripProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The orange wash is a 6% tint over TRANSPARENT, so the strip borrowed whatever was behind
          it. On a light canvas that read as a faint warm panel; on direction E's navy field it
          vanished and left dark text on navy. Adding an explicit surface underneath keeps the wash
          exactly as it was and makes the strip a light island like every other block. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] bg-gradient-to-r from-[var(--nts-accent)]/[0.06] to-transparent px-4 py-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-[var(--nts-accent)]/15 text-[var(--nts-accent-text)] shrink-0">
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
