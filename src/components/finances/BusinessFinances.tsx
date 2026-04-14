import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Euro, Trash2, TrendingUp, Calendar } from 'lucide-react';
import { Card, Button, Spinner, useToast, Tooltip, PageHeader } from '../common';
import { useOrganic, useBrand } from '../../hooks';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useGA4Data } from '../../hooks/useGA4Data';
import { organicRevenueForSingleDay } from '../../utils/roiUtils';
import { FirestoreService } from '../../services/firestore';
import { formatCurrency, formatNumber } from '../../utils/format';
import type { OrganicRevenue } from '../../types';

interface BusinessFinancesProps {
  onSectionChange?: (section: string) => void;
}

export function BusinessFinances({ onSectionChange }: BusinessFinancesProps = {}) {
  const { currentBrand } = useBrand();
  const {
    records,
    totalOrganicRevenue,
    byMonth: organicByMonth,
    hasImported,
    organicRevenueSource,
    isLoading,
  } = useOrganic();
  const { organicRevenueByDay: ga4OrganicByDay } = useGA4Data();
  const ecomm = useEcommerceSummary();

  /** Organic ανά ημέρα (import ή GA4) στις ίδιες ημερομηνίες με το ημερήσιο e-shop summary — για δίκαιο gap. */
  const organicAlignedToEcommDays = useMemo(() => {
    if (!ecomm.hasData || ecomm.dailyRevenue.length === 0) return totalOrganicRevenue;
    let s = 0;
    for (const { date } of ecomm.dailyRevenue) {
      if (!date) continue;
      s += organicRevenueForSingleDay(date, organicByMonth, ga4OrganicByDay);
    }
    return s;
  }, [ecomm.hasData, ecomm.dailyRevenue, totalOrganicRevenue, organicByMonth, ga4OrganicByDay]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των οργανικών εσόδων (${records.length} εγγραφές) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('organic', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['organic', currentBrand.id] });
      toast.success('Τα οργανικά έσοδα διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση οικονομικών…" />
      </div>
    );
  }

  if (!hasImported && !ecomm.hasData && totalOrganicRevenue <= 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Οικονομικά Επιχείρησης</h2>}
          description={<p className="text-sm text-[#4A4A4A] sm:text-base">Τζίρος και οργανικά έσοδα (χωρίς campaigns)</p>}
        />
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">
            Δεν υπάρχουν εισαγόμενα οργανικά έσοδα ακόμα.
          </p>
          <p className="text-sm text-[#4A4A4A]">
            Εισάγετε οργανικό τζίρο από την{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-organic')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              καρτέλα οργανικών εσόδων
            </button>
            .
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Διαχείριση δεδομένων"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Οικονομικά Επιχείρησης</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Τζίρος οργανικός (χωρίς έσοδα από campaigns)
            {hasImported ? ` · ${records.length} περίοδοι εισαγωγής` : organicRevenueSource === 'ga4' ? ' · από GA4 (organic channels)' : ''}
          </p>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={handleDelete}
            disabled={isDeleting || !hasImported}
            className="min-h-[36px] w-full text-[#DC2626] hover:bg-[#FEE2E2] sm:w-auto"
          >
            {isDeleting ? (
              'Διαγραφή…'
            ) : (
              <>
                <span className="sm:hidden">Διαγραφή</span>
                <span className="hidden sm:inline">Διαγραφή δεδομένων</span>
              </>
            )}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="md" className="border-l-4 border-l-[#22C55E]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
              <Euro size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Σύνολο Οργανικών Εσόδων</p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                €{formatCurrency(totalOrganicRevenue, 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#F5F5F5] rounded-lg flex items-center justify-center">
              <Calendar size={20} className="text-[#4A4A4A]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Περίοδοι</p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">{records.length}</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--nts-light-gray)] rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-[var(--nts-accent)]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Μέσος Όρος/Περίοδο</p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                €{records.length > 0 ? formatNumber(Math.round(totalOrganicRevenue / records.length)) : '0'}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" className={ecomm.hasData ? 'border-l-4 border-l-[#10B981]' : ''}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#ECFDF5] rounded-lg flex items-center justify-center">
              <Euro size={20} className="text-[#10B981]" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <p className="text-sm text-[#4A4A4A]">e-shop Revenue (E-commerce)</p>
                <Tooltip
                  content="Άθροισμα από τη σύνοψη e-commerce (συνήθως τελευταίες ~90 ημέρες sync). Το gap από κάτω χρησιμοποιεί organic στις ίδιες ημερομηνίες με το ημερήσιο e-shop."
                  size={12}
                />
              </div>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {ecomm.hasData ? `€${formatCurrency(ecomm.totalRevenue, 0)}` : '—'}
              </p>
              <p className="text-xs text-[#4A4A4A]">
                {ecomm.hasData ? `${formatNumber(ecomm.orderCount)} orders` : 'Χωρίς e-commerce sync'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {ecomm.hasData && (
        <Card padding="md" className="bg-[#F9FAFB] border-[#E5E7EB]">
          <p className="text-sm text-[#4A4A4A]">
            Revenue Gap (e-shop − Organic, ίδιες ημέρες ημερ. σύνοψης):{' '}
            <strong
              className={
                ecomm.totalRevenue - organicAlignedToEcommDays >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
              }
            >
              €{formatCurrency(ecomm.totalRevenue - organicAlignedToEcommDays, 0)}
            </strong>
          </p>
          <p className="text-xs text-[#6B7280] mt-2">
            Το «Σύνολο Οργανικών» παραπάνω μπορεί να είναι συνολικό import ή GA4· εδώ το organic στο gap ευθυγραμμίζεται με τις ημερομηνίες του ημερήσιου e-shop.
          </p>
        </Card>
      )}

      {records.length > 0 && (
        <Card padding="lg">
          <h3 className="font-semibold text-[#1A1A1A] mb-4">Λεπτομέρειες ανά περίοδο</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <th className="pb-3 font-medium">Περίοδος</th>
                  <th className="pb-3 font-medium text-right">Οργανικά Έσοδα</th>
                </tr>
              </thead>
              <tbody>
                {([...records] as OrganicRevenue[]).sort((a, b) => (b.period || '').localeCompare(a.period || '')).map((r) => (
                  <tr key={r.id} className="border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5]">
                    <td className="py-3 font-medium text-[#1A1A1A]">{r.period}</td>
                    <td className="py-3 text-right font-mono">
                      €{formatCurrency(r.organic_revenue || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
