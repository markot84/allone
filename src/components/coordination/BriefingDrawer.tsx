import { useState } from 'react';
import { X, Send, Users } from 'lucide-react';
import { Button } from '../common';
import { DecisionsService, logAndNotify } from '../../services/coordination';
import { useBrand, useAuth } from '../../hooks';
import type { BrandDepartment } from '../../types';

const DEPTS: [BrandDepartment, string][] = [
  ['commercial', 'Εμπορική Δ/νση'],
  ['marketing', 'Marketing'],
  ['procurement', 'Procurement'],
  ['agency', 'Agency'],
  ['management', 'Διοίκηση'],
];

const DEPTS_KEY = 'perf-plus-briefing-depts';

interface BriefingDrawerProps {
  strategyName: string;
  onClose: () => void;
  onSent: () => void;
}

export function BriefingDrawer({ strategyName, onClose, onSent }: BriefingDrawerProps) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const [title, setTitle] = useState(`Νέα στρατηγική: ${strategyName}`);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<BrandDepartment[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(DEPTS_KEY) || '["commercial","marketing","procurement","agency"]');
    } catch {
      return ['commercial', 'marketing', 'procurement', 'agency'];
    }
  });

  const toggleDept = (d: BrandDepartment) => {
    setSelectedDepts(prev => {
      const next = prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d];
      localStorage.setItem(DEPTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSend = async () => {
    if (!title.trim() || !currentBrand?.id || !user?.uid || selectedDepts.length === 0) return;
    setSending(true);
    try {
      const authorName = user.displayName || user.email || '';
      const decId = await DecisionsService.create({
        brandId: currentBrand.id,
        title: title.trim(),
        description: note.trim() || `Εφαρμόστηκε η στρατηγική "${strategyName}". Τα τμήματα καλούνται να ευθυγραμμίσουν τις ενέργειές τους.`,
        category: 'general',
        priority: 'high',
        status: 'active',
        targetDepartments: selectedDepts,
        createdBy: user.uid,
        createdByName: authorName,
      });
      await logAndNotify(
        currentBrand.id, user.uid, authorName,
        'decision_created', 'decision', decId,
        `${authorName} έστειλε briefing: "${title.trim()}"`,
        'Νέο Briefing',
        title.trim(),
        selectedDepts
      );
      onSent();
    } catch (e) {
      console.error('Briefing failed:', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Bottom drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl border-t border-[#E5E7EB] animate-in slide-in-from-bottom">
        <div className="max-w-2xl mx-auto px-5 py-5">
          {/* Handle */}
          <div className="w-10 h-1 bg-[#E5E7EB] rounded-full mx-auto mb-4" />

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-[#111827] text-base">Αποστολή Briefing</h3>
              <p className="text-xs text-[#9CA3AF] mt-0.5">Ειδοποίηση τμημάτων για νέα στρατηγική</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#F3F4F6] rounded-lg transition-colors"
            >
              <X size={17} className="text-[#6B7280]" />
            </button>
          </div>

          {/* Title */}
          <div className="mb-3">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-medium border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[var(--nts-accent)] bg-[#FAFAFA]"
              placeholder="Τίτλος briefing"
            />
          </div>

          {/* Note */}
          <div className="mb-4">
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Προαιρετική σημείωση στα τμήματα... (π.χ. «Εστίαση σε κατηγορία Χ, ξεκινάμε από Δευτέρα»)"
              className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[var(--nts-accent)] resize-none text-[#374151] placeholder:text-[#D1D5DB] bg-[#FAFAFA]"
            />
          </div>

          {/* Departments */}
          <div className="mb-5">
            <p className="text-xs font-medium text-[#6B7280] mb-2 flex items-center gap-1.5">
              <Users size={12} /> Ειδοποίηση τμημάτων
            </p>
            <div className="flex flex-wrap gap-2">
              {DEPTS.map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => toggleDept(k)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                    selectedDepts.includes(k)
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/8 text-[var(--nts-accent)] font-medium'
                      : 'border-[#E5E7EB] text-[#9CA3AF] hover:border-[#D1D5DB] hover:text-[#6B7280]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
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
