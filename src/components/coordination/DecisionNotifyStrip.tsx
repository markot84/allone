import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Send } from 'lucide-react';
import { Button, useToast } from '../common';
import { logAndNotify } from '../../services/coordination';
import { useAuth } from '../../hooks/useAuth';
import { useBrand } from '../../hooks/useBrand';
import { useBrandMembers } from '../../hooks/useCoordination';
import type { Decision, BrandDepartment } from '../../types';
import { BRIEFING_MESSAGE_TEMPLATES, getBriefingTemplate } from './briefingShared';
import { DepartmentBriefingFields } from './DepartmentBriefingFields';
import type { BroadcastResult } from '../../services/coordination';

interface DecisionNotifyStripProps {
  decision: Decision;
  /** Στο συρτάρι λεπτομερειών: χωρίς μεγάλη κεφαλίδα / διπλότυπα τμήματα */
  variant?: 'default' | 'embedded';
}

export function DecisionNotifyStrip({ decision: d, variant = 'default' }: DecisionNotifyStripProps) {
  const { currentBrand } = useBrand();
  const { user, isSuperAdmin } = useAuth();
  const { members } = useBrandMembers();
  const toast = useToast();
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState(BRIEFING_MESSAGE_TEMPLATES[0].id);
  const [extraLine, setExtraLine] = useState('');
  const [sending, setSending] = useState(false);
  const [lastDispatch, setLastDispatch] = useState<{
    at: string;
    result: BroadcastResult;
  } | null>(null);

  const depts = d.targetDepartments?.length ? d.targetDepartments : [];
  const brandId = currentBrand?.id;
  const myRole = members.find((m) => m.userId === user?.uid)?.role ?? 'member';
  const canSeeDiagnostics =
    myRole === 'owner' ||
    myRole === 'admin' ||
    currentBrand?.createdBy === user?.uid ||
    isSuperAdmin;

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
      const result = await logAndNotify(
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
      setLastDispatch({ at: new Date().toISOString(), result });
      await qc.invalidateQueries({ queryKey: ['activity', brandId] });
      if (result.emailRecipients > 0 && result.emailSent === 0) {
        toast.error('Στάλθηκαν μόνο in-app ειδοποιήσεις. Τα email απέτυχαν.');
      } else if (result.emailFailed > 0) {
        toast.info(
          `Ειδοποιήσεις στάλθηκαν. Email: ${result.emailSent}/${result.emailRecipients} επιτυχία.`
        );
      } else {
        toast.success('Η ειδοποίηση στάλθηκε στα τμήματα (in-app & email).');
      }
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

          {canSeeDiagnostics && lastDispatch && (
            <details className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-[#6B7280]">
                Diagnostics αποστολής (admin)
              </summary>
              <div className="mt-2 text-[11px] text-[#374151] space-y-1">
                <p>
                  <span className="text-[#6B7280]">Χρόνος:</span>{' '}
                  {new Date(lastDispatch.at).toLocaleString('el-GR')}
                </p>
                <p>
                  <span className="text-[#6B7280]">In-app recipients:</span>{' '}
                  {lastDispatch.result.inAppRecipients}
                </p>
                <p>
                  <span className="text-[#6B7280]">Email recipients:</span>{' '}
                  {lastDispatch.result.emailRecipients}
                </p>
                <p>
                  <span className="text-[#6B7280]">Email sent:</span>{' '}
                  {lastDispatch.result.emailSent}
                </p>
                <p>
                  <span className="text-[#6B7280]">Email failed:</span>{' '}
                  <span className={lastDispatch.result.emailFailed > 0 ? 'text-[#DC2626] font-semibold' : ''}>
                    {lastDispatch.result.emailFailed}
                  </span>
                </p>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
