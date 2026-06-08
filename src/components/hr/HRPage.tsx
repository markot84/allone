import { useState } from 'react';
import { Users, TrendingDown, Calendar, Activity, Download } from 'lucide-react';
import { PageHeader, Button } from '../common';
import { useHREmployees } from '../../hooks/useHRData';
import { EmployeeRoster } from './EmployeeRoster';
import { PayrollOverview } from './PayrollOverview';
import { LeaveTracker } from './LeaveTracker';
import { TaskPerformance } from './TaskPerformance';

type HRTab = 'roster' | 'payroll' | 'leaves' | 'performance';

const TABS: { id: HRTab; label: string; icon: React.ElementType }[] = [
  { id: 'roster', label: 'Ομάδα', icon: Users },
  { id: 'payroll', label: 'Μισθοδοσία', icon: TrendingDown },
  { id: 'leaves', label: 'Άδειες', icon: Calendar },
  { id: 'performance', label: 'Απόδοση', icon: Activity },
];

interface HRPageProps {
  totalRevenue?: number;
}

export function HRPage({ totalRevenue }: HRPageProps = {}) {
  const [activeTab, setActiveTab] = useState<HRTab>('roster');
  const { employees, activeEmployees, totalMonthlyCost } = useHREmployees();

  const handleExport = () => {
    const rows = [
      ['Ονοματεπώνυμο', 'Ρόλος', 'Τμήμα', 'Μηνιαίο κόστος', 'Ημ/νία έναρξης', 'Κατάσταση'],
      ...employees.map((e) => [e.name, e.role, e.department, `€${e.monthlyCost}`, e.startDate, e.status]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hr-employees.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">People & HR</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Διαχείριση ομάδας, μισθοδοσία, αδειοδότηση και παρακολούθηση απόδοσης.
          </p>
        }
        actions={
          <Button variant="secondary" onClick={handleExport} disabled={employees.length === 0}>
            <Download size={15} className="mr-1.5" /> Export CSV
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-sm text-[var(--nts-medium-gray)]">
        <span><strong className="text-[var(--nts-charcoal)]">{activeEmployees.length}</strong> ενεργοί εργαζόμενοι</span>
        <span className="text-[#d1d5db]">|</span>
        <span>Μηνιαίο κόστος <strong className="text-[var(--nts-charcoal)]">€{totalMonthlyCost.toLocaleString('el-GR')}</strong></span>
        {totalRevenue && totalRevenue > 0 ? (
          <>
            <span className="text-[#d1d5db]">|</span>
            <span>HR Cost % <strong className="text-[var(--nts-charcoal)]">{((totalMonthlyCost / totalRevenue) * 100).toFixed(1)}%</strong></span>
          </>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[#eef0f3] bg-[#f9fafb] p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 px-3 text-sm font-medium transition-all',
              activeTab === id
                ? 'bg-white text-[var(--nts-charcoal)] shadow-sm'
                : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]',
            ].join(' ')}
          >
            <Icon size={15} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'roster' && <EmployeeRoster />}
      {activeTab === 'payroll' && <PayrollOverview totalRevenue={totalRevenue} />}
      {activeTab === 'leaves' && <LeaveTracker />}
      {activeTab === 'performance' && <TaskPerformance />}
    </div>
  );
}
