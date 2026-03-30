import { useState, useEffect, useCallback } from 'react';
import { Bell, Mail, Monitor, Save, Loader2 } from 'lucide-react';
import { useAuth, useBrand } from '../../hooks';
import { NotificationPrefsService } from '../../services/coordination';
import type { ActivityType, NotificationChannel, NotificationPreferences } from '../../types';
import { DEFAULT_NOTIFICATION_CHANNELS } from '../../types';

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  decision_created: 'Νέα απόφαση',
  decision_updated: 'Ενημέρωση απόφασης',
  decision_completed: 'Ολοκλήρωση απόφασης',
  task_created: 'Νέο task',
  task_assigned: 'Ανάθεση task',
  task_completed: 'Ολοκλήρωση task',
  comment_added: 'Νέο σχόλιο',
  member_joined: 'Νέο μέλος',
};

const ACTIVITY_GROUPS: { label: string; types: ActivityType[] }[] = [
  { label: 'Αποφάσεις', types: ['decision_created', 'decision_updated', 'decision_completed'] },
  { label: 'Tasks', types: ['task_created', 'task_assigned', 'task_completed'] },
  { label: 'Γενικά', types: ['comment_added', 'member_joined'] },
];

export function NotificationSettings() {
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const [channels, setChannels] = useState<Record<ActivityType, NotificationChannel[]>>(
    { ...DEFAULT_NOTIFICATION_CHANNELS }
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    if (!currentBrand || !user?.uid) return;
    setLoading(true);
    try {
      const prefs = await NotificationPrefsService.get(currentBrand.id, user.uid);
      if (prefs?.channels) setChannels(prefs.channels);
    } catch { /* use defaults */ }
    setLoading(false);
  }, [currentBrand, user?.uid]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  const toggleChannel = (type: ActivityType, channel: NotificationChannel) => {
    setChannels(prev => {
      const current = prev[type] ?? [];
      const has = current.includes(channel);
      const next = has ? current.filter(c => c !== channel) : [...current, channel];
      return { ...prev, [type]: next };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!currentBrand || !user?.uid) return;
    setSaving(true);
    try {
      await NotificationPrefsService.save(currentBrand.id, user.uid, { channels } as Partial<NotificationPreferences>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* noop */ }
    setSaving(false);
  };

  if (!currentBrand) return null;

  return (
    <div className="p-4 border border-[var(--nts-border-gray)] rounded-xl bg-[var(--nts-light-gray)]">
      <h4 className="font-semibold text-[var(--nts-charcoal)] mb-1 flex items-center gap-2">
        <Bell size={18} />
        Ρυθμίσεις ειδοποιήσεων
      </h4>
      <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
        Επιλέξτε πώς θέλετε να ενημερώνεστε για κάθε τύπο δραστηριότητας.
      </p>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin text-[var(--nts-medium-gray)]" />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_60px] gap-2 mb-2 px-1">
            <span className="text-xs font-medium text-[var(--nts-medium-gray)]">Τύπος</span>
            <span className="text-xs font-medium text-[var(--nts-medium-gray)] text-center flex items-center justify-center gap-1">
              <Monitor size={12} /> App
            </span>
            <span className="text-xs font-medium text-[var(--nts-medium-gray)] text-center flex items-center justify-center gap-1">
              <Mail size={12} /> Email
            </span>
          </div>

          <div className="space-y-3">
            {ACTIVITY_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider mb-1.5 px-1">{group.label}</p>
                <div className="space-y-0.5">
                  {group.types.map(type => {
                    const ch = channels[type] ?? [];
                    return (
                      <div key={type} className="grid grid-cols-[1fr_60px_60px] gap-2 items-center py-1.5 px-1 rounded-md hover:bg-white/60 transition-colors">
                        <span className="text-sm text-[var(--nts-charcoal)]">{ACTIVITY_LABELS[type]}</span>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleChannel(type, 'inApp')}
                            className={`w-8 h-5 rounded-full transition-colors ${ch.includes('inApp') ? 'bg-[var(--nts-accent)]' : 'bg-gray-200'}`}
                          >
                            <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${ch.includes('inApp') ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleChannel(type, 'email')}
                            className={`w-8 h-5 rounded-full transition-colors ${ch.includes('email') ? 'bg-[var(--nts-accent)]' : 'bg-gray-200'}`}
                          >
                            <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${ch.includes('email') ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--nts-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Αποθήκευση
            </button>
            {saved && <span className="text-xs text-green-600 font-medium">Αποθηκεύτηκε!</span>}
          </div>
        </>
      )}
    </div>
  );
}
