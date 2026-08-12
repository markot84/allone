import { useState } from 'react';
import { X, Send } from 'lucide-react';
import { Button, useToast } from '../common';
import { DecisionsService, logAndNotify } from '../../services/coordination';
import { useBrand } from '../../hooks/useBrand';
import { useAuth } from '../../hooks/useAuth';
import { useBrandMembers } from '../../hooks/useCoordination';
import type { BrandDepartment } from '../../types';
import { DepartmentBriefingFields } from './DepartmentBriefingFields';
import {
  BRIEFING_MESSAGE_TEMPLATES,
  getBriefingTemplate,
  loadSavedBriefingDepartments,
  saveBriefingDepartments,
} from './briefingShared';
import { logger } from '../../utils/logger';

interface BriefingDrawerProps {
  strategyName: string;
  /** If provided (e.g. a briefing without an active scenario), replaces the "New strategy: …" title */
  initialTitle?: string;
  onClose: () => void;
  onSent: () => void;
}

function buildDecisionDescription(
  strategyName: string,
  templateBody: string,
  extraLine: string,
  additionalNote: string
): string {
  const parts: string[] = [templateBody];
  if (extraLine.trim()) parts.push(extraLine.trim());
  if (additionalNote.trim()) parts.push(additionalNote.trim());
  const joined = parts.join('\n\n').trim();
  if (joined) return joined;
  return `Εφαρμόστηκε η στρατηγική "${strategyName}". Τα τμήματα καλούνται να ευθυγραμμίσουν τις ενέργειές τους.`;
}

export function BriefingDrawer({ strategyName, initialTitle, onClose, onSent }: BriefingDrawerProps) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { members } = useBrandMembers();
  const toast = useToast();
  const [title, setTitle] = useState(() => initialTitle ?? `Νέα στρατηγική: ${strategyName}`);
  const [templateId, setTemplateId] = useState(BRIEFING_MESSAGE_TEMPLATES[0].id);
  const [extraLine, setExtraLine] = useState('');
  const [additionalNote, setAdditionalNote] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<BrandDepartment[]>(() => loadSavedBriefingDepartments());

  const toggleDept = (d: BrandDepartment) => {
    setSelectedDepts((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      saveBriefingDepartments(next);
      return next;
    });
  };

  const handleSend = async () => {
    if (!title.trim()) {
      toast.error('Συμπληρώστε τίτλο για την εμπορική πολιτική.');
      return;
    }
    if (!currentBrand?.id || !user?.uid) {
      toast.error('Απαιτείται σύνδεση για αποστολή.');
      return;
    }
    if (selectedDepts.length === 0) {
      toast.error('Επιλέξτε τουλάχιστον ένα τμήμα.');
      return;
    }
    setSending(true);
    try {
      const authorName = user.displayName || user.email || '';
      const template = getBriefingTemplate(templateId);
      const description = buildDecisionDescription(strategyName, template.body, extraLine, additionalNote);

      const decId = await DecisionsService.create({
        brandId: currentBrand.id,
        title: title.trim(),
        description,
        category: 'general',
        priority: 'high',
        status: 'active',
        targetDepartments: selectedDepts,
        createdBy: user.uid,
        createdByName: authorName,
      });
      const broadcast = await logAndNotify(
        currentBrand.id,
        user.uid,
        authorName,
        'decision_created',
        'decision',
        decId,
        `${authorName} έστειλε briefing: "${title.trim()}"`,
        'Νέο Briefing',
        title.trim(),
        selectedDepts,
        members
      );
      const noOthers =
        broadcast.inAppRecipients === 0 &&
        broadcast.emailRecipients === 0;
      if (noOthers) {
        toast.info(
          'Η εμπορική πολιτική αποθηκεύτηκε, αλλά δεν βρέθηκαν άλλα μέλη στα επιλεγμένα τμήματα (ή μόνο εσείς είστε στο brand). Ο αποστολέας δεν λαμβάνει ειδοποίηση ούτε email.'
        );
      } else {
        const parts: string[] = [];
        if (broadcast.inAppRecipients > 0) {
          parts.push(`in-app: ${broadcast.inAppRecipients} μέλη`);
        }
        if (broadcast.emailRecipients > 0) {
          parts.push(
            `email: ${broadcast.emailRecipients} παραλήπτες (αποστολή στο παρασκήνιο)`
          );
        }
        const msg =
          parts.length > 0
            ? `Το briefing καταχωρήθηκε. ${parts.join(' · ')}.`
            : 'Το briefing καταχωρήθηκε.';
        if (broadcast.emailFailed > 0 && broadcast.emailSent === 0 && broadcast.emailRecipients > 0) {
          toast.error(msg);
        } else if (broadcast.emailFailed > 0) {
          toast.info(msg);
        } else {
          toast.success(msg);
        }
      }
      onSent();
    } catch (e) {
      logger.error('Briefing failed:', { err: e });
      const msg = e instanceof Error ? e.message : String(e);
      const short = msg.length > 120 ? `${msg.slice(0, 120)}…` : msg;
      toast.error(`Αποτυχία αποστολής: ${short}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="fixed bottom-0 left-0 right-0 z-[100] bg-white rounded-t-2xl shadow-2xl border-t border-[#E5E7EB] animate-in slide-in-from-bottom max-h-[min(92vh,900px)] flex flex-col">
        <div className="max-w-2xl mx-auto px-5 py-5 w-full overflow-y-auto">
          <div className="w-10 h-1 bg-[#E5E7EB] rounded-full mx-auto mb-4" />

          <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[#111827]">Αποστολή Briefing</h3>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">Ειδοποίηση τμημάτων για νέα στρατηγική</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 self-end p-1.5 transition-colors hover:bg-[var(--surface-2)] rounded-lg sm:self-start"
            >
              <X size={17} className="text-[#6B7280]" />
            </button>
          </div>

          <div className="mb-3">
            <label className="text-xs font-medium text-[#374151] mb-1 block">Τίτλος εμπορικής πολιτικής</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-medium border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[var(--nts-accent)] bg-[#FAFAFA]"
              placeholder="Τίτλος briefing"
            />
          </div>

          <DepartmentBriefingFields
            deptSelectable
            selectedDepts={selectedDepts}
            onToggleDept={toggleDept}
            templateId={templateId}
            onTemplateIdChange={setTemplateId}
            extraLine={extraLine}
            onExtraLineChange={setExtraLine}
            showAdditionalNote
            additionalNote={additionalNote}
            onAdditionalNoteChange={setAdditionalNote}
          />

          <div className="flex gap-3 mt-5">
            <Button variant="secondary" onClick={onClose} className="flex-1">
              Παράλειψη
            </Button>
            <Button
              variant="primary"
              icon={<Send size={15} />}
              onClick={handleSend}
              disabled={!title.trim() || selectedDepts.length === 0 || sending}
              className="flex-1"
            >
              {sending ? 'Αποστολή...' : 'Αποστολή Briefing'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
