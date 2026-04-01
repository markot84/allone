import { useState, useMemo } from 'react';
import { Plus, MessageSquare, CheckSquare, Activity, ChevronRight, X, AlertTriangle, CheckCircle2, Users, Flag, Pencil, Zap, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Card, Button, Spinner, useToast, FormattedProse } from '../common';
import { CommentsPanel } from './CommentsPanel';
import { DecisionNotifyStrip } from './DecisionNotifyStrip';
import { useDecisions, useTasks, useActivity, useBrandMembers, useAuth } from '../../hooks';
import { useBrand } from '../../hooks';
import { DecisionsService, TasksService, logAndNotify } from '../../services/coordination';
import type {
  Decision, CoordinationTask, DecisionCategory, DecisionPriority,
  DecisionStatus, TaskStatus, TaskPriority, BrandDepartment
} from '../../types';
import { DEPARTMENT_LABELS } from '../../types';

// ── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<DecisionCategory, { label: string; color: string }> = {
  pricing: { label: 'Τιμολόγηση', color: '#8B5CF6' },
  promotion: { label: 'Προωθητική', color: '#F59E0B' },
  product: { label: 'Προϊόν', color: '#3B82F6' },
  procurement: { label: 'Procurement', color: '#10B981' },
  marketing: { label: 'Marketing', color: '#EC4899' },
  general: { label: 'Γενική', color: '#6B7280' },
};

const PRIORITY_META: Record<string, { label: string; color: string; icon: typeof Flag }> = {
  low: { label: 'Χαμηλή', color: '#9CA3AF', icon: Flag },
  medium: { label: 'Μεσαία', color: '#F59E0B', icon: Flag },
  high: { label: 'Υψηλή', color: '#EF4444', icon: Flag },
  urgent: { label: 'Επείγον', color: '#DC2626', icon: AlertTriangle },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  proposal: { label: 'Πρόταση τμήματος', color: '#8B5CF6' },
  draft: { label: 'Πρόχειρη', color: '#9CA3AF' },
  active: { label: 'Ενεργή', color: '#3B82F6' },
  completed: { label: 'Ολοκληρωμένη', color: '#10B981' },
  archived: { label: 'Αρχείο', color: '#6B7280' },
  pending: { label: 'Εκκρεμεί', color: '#F59E0B' },
  in_progress: { label: 'Σε εξέλιξη', color: '#3B82F6' },
  done: { label: 'Ολοκληρωμένη', color: '#10B981' },
  cancelled: { label: 'Ακυρωμένη', color: '#EF4444' },
};

const DEPT_LABELS = DEPARTMENT_LABELS;

// ── Main Page (Briefing Board) ───────────────────────────────────────────────

