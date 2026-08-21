import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { useAuth } from '../../hooks/useAuth';
import { AutomationAlertsService } from '../../services/automationSettings';
import { getAlertNavigation } from '../../utils/alertNavigation';
import { useToast } from '../common/Toast';
import { MONO, PillButton, SignalCard } from './SignalBoard';
import type { AlertEvaluation, AlertSeverity, AutomationAlert } from '../../types';

/**
 * The row of decision cards at the top of the board.
 *
 * Same data and same flow as `AlertsBanner` — read a signal, triage it, it archives — drawn to the
 * Signal Board's rules instead of the banner's. The triage verbs are the three values
 * `AlertEvaluation` already has; nothing new was invented for the layout.
 */

const SEVERITY: Record<AlertSeverity, { label: string; tone: string; background: string }> = {
  critical: { label: 'Κρίσιμο', tone: 'var(--danger-600)', background: 'var(--danger-light)' },
  warning: { label: 'Προσοχή', tone: 'var(--gold-700)', background: 'var(--gold-100)' },
  info: { label: 'Ευκαιρία', tone: 'var(--sky-500)', background: 'var(--sky-badge-bg)' },
};

const EVALUATIONS: { id: AlertEvaluation; label: string; title: string }[] = [
  { id: 'urgent', label: 'Επείγον', title: 'Επείγον' },
  { id: 'interested', label: 'Με ενδιαφέρει', title: 'Με ενδιαφέρει' },
  { id: 'not_interested', label: 'Άκυρο', title: 'Δεν με ενδιαφέρει, αρχειοθέτηση' },
];

function severityOf(alert: AutomationAlert) {
  return SEVERITY[alert.severity] ?? SEVERITY.info;
}

/** Description plus the trigger's suggestions, as one paragraph — the card has room for one. */
function alertBody(alert: AutomationAlert): string {
  const description = alert.description.trim();
  if (!alert.suggestions?.length) return description;
  return [description, ...alert.suggestions].join(' · ');
}

export function SignalAlerts({
  maxAlerts = 3,
  onNavigate,
}: {
  maxAlerts?: number;
  onNavigate?: (section: string, opts?: { hashQuery?: string }) => void;
}) {
  const { newAlerts, invalidate } = useAutomationAlerts();
  const { user } = useAuth();
  const toast = useToast();
  const [chosen, setChosen] = useState<Partial<Record<string, AlertEvaluation>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  if (newAlerts.length === 0) return null;

  const handleEvaluate = async (alert: AutomationAlert, evaluation: AlertEvaluation) => {
    setChosen((prev) => ({ ...prev, [alert.id]: evaluation }));
    setSavingId(alert.id);
    try {
      await AutomationAlertsService.archiveWithEvaluation(alert.id, evaluation, user?.uid);
      toast.success('Η αξιολόγηση καταχωρίστηκε');
      // A beat before the card leaves, so the choice is visibly registered rather than vanishing.
      await new Promise((r) => setTimeout(r, 450));
      invalidate();
    } catch {
      toast.error('Δεν ήταν δυνατή η αποθήκευση της αξιολόγησης');
      setChosen((prev) => {
        const next = { ...prev };
        delete next[alert.id];
        return next;
      });
    } finally {
      setSavingId(null);
    }
  };

  const displayed = newAlerts.slice(0, maxAlerts);
  const remaining = newAlerts.length - displayed.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        {displayed.map((alert) => {
          const severity = severityOf(alert);
          const saving = savingId === alert.id;
          const picked = chosen[alert.id];
          const { section, hashQuery } = getAlertNavigation(alert);

          return (
            <SignalCard key={alert.id} accent={severity.tone} padding={0} style={{ gap: 0 }}>
              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      padding: '4px 8px',
                      borderRadius: 6,
                      color: severity.tone,
                      background: severity.background,
                    }}
                  >
                    {severity.label}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10.5,
                      color: 'var(--text-muted)',
                      marginLeft: 'auto',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {alert.triggerLabel}
                  </span>
                </div>

                {/* The title opens the module the signal came from; the triage row below archives it. */}
                <button
                  type="button"
                  onClick={() => onNavigate?.(section, hashQuery ? { hashQuery } : undefined)}
                  className="signal-alert-title"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    lineHeight: 1.35,
                  }}
                >
                  {alert.title}
                </button>

                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.55,
                    display: '-webkit-box',
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {alertBody(alert)}
                </span>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 'auto',
                    paddingTop: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  {EVALUATIONS.map((evaluation) => {
                    const active = picked === evaluation.id;
                    return (
                      <PillButton
                        key={evaluation.id}
                        active={active}
                        tone={severity.tone}
                        disabled={saving}
                        onClick={() => void handleEvaluate(alert, evaluation.id)}
                      >
                        {saving && active && (
                          <Loader2 size={11} className="animate-spin" style={{ marginRight: 5, verticalAlign: -1 }} />
                        )}
                        {evaluation.label}
                      </PillButton>
                    );
                  })}
                </div>
              </div>
            </SignalCard>
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => onNavigate?.('automation')}
          className="signal-link"
          style={{
            alignSelf: 'flex-start',
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--sky-500)',
          }}
        >
          +{remaining} ακόμα ειδοποιήσεις →
        </button>
      )}
    </div>
  );
}
