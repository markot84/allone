import type { BrandDepartment, BrandMember } from '../../types';
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

/** Μία γραμμή προεπισκόπησης παραληπτών (in-app + email) */
export function formatRecipientsPreview(depts: BrandDepartment[]): string {
  if (!depts.length) return 'Επιλέξτε τουλάχιστον ένα τμήμα για ειδοποίηση.';
  const labels = depts.map((d) => DEPARTMENT_LABELS[d] || d);
  return `Η ειδοποίηση πάει σε μέλη που έχουν ταιριστό τμήμα στο προφίλ τους (${labels.join(', ')}). Δεν είναι «ένα email ανά τμήμα»: αν κάποιο τμήμα δεν έχει άλλα μέλη, δεν θα σταλεί κάπου. In-app και email ανά τις προτιμήσεις κάθε χρήστη. Ο αποστολέας δεν λαμβάνει αντίγραφο.`;
}

/** Άλλα μέλη (εξαιρώντας αποστολέα) με department στα επιλεγμένα τμήματα — ίδια λογική με broadcast. */
export function countMembersInSelectedDepartments(
  members: BrandMember[],
  excludeUserId: string,
  selectedDepts: BrandDepartment[]
): number {
  return members.filter((m) => {
    if (m.userId === excludeUserId) return false;
    const dept = m.department ?? 'other';
    return selectedDepts.includes(dept);
  }).length;
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
