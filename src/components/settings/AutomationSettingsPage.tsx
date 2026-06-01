import { useState, useEffect, useCallback } from 'react';
import { Zap, Lock, Bell, BellOff, Save, AlertTriangle, CheckCircle2, Info, X, Palette, Check } from 'lucide-react';
import { Card, Button, Spinner, useToast, EnterpriseBadge, PageHeader } from '../common';
import { ACCENT_PRESETS, readStoredAccent, setStoredAccent, type AccentId } from '../../theme/accentTheme';
import { useAutomationSettings, useAutomationAlerts } from '../../hooks/useAutomation';
import { usePlan } from '../../hooks/usePlan';
import { useBrand } from '../../hooks/useBrand';
import { AutomationSettingsService, AutomationAlertsService } from '../../services/automationSettings';
import { TRIGGERS_CATALOG, TRIGGER_GROUPS, getDefaultTriggerConfigs } from '../../data/triggersCatalog';
import type { TriggerConfig, AutomationAlert } from '../../types';

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2' },
  warning: { icon: AlertTriangle, color: '#F59E0B', bg: '#FFFBEB' },
  info: { icon: Info, color: '#3B82F6', bg: '#EFF6FF' },
};

export function AutomationSettingsPage() {
  const { currentBrand } = useBrand();
  const { plan, isEnterprise, canAccess } = usePlan();
  const { settings, isLoading, invalidate } = useAutomationSettings();
  const { newAlerts, invalidate: invalidateAlerts } = useAutomationAlerts();
  const toast = useToast();

  const [triggers, setTriggers] = useState<Record<string, TriggerConfig>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent());

  const handleAccentChange = (id: AccentId) => {
    setStoredAccent(id);
    setAccent(id);
  };

  useEffect(() => {
    if (settings?.triggers) {
      const defaults = getDefaultTriggerConfigs();
      setTriggers({ ...defaults, ...settings.triggers });
    } else {
      setTriggers(getDefaultTriggerConfigs());
    }
  }, [settings]);

  const updateTrigger = useCallback((id: string, patch: Partial<TriggerConfig>) => {
    setTriggers(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await AutomationSettingsService.save(currentBrand.id, triggers);
      invalidate();
      setDirty(false);
      toast.success('Οι ρυθμίσεις αποθηκεύτηκαν');
    } catch {
      toast.error('Σφάλμα αποθήκευσης');
    } finally {
      setSaving(false);
    }
  };

  const handleDismissAlert = async (alert: AutomationAlert) => {
    await AutomationAlertsService.dismiss(alert.id);
    invalidateAlerts();
    toast.success('Ειδοποίηση απορρίφθηκε');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        toolbarAriaLabel="Αποθήκευση ρυθμίσεων"
        title={
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#111827] sm:text-2xl">
            <Zap size={20} className="shrink-0 text-[var(--nts-accent)] sm:h-[22px] sm:w-[22px]" />
            Αυτοματισμοί Εμπορικών Αποφάσεων
          </h1>
        }
        description={
          <p className="text-sm text-[#6B7280]">
            Ενεργοποιήστε τα σήματα που θέλετε να παρακολουθεί η εφαρμογή
          </p>
        }
        actions={
          dirty ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={14} />}
              onClick={handleSave}
              disabled={saving}
              className="min-h-[36px] w-full sm:w-auto"
            >
              {saving ? 'Αποθήκευση...' : 'Αποθήκευση'}
            </Button>
          ) : null
        }
      />

      {/* Appearance — per-user accent (localStorage) */}
      <Card padding="none">
        <div className="flex items-center gap-2 border-b border-[#F3F4F6] px-5 py-3.5">
          <Palette size={16} className="shrink-0 text-[var(--nts-accent)]" />
          <h2 className="text-sm font-semibold text-[#111827]">Εμφάνιση</h2>
        </div>
        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-[#6B7280]">
            Χρώμα έμφασης της εφαρμογής. Αποθηκεύεται στον δικό σου browser.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_PRESETS.map((preset) => {
              const selected = accent === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleAccentChange(preset.id)}
                  aria-pressed={selected}
                  title={preset.label}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                    selected
                      ? 'border-[#111827]/30 bg-[#F9FAFB] ring-2 ring-offset-1'
                      : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
                  }`}
                  style={selected ? ({ '--tw-ring-color': preset.swatch } as React.CSSProperties) : undefined}
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full shadow-sm"
                    style={{ backgroundColor: preset.swatch }}
                  >
                    {selected && <Check size={12} className="text-white" />}
                  </span>
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Active Alerts */}
      {newAlerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[#111827]">
            Ενεργές ειδοποιήσεις
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-red-500 text-white">
              {newAlerts.length}
            </span>
          </h2>
          {newAlerts.slice(0, 5).map(alert => {
            const style = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.info;
            const Icon = style.icon;
            return (
              <div
                key={alert.id}
                className="flex items-start gap-3 px-4 py-3 rounded-xl border"
                style={{ backgroundColor: style.bg, borderColor: `${style.color}20` }}
              >
                <Icon size={16} style={{ color: style.color }} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#111827]">{alert.title}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{alert.description}</p>
                  {alert.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {alert.suggestions.map((s, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-white/80 text-[#374151] border border-[#E5E7EB]">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDismissAlert(alert)}
                  className="p-1 hover:bg-white/50 rounded transition-colors shrink-0"
                >
                  <X size={14} className="text-[#9CA3AF]" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Trigger Groups */}
      {TRIGGER_GROUPS.map(group => {
        const groupTriggers = TRIGGERS_CATALOG.filter(t => t.group === group.id);
        const isLocked = group.id === 'procurement' && !canAccess('procurement_triggers');

        return (
          <Card key={group.id} padding="none" className={isLocked ? 'opacity-60' : ''}>
            <div className="flex flex-col gap-2 border-b border-[#F3F4F6] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#111827]">
                {group.label}
                {isLocked && <EnterpriseBadge inline />}
              </h2>
              {!isLocked && (
                <span className="shrink-0 text-[10px] text-[#9CA3AF]">
                  {groupTriggers.filter(t => triggers[t.id]?.enabled).length}/{groupTriggers.length} ενεργά
                </span>
              )}
            </div>

            {isLocked ? (
              <div className="px-5 py-6 text-center">
                <Lock size={20} className="mx-auto mb-2 text-[#9CA3AF]" />
                <p className="text-sm text-[#6B7280]">
                  Οι αυτοματισμοί Procurement είναι διαθέσιμοι στο Enterprise plan
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {groupTriggers.map(triggerDef => {
                  const config = triggers[triggerDef.id] ?? {
                    enabled: false,
                    checkIntervalDays: triggerDef.defaultInterval,
                    autoBriefing: false,
                  };

                  return (
                    <div key={triggerDef.id} className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        {/* Toggle */}
                        <button
                          onClick={() => updateTrigger(triggerDef.id, { enabled: !config.enabled })}
                          className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 ${
                            config.enabled ? 'bg-[#22C55E]' : 'bg-[#D1D5DB]'
                          }`}
                        >
                          <span
                            className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              config.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </button>

                        {/* Label & description */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#111827]">{triggerDef.label}</p>
                          <p className="text-xs text-[#9CA3AF]">{triggerDef.description}</p>
                        </div>
                      </div>

                      {/* Config row (visible when enabled) */}
                      {config.enabled && (
                        <div className="flex items-center gap-4 mt-3 ml-[52px] flex-wrap">
                          {/* Threshold */}
                          {triggerDef.thresholdLabel && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[#6B7280]">{triggerDef.thresholdLabel}</span>
                              <input
                                type="number"
                                value={config.threshold ?? triggerDef.defaultThreshold ?? 0}
                                onChange={e => updateTrigger(triggerDef.id, { threshold: parseFloat(e.target.value) || 0 })}
                                className="w-20 px-2 py-1 text-xs border border-[#E5E7EB] rounded-lg text-center focus:outline-none focus:border-[var(--nts-accent)]"
                              />
                              {triggerDef.thresholdUnit && (
                                <span className="text-[10px] text-[#9CA3AF]">{triggerDef.thresholdUnit}</span>
                              )}
                            </div>
                          )}

                          {/* Interval */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-[#6B7280]">Κάθε</span>
                            <input
                              type="number"
                              value={config.checkIntervalDays}
                              onChange={e => updateTrigger(triggerDef.id, { checkIntervalDays: parseInt(e.target.value) || 1 })}
                              className="w-14 px-2 py-1 text-xs border border-[#E5E7EB] rounded-lg text-center focus:outline-none focus:border-[var(--nts-accent)]"
                              min={1}
                            />
                            <span className="text-[10px] text-[#9CA3AF]">ημ.</span>
                          </div>

                          {/* Auto-briefing toggle */}
                          <button
                            onClick={() => updateTrigger(triggerDef.id, { autoBriefing: !config.autoBriefing })}
                            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-all ${
                              config.autoBriefing
                                ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/8 text-[var(--nts-accent)] font-medium'
                                : 'border-[#E5E7EB] text-[#9CA3AF] hover:border-[#D1D5DB]'
                            }`}
                            title="Αυτόματη δημιουργία εμπορικής πολιτικής στο Συντονισμό Τμημάτων"
                          >
                            {config.autoBriefing ? <Bell size={11} /> : <BellOff size={11} />}
                            Auto-briefing
                          </button>

                          {/* Last check info */}
                          {config.lastCheckedAt && (
                            <span className="text-[10px] text-[#D1D5DB] flex items-center gap-1">
                              <CheckCircle2 size={10} />
                              {new Date(config.lastCheckedAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      {/* Plan info */}
      <div className="text-xs text-[#9CA3AF] text-center py-2">
        Plan: <strong className="text-[#6B7280]">{plan === 'enterprise' ? 'Enterprise' : 'Growth'}</strong>
        {' · '}
        {TRIGGERS_CATALOG.filter(t => t.planRequired === 'growth' || isEnterprise).length} αυτοματισμοί διαθέσιμοι
      </div>
    </div>
  );
}
