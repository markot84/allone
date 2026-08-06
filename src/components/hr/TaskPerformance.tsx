import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardHeader } from '../common';
import { useTasks, useBrandMembers } from '../../hooks/useCoordination';
import { CheckCircle2, Activity } from 'lucide-react';

export function TaskPerformance() {
  const { tasks, isLoading: tasksLoading } = useTasks();
  const { members, isLoading: membersLoading } = useBrandMembers();

  const stats = useMemo(() => {
    return members
      .filter((m) => m.displayName || m.email)
      .map((member) => {
        const name = member.displayName ?? member.email ?? '—';
        const assigned = tasks.filter((t) => t.assignedTo === member.id);
        const done = assigned.filter((t) => t.status === 'done');
        const overdue = assigned.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));
        const rate = assigned.length > 0 ? Math.round((done.length / assigned.length) * 100) : null;
        return { name: name.split(' ')[0], fullName: name, assigned: assigned.length, done: done.length, overdue: overdue.length, rate };
      })
      .filter((s) => s.assigned > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  }, [tasks, members]);

  const isLoading = tasksLoading || membersLoading;

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length;
  const globalRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  if (isLoading) return <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Completion rate', value: `${globalRate}%`, sub: `${doneTasks} / ${totalTasks} tasks` },
          { label: 'Εκκρεμή tasks', value: `${tasks.filter((t) => t.status !== 'done').length}`, sub: 'σε εξέλιξη' },
          { label: 'Καθυστερημένα', value: `${overdueTasks}`, sub: 'χρειάζονται προσοχή' },
        ].map((item, i) => (
          <Card key={i} padding="lg">
            <p className="text-[13px] font-medium text-[var(--nts-medium-gray)]">{item.label}</p>
            <p className="mt-1 text-3xl font-bold font-mono text-[var(--nts-charcoal)]">{item.value}</p>
            <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{item.sub}</p>
          </Card>
        ))}
      </div>

      {stats.length > 0 ? (
        <Card padding="lg">
          <CardHeader
            title="Απόδοση ανά Μέλος"
            subtitle="Βάσει tasks από το Coordination"
            icon={<Activity size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <ReTooltip
                  formatter={(_v: unknown, _n: unknown, props: { payload?: { fullName?: string; assigned?: number; done?: number; rate?: number | null } }) => {
                    const p = props.payload ?? {};
                    return [`${p.done ?? 0}/${p.assigned ?? 0} tasks (${p.rate ?? 0}%)`, p.fullName ?? ''];
                  }}
                />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                  {stats.map((s, i) => (
                    <Cell key={i} fill={s.rate != null && s.rate >= 70 ? '#10b981' : s.rate != null && s.rate >= 40 ? '#f97316' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 divide-y divide-[var(--border)]">
            {stats.map((s) => (
              <div key={s.fullName} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-[var(--nts-charcoal)]">{s.fullName}</p>
                  <p className="text-xs text-[var(--nts-medium-gray)]">{s.done} ολοκλ. / {s.assigned} σύνολο · {s.overdue} καθυστ.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${s.rate ?? 0}%`, background: s.rate != null && s.rate >= 70 ? '#10b981' : s.rate != null && s.rate >= 40 ? '#f97316' : '#ef4444' }} />
                  </div>
                  <span className="text-sm font-mono font-bold text-[var(--nts-charcoal)] w-10 text-right">{s.rate ?? 0}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card padding="lg">
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 size={36} className="mb-3 text-[var(--nts-medium-gray)]/40" />
            <p className="text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν εκχωρημένα tasks. Ανάθεσε tasks σε μέλη από το <strong>Coordination</strong> για να εμφανιστεί η απόδοση εδώ.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