export function CoordinationPage() {
  const { decisions, isLoading: decisionsLoading, invalidate: invalidateDecisions } = useDecisions();
  const { tasks, isLoading: tasksLoading, invalidate: invalidateTasks } = useTasks();
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const toast = useToast();

  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [selectedTask, setSelectedTask] = useState<CoordinationTask | null>(null);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskFromDecision, setTaskFromDecision] = useState<Decision | null>(null);
  const [showActivityDrawer, setShowActivityDrawer] = useState(false);

  const activeDecisions = useMemo(
    () => decisions.filter(d => d.status === 'active').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [decisions]
  );
  const proposals = useMemo(
    () => decisions.filter(d => d.status === 'proposal').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [decisions]
  );
  const pendingTasks = useMemo(
    () => tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').sort((a, b) => {
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
      return 0;
    }),
    [tasks]
  );

  const lastBriefing = activeDecisions[0] ?? null;

  const handleApproveProposal = async (d: Decision) => {
    try {
      await DecisionsService.update(d.id, { status: 'active' });
      if (currentBrand && user) {
        await logAndNotify(
          currentBrand.id, user.uid, user.displayName || user.email || '',
          'decision_updated', 'decision', d.id,
          `Η πρόταση "${d.title}" εγκρίθηκε`,
          'Πρόταση τμήματος εγκρίθηκε', d.title,
          d.targetDepartments as BrandDepartment[]
        );
      }
      invalidateDecisions();
      toast.success('Η πρόταση εγκρίθηκε');
    } catch {
      toast.error('Αποτυχία ενημέρωσης');
    }
  };

  const handleRejectProposal = async (d: Decision) => {
    try {
      await DecisionsService.update(d.id, { status: 'archived' });
      invalidateDecisions();
      toast.success('Η πρόταση απορρίφθηκε');
    } catch {
      toast.error('Αποτυχία ενημέρωσης');
    }
  };

  const handleCompleteTask = async (t: CoordinationTask) => {
    try {
      await TasksService.update(t.id, { status: 'done' });
      if (currentBrand && user) {
        await logAndNotify(
          currentBrand.id, user.uid, user.displayName || user.email || '',
          'task_completed', 'task', t.id,
          `Η εργασία "${t.title}" ολοκληρώθηκε`, 'Εργασία ολοκληρώθηκε', t.title
        );
      }
      invalidateTasks();
      toast.success('Εργασία ολοκληρώθηκε');
    } catch {
      toast.error('Αποτυχία ενημέρωσης');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Συντονισμός Τμημάτων</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Ειδοποιήστε τα τμήματα από την εμπορική πολιτική σε ένα βήμα — οι λεπτομερείς εργασίες είναι προαιρετικές.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            variant="primary"
            icon={<Zap size={15} />}
            title="Καταχώρηση ενεργής εμπορικής πολιτικής — ειδοποίηση τμημάτων"
            onClick={() => { setShowDecisionForm(true); setTaskFromDecision(null); }}
          >
            Νέα Εμπορική Πολιτική
          </Button>
          <Button
            variant="secondary"
            icon={<Plus size={15} />}
            title="Υποβολή πρότασης τμήματος προς έγκριση"
            onClick={() => setShowProposalForm(true)}
          >
            Προτάσεις Τμημάτων
          </Button>
          <Button
            variant="ghost"
            icon={<Activity size={15} />}
            title="Χρονολογική ροή ενεργειών και ειδοποιήσεων"
            onClick={() => setShowActivityDrawer(true)}
          >
            Ροή Ενεργειών
          </Button>
        </div>
      </div>

      {/* Zone A — Last Briefing bar */}
      {decisionsLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : lastBriefing ? (
        <div
          className="flex items-center gap-4 px-5 py-4 bg-[#111827] rounded-xl cursor-pointer group"
          onClick={() => setSelectedDecision(lastBriefing)}
        >
          <div className="w-2 h-2 rounded-full bg-[var(--nts-accent)] shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white/50 mb-0.5 uppercase tracking-wider">Τελευταίο Briefing</p>
            <p className="font-semibold text-white truncate">{lastBriefing.title}</p>
            <p className="text-xs text-white/40 mt-0.5">
              {lastBriefing.createdByName && `${lastBriefing.createdByName} · `}
              {new Date(lastBriefing.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' })}
              {lastBriefing.targetDepartments && lastBriefing.targetDepartments.length > 0 && (
                ` · ${lastBriefing.targetDepartments.map(d => DEPT_LABELS[d]).join(', ')}`
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 text-white/50 group-hover:text-white/80 transition-colors shrink-0">
            <span className="text-xs hidden sm:block">Λεπτομέρειες</span>
            <ChevronRight size={16} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-5 py-4 bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-xl text-[#9CA3AF]">
          <Zap size={18} className="shrink-0" />
          <p className="text-sm">Δεν υπάρχει ενεργό briefing. Δημιουργήστε την πρώτη εμπορική πολιτική.</p>
        </div>
      )}

      {/* Zone B — Two columns: Active Decisions + Proposals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Active Decisions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111827]">
              Νέα Εμπορική Πολιτική
              <span className="ml-2 text-xs font-normal text-[#9CA3AF]">({activeDecisions.length})</span>
            </h2>
          </div>
          <div className="space-y-2">
            {activeDecisions.length === 0 && (
              <div className="text-center py-8 text-[#D1D5DB] text-sm bg-[#F9FAFB] rounded-xl border border-dashed border-[#E5E7EB]">
                Καμία ενεργή εμπορική πολιτική
              </div>
            )}
            {activeDecisions.map(d => (
              <ActiveDecisionRow
                key={d.id}
                decision={d}
                isSelected={selectedDecision?.id === d.id}
                onSelect={() => setSelectedDecision(d)}
              />
            ))}
          </div>
        </div>

        {/* Right: Incoming Proposals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111827]">
              Προτάσεις Τμημάτων
              {proposals.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-[#8B5CF6] text-white">{proposals.length}</span>
              )}
            </h2>
          </div>
          <div className="space-y-2">
            {proposals.length === 0 && (
              <div className="text-center py-8 text-[#D1D5DB] text-sm bg-[#F9FAFB] rounded-xl border border-dashed border-[#E5E7EB]">
                Καμία πρόταση τμήματος
              </div>
            )}
            {proposals.map(d => (
              <ProposalRow
                key={d.id}
                decision={d}
                onApprove={() => handleApproveProposal(d)}
                onReject={() => handleRejectProposal(d)}
                onSelect={() => setSelectedDecision(d)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Zone C — Pending Tasks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#111827]">
            Εκκρεμείς Εργασίες
            <span className="ml-2 text-xs font-normal text-[#9CA3AF]">({pendingTasks.length})</span>
          </h2>
          <button
            onClick={() => { setShowTaskForm(true); setTaskFromDecision(null); }}
            className="flex items-center gap-1 text-xs text-[var(--nts-accent)] hover:underline"
          >
            <Plus size={12} /> Νέα εργασία
          </button>
        </div>

        {tasksLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : pendingTasks.length === 0 ? (
          <div className="text-center py-8 text-[#D1D5DB] text-sm bg-[#F9FAFB] rounded-xl border border-dashed border-[#E5E7EB]">
            Όλες οι εργασίες έχουν ολοκληρωθεί 🎉
          </div>
        ) : (
          <div className="bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] overflow-hidden">
            {pendingTasks.map((t, idx) => (
              <TaskRow
                key={t.id}
                task={t}
                isLast={idx === pendingTasks.length - 1}
                isSelected={selectedTask?.id === t.id}
                onSelect={() => setSelectedTask(t)}
                onComplete={() => handleCompleteTask(t)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showDecisionForm && (
        <DecisionFormModal onClose={() => setShowDecisionForm(false)} />
      )}
      {showProposalForm && (
        <DecisionFormModal isProposal onClose={() => setShowProposalForm(false)} />
      )}
      {showTaskForm && (
        <TaskFormModal
          linkedDecision={taskFromDecision}
          onClose={() => { setShowTaskForm(false); setTaskFromDecision(null); }}
        />
      )}

      {/* ── Side Panels ── */}
      {selectedDecision && (
        <DetailPanel
          title={selectedDecision.title}
          onClose={() => setSelectedDecision(null)}
          entityType="decision"
          entityId={selectedDecision.id}
          entityTitle={selectedDecision.title}
        >
          <DecisionDetail
            decision={selectedDecision}
            onUpdate={(d) => setSelectedDecision(d)}
            onCreateTask={() => {
              const dec = selectedDecision;
              if (!dec) return;
              setTaskFromDecision(dec);
              setShowTaskForm(true);
              setSelectedDecision(null);
            }}
          />
        </DetailPanel>
      )}

      {selectedTask && (
        <DetailPanel
          title={selectedTask.title}
          onClose={() => setSelectedTask(null)}
          entityType="task"
          entityId={selectedTask.id}
          entityTitle={selectedTask.title}
        >
          <TaskDetail task={selectedTask} onUpdate={setSelectedTask} />
        </DetailPanel>
      )}

      {/* Activity Drawer */}
      {showActivityDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowActivityDrawer(false)} />
          <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
              <h2 className="font-semibold text-[#111827] text-sm">Ροή Ενεργειών</h2>
              <button onClick={() => setShowActivityDrawer(false)} className="p-1 hover:bg-[#F3F4F6] rounded-lg transition-colors">
                <X size={18} className="text-[#6B7280]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ActivityFeed />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Active Decision Row ──────────────────────────────────────────────────────

function ActiveDecisionRow({ decision: d, isSelected, onSelect }: { decision: Decision; isSelected: boolean; onSelect: () => void }) {
  const cat = CATEGORY_META[d.category];
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-3 px-3.5 py-3 bg-white rounded-xl border transition-all hover:shadow-sm ${
        isSelected ? 'ring-2 ring-[var(--nts-accent)] border-transparent' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
      }`}
    >
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#111827] truncate">{d.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-medium" style={{ color: cat.color }}>{cat.label}</span>
          {d.targetDepartments && d.targetDepartments.length > 0 && (
            <span className="text-[10px] text-[#9CA3AF]">· {d.targetDepartments.map(dep => DEPT_LABELS[dep]).join(', ')}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-[10px] text-[#9CA3AF]">
        {new Date(d.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}
      </div>
      <ChevronRight size={14} className="text-[#D1D5DB] shrink-0" />
    </button>
  );
}

// ── Proposal Row ─────────────────────────────────────────────────────────────

function ProposalRow({ decision: d, onApprove, onReject, onSelect }: {
  decision: Decision;
  onApprove: () => void;
  onReject: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 bg-white rounded-xl border border-[#E5E7EB] hover:border-[#D1D5DB] transition-all">
      <div className="w-1 self-stretch rounded-full shrink-0 bg-[#8B5CF6]" />
      <button className="flex-1 min-w-0 text-left" onClick={onSelect}>
        <p className="text-sm font-medium text-[#111827] truncate">{d.title}</p>
        <p className="text-[10px] text-[#9CA3AF] mt-0.5">
          {d.createdByName && `${d.createdByName} · `}
          {new Date(d.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}
        </p>
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onReject(); }}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-[#EF4444] border border-[#FEE2E2] rounded-lg hover:bg-[#FEF2F2] transition-colors"
        >
          <ThumbsDown size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#10B981] rounded-lg hover:bg-[#059669] transition-colors"
        >
          <ThumbsUp size={12} /> Έγκριση
        </button>
      </div>
    </div>
  );
}

// ── Task Row (flat list) ─────────────────────────────────────────────────────

function TaskRow({ task: t, isLast, isSelected, onSelect, onComplete }: {
  task: CoordinationTask;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onComplete: () => void;
}) {
  const pri = PRIORITY_META[t.priority];
  const statusColor = t.status === 'in_progress' ? '#3B82F6' : '#F59E0B';
  const statusLabel = t.status === 'in_progress' ? 'Σε εξέλιξη' : 'Εκκρεμεί';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/70 transition-colors ${
        !isLast ? 'border-b border-[#E5E7EB]' : ''
      } ${isSelected ? 'bg-white ring-1 ring-inset ring-[var(--nts-accent)]' : ''}`}
      onClick={onSelect}
    >
      {/* Complete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onComplete(); }}
        className="w-5 h-5 rounded-full border-2 border-[#D1D5DB] hover:border-[#10B981] hover:bg-[#10B981]/10 transition-colors flex items-center justify-center shrink-0 group"
        title="Ολοκλήρωση"
      >
        <CheckCircle2 size={11} className="text-transparent group-hover:text-[#10B981] transition-colors" />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#111827] truncate">{t.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {t.assignedDepartment && (
            <span className="text-[10px] text-[#6B7280]">{DEPT_LABELS[t.assignedDepartment]}</span>
          )}
          {t.assignedToName && (
            <span className="text-[10px] text-[#9CA3AF]">· {t.assignedToName}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: statusColor, backgroundColor: `${statusColor}15` }}>
          {statusLabel}
        </span>
        <Flag size={11} style={{ color: pri.color }} />
        {t.dueDate && (
          <span className="text-[10px] text-[#9CA3AF] hidden sm:block">
            {new Date(t.dueDate).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Decision Detail ─────────────────────────────────────────────────────────

function DecisionDetail({ decision: d, onUpdate, onCreateTask }: { decision: Decision; onUpdate: (d: Decision) => void; onCreateTask: () => void }) {
  const { invalidate } = useDecisions();
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const toast = useToast();

  const handleStatusChange = async (status: DecisionStatus) => {
    try {
      await DecisionsService.update(d.id, { status });
      if (status === 'completed' && currentBrand && user) {
        await logAndNotify(
          currentBrand.id, user.uid, user.displayName || user.email || '',
          'decision_completed', 'decision', d.id,
          `Η εμπορική πολιτική "${d.title}" ολοκληρώθηκε`, 'Εμπορική πολιτική ολοκληρώθηκε', d.title,
          d.targetDepartments as BrandDepartment[]
        );
      }
      invalidate();
      onUpdate({ ...d, status });
      toast.success('Ενημερώθηκε');
    } catch {
      toast.error('Αποτυχία ενημέρωσης');
    }
  };

  const cat = CATEGORY_META[d.category];
  const pri = PRIORITY_META[d.priority];

  return (
    <div className="space-y-5 p-4">
      {d.targetDepartments && d.targetDepartments.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide mb-2">Προς τμήματα</p>
          <div className="flex flex-wrap gap-1.5">
            {d.targetDepartments.map((dep) => (
              <span key={dep} className="text-xs px-2.5 py-1 rounded-md bg-[#F3F4F6] text-[#111827]">
                {DEPT_LABELS[dep] || dep}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wide mb-2">
          {d.status === 'proposal' ? 'Κείμενο πρότασης τμήματος' : 'Κείμενο εμπορικής πολιτικής'}
        </p>
        <div className="text-sm text-[#111827] leading-relaxed rounded-lg bg-[#FAFAFA] border border-[#F3F4F6] px-3 py-2.5 min-h-[3rem]">
          {d.description?.trim() ? (
            <FormattedProse content={d.description} variant="compact" />
          ) : (
            '—'
          )}
        </div>
      </div>

      <p className="text-[11px] text-[#9CA3AF]">
        {STATUS_META[d.status].label} · {cat.label} · {pri.label}
        {' · '}
        {new Date(d.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' })}
        {d.createdByName && ` · ${d.createdByName}`}
      </p>

      <div className="flex items-center gap-2">
        <label htmlFor={`dec-status-${d.id}`} className="text-xs text-[#6B7280] shrink-0">
          Κατάσταση
        </label>
        <select
          id={`dec-status-${d.id}`}
          value={d.status}
          onChange={(e) => handleStatusChange(e.target.value as DecisionStatus)}
          className="flex-1 min-w-0 text-sm border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white text-[#374151]"
        >
          {(['proposal', 'draft', 'active', 'completed', 'archived'] as DecisionStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>

      <details className="rounded-lg border border-[#E5E7EB] bg-white">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-[var(--nts-accent)] list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <span className="text-[#9CA3AF] select-none">▸</span>
          Νέα ειδοποίηση στα τμήματα
        </summary>
        <div className="px-3 pb-3 border-t border-[#F3F4F6] pt-3">
          <DecisionNotifyStrip decision={d} variant="embedded" />
        </div>
      </details>

      <details className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA]">
        <summary className="cursor-pointer px-3 py-2.5 text-xs text-[#6B7280] list-none [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <Plus size={14} className="text-[var(--nts-accent)] shrink-0" />
          {d.status === 'proposal'
            ? 'Εργασία από αυτή την πρόταση τμήματος'
            : 'Εργασία από αυτή την εμπορική πολιτική'}
        </summary>
        <div className="px-3 pb-3 pt-1">
          <button
            type="button"
            onClick={onCreateTask}
            className="text-sm font-medium text-[var(--nts-accent)] hover:underline"
          >
            Άνοιγμα φόρμας εργασίας
          </button>
        </div>
      </details>
    </div>
  );
}

// ── Task Detail ─────────────────────────────────────────────────────────────

function TaskDetail({ task: t, onUpdate }: { task: CoordinationTask; onUpdate: (t: CoordinationTask) => void }) {
  const { invalidate } = useTasks();
  const toast = useToast();
  const pri = PRIORITY_META[t.priority];

  const handleStatusChange = async (status: TaskStatus) => {
    try {
      await TasksService.update(t.id, { status });
      invalidate();
      onUpdate({ ...t, status });
      toast.success('Ενημερώθηκε');
    } catch {
      toast.error('Αποτυχία ενημέρωσης');
    }
  };

  return (
    <div className="space-y-4 p-4">
      {t.description && (
        <div className="text-sm text-[#374151]">
          <FormattedProse content={t.description} variant="compact" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[#9CA3AF] mb-0.5">Προτεραιότητα</p>
          <p className="flex items-center gap-1" style={{ color: pri.color }}>
            <Flag size={13} /> {pri.label}
          </p>
        </div>
        {t.assignedDepartment && (
          <div>
            <p className="text-xs text-[#9CA3AF] mb-0.5">Τμήμα</p>
            <p className="text-[#374151]">{DEPT_LABELS[t.assignedDepartment] || t.assignedDepartment}</p>
          </div>
        )}
        {t.assignedToName && (
          <div>
            <p className="text-xs text-[#9CA3AF] mb-0.5">Ανάθεση σε</p>
            <p className="text-[#374151]">{t.assignedToName}</p>
          </div>
        )}
        {t.dueDate && (
          <div>
            <p className="text-xs text-[#9CA3AF] mb-0.5">Προθεσμία</p>
            <p className="text-[#374151]">{new Date(t.dueDate).toLocaleDateString('el-GR')}</p>
          </div>
        )}
      </div>

      {t.linkedDecisionTitle && (
        <div className="text-xs text-[#6B7280] flex items-center gap-1">
          <MessageSquare size={12} /> Σχετική καταχώρηση: {t.linkedDecisionTitle}
        </div>
      )}

      <div className="flex gap-2 flex-wrap pt-2">
        <p className="text-xs text-[#9CA3AF] w-full mb-1">Κατάσταση:</p>
        {(['pending', 'in_progress', 'done', 'cancelled'] as TaskStatus[]).map(s => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            disabled={t.status === s}
            className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
              t.status === s
                ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] font-medium'
                : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
            }`}
          >
            {STATUS_META[s].label}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-[#9CA3AF] pt-2 border-t border-[#F3F4F6]">
        Δημιουργήθηκε: {new Date(t.createdAt).toLocaleDateString('el-GR')} {t.createdByName && `απo ${t.createdByName}`}
      </div>
    </div>
  );
}

// ── Activity Feed ───────────────────────────────────────────────────────────

function ActivityFeed() {
  const { activity, isLoading } = useActivity();

  const ACTIVITY_ICONS: Record<string, { icon: typeof MessageSquare; color: string }> = {
    decision_created: { icon: MessageSquare, color: '#3B82F6' },
    decision_updated: { icon: Pencil, color: '#F59E0B' },
    decision_completed: { icon: CheckCircle2, color: '#10B981' },
    task_created: { icon: CheckSquare, color: '#3B82F6' },
    task_assigned: { icon: Users, color: '#8B5CF6' },
    task_completed: { icon: CheckCircle2, color: '#10B981' },
    comment_added: { icon: MessageSquare, color: '#6B7280' },
    member_joined: { icon: Users, color: '#EC4899' },
  };

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;

  if (activity.length === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-8 text-[#9CA3AF]">
          <Activity size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Δεν υπάρχει δραστηριότητα ακόμη</p>
          <p className="text-sm mt-1">Η ροή ενεργειών θα ενημερώνεται αυτόματα</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-5 top-0 bottom-0 w-px bg-[#E5E7EB]" />
      <div className="space-y-4">
        {activity.map(a => {
          const meta = ACTIVITY_ICONS[a.type] || { icon: Activity, color: '#9CA3AF' };
          const Icon = meta.icon;
          return (
            <div key={a.id} className="flex gap-3 relative">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10"
                style={{ backgroundColor: `${meta.color}15` }}
              >
                <Icon size={16} style={{ color: meta.color }} />
              </div>
              <div className="pt-1.5">
                <p className="text-sm text-[#374151]">{a.summary}</p>
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                  {new Date(a.createdAt).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail Side Panel ───────────────────────────────────────────────────────

function DetailPanel({ title, onClose, children, entityType, entityId, entityTitle }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  entityType: 'decision' | 'task';
  entityId: string;
  entityTitle: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
          <h2 className="font-semibold text-[#111827] text-sm truncate">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#F3F4F6] rounded-lg transition-colors">
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        {/* Detail content */}
        <div className="overflow-y-auto border-b border-[#F3F4F6]">
          {children}
        </div>

        {/* Comments */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-2 text-xs font-semibold text-[#6B7280] uppercase tracking-wider border-b border-[#F3F4F6]">
            {entityType === 'decision' ? 'Διάλογος' : 'Σχόλια'}
          </div>
          <CommentsPanel entityType={entityType} entityId={entityId} entityTitle={entityTitle} />
        </div>
      </div>
    </div>
  );
}

// ── Decision Form Modal ─────────────────────────────────────────────────────

function DecisionFormModal({ onClose, isProposal = false }: { onClose: () => void; isProposal?: boolean }) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { invalidate } = useDecisions();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DecisionCategory>('general');
  const [priority, setPriority] = useState<DecisionPriority>('medium');
  const decisionStatus: DecisionStatus = isProposal ? 'proposal' : 'active';
  const [targetDepts, setTargetDepts] = useState<BrandDepartment[]>([]);

  const toggleDept = (d: BrandDepartment) => {
    setTargetDepts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !currentBrand || !user) return;
    setSubmitting(true);
    try {
      const authorName = user.displayName || user.email || '';
      const id = await DecisionsService.create({
        brandId: currentBrand.id,
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        status: decisionStatus,
        targetDepartments: targetDepts,
        createdBy: user.uid,
        createdByName: authorName,
      });
      const label = isProposal ? 'πρόταση τμήματος' : 'εμπορική πολιτική';
      await logAndNotify(
        currentBrand.id, user.uid, authorName,
        'decision_created', 'decision', id,
        `${authorName} δημιούργησε νέα ${label}: "${title.trim()}"`,
        isProposal ? 'Νέα πρόταση τμήματος' : 'Νέα εμπορική πολιτική',
        title.trim(),
        targetDepts
      );
      invalidate();
      toast.success(isProposal ? 'Η πρόταση υποβλήθηκε' : 'Η εμπορική πολιτική καταχωρήθηκε');
      onClose();
    } catch (err) {
      toast.error('Σφάλμα δημιουργίας');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[#F3F4F6]">
          <h2 className="font-semibold text-[#111827]">{isProposal ? 'Νέα πρόταση τμήματος' : 'Νέα εμπορική πολιτική'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#F3F4F6] rounded-lg">
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-[#374151] mb-1 block">Τίτλος *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="π.χ. Έκπτωση 20% στην κατηγορία X για Q2"
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#374151] mb-1 block">Περιγραφή</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder={isProposal ? 'Αναλυτική περιγραφή της πρότασης τμήματος...' : 'Αναλυτική περιγραφή της εμπορικής πολιτικής...'}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[var(--nts-accent)] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Κατηγορία</label>
              <select value={category} onChange={e => setCategory(e.target.value as DecisionCategory)} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg">
                {Object.entries(CATEGORY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Προτεραιότητα</label>
              <select value={priority} onChange={e => setPriority(e.target.value as DecisionPriority)} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg">
                {Object.entries(PRIORITY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#374151] mb-1.5 block">Αφορά τμήματα</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(DEPT_LABELS) as [BrandDepartment, string][]).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleDept(k)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                    targetDepts.includes(k)
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] font-medium'
                      : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-[#F3F4F6]">
          <Button variant="secondary" onClick={onClose}>Ακύρωση</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!title.trim() || submitting}>
            {submitting ? 'Αποθήκευση...' : 'Δημιουργία'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Task Form Modal ─────────────────────────────────────────────────────────

function TaskFormModal({ linkedDecision, onClose }: { linkedDecision: Decision | null; onClose: () => void }) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const { members } = useBrandMembers();
  const { invalidate: invalidateTasks } = useTasks();
  const { invalidate: invalidateDecisions } = useDecisions();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignedDepartment, setAssignedDepartment] = useState<BrandDepartment | ''>('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = async () => {
    if (!title.trim() || !currentBrand || !user) return;
    setSubmitting(true);
    try {
      const authorName = user.displayName || user.email || '';
      const assignedMember = members.find(m => m.userId === assignedTo);
      const id = await TasksService.create({
        brandId: currentBrand.id,
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'pending',
        priority,
        assignedTo: assignedTo || undefined,
        assignedToName: assignedMember?.displayName || undefined,
        assignedDepartment: (assignedDepartment as BrandDepartment) || undefined,
        linkedDecisionId: linkedDecision?.id || undefined,
        linkedDecisionTitle: linkedDecision?.title || undefined,
        dueDate: dueDate || undefined,
        createdBy: user.uid,
        createdByName: authorName,
      });

      if (linkedDecision) {
        await DecisionsService.update(linkedDecision.id, { taskCount: (linkedDecision.taskCount || 0) + 1 });
        invalidateDecisions();
      }

      await logAndNotify(
        currentBrand.id, user.uid, authorName,
        'task_created', 'task', id,
        `${authorName} δημιούργησε εργασία: "${title.trim()}"`,
        'Νέα εργασία', title.trim(),
        assignedDepartment ? [assignedDepartment as BrandDepartment] : undefined
      );

      invalidateTasks();
      toast.success('Η εργασία δημιουργήθηκε');
      onClose();
    } catch (err) {
      toast.error('Σφάλμα δημιουργίας');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[#F3F4F6]">
          <h2 className="font-semibold text-[#111827]">Νέα εργασία</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#F3F4F6] rounded-lg">
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {linkedDecision && (
            <div className="text-xs text-[#6B7280] bg-[#F9FAFB] rounded-lg px-3 py-2 flex items-center gap-1.5">
              <MessageSquare size={12} /> Συνδεδεμένη{' '}
              {linkedDecision.status === 'proposal' ? 'πρόταση τμήματος' : 'εμπορική πολιτική'}:{' '}
              <strong>{linkedDecision.title}</strong>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[#374151] mb-1 block">Τίτλος *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="π.χ. Δημιουργία campaign για την έκπτωση"
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#374151] mb-1 block">Περιγραφή</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[var(--nts-accent)] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Τμήμα</label>
              <select value={assignedDepartment} onChange={e => setAssignedDepartment(e.target.value as BrandDepartment)} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg">
                <option value="">Κανένα</option>
                {(Object.entries(DEPT_LABELS) as [BrandDepartment, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Προτεραιότητα</label>
              <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg">
                {Object.entries(PRIORITY_META).filter(([k]) => k !== 'urgent').map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Ανάθεση σε</label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg">
                <option value="">Κανένας</option>
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>{m.displayName || m.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#374151] mb-1 block">Προθεσμία</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[var(--nts-accent)]"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-[#F3F4F6]">
          <Button variant="secondary" onClick={onClose}>Ακύρωση</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!title.trim() || submitting}>
            {submitting ? 'Αποθήκευση...' : 'Δημιουργία'}
          </Button>
        </div>
      </div>
    </div>
  );
}
