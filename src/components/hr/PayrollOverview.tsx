import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardHeader, KPICard } from '../common';
import { TrendingDown, Users } from 'lucide-react';
import { useHREmployees } from '../../hooks/useHRData';

interface PayrollOverviewProps {
  totalRevenue?: number;
}

const DEPT_COLORS: Record<string, string> = {
  Διοίκηση: '#111827',
  Εμπορική: '#f97316',
  Marketing: '#3b82f6',
  Logistics: '#10b981',
  Τεχνικό: '#8b5cf6',
  Λογιστήριο: '#f59e0b',
  Άλλο: '#9ca3af',
};

export function PayrollOverview({ totalRevenue }: PayrollOverviewProps) {
  const { employees, activeEmployees, totalMonthlyCost, isLoading } = useHREmployees();

  const byDepartment = useMemo(() => {
    const map: Record<string, number> = {};
    activeEmployees.forEach((e) => {
      map[e.department] = (map[e.department] ?? 0) + e.monthlyCost;
    });
    return Object.entries(map)
      .map(([dept, cost]) => ({ dept, cost }))
      .sort((a, b) => b.cost - a.cost);
  }, [activeEmployees]);

  const annualCost = totalMonthlyCost * 12;
  const hrCostRatio = totalRevenue && totalRevenue > 0 ? (totalMonthlyCost / totalRevenue) * 100 : null;
  const revenuePerEmployee = totalRevenue && activeEmployees.length > 0 ? totalRevenue / activeEmployees.length : null;

  if (isLoading) return <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPICard
          index={0}
          kpi={{
            label: 'Εργαζόμενοι (ενεργοί)',
            value: `${activeEmployees.length}`,
            changeLabel: `${employees.length} σύνολο`,
            tooltip: 'Αριθμός εργαζομένων με κατάσταση "Ενεργός".',
          }}
        />
        <KPICard
          index={1}
          kpi={{
            label: 'Μηνιαίο κόστος',
            value: `€${totalMonthlyCost.toLocaleString('el-GR')}`,
            changeLabel: `€${annualCost.toLocaleString('el-GR')} / έτος`,
            tooltip: 'Άθροισμα μηνιαίου κόστους όλων των ενεργών εργαζομένων.',
          }}
        />
        <KPICard
          index={2}
          kpi={{
            label: 'HR Cost %',
            value: hrCostRatio != null ? `${hrCostRatio.toFixed(1)}%` : '—',
            changeLabel: 'επί μηνιαίων εσόδων',
            trend: hrCostRatio != null ? (hrCostRatio > 40 ? 'down' : 'up') : undefined,
            tooltip: 'Ποσοστό μισθοδοσίας επί των εσόδων περιόδου. Healthy range για SME: 25–40%.',
          }}
        />
        <KPICard
          index={3}
          kpi={{
            label: 'Revenue / Εργαζόμενο',
            value: revenuePerEmployee != null ? `€${Math.round(revenuePerEmployee).toLocaleString('el-GR')}` : '—',
            changeLabel: 'ανά ενεργό μέλος',
            trend: 'up',
            tooltip: 'Μηνιαία έσοδα διαιρεμένα με τον αριθμό ενεργών εργαζομένων — δείκτης παραγωγικότητας.',
          }}
        />
      </div>

      {byDepartment.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Κόστος ανά Τμήμα"
            subtitle="Μηνιαίο κόστος μισθοδοσίας"
            icon={<TrendingDown size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDepartment} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef0f3" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="dept" tick={{ fontSize: 12 }} width={80} />
                <ReTooltip formatter={(v) => [`€${Number(v).toLocaleString('el-GR')}`, 'Κόστος']} />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 divide-y divide-[#eef0f3]">
            {byDepartment.map((row) => (
              <div key={row.dept} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: DEPT_COLORS[row.dept] ?? '#9ca3af' }} />
                  <span className="text-sm text-[var(--nts-charcoal)]">{row.dept}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-[var(--nts-charcoal)]">€{row.cost.toLocaleString('el-GR')}</span>
                  <span className="text-xs text-[var(--nts-medium-gray)]">
                    {totalMonthlyCost > 0 ? `${((row.cost / totalMonthlyCost) * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeEmployees.length === 0 && (
        <Card padding="lg">
          <div className="flex flex-col items-center py-8 text-center">
            <Users size={36} className="mb-3 text-[var(--nts-medium-gray)]/40" />
            <p className="text-sm text-[var(--nts-medium-gray)]">Προσθέστε εργαζόμενους στην καρτέλα <strong>Ομάδα</strong> για να δείτε ανάλυση μισθοδοσίας.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
