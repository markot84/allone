import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Send } from 'lucide-react';
import { Button, useToast } from '../common';
import { logAndNotify } from '../../services/coordination';
import { useAuth, useBrand } from '../../hooks';
import type { Decision, BrandDepartment } from '../../types';
import { BRIEFING_MESSAGE_TEMPLATES, getBriefingTemplate } from './briefingShared';
import { DepartmentBriefingFields } from './DepartmentBriefingFields';

interface DecisionNotifyStripProps {
  decision: Decision;
  /** Στο συρτάρι λεπτομερειών: χωρίς μεγάλη κεφαλίδα / διπλότυπα τμήματα */
  variant?: 'default' | 'embedded';
}

export function DecisionNotifyStrip({ decision: d, variant = 'default' }: DecisionNotifyStripProps) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState(BRIEFING_MESSAGE_TEMPLATES[0].id);
  const [extraLine, setExtraLine] = useState('');
  const [sending, setSending] = useState(false);

  const depts = d.targetDepartments?.length ? d.targetDepartments : [];
  const brandId = currentBrand?.id;

  const handleSend = async () => {
    if (!brandId || !user?.uid || depts.length === 0) return;
    setSending(true);
    try {
      const authorName = user.displayName || user.email || '';
      const template = getBriefingTemplate(templateId);
      const bodyLine = extraLine.trim();
      const fullBody = bodyLine ? `${template.body}\n${bodyLine}` : template.body;
      const summary = `${authorName} ειδοποίησε τμήματα για «${d.title}»: ${template.label}`;
      const notifTitle =
        d.status === 'proposal' ? 'Ειδοποίηση πρότασης τμήματος' : 'Ειδοποίηση εμπορικής πολιτικής';
      await logAndNotify(
        brandId,
        user.uid,
        authorName,
        'decision_updated',
        'decision',
        d.id,
        summary,
        notifTitle,
        fullBody,
        depts as BrandDepartment[]
      );
      await qc.invalidateQueries({ queryKey: ['activity', brandId] });
      toast.success('Η ειδοποίηση στάλθηκε στα τμήματα');
    } catch (e) {
      console.error(e);
      toast.error('Αποτυχία αποστολής');
    } finally {
      setSending(false);
    }
  };

  const shell =
    variant === 'embedded'
      ? 'rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 space-y-3'
      : 'rounded-xl border border-[var(--nts-accent)]/25 bg-gradient-to-br from-[var(--nts-accent)]/[0.06] to-transparent p-4 space-y-3';

  return (
    <div className={shell}>
      {variant === 'default' && (
        <div className="flex items-start gap-2">
          <div className="mt-0.5 p-1.5 rounded-lg bg-[var(--nts-accent)]/15 text-[var(--nts-accent)]">
            <Bell size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#111827]">Ειδοποίηση τμημάτων</p>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {d.status === 'proposal'
                ? 'Ένα βήμα: επιλέξτε μήνυμα και στείλτε ειδοποίηση στα τμήματα της πρότασης τμήματος.'
                : 'Ένα βήμα: επιλέξτε μήνυμα και στείλτε ειδοποίηση στα τμήματα της εμπορικής πολιτικής.'}
            </p>
          </div>
        </div>
      )}

      {variant === 'embedded' && (
        <p className="text-[11px] font-medium text-[#6B7280]">Νέα ειδοποίηση (in-app & email)</p>
      )}

      {depts.length === 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {d.status === 'proposal'
            ? 'Δεν έχουν οριστεί τμήματα σε αυτή την πρόταση — επεξεργαστείτε την πρόταση ή δημιουργήστε νέα με επιλογή τμημάτων.'
            : 'Δεν έχουν οριστεί τμήματα σε αυτή την εμπορική πολιτική — επεξεργαστείτε την καταχώρηση ή δημιουργήστε νέα με επιλογή τμημάτων.'}
        </p>
      ) : (
        <>
          <DepartmentBriefingFields
            deptSelectable={false}
            selectedDepts={depts as BrandDepartment[]}
            templateId={templateId}
            onTemplateIdChange={setTemplateId}
            extraLine={extraLine}
            onExtraLineChange={setExtraLine}
            compact
            showRecipientsPreview={variant === 'default'}
            showDepartmentRow={variant === 'default'}
          />

          <Button
            variant="primary"
            icon={<Send size={15} />}
            onClick={handleSend}
            disabled={sending}
            className="w-full sm:w-auto"
          >
            {sending ? 'Αποστολή...' : 'Αποστολή ειδοποίησης'}
          </Button>
        </>
      )}
    </div>
  );
}
