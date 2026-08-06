import { useState } from 'react';
import { AlertTriangle, Info, Zap, ExternalLink, Loader2 } from 'lucide-react';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { useAuth } from '../../hooks/useAuth';
import { AutomationAlertsService } from '../../services/automationSettings';
import { getAlertNavigation } from '../../utils/alertNavigation';
import { useToast } from './Toast';
import type { AlertEvaluation, AutomationAlert } from '../../types';

type SeverityKey = 'critical' | 'warning' | 'info';

const SEVERITY_CONFIG: Record<
  SeverityKey,
  {
    icon: typeof AlertTriangle;
    iconWrap: string;
    card: string;
    bar: string;
  }
> = {
  critical: {
    icon: AlertTriangle,
    iconWrap: 'bg-red-100 text-red-700 ring-red-200/60',
    card: 'border-red-200/90 bg-gradient-to-br from-red-50/95 via-white to-white shadow-sm shadow-red-900/5',
    bar: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: 'bg-amber-100 text-amber-800 ring-amber-200/70',
    card: 'border-amber-200/90 bg-gradient-to-br from-amber-50/90 via-white to-white shadow-sm shadow-amber-900/5',
    bar: 'bg-amber-500',
  },
  info: {
    icon: Info,
    iconWrap: 'bg-sky-100 text-sky-700 ring-sky-200/70',
    card: 'border-sky-200/90 bg-gradient-to-br from-sky-50/90 via-white to-white shadow-sm shadow-sky-900/5',
    bar: 'bg-sky-500',
  },
};

function getSeverityConfig(severity: string) {
  if (severity === 'critical' || severity === 'warning' || severity === 'info') {
    return SEVERITY_CONFIG[severity];
  }
  return SEVERITY_CONFIG.info;
}

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
  const [chosen, setChosen] = useState<Partial<Record<string, AlertEvaluation>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const filtered = filterGroup ? newAlerts.filter((a) => a.triggerGroup === filterGroup) : newAlerts;

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
      toast.success('Η αξιολόγηση καταχωρίστηκε');
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

  const displayed = filtered.slice(0, maxAlerts);
  const remaining = filtered.length - displayed.length;
  const useGrid = !compact && displayed.length > 1;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={useGrid ? 'grid grid-cols-1 lg:grid-cols-2 gap-3' : 'space-y-3'}>
        {displayed.map((alert) => {
          const cfg = getSeverityConfig(alert.severity);
          const Icon = cfg.icon;
          const saving = savingId === alert.id;
          const picked = chosen[alert.id];
          const merged = mergeAlertText(alert);

          return (
            <article
              key={alert.id}
              className={`group relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                compact ? 'rounded-xl' : ''
              } ${cfg.card} ${
                compact ? '' : 'hover:shadow-md hover:border-opacity-100'
              }`}
            >
              <div
                className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.bar} rounded-l-2xl`}
                aria-hidden
              />
              <div className={`${compact ? 'p-2.5 pl-3' : 'p-4 pl-4'}`}>
                <div className="flex gap-3">
                  <div
                    className={`flex shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/[0.04] ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${cfg.iconWrap}`}
                  >
                    <Icon size={compact ? 15 : 18} className="shrink-0" aria-hidden />
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => openAlertTarget(alert)}
                      className="flex w-full gap-2 text-left rounded-xl -m-1 p-1 hover:bg-black/[0.025] disabled:opacity-60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nts-accent)]/40 focus-visible:ring-offset-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`font-semibold text-[var(--text-primary)] leading-snug ${
                            compact ? 'text-xs line-clamp-2' : 'text-sm line-clamp-2'
                          }`}
                        >
                          {alert.title}
                        </p>
                        <p
                          className={`text-[#57534E] mt-1 leading-relaxed ${
                            compact ? 'text-[10px] line-clamp-2' : 'text-[12px] line-clamp-4'
                          }`}
                        >
                          {merged}
                        </p>
                      </div>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70 text-[var(--nts-accent-text)] opacity-90 ring-1 ring-black/[0.06] group-hover:bg-[var(--nts-accent)]/10 transition-colors">
                        <ExternalLink size={15} aria-hidden />
                      </span>
                    </button>

                    <div
                      className={`rounded-xl bg-white/70 ring-1 ring-black/[0.04] ${
                        compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
                      }`}
                    >
                      <p
                        className={`font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1.5 ${
                          compact ? 'text-[8px]' : 'text-[9px]'
                        }`}
                      >
                        Αξιολόγηση
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(['urgent', 'interested', 'not_interested'] as const).map((ev) => {
                          const label =
                            ev === 'urgent' ? 'Επείγον' : ev === 'interested' ? 'Με ενδιαφέρει' : 'Δεν με ενδιαφέρει';
                          const title =
                            ev === 'not_interested'
                              ? 'Δεν με ενδιαφέρει, αρχειοθέτηση'
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
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleEvaluate(alert, ev);
                              }}
                              className={`leading-none rounded-lg border font-medium transition-all flex items-center gap-1 ${
                                compact ? 'text-[9px] px-2 py-1 min-h-[26px]' : 'text-[11px] px-2.5 py-1.5 min-h-[30px]'
                              } ${
                                isActive
                                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/15 text-[var(--nts-accent-text)] shadow-inner ring-1 ring-[var(--nts-accent)]/30'
                                  : 'border-[var(--border)] bg-white text-[var(--text-secondary)] hover:border-[var(--nts-accent)]/45 hover:bg-orange-50/50 hover:text-[#C2410C]'
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
              </div>
            </article>
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => onNavigate?.('automation')}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--nts-accent-text)] hover:text-[var(--nts-accent-hover)] hover:underline underline-offset-2 pl-0.5"
        >
          <Zap size={12} className="opacity-80" />
          +{remaining} ακόμα ειδοποιήσεις →
        </button>
      )}
    </div>
  );
}
