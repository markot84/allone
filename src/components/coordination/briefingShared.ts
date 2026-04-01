import type { BrandDepartment } from '../../types';
import { DEPARTMENT_LABELS } from '../../types';

/** localStorage key για απομνημονευμένη επιλογή τμημάτων (BriefingDrawer / quick strip) */
export const BRIEFING_DEPTS_STORAGE_KEY = 'perf-plus-briefing-depts';

export const BRIEFING_DEPT_OPTIONS: [BrandDepartment, string][] = (
  Object.entries(DEPARTMENT_LABELS) as [BrandDepartment, string][]
).filter(([k]) => k !== 'other');

export interface BriefingMessageTemplate {
  id: string;
  label: string;
  body: string;
}

/** Κοινά templates για briefing από στρατηγική και ειδοποίηση εμπορικής πολιτικής */
export const BRIEFING_MESSAGE_TEMPLATES: BriefingMessageTemplate[] = [
  {
    id: 'align',
    label: 'Ευθυγράμμιση ενεργειών',
    body: 'Παρακαλώ ευθυγραμμίστε τις ενέργειές σας με αυτή την εμπορική πολιτική.',
  },
  {
    id: 'week',
    label: 'Υπενθύμιση χρονοδιαγράμματος',
    body: 'Υπενθυμίζω: χρειάζονται ενημερώσεις μέχρι το τέλος της εβδομάδας.',
  },
  {
    id: 'confirm',
    label: 'Επιβεβαίωση λήψης',
    body: 'Επιβεβαιώστε ότι έχετε λάβει γνώση και πώς προχωράτε.',
  },
  {
    id: 'campaigns_stock',
    label: 'Campaigns & απόθεμα',
    body: 'Προσαρμόστε τα σχετικά campaigns και αποθέματα σύμφωνα με την εμπορική πολιτική.',
  },
  {
    id: 'meeting',
    label: 'Πριν τη σύσκεψη',
    body: 'Ζητήστε σύντομο feedback από το αρμόδιο τμήμα πριν την επόμενη σύσκεψη.',
  },
];

export function getBriefingTemplate(id: string): BriefingMessageTemplate {
  return BRIEFING_MESSAGE_TEMPLATES.find((t) => t.id === id) ?? BRIEFING_MESSAGE_TEMPLATES[0];
}

export function loadSavedBriefingDepartments(): BrandDepartment[] {
  try {
    const raw = localStorage.getItem(BRIEFING_DEPTS_STORAGE_KEY);
    if (!raw) return ['commercial', 'marketing', 'procurement', 'agency'];
    const parsed = JSON.parse(raw) as BrandDepartment[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['commercial', 'marketing', 'procurement', 'agency'];
  } catch {
    return ['commercial', 'marketing', 'procurement', 'agency'];
  }
}

export function saveBriefingDepartments(depts: BrandDepartment[]) {
  try {
    localStorage.setItem(BRIEFING_DEPTS_STORAGE_KEY, JSON.stringify(depts));
  } catch {
    /* */
  }
}
