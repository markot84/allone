import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { AutomationSettings, AutomationAlert, TriggerConfig, AlertEvaluation } from '../types';
import { getDefaultTriggerConfigs } from '../data/triggersCatalog';

const ts = () => new Date().toISOString();

export const AutomationSettingsService = {
  async get(brandId: string): Promise<AutomationSettings> {
    const ref = doc(db, 'automation_settings', brandId);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() as AutomationSettings;
    const defaults: AutomationSettings = {
      triggers: getDefaultTriggerConfigs(),
      updatedAt: ts(),
    };
    return defaults;
  },

  async save(brandId: string, triggers: Record<string, TriggerConfig>): Promise<void> {
    const ref = doc(db, 'automation_settings', brandId);
    // Strip undefined values which Firestore rejects
    const clean: Record<string, Record<string, unknown>> = {};
    for (const [id, cfg] of Object.entries(triggers)) {
      clean[id] = {
        enabled: cfg.enabled ?? false,
        threshold: cfg.threshold ?? 0,
        checkIntervalDays: cfg.checkIntervalDays ?? 7,
        autoBriefing: cfg.autoBriefing ?? false,
      };
    }
    await setDoc(ref, { triggers: clean, updatedAt: ts() }, { merge: true });
  },

  async updateTrigger(brandId: string, triggerId: string, config: Partial<TriggerConfig>): Promise<void> {
    const current = await this.get(brandId);
    current.triggers[triggerId] = { ...current.triggers[triggerId], ...config };
    await this.save(brandId, current.triggers);
  },
};

export const AutomationAlertsService = {
  async getAll(brandId: string): Promise<AutomationAlert[]> {
    const q = query(
      collection(db, 'automation_alerts'),
      where('brandId', '==', brandId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as AutomationAlert)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async create(alert: Omit<AutomationAlert, 'id' | 'createdAt'>): Promise<string> {
    const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const data: AutomationAlert = { ...alert, id, createdAt: ts() };
    await setDoc(doc(db, 'automation_alerts', id), data);
    return id;
  },

  async updateStatus(id: string, status: AutomationAlert['status'], linkedDecisionId?: string): Promise<void> {
    const ref = doc(db, 'automation_alerts', id);
    const update: Record<string, unknown> = { status };
    if (linkedDecisionId) update.linkedDecisionId = linkedDecisionId;
    await setDoc(ref, update, { merge: true });
  },

  async dismiss(id: string): Promise<void> {
    await this.updateStatus(id, 'dismissed');
  },

  /** Archive with evaluation — new alerts keep being created normally by the server */
  async archiveWithEvaluation(id: string, evaluation: AlertEvaluation, evaluatedBy?: string): Promise<void> {
    const ref = doc(db, 'automation_alerts', id);
    await setDoc(
      ref,
      {
        status: 'archived' as const,
        evaluation,
        evaluatedAt: ts(),
        ...(evaluatedBy ? { evaluatedBy } : {}),
      },
      { merge: true }
    );
  },

  async deleteOld(brandId: string, olderThanDays = 30): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const all = await this.getAll(brandId);
    for (const a of all) {
      if (
        new Date(a.createdAt) < cutoff &&
        (a.status === 'dismissed' || a.status === 'acted' || a.status === 'archived')
      ) {
        await deleteDoc(doc(db, 'automation_alerts', a.id));
      }
    }
  },
};
