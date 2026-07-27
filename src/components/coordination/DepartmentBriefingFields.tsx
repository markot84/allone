import { Users } from 'lucide-react';
import {
  BRIEFING_DEPT_OPTIONS,
  BRIEFING_MESSAGE_TEMPLATES,
  getBriefingTemplate,
} from './briefingShared';
import type { BrandDepartment } from '../../types';
import { DEPARTMENT_LABELS } from '../../types';

interface DepartmentBriefingFieldsProps {
  selectedDepts: BrandDepartment[];
  /** If false, only chips are shown (e.g. commercial policy with fixed departments) */
  deptSelectable: boolean;
  onToggleDept?: (d: BrandDepartment) => void;
  templateId: string;
  onTemplateIdChange: (id: string) => void;
  extraLine: string;
  onExtraLineChange: (v: string) => void;
  /** Extra text (e.g. in BriefingDrawer after the strategy) */
  showAdditionalNote?: boolean;
  additionalNote?: string;
  onAdditionalNoteChange?: (v: string) => void;
  /** Narrower fields for inline strip */
  compact?: boolean;
  /** Hide the departments row (chips/toggles) — when departments are shown above */
  showDepartmentRow?: boolean;
}

export function DepartmentBriefingFields({
  selectedDepts,
  deptSelectable,
  onToggleDept,
  templateId,
  onTemplateIdChange,
  extraLine,
  onExtraLineChange,
  showAdditionalNote,
  additionalNote = '',
  onAdditionalNoteChange,
  compact,
  showDepartmentRow = true,
}: DepartmentBriefingFieldsProps) {
  const template = getBriefingTemplate(templateId);
  const pad = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="space-y-3">
      {showDepartmentRow && (
      <div>
        <p className="text-xs font-medium text-[#6B7280] mb-2 flex items-center gap-1.5">
          <Users size={12} /> Ειδοποίηση τμημάτων
        </p>
        {deptSelectable && onToggleDept ? (
          <div className="flex flex-wrap gap-2">
            {BRIEFING_DEPT_OPTIONS.map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => onToggleDept(k)}
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
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedDepts.map((dep) => (
              <span
                key={dep}
                className="text-[10px] px-2 py-0.5 rounded-md bg-white/80 border border-[#E5E7EB] text-[#374151]"
              >
                {DEPARTMENT_LABELS[dep] ?? dep}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-[#374151]">Μήνυμα προς τα τμήματα</label>
        <select
          value={templateId}
          onChange={(e) => onTemplateIdChange(e.target.value)}
          className={`w-full px-3 py-2 ${pad} border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[var(--nts-accent)]`}
        >
          {BRIEFING_MESSAGE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#6B7280] leading-snug pl-0.5 border-l-2 border-[#E5E7EB] pl-2">{template.body}</p>
        <input
          type="text"
          value={extraLine}
          onChange={(e) => onExtraLineChange(e.target.value)}
          placeholder="Προαιρετική γραμμή (π.χ. deadline ή project)"
          className={`w-full px-3 py-2 ${pad} border border-[#E5E7EB] rounded-lg bg-white placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--nts-accent)]`}
        />
      </div>

      {showAdditionalNote && onAdditionalNoteChange && (
        <div>
          <label className="text-xs font-medium text-[#374151] mb-1 block">Επιπλέον σημείωση</label>
          <textarea
            value={additionalNote}
            onChange={(e) => onAdditionalNoteChange(e.target.value)}
            rows={compact ? 2 : 3}
            placeholder="Λεπτομέρειες για τα τμήματα (προαιρετικά)…"
            className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[var(--nts-accent)] resize-none text-[#374151] placeholder:text-[#D1D5DB] bg-[#FAFAFA]"
          />
        </div>
      )}
    </div>
  );
}
