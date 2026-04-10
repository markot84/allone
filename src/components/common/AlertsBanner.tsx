import { useState } from 'react';
import { AlertTriangle, Info, Zap, ExternalLink, Loader2 } from 'lucide-react';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { useAuth } from '../../hooks/useAuth';
import { AutomationAlertsService } from '../../services/automationSettings';
import { getAlertNavigation } from '../../utils/alertNavigation';
import { useToast } from './Toast';
import type { AlertEvaluation, AutomationAlert } from '../../types';

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; border: string }> = {
  critical: { icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A' },
  info: { icon: Info, color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' },
};

export interface AlertsBannerNavigateOptions {
  hashQuery?: string;
}

interface AlertsBannerProps {
  filterGroup?: string;
  maxAlerts?: number;
  compact?: boolean;
  onNavigate?: (section: string, opts?: AlertsBannerNavigateOptions) => void;
}

function mergeAlertText(alert: AutomationAlert): string {
  const d = alert.description.trim();
  if (!alert.suggestions?.length) return d;
  return [d, ...alert.suggestions].join(' · ');
}

export function AlertsBanner({ filterGroup, maxAlerts = 3, compact = false, onNavigate }: AlertsBannerProps) {
  const { newAlerts, invalidate } = useAutomationAlerts();
  const { user } = useAuth();
  const toast = useToast();
  /** Άμεση επισήμανση επιλογής πριν ολοκληρωθεί το write */
  const [chosen, setChosen] = useState<Partial<Record<string, AlertEvaluation>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const filtered = filterGroup ? newAlerts.filter(a => a.triggerGroup === filterGroup) : newAlerts;

  if (filtered.length === 0) return null;

  const openAlertTarget = (alert: AutomationAlert) => {
    const { section, hashQuery } = getAlertNavigation(alert);
    onNavigate?.(section, hashQuery ? { hashQuery } : undefined);
  };

  const handleEvaluate = async (alert: AutomationAlert, evaluation: AlertEvaluation) => {
    setChosen((prev) => ({ ...prev, [alert.id]: evaluation }));
    setSavingId(alert.id);
    try {
      await AutomationAlertsService.archiveWithEvaluation(alert.id, evaluation, user?.uid);
      toast.success('Η αξιολόγηση αποθηκεύτηκε');
      // Μικρή παύση ώστε να φαίνεται η φωτεινή επιλογή πριν εξαφανιστεί η κάρτα
      await new Promise((r) => setTimeout(r, 450));
      invalidate();
    } catch {
      toast.error('Αποτυχία αποθήκευσης αξιολόγησης');
      setChosen((prev) => {
        const next = { ...prev };
        delete next[alert.id];
        return next;
      });
    } finally {
      setSavingId(null);
    }
  };

  const displayed = filtered.slice(0, maxAlerts);
  const remaining = filtered.length - displayed.length;
  const useGrid = !compact && displayed.length > 1;

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {!compact && (
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[var(--nts-accent)] shrink-0" />
          <span className="text-sm font-semibold text-[#111827]">Ειδοποιήσεις</span>
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full bg-red-500 text-white px-1">
            {filtered.length}
          </span>
        </div>
      )}

      <div className={useGrid ? 'grid grid-cols-1 lg:grid-cols-2 gap-2' : 'space-y-2'}>
        {displayed.map(alert => {
          const style = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info;
          const Icon = style.icon;
          const saving = savingId === alert.id;
          const picked = chosen[alert.id];
          const merged = mergeAlertText(alert);

          return (
            <div
              key={alert.id}
              className={`rounded-lg border overflow-hidden transition-shadow hover:shadow-sm ${
                compact ? 'shadow-none' : ''
              }`}
              style={{ backgroundColor: style.bg, borderColor: style.border }}
            >
              <div className={`flex gap-2 ${compact ? 'p-2' : 'p-2.5'}`}>
                <Icon
                  size={compact ? 14 : 15}
                  style={{ color: style.color }}
                  className="shrink-0 mt-0.5"
                  aria-hidden
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => openAlertTarget(alert)}
                    className="flex w-full gap-1.5 text-left rounded-md -m-0.5 p-0.5 hover:bg-black/[0.03] disabled:opacity-60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-medium text-[#111827] leading-snug ${
                          compact ? 'text-xs line-clamp-2' : 'text-sm line-clamp-2'
                        }`}
                      >
                        {alert.title}
                      </p>
                      <p
                        className={`text-[#6B7280] mt-0.5 leading-snug line-clamp-2 ${
                          compact ? 'text-[10px]' : 'text-[11px]'
                        }`}
                      >
                        {merged}
                      </p>
                    </div>
                    <ExternalLink
                      size={14}
                      className="shrink-0 text-[var(--nts-accent)] opacity-80 mt-0.5"
                      aria-hidden
                    />
                  </button>

                  <div className={`flex flex-wrap items-center gap-x-1 gap-y-1 ${compact ? 'pt-0' : ''}`}>
                    <span className={`uppercase tracking-wide text-[#9CA3AF] mr-0.5 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>Αξιολόγηση</span>
                    {(['urgent', 'interested', 'not_interested'] as const).map(ev => {
                      const label =
                        ev === 'urgent'
                          ? 'Επείγον'
                          : ev === 'interested'
                            ? 'Με ενδιαφέρει'
                            : 'Όχι';
                      const title =
                        ev === 'not_interested'
                          ? 'Δεν με ενδιαφέρει — αρχειοθέτηση'
                          : ev === 'interested'
                            ? 'Με ενδιαφέρει'
                            : 'Επείγον';
                      const isActive = picked === ev;
                      return (
                        <button
                          key={ev}
                          type="button"
                          title={title}
                          disabled={saving}
                          onClick={e => {
                            e.stopPropagation();
                            void handleEvaluate(alert, ev);
                          }}
                          className={`leading-none px-2 rounded-md border transition-colors flex items-center gap-1 ${
                            compact ? 'text-[9px] py-0.5 min-h-[22px]' : 'text-[10px] py-1 min-h-[26px]'
                          } ${
                            isActive
                              ? 'ring-2 ring-[var(--nts-accent)] border-[var(--nts-accent)] bg-[var(--nts-accent)]/12 text-[var(--nts-accent)] font-semibold shadow-sm'
                              : 'border-[#E5E7EB] bg-white/95 text-[#4B5563] hover:border-[var(--nts-accent)]/60 hover:text-[var(--nts-accent)]'
                          } disabled:opacity-60`}
                        >
                          {saving && isActive ? (
                            <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
                          ) : null}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => onNavigate?.('automation')}
          className="text-xs text-[var(--nts-accent)] hover:underline font-medium pl-0.5"
        >
          +{remaining} ακόμα ειδοποιήσεις →
        </button>
      )}
    </div>
  );
}
