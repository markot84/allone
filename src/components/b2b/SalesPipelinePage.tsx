import { Handshake, KanbanSquare, Megaphone, Target, Users } from 'lucide-react';
import { Button, Card, KPICard, PageHeader } from '../common';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useBrandMembers, useTasks } from '../../hooks/useCoordination';

interface SalesPipelinePageProps {
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
}

export function SalesPipelinePage({ onSectionChange }: SalesPipelinePageProps = {}) {
  const { members } = useBrandMembers();
  const { tasks } = useTasks();
  const { activeStrategy, getStrategyName } = useActiveStrategy();

  const salesMembers = members.filter((member) => member.department === 'commercial' || member.department === 'management');
  const openTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');
  const overdueTasks = tasks.filter((task) => task.dueDate && task.status !== 'done' && task.dueDate < new Date().toISOString().slice(0, 10));

  const pipelineStages = [
    {
      title: 'Target Accounts',
      value: salesMembers.length > 0 ? `${salesMembers.length * 12}` : '24',
      note: 'Λίστα λογαριασμών προς προσέγγιση ανά εμπορικό μέλος.',
    },
    {
      title: 'Qualified Opportunities',
      value: openTasks.length > 0 ? `${openTasks.length}` : '8',
      note: 'Ενεργά opportunities με συγκεκριμένο next step και owner.',
    },
    {
      title: 'Proposal / Negotiation',
      value: overdueTasks.length > 0 ? `${Math.max(2, overdueTasks.length)}` : '3',
      note: 'Deals που θέλουν follow-up, pricing ή procurement input.',
    },
    {
      title: 'Close / Rollout',
      value: activeStrategy ? '1 active motion' : 'Set owner motion',
      note: 'Commercial rollout με briefings, offer packs και εβδομαδιαίο review.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Pipeline"
        description={
          <p className="text-sm text-[var(--text-secondary)] sm:text-base">
            B2B workspace για account coverage, next-step discipline και εμπορική εκτέλεση.
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          index={0}
          kpi={{
            label: 'Commercial team',
            value: `${salesMembers.length || members.length || 0}`,
            changeLabel: 'ενεργά μέλη',
            tooltip: 'Μέλη των departments Διοίκηση και Εμπορική Διεύθυνση.',
          }}
          onClick={() => onSectionChange?.('invite')}
        />
        <KPICard
          index={1}
          kpi={{
            label: 'Open actions',
            value: `${openTasks.length}`,
            changeLabel: 'pipeline tasks',
            tooltip: 'Coordination tasks που μπορούν να λειτουργούν ως next steps του pipeline.',
          }}
          onClick={() => onSectionChange?.('coordination')}
        />
        <KPICard
          index={2}
          kpi={{
            label: 'Overdue follow-ups',
            value: `${overdueTasks.length}`,
            changeLabel: 'needs attention',
            tooltip: 'Ενέργειες που έχουν due date και δεν έχουν κλείσει.',
          }}
          onClick={() => onSectionChange?.('coordination')}
        />
        <KPICard
          index={3}
          kpi={{
            label: 'Commercial motion',
            value: activeStrategy ? getStrategyName(activeStrategy.scenarioId) : 'Not set',
            changeLabel: activeStrategy?.approvalStatus === 'implementing' ? 'active' : 'pending',
            tooltip: 'Η ενεργή στρατηγική γίνεται η εμπορική κατεύθυνση του pipeline.',
          }}
          onClick={() => onSectionChange?.('strategy')}
        />
      </div>

      <Card>
        <div className="p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl bg-[var(--nts-accent)]/10 p-2.5 text-[var(--nts-accent-text)]">
              <KanbanSquare size={18} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#1A1A1A]">Pipeline Blueprint</h3>
              <p className="text-sm text-[#6B7280]">
                Μέχρι να προστεθεί πλήρες CRM layer, το workspace δίνει το λειτουργικό template που μπορείς να τρέχεις
                μαζί με `Coordination`, `Campaigns` και `Sales Activation`.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {pipelineStages.map((stage) => (
              <div key={stage.title} className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">{stage.title}</p>
                <p className="mt-2 text-2xl font-bold text-[#1A1A1A]">{stage.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7280]">{stage.note}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[#1A1A1A]">
              <Users size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="font-semibold">Team cadence</h3>
            </div>
            <p className="text-sm leading-relaxed text-[#6B7280]">
              Τρέξε εβδομαδιαίο review με 3 buckets: stuck deals, pricing blockers, supply blockers. Το `Coordination`
              γίνεται το execution log του sales team.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('coordination')}>
              Open Coordination
            </Button>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[#1A1A1A]">
              <Megaphone size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="font-semibold">Sales activation</h3>
            </div>
            <p className="text-sm leading-relaxed text-[#6B7280]">
              Οι εμπορικές ενέργειες δεν είναι μόνο campaigns. Χτίσε outreach ανά account cluster, email nurture,
              distributor touchpoints και playbooks για την ομάδα πωλήσεων.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('channels')}>
              Open Sales Activation
            </Button>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[#1A1A1A]">
              <Target size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="font-semibold">Demand generation</h3>
            </div>
            <p className="text-sm leading-relaxed text-[#6B7280]">
              Σύνδεσε την digital ζήτηση με το pipeline. Καμπάνιες, landing pages και content πρέπει να εξυπηρετούν
              συγκεκριμένα segments και φάσεις του deal cycle.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => onSectionChange?.('campaigns')}>
              Open Campaigns
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[#1A1A1A]">
            <Handshake size={18} className="text-[var(--nts-accent-text)]" />
            <h3 className="font-semibold">Recommended operating model</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[#E5E5E5] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">1. Account owner</p>
              <p className="mt-1 text-sm text-[#6B7280]">Κάθε strategic account να έχει owner, next review date και clear commercial objective.</p>
            </div>
            <div className="rounded-lg border border-[#E5E5E5] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">2. Offer discipline</p>
              <p className="mt-1 text-sm text-[#6B7280]">Κάθε proposal να περνά από pricing, margin και availability check πριν βγει προς τον πελάτη.</p>
            </div>
            <div className="rounded-lg border border-[#E5E5E5] p-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">3. Weekly forecast</p>
              <p className="mt-1 text-sm text-[#6B7280]">Η διοίκηση να βλέπει weekly forecast, blocked opportunities και top expansion plays σε ένα σημείο.</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
